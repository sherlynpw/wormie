#!/usr/bin/env bash
# Build the entire wormie.rs.ht database from scratch using only public sources +
# the two static CSVs committed under data/. No external pipeline DB required,
# fully reproducible, designed to run in CI on a clean checkout.
#
# Outputs static/data/wormie.sqlite.gz + static/data/version.json.
#
# Cache dir: .cache/ (downloaded sources). Safe to delete; will re-download.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CACHE="${CACHE:-.cache}"
DEST_DIR="${DEST_DIR:-static/data}"
WORMCAT_CSV="${WORMCAT_CSV:-$ROOT/data/wormcat_whole_genome_v2.csv}"
NEURONAL_CSV="${NEURONAL_CSV:-$ROOT/data/neuronal_genes.csv}"
SYNAPTO_TSV="${SYNAPTO_TSV:-$ROOT/data/synaptogenesis_genes.tsv}"

mkdir -p "$CACHE" "$DEST_DIR"

# WS298 is WormBase's final major release, so pin rather than auto-detect.
# WB_RELEASE overrides; WB_AUTODETECT=1 probes the EBI mirror again.
WB_RELEASE="${WB_RELEASE:-WS298}"
if [[ "${WB_AUTODETECT:-}" == "1" ]]; then
  DETECTED="$(curl -fsS --max-time 10 'https://ftp.ebi.ac.uk/pub/databases/wormbase/releases/' 2>/dev/null | grep -oE 'WS[0-9]+' | sort -u -t S -k 2 -n | tail -1)"
  WB_RELEASE="${DETECTED:-$WB_RELEASE}"
fi
echo "WormBase release: $WB_RELEASE"

EBI_WB="https://ftp.ebi.ac.uk/pub/databases/wormbase/releases/${WB_RELEASE}/species/c_elegans/PRJNA13758/annotation"
GENE_IDS="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.geneIDs.txt.gz"
# Canonical gene models, shipped for /counts so nobody has to hunt for a GTF that
# matches the assembly. Served on demand, not bundled into the database.
GTF_URL="https://ftp.ebi.ac.uk/pub/databases/wormbase/releases/${WB_RELEASE}/species/c_elegans/PRJNA13758/c_elegans.PRJNA13758.${WB_RELEASE}.canonical_geneset.gtf.gz"
GTF_GZ="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.canonical_geneset.gtf.gz"
FUNC_DESC="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.functional_descriptions.txt.gz"
XREFS="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.xrefs.txt.gz"
# Genetic map: interpolated cM per cosmid or YAC clone; genes take their clone's position.
CLONE_MAP="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.interpolated_clones.txt.gz"
# Allele-level phenotype associations
WB_PHENO="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.phenotype_association.wb.gz"
# RNAi reagent → gene → phenotype mapping
RNAI_PHENO="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.rnai_phenotypes.wb.gz"
GAF_URL="https://current.geneontology.org/annotations/wb.gaf.gz"
OBO_URL="https://current.geneontology.org/ontology/go.obo"
ALLIANCE_ORTHO_URL="https://fms.alliancegenome.org/download/ORTHOLOGY-ALLIANCE_COMBINED.tsv.gz"
ALLIANCE_PHENO_URL="https://fms.alliancegenome.org/download/PHENOTYPE_WB.json.gz"
ALLIANCE_EXPR_URL="https://fms.alliancegenome.org/download/EXPRESSION-ALLIANCE_WB.tsv"
ALLIANCE_DISEASE_URL="https://fms.alliancegenome.org/download/DISEASE-ALLIANCE_WB.tsv.gz"
ALLIANCE_BGI_URL="https://fms.alliancegenome.org/download/BGI_WB.json.gz"
# WBVar id -> public allele name (e.g. e1370); the phenotype GAF carries only the WBVar id.
ALLIANCE_ALLELE_URL="https://fms.alliancegenome.org/download/ALLELE_WB.json.gz"
WBPHENO_OBO_URL="https://raw.githubusercontent.com/obophenotype/c-elegans-phenotype-ontology/master/wbphenotype.obo"
WBBT_OBO_URL="https://raw.githubusercontent.com/obophenotype/c-elegans-gross-anatomy-ontology/master/wbbt.obo"
BIOGRID_ZIP_URL="https://downloads.thebiogrid.org/Download/BioGRID/Latest-Release/BIOGRID-ORGANISM-LATEST.tab3.zip"
# CeNGEN L4 integrated single-cell + bulk expression, contamination-subtracted (LittleBites) and
# proportion-adjusted, one column per neuron type (Barrett et al. 2025 preprint, analysis repo).
# The per-sample bulk TMM file is read only for the replicate count per neuron type.
CENGEN_REPO="https://raw.githubusercontent.com/cengenproject/CeNGEN_integrated_analysis_2024/HEAD/Data"
CENGEN_URL="$CENGEN_REPO/bsn12_subtracted_integrated_propadjust_071724.tsv.gz"
CENGEN_BULK_URL="$CENGEN_REPO/bsn12_bulk_subtracted_TMM_051624.tsv.gz"
CENGEN_VERSION="2024-07-17-L4-integrated-bsn12"
# CeNGEN per-neuron binary expression calls at four thresholds
CENGEN_T1_URL="https://cengen.org/storage/021821_liberal_threshold1.csv"
CENGEN_T2_URL="https://cengen.org/storage/021821_medium_threshold2.csv"
CENGEN_T3_URL="https://cengen.org/storage/021821_conservative_threshold3.csv"
CENGEN_T4_URL="https://cengen.org/storage/021821_stringent_threshold4.csv"
# Alliance bibliography
ALLIANCE_REF_URL="https://fms.alliancegenome.org/download/REFERENCE_WB.json.gz"

GAF="$CACHE/wb.gaf.gz"
OBO="$CACHE/go.obo"
ORTHO="$CACHE/ORTHOLOGY-ALLIANCE_COMBINED.tsv.gz"
PHENO_JSON="$CACHE/PHENOTYPE_WB.json.gz"
EXPR_TSV="$CACHE/EXPRESSION-ALLIANCE_WB.tsv"
DISEASE_TSV="$CACHE/DISEASE-ALLIANCE_WB.tsv.gz"
BGI_JSON="$CACHE/BGI_WB.json.gz"
ALLELE_JSON="$CACHE/ALLELE_WB.json.gz"
WBPHENO_OBO="$CACHE/wbphenotype.obo"
WBBT_OBO="$CACHE/wbbt.obo"
BIOGRID_ZIP="$CACHE/BIOGRID-ORGANISM-LATEST.tab3.zip"
BIOGRID_TAB="" # set after unzip
CENGEN_TSV="$CACHE/cengen_L4_integrated_2024.tsv.gz"
CENGEN_BULK="$CACHE/cengen_bulk_TMM_2024.tsv.gz"
CENGEN_T1="$CACHE/cengen_threshold1_liberal.csv"
CENGEN_T2="$CACHE/cengen_threshold2_medium.csv"
CENGEN_T3="$CACHE/cengen_threshold3_conservative.csv"
CENGEN_T4="$CACHE/cengen_threshold4_stringent.csv"
REF_JSON="$CACHE/REFERENCE_WB.json.gz"
# NCBI gene-to-publication links (comprehensive per-gene literature). Full file
# is ~255 MB all-species; stream-filtered to C. elegans (tax 6239) on download.
GENE2PUBMED_URL="https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene2pubmed.gz"
GENE2PUBMED_CE="$CACHE/gene2pubmed_ce.tsv"

# FORCE_REFRESH=1 refetches even when cached; a warm .cache otherwise pins the
# build to whatever was downloaded previously.
fetch() {
  local url="$1" dest="$2"
  if [[ ! -f "$dest" || "${FORCE_REFRESH:-}" == "1" ]]; then
    echo "Downloading $(basename "$dest")..."
    curl -fsSL "$url" -o "$dest"
  fi
}

fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.geneIDs.txt.gz" "$GENE_IDS"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.functional_descriptions.txt.gz" "$FUNC_DESC"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.xrefs.txt.gz" "$XREFS"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.interpolated_clones.txt.gz" "$CLONE_MAP"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.phenotype_association.wb.gz" "$WB_PHENO"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.rnai_phenotypes.wb.gz" "$RNAI_PHENO"
fetch "$GTF_URL" "$GTF_GZ" || echo "warning: canonical geneset GTF unavailable for $WB_RELEASE" >&2
fetch "$GAF_URL" "$GAF"
fetch "$OBO_URL" "$OBO"
fetch "$ALLIANCE_ORTHO_URL" "$ORTHO"
fetch "$ALLIANCE_PHENO_URL" "$PHENO_JSON"
fetch "$ALLIANCE_EXPR_URL" "$EXPR_TSV"
fetch "$ALLIANCE_DISEASE_URL" "$DISEASE_TSV"
fetch "$ALLIANCE_BGI_URL" "$BGI_JSON"
fetch "$ALLIANCE_ALLELE_URL" "$ALLELE_JSON"
fetch "$WBPHENO_OBO_URL" "$WBPHENO_OBO"
fetch "$WBBT_OBO_URL" "$WBBT_OBO"
fetch "$BIOGRID_ZIP_URL" "$BIOGRID_ZIP"
fetch "$CENGEN_URL" "$CENGEN_TSV"
fetch "$CENGEN_BULK_URL" "$CENGEN_BULK"
fetch "$CENGEN_T1_URL" "$CENGEN_T1"
fetch "$CENGEN_T2_URL" "$CENGEN_T2"
fetch "$CENGEN_T3_URL" "$CENGEN_T3"
fetch "$CENGEN_T4_URL" "$CENGEN_T4"
fetch "$ALLIANCE_REF_URL" "$REF_JSON"

# Stream-filter gene2pubmed to C. elegans -> gene_id<TAB>pmid. awk consumes the
# whole stream, so curl's pipe is never closed early (safe under pipefail).
if [[ ! -f "$GENE2PUBMED_CE" ]]; then
  echo "Downloading + filtering gene2pubmed (C. elegans)..."
  curl -fsSL --max-time 900 "$GENE2PUBMED_URL" | gunzip -c \
    | awk -F'\t' '$1=="6239"{print $2"\t"$3}' >"$GENE2PUBMED_CE"
fi

# Unzip BioGRID and resolve the C. elegans tab3 filename (contains the version)
# Version order, not name order: `ls | head -1` sorts 5.0.258 ahead of 5.0.259,
# so a cache holding both would build against the older release.
rm -f "$CACHE"/BIOGRID-ORGANISM-Caenorhabditis_elegans-*.tab3.txt
(cd "$CACHE" && unzip -o BIOGRID-ORGANISM-LATEST.tab3.zip 'BIOGRID-ORGANISM-Caenorhabditis_elegans-*.tab3.txt' >/dev/null)
BIOGRID_TAB="$(ls "$CACHE"/BIOGRID-ORGANISM-Caenorhabditis_elegans-*.tab3.txt | sort -V | tail -1)"
BIOGRID_VERSION="$(basename "$BIOGRID_TAB" | sed -E 's/.*-([0-9.]+)\.tab3\.txt/\1/')"
echo "BioGRID version: $BIOGRID_VERSION"

TMP_DB="$(mktemp)"
trap 'rm -f "$TMP_DB" "$TMP_DB-wal" "$TMP_DB-shm"' EXIT

if command -v uv >/dev/null 2>&1; then
  PY=(uv run --quiet --with numpy --with Pillow python3)
else
  PY=(python3)
fi

# Fail here rather than 20 minutes in.
if ! "${PY[@]}" -c 'import numpy' >/dev/null 2>&1; then
  echo "error: numpy is required to build the CeNGEN co-expression table." >&2
  echo "       install it (pip install numpy) or install uv." >&2
  exit 1
fi

"${PY[@]}" - "$TMP_DB" "$WORMCAT_CSV" "$NEURONAL_CSV" "$GAF" "$OBO" "$ORTHO" "$BIOGRID_TAB" "$PHENO_JSON" "$WBPHENO_OBO" "$WBBT_OBO" "$EXPR_TSV" "$BGI_JSON" "$GENE_IDS" "$FUNC_DESC" "$XREFS" "$WB_PHENO" "$CENGEN_TSV" "$CENGEN_BULK" "$CENGEN_T1" "$CENGEN_T2" "$CENGEN_T3" "$CENGEN_T4" "$DISEASE_TSV" "$RNAI_PHENO" "$SYNAPTO_TSV" "$REF_JSON" "$GENE2PUBMED_CE" "$CACHE/paper_meta" "$DEST_DIR" "$ALLELE_JSON" "$CLONE_MAP" <<'PY'
import csv, gzip, json, math, re, sqlite3, sys
from pathlib import Path

(db_path, wormcat_csv, neuronal_csv, gaf_path, obo_path, ortho_gz,
 biogrid_tab, pheno_json_gz, wbpheno_obo, anatomy_obo, anatomy_assoc,
 bgi_json_gz, gene_ids_path, func_desc_path, xrefs_path, wb_pheno_gz,
 cengen_tsv, cengen_bulk, cengen_t1, cengen_t2, cengen_t3, cengen_t4, disease_tsv,
 rnai_pheno_gz, synapto_tsv, reference_json_gz, gene2pubmed_ce,
 paper_cache_dir, dest_dir, allele_json_gz, clone_map_gz) = sys.argv[1:32]

conn = sqlite3.connect(db_path)
conn.executescript('PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL;')
cur = conn.cursor()

# ---------- annotations (WS) ----------
def normalize_type(t):
    if not t: return None
    t = t.replace('_gene', '').replace('_', ' ').strip()
    return t or None

cur.executescript("""
CREATE TABLE annotations (
  wormbase_gene TEXT,
  gene_name TEXT,
  gene_class_description TEXT,
  concise_description TEXT,
  legacy_description TEXT,
  sequence_name TEXT,
  gene_type TEXT,
  operon TEXT,
  other_names TEXT,
  status TEXT
);
CREATE INDEX idx_anno_wb ON annotations(wormbase_gene);
""")

rows = []
with gzip.open(gene_ids_path, 'rt', encoding='utf-8') as f:
    for line in f:
        parts = line.rstrip('\n').split(',')
        if len(parts) < 6: continue
        _taxon, wb, name, seq, status, gtype = parts[:6]
        if not wb.startswith('WBGene'): continue
        rows.append((wb, name or None, None, None, None, seq or None,
                     normalize_type(gtype), None, None, status or None))
cur.executemany('INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?,?,?)', rows)
print(f'annotations: {len(rows)} rows', file=sys.stderr)

# Description sections from functional_descriptions
SECTIONS = {
    'Concise description': 'concise',
    'Provisional description': 'provisional',
    'Automated description': 'automated',
    'Gene class description': 'gene_class',
}
HEADER_RE = re.compile(r'^(WBGene\d+)\s')
SECTION_RE = re.compile(r'^(' + '|'.join(re.escape(k) for k in SECTIONS) + r'):\s?(.*)$')
# WormBase stores literal placeholders for unannotated genes (e.g. 21U piRNAs).
# Treat them as missing so cards don't render the placeholder text and so the
# description-bucket sort puts these genes after truly annotated ones.
PLACEHOLDER_RE = re.compile(
    r'^\s*(none\s+available|not\s+available|no\s+description\s+available|unavailable|n/?a)\.?\s*$',
    re.IGNORECASE
)

descs = {}
state = {'wb': None, 'sect': None, 'buf': []}
def flush_section():
    if state['wb'] and state['sect']:
        text = ' '.join(b.strip() for b in state['buf']).strip()
        if text and not PLACEHOLDER_RE.match(text):
            descs.setdefault(state['wb'], {})[state['sect']] = text
    state['sect'] = None
    state['buf'] = []

with gzip.open(func_desc_path, 'rt', encoding='utf-8') as f:
    for raw in f:
        line = raw.rstrip('\n')
        if not line or line.startswith('#'): continue
        if line == '=':
            flush_section(); state['wb'] = None; continue
        m = HEADER_RE.match(line)
        if m:
            flush_section(); state['wb'] = m.group(1); continue
        m = SECTION_RE.match(line)
        if m:
            flush_section(); state['sect'] = SECTIONS[m.group(1)]
            if m.group(2): state['buf'].append(m.group(2))
            continue
        if state['sect']: state['buf'].append(line)
    flush_section()

updates = []
for wb, d in descs.items():
    # Only curated / provisional text counts as "concise". Automated
    # descriptions (e.g. "Is affected by ogt-1; daf-2; and daf-16 based on
    # RNA-seq studies.") are always treated as the legacy field, otherwise
    # they'd dominate the description-bucket sort and surface ahead of
    # genuinely annotated genes.
    concise = d.get('concise') or d.get('provisional')
    legacy = d.get('automated')
    updates.append((concise, legacy, d.get('gene_class'), wb))
cur.executemany(
    'UPDATE annotations SET concise_description=?, legacy_description=?, gene_class_description=? WHERE wormbase_gene=?',
    updates,
)
print(f'descriptions: {len(updates)} genes', file=sys.stderr)

# ---------- entrez_to_wb / wb_to_entrez (from Alliance BGI cross-refs) ----------
cur.executescript("""
CREATE TABLE entrez_to_wb (entrez_id TEXT PRIMARY KEY, wormbase_gene TEXT NOT NULL);
CREATE TABLE wb_to_entrez (wormbase_gene TEXT PRIMARY KEY, entrez_id TEXT NOT NULL);
""")
with gzip.open(bgi_json_gz, 'rt', encoding='utf-8') as f:
    bgi = json.load(f)
e_rows = []
gene_synonyms = {}
for g in bgi.get('data', []):
    be = g.get('basicGeneticEntity', {}) or {}
    wb_raw = be.get('primaryId') or ''
    if not wb_raw.startswith('WB:WBGene'): continue
    wb = wb_raw[3:]
    # CELE_* entries duplicate the sequence name; the rest are the literature
    # aliases (nca-1 for unc-77, snap-25 for ric-4) users actually search for.
    syns = [s for s in (be.get('synonyms') or []) if s and not s.startswith('CELE_')]
    if syns: gene_synonyms[wb] = syns
    for x in be.get('crossReferences', []) or []:
        xid = x.get('id', '')
        if xid.startswith('NCBI_Gene:'):
            e_rows.append((xid.split(':', 1)[1], wb))
            break
cur.executemany('INSERT OR REPLACE INTO entrez_to_wb VALUES (?,?)', e_rows)

# Genome location from the same Alliance record (WBcel235 coordinates).
cur.executescript("""
CREATE TABLE gene_location (
  wormbase_gene TEXT PRIMARY KEY,
  chromosome TEXT NOT NULL,
  start_pos INTEGER NOT NULL,
  end_pos INTEGER NOT NULL,
  strand TEXT,
  assembly TEXT,
  cm REAL,
  cm_source TEXT
);
CREATE INDEX idx_gene_location_chrom ON gene_location(chromosome);
""")
loc_rows = []
for g in bgi.get('data', []):
    be = g.get('basicGeneticEntity', {}) or {}
    wb_raw = be.get('primaryId') or ''
    if not wb_raw.startswith('WB:WBGene'): continue
    locs = be.get('genomeLocations') or []
    if not locs: continue
    loc = locs[0]
    chrom = loc.get('chromosome'); s0 = loc.get('startPosition'); e0 = loc.get('endPosition')
    if not chrom or s0 is None or e0 is None: continue
    loc_rows.append((wb_raw[3:], str(chrom), int(s0), int(e0), loc.get('strand'), loc.get('assembly')))

# Genetic position in cM. A gene takes the interpolated position WormBase gives
# its clone (the cosmid or YAC named by its sequence name, R13H8.1 -> R13H8);
# the few genes whose clone has no position are interpolated by base pair between
# the nearest positioned genes on the same chromosome.
clone_cm = {}
if Path(clone_map_gz).is_file():
    with gzip.open(clone_map_gz, 'rt', encoding='utf-8') as f:
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) >= 3:
                try: clone_cm[p[0]] = (p[1], float(p[2]))
                except ValueError: pass
seq_of = dict(cur.execute('SELECT wormbase_gene, sequence_name FROM annotations WHERE sequence_name IS NOT NULL'))
anchors = {}
cm_rows = []
pending = []
for wb, chrom, s0, e0, strand, asm in loc_rows:
    clone = (seq_of.get(wb) or '').split('.')[0]
    hit = clone_cm.get(clone)
    if hit and hit[0] == chrom:
        cm_rows.append((wb, chrom, s0, e0, strand, asm, hit[1], 'clone'))
        anchors.setdefault(chrom, []).append(((s0 + e0) / 2, hit[1]))
    else:
        pending.append((wb, chrom, s0, e0, strand, asm))
for ch in anchors: anchors[ch].sort()
import bisect
for wb, chrom, s0, e0, strand, asm in pending:
    pts = anchors.get(chrom)
    if not pts:
        cm_rows.append((wb, chrom, s0, e0, strand, asm, None, None)); continue
    mid = (s0 + e0) / 2
    i = bisect.bisect_left(pts, (mid, float('-inf')))
    if i == 0: cm = pts[0][1]
    elif i >= len(pts): cm = pts[-1][1]
    else:
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        cm = y0 if x1 == x0 else y0 + (y1 - y0) * (mid - x0) / (x1 - x0)
    cm_rows.append((wb, chrom, s0, e0, strand, asm, round(cm, 4), 'interpolated'))
cur.executemany('INSERT OR REPLACE INTO gene_location VALUES (?,?,?,?,?,?,?,?)', cm_rows)
n_clone = sum(1 for r in cm_rows if r[7] == 'clone')
print(f'gene_location: {len(cm_rows)} genes ({n_clone} with a clone cM, {len(clone_cm)} clones mapped)', file=sys.stderr)
cur.executemany('INSERT OR REPLACE INTO wb_to_entrez VALUES (?,?)', [(wb, eid) for eid, wb in e_rows])
print(f'entrez_to_wb: {len(e_rows)} mappings', file=sys.stderr)

# annotations.other_names was schema-only until now: it is FTS-indexed and
# shown on the gene page, but nothing filled it, so alias searches found
# nothing. Fill it from the Alliance synonyms.
cur.executemany(
    'UPDATE annotations SET other_names = ? WHERE wormbase_gene = ?',
    [(' | '.join(v), k) for k, v in gene_synonyms.items()],
)
print(f'other_names: synonyms for {len(gene_synonyms)} genes', file=sys.stderr)

# Symbol resolver for the curated panels, shared by the neuronal and
# synaptogenesis ingests below. Canonical WormBase names claim a symbol first;
# Alliance synonyms fill the gaps, so a curated row naming nca-1 lands on
# unc-77 instead of being dropped.
sym_to_wb = {}
for wb, name in cur.execute(
    'SELECT wormbase_gene, gene_name FROM annotations WHERE gene_name IS NOT NULL'
).fetchall():
    sym_to_wb.setdefault(name.lower(), wb)
for wb, syns in gene_synonyms.items():
    for s in syns:
        sym_to_wb.setdefault(s.lower(), wb)

# ---------- WormCat ----------
cur.executescript("""
CREATE TABLE wormcat (
  wormbase_gene TEXT NOT NULL,
  sequence_id TEXT,
  category_1 TEXT, category_2 TEXT, category_3 TEXT,
  auto_description TEXT,
  PRIMARY KEY (wormbase_gene)
);
CREATE INDEX idx_wormcat_cat1 ON wormcat(category_1);
CREATE INDEX idx_wormcat_cat2 ON wormcat(category_2);
CREATE INDEX idx_wormcat_cat3 ON wormcat(category_3);
""")
wc_rows = []
if Path(wormcat_csv).is_file():
    with open(wormcat_csv, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            wb = (row.get('Wormbase ID') or '').strip()
            if not wb: continue
            def clean(v):
                v = (v or '').strip()
                return None if not v or v.lower() == 'unassigned' else v
            wc_rows.append((
                wb,
                (row.get('Sequence ID') or '').strip() or None,
                clean(row.get('Category 1')),
                clean(row.get('Category 2')),
                clean(row.get('Category 3')),
                (row.get('Automated Description') or '').strip() or None,
            ))
    cur.executemany('INSERT OR REPLACE INTO wormcat VALUES (?,?,?,?,?,?)', wc_rows)
    print(f'wormcat: {len(wc_rows)} genes', file=sys.stderr)

# ---------- Neuronal ----------
cur.executescript("""
CREATE TABLE neuronal (
  wormbase_gene TEXT NOT NULL,
  gene_name TEXT,
  category TEXT,
  supercategory TEXT,
  PRIMARY KEY (wormbase_gene, category)
);
CREATE INDEX idx_neuronal_sc ON neuronal(supercategory);
CREATE INDEX idx_neuronal_cat ON neuronal(category);
""")
n_rows = []
neuronal_skipped = []
if Path(neuronal_csv).is_file():
    with open(neuronal_csv, newline='') as f:
        for row in csv.DictReader(f):
            wb = (row.get('wormbase_id') or '').strip()
            name = (row.get('gene_name') or '').strip()
            if not wb and name:
                # A panel supplied as names only (a lab substituting its own)
                # resolves through canonical names and Alliance synonyms.
                wb = sym_to_wb.get(name.lower()) or ''
            if not wb:
                neuronal_skipped.append(name or '<blank row>')
                continue
            n_rows.append((
                wb,
                (row.get('gene_name') or '').strip() or None,
                (row.get('category') or '').strip() or None,
                (row.get('supercategory') or '').strip() or None,
            ))
    cur.executemany('INSERT OR REPLACE INTO neuronal VALUES (?,?,?,?)', n_rows)
    msg = f'neuronal: {len(n_rows)} rows'
    if neuronal_skipped:
        msg += f' ({len(neuronal_skipped)} rows skipped: no wormbase_id and the name resolved against neither source)'
    print(msg, file=sys.stderr)

# ---------- Synapse development and function panel (table: synaptogenesis) ----------
cur.executescript("""
CREATE TABLE synaptogenesis (
  wormbase_gene TEXT NOT NULL,
  gene_name TEXT,
  class TEXT NOT NULL,
  subclass TEXT,
  notes TEXT,
  refs TEXT,
  PRIMARY KEY (wormbase_gene, class)
);
CREATE INDEX idx_synapto_class ON synaptogenesis(class);
CREATE INDEX idx_synapto_subclass ON synaptogenesis(subclass);
""")
# Keyed by the curated wormbase_id column when present; a panel supplied as
# names only (a lab substituting its own) falls back to sym_to_wb above.
syn_rows = []
syn_unresolved = []
if Path(synapto_tsv).is_file():
    with open(synapto_tsv, encoding='utf-8') as f:
        header = None
        for line in f:
            if not line.strip() or line.startswith('#'): continue
            parts = line.rstrip('\n').split('\t')
            if header is None:
                header = [h.strip() for h in parts]
                continue
            if len(parts) < 2: continue
            row = dict(zip(header, (v.strip() for v in parts)))
            symbol = row.get('symbol', '')
            klass = row.get('class', '')
            subclass = row.get('subclass') or None
            notes = row.get('notes') or None
            refs = row.get('refs') or None
            if not symbol or not klass: continue
            wb = row.get('wormbase_id') or sym_to_wb.get(symbol.lower())
            if not wb:
                syn_unresolved.append(symbol)
                continue
            syn_rows.append((wb, symbol, klass, subclass or None, notes or None, refs))
    cur.executemany(
        'INSERT OR REPLACE INTO synaptogenesis VALUES (?,?,?,?,?,?)', syn_rows
    )
    msg = f'synaptogenesis: {len(syn_rows)} rows'
    if syn_unresolved:
        msg += f' ({len(syn_unresolved)} unresolved symbols: ' + ', '.join(syn_unresolved[:8])
        if len(syn_unresolved) > 8: msg += ', ...'
        msg += ')'
    print(msg, file=sys.stderr)

# Every panel row skipped during ingest, in full, written next to the database so
# a lab substituting its own panel can inspect the misses after the build. The
# stderr summaries above truncate; this file does not.
with open(Path(dest_dir) / 'unresolved-symbols.txt', 'w', encoding='utf-8') as rf:
    rf.write('# Curated panel rows skipped by this build.\n')
    rf.write('# A row is skipped when it carries no wormbase_id and its name resolved\n')
    rf.write('# against neither WormBase names nor Alliance synonyms.\n')
    for s in syn_unresolved:
        rf.write(f'synaptogenesis\t{s}\n')
    for s in neuronal_skipped:
        rf.write(f'neuronal\t{s}\n')

# ---------- GO ontology ----------
cur.executescript("""
CREATE TABLE go_terms (
  go_id TEXT PRIMARY KEY, name TEXT NOT NULL, namespace TEXT NOT NULL,
  definition TEXT, is_obsolete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE go_relations (
  child_id TEXT NOT NULL, parent_id TEXT NOT NULL, rel_type TEXT NOT NULL,
  PRIMARY KEY (child_id, parent_id, rel_type)
);
CREATE TABLE go_alt_ids (alt_id TEXT PRIMARY KEY, go_id TEXT NOT NULL);
CREATE TABLE go_synonyms (go_id TEXT NOT NULL, synonym TEXT NOT NULL);
CREATE INDEX idx_gorel_child  ON go_relations(child_id);
CREATE INDEX idx_gorel_parent ON go_relations(parent_id);
CREATE INDEX idx_go_syn ON go_synonyms(go_id);
""")
NS_MAP = {'biological_process': 'BP', 'molecular_function': 'MF', 'cellular_component': 'CC'}
terms, rels, alts, gosyns = [], [], [], []
cur_term = None
def flush(t):
    if not t or 'id' not in t or 'name' not in t or 'namespace' not in t: return
    terms.append((t['id'], t['name'], NS_MAP.get(t['namespace'], t['namespace']),
                  t.get('def'), 1 if t.get('obsolete') else 0))
    for p in t.get('is_a', []):
        rels.append((t['id'], p, 'is_a'))
    for rel in t.get('relationship', []):
        parts = rel.split(None, 1)
        if len(parts) == 2 and parts[1].startswith('GO:'):
            rels.append((t['id'], parts[1].split()[0], parts[0]))
    for a in t.get('alt_id', []):
        alts.append((a, t['id']))
    for s in t.get('synonyms', []):
        gosyns.append((t['id'], s))

with open(obo_path, encoding='utf-8') as f:
    in_term = False
    for raw in f:
        line = raw.rstrip('\n')
        if line == '[Term]':
            flush(cur_term); cur_term = {'is_a': [], 'relationship': [], 'alt_id': [], 'synonyms': []}; in_term = True; continue
        if line.startswith('['):
            flush(cur_term); cur_term = None; in_term = False; continue
        if not in_term or not line.strip() or ':' not in line: continue
        k, _, v = line.partition(': '); v = v.strip()
        if k == 'id': cur_term['id'] = v
        elif k == 'name': cur_term['name'] = v
        elif k == 'namespace': cur_term['namespace'] = v
        elif k == 'def':
            if v.startswith('"'):
                end = v.rfind('"')
                if end > 0: v = v[1:end]
            cur_term['def'] = v
        elif k == 'is_obsolete' and v == 'true':
            cur_term['obsolete'] = True
        elif k == 'is_a': cur_term['is_a'].append(v.split(' !')[0].strip())
        elif k == 'relationship': cur_term['relationship'].append(v.split(' !')[0].strip())
        elif k == 'alt_id': cur_term['alt_id'].append(v.strip())
        elif k == 'synonym':
            # synonym: "exact name" EXACT [] | "broader" BROAD [] | RELATED | NARROW
            if v.startswith('"'):
                end = v.find('"', 1)
                if end > 0:
                    cur_term['synonyms'].append(v[1:end])
    flush(cur_term)
cur.executemany('INSERT OR IGNORE INTO go_terms VALUES (?,?,?,?,?)', terms)
cur.executemany('INSERT OR IGNORE INTO go_relations VALUES (?,?,?)', rels)
cur.executemany('INSERT OR IGNORE INTO go_alt_ids VALUES (?,?)', alts)
cur.executemany('INSERT INTO go_synonyms VALUES (?,?)', gosyns)
print(f'go_terms: {len(terms)} | rels: {len(rels)} | alts: {len(alts)} | syns: {len(gosyns)}', file=sys.stderr)

# ---------- gene_go (GAF) ----------
cur.executescript("""
CREATE TABLE gene_go (
  wormbase_gene TEXT NOT NULL, go_id TEXT NOT NULL, qualifier TEXT,
  evidence_code TEXT NOT NULL, reference TEXT, with_from TEXT, aspect TEXT NOT NULL,
  assigned_by TEXT, annotation_date TEXT
);
CREATE INDEX idx_gene_go_gene ON gene_go(wormbase_gene);
CREATE INDEX idx_gene_go_term ON gene_go(go_id);
CREATE INDEX idx_gene_go_evi  ON gene_go(evidence_code);
""")
gaf_rows = []
with gzip.open(gaf_path, 'rt', encoding='utf-8') as f:
    for line in f:
        if not line or line.startswith('!'): continue
        cols = line.rstrip('\n').split('\t')
        if len(cols) < 15: continue
        if not cols[1].startswith('WBGene'): continue
        gaf_rows.append((cols[1].strip(), cols[4].strip(), cols[3].strip() or None,
                         cols[6].strip(), cols[5].strip() or None, cols[7].strip() or None,
                         cols[8].strip(), cols[14].strip() or None, cols[13].strip() or None))
cur.executemany('INSERT INTO gene_go VALUES (?,?,?,?,?,?,?,?,?)', gaf_rows)
print(f'gene_go: {len(gaf_rows)} direct annotations', file=sys.stderr)

# ---------- GO ancestor propagation (GOALL semantics) ----------
# Matches clusterProfiler's gseGO/enrichGO + GO.db's GOALL column: transitive
# closure over is_a, part_of, and the regulates family. occurs_in/has_part
# do not propagate. Required so GSEA/ORA results match the field's standard
# expectations; raw WormBase GAF stores only direct (leaf) annotations.
PROP_RELS = {'is_a', 'part_of', 'regulates', 'positively_regulates', 'negatively_regulates'}
alt_to_canon = dict(alts)
parents = {}
for c, p, rt in rels:
    if rt in PROP_RELS:
        parents.setdefault(c, set()).add(p)
ancestors = {}
sys.setrecursionlimit(50000)
def collect_ancestors(t, seen):
    if t in ancestors: return ancestors[t]
    if t in seen: return set()
    seen.add(t); out = set()
    for p in parents.get(t, ()):
        out.add(p); out |= collect_ancestors(p, seen)
    seen.discard(t); ancestors[t] = out
    return out
for t in list(parents):
    collect_ancestors(t, set())

# NOT-qualified annotations must not seed propagation: a negation applies to the
# term and its descendants, not its ancestors (gaudet2017). The rows stay in
# gene_go for display; enrichment/GSEA exclude them query-side.
def go_negated(qual):
    return bool(qual) and 'NOT' in qual.split('|')

seen_pair = set((g, go) for g, go, qual, *_ in gaf_rows if not go_negated(qual))
prop_rows = []
for g, direct_go, qual, *_ in gaf_rows:
    if go_negated(qual): continue
    canon = alt_to_canon.get(direct_go, direct_go)
    for anc in ancestors.get(canon, ()):
        key = (g, anc)
        if key in seen_pair: continue
        seen_pair.add(key)
        prop_rows.append((g, anc, None, 'IEA-PROP', None, None, '', 'GO-DAG', None))
cur.executemany('INSERT INTO gene_go VALUES (?,?,?,?,?,?,?,?,?)', prop_rows)
print(f'gene_go: +{len(prop_rows)} propagated (total {len(gaf_rows) + len(prop_rows)})', file=sys.stderr)

# ---------- Orthologs ----------
cur.executescript("""
CREATE TABLE orthologs (
  wormbase_gene TEXT NOT NULL, species TEXT NOT NULL, taxon_id TEXT NOT NULL,
  ortholog_id TEXT NOT NULL, ortholog_symbol TEXT NOT NULL,
  algorithms TEXT, algorithms_match INTEGER, out_of_algorithms INTEGER,
  is_best_score INTEGER, is_best_rev_score INTEGER,
  PRIMARY KEY (wormbase_gene, taxon_id, ortholog_id)
);
CREATE INDEX idx_ortho_wb ON orthologs(wormbase_gene);
CREATE INDEX idx_ortho_taxon ON orthologs(taxon_id);
CREATE INDEX idx_ortho_symbol ON orthologs(ortholog_symbol);
""")
WORM_TAXON = 'NCBITaxon:6239'
ortho_rows = []
seen_keys = set()
with gzip.open(ortho_gz, 'rt', encoding='utf-8') as f:
    for line in f:
        if not line or line.startswith('#'): continue
        cols = line.rstrip('\n').split('\t')
        if len(cols) < 13 or cols[0] == 'Gene1ID': continue
        g1_id, g1_sym, g1_tax, g1_sp, g2_id, g2_sym, g2_tax, g2_sp = cols[:8]
        algos = cols[8] or None
        def ti(x):
            try: return int(x)
            except: return None
        algos_match = ti(cols[9]); out_of = ti(cols[10])
        is_best = 1 if cols[11].lower().startswith('y') else 0
        is_best_rev = 1 if cols[12].lower().startswith('y') else 0
        if g1_tax == WORM_TAXON:
            wb_id, sp_id, sp_sym, sp_tax, sp_name = g1_id, g2_id, g2_sym, g2_tax, g2_sp
        elif g2_tax == WORM_TAXON:
            wb_id, sp_id, sp_sym, sp_tax, sp_name = g2_id, g1_id, g1_sym, g1_tax, g1_sp
        else: continue
        wb_id = wb_id.replace('WB:', '')
        if not wb_id.startswith('WBGene'): continue
        key = (wb_id, sp_tax, sp_id)
        if key in seen_keys: continue
        seen_keys.add(key)
        ortho_rows.append((wb_id, sp_name, sp_tax, sp_id, sp_sym, algos, algos_match, out_of, is_best, is_best_rev))
cur.executemany('INSERT OR IGNORE INTO orthologs VALUES (?,?,?,?,?,?,?,?,?,?)', ortho_rows)
print(f'orthologs: {len(ortho_rows)} pairs', file=sys.stderr)

# ---------- BioGRID interactions ----------
cur.executescript("""
CREATE TABLE interactions (
  gene_a TEXT NOT NULL, gene_b TEXT NOT NULL,
  symbol_a TEXT, symbol_b TEXT,
  experimental_system TEXT, experimental_type TEXT,
  author TEXT, pmid TEXT, throughput TEXT, score REAL,
  source TEXT NOT NULL DEFAULT 'biogrid'
);
CREATE INDEX idx_int_a ON interactions(gene_a);
CREATE INDEX idx_int_b ON interactions(gene_b);
CREATE INDEX idx_int_type ON interactions(experimental_type);
""")
entrez_to_wb = {e: w for e, w in cur.execute('SELECT entrez_id, wormbase_gene FROM entrez_to_wb')}
ix_rows = []; skipped = 0
with open(biogrid_tab, newline='') as f:
    reader = csv.reader(f, delimiter='\t')
    next(reader, None)
    for cols in reader:
        if len(cols) < 19: continue
        wb_a = entrez_to_wb.get(cols[1].strip())
        wb_b = entrez_to_wb.get(cols[2].strip())
        if not wb_a or not wb_b: skipped += 1; continue
        score_raw = cols[18].strip()
        try: score = float(score_raw) if score_raw and score_raw != '-' else None
        except ValueError: score = None
        ix_rows.append((wb_a, wb_b, cols[7].strip() or None, cols[8].strip() or None,
                        cols[11].strip() or None, cols[12].strip() or None,
                        cols[13].strip() or None, cols[14].strip() or None,
                        cols[17].strip() or None, score))
cur.executemany("INSERT INTO interactions VALUES (?,?,?,?,?,?,?,?,?,?,'biogrid')", ix_rows)
print(f'interactions: {len(ix_rows)} ({skipped} skipped, no Entrez->WB)', file=sys.stderr)

# ---------- STRING-DB high-confidence interactions ----------
# STRING v12 detailed links for C. elegans (NCBI taxon 6239), filtered to
# combined_score >= 700 ("high confidence"). Each edge keeps the seven STRING
# evidence channels so the per-gene panel can show an evidence breakdown.
# License: CC-BY 4.0. Pulled fresh at build time (cached under .cache/string).
cur.executescript("""
CREATE TABLE string_interactions (
  gene_a TEXT NOT NULL, gene_b TEXT NOT NULL,
  combined_score INTEGER NOT NULL,
  neighborhood INTEGER, fusion INTEGER, cooccurrence INTEGER,
  coexpression INTEGER, experimental INTEGER,
  database INTEGER, textmining INTEGER,
  PRIMARY KEY (gene_a, gene_b)
) WITHOUT ROWID;
CREATE INDEX idx_string_a ON string_interactions(gene_a);
CREATE INDEX idx_string_b ON string_interactions(gene_b);
""")
try:
    import os as _os, urllib.request as _ureq, gzip as _gz
    string_cache = _os.path.join(_os.environ.get('CACHE', '.cache'), 'string')
    _os.makedirs(string_cache, exist_ok=True)
    base = 'https://stringdb-downloads.org/download'
    aliases_url = f'{base}/protein.aliases.v12.0/6239.protein.aliases.v12.0.txt.gz'
    links_url = f'{base}/protein.links.detailed.v12.0/6239.protein.links.detailed.v12.0.txt.gz'
    aliases_path = _os.path.join(string_cache, '6239.protein.aliases.v12.0.txt.gz')
    links_path = _os.path.join(string_cache, '6239.protein.links.detailed.v12.0.txt.gz')
    for url, path in ((aliases_url, aliases_path), (links_url, links_path)):
        if not _os.path.exists(path):
            print(f'  downloading {url}', file=sys.stderr)
            _ureq.urlretrieve(url, path)
    string_to_wb = {}
    with _gz.open(aliases_path, 'rt', encoding='utf-8') as f:
        next(f, None)  # header
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 3: continue
            sp_id, alias, src = parts[0], parts[1], parts[2]
            if alias.startswith('WBGene'):
                string_to_wb.setdefault(sp_id, alias)
    print(f'string aliases: {len(string_to_wb)} STRING→WBGene mappings', file=sys.stderr)
    # Stream links.detailed. Space-separated. Filter combined_score >= 700.
    SCORE_MIN = 700
    rows = []
    skipped_lowscore = 0
    skipped_unmapped = 0
    with _gz.open(links_path, 'rt', encoding='utf-8') as f:
        next(f, None)  # header
        for line in f:
            toks = line.split()
            if len(toks) < 10: continue
            score = int(toks[9])
            if score < SCORE_MIN:
                skipped_lowscore += 1
                continue
            wa = string_to_wb.get(toks[0])
            wb = string_to_wb.get(toks[1])
            if not (wa and wb) or wa == wb:
                skipped_unmapped += 1
                continue
            # STRING ships each edge in both orderings; dedupe with sorted pair.
            if wa > wb:
                wa, wb = wb, wa
            rows.append((wa, wb, score,
                         int(toks[2]), int(toks[3]), int(toks[4]),
                         int(toks[5]), int(toks[6]), int(toks[7]), int(toks[8])))
    cur.executemany(
        'INSERT OR IGNORE INTO string_interactions VALUES (?,?,?,?,?,?,?,?,?,?)',
        rows,
    )
    print(
        f'string_interactions: {len(rows)} ordered pairs (after dedupe; '
        f'{skipped_lowscore} below score {SCORE_MIN}, {skipped_unmapped} unmapped)',
        file=sys.stderr,
    )
except Exception as e:
    print(f'STRING ingest failed (download or parse): {e}', file=sys.stderr)

# ---------- Phenotype ontology + gene-phenotype ----------
cur.executescript("""
CREATE TABLE phenotype_terms (
  term_id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT,
  is_obsolete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE gene_phenotype (
  wormbase_gene TEXT NOT NULL, term_id TEXT NOT NULL,
  statement TEXT, pmid TEXT, source_id TEXT
);
CREATE INDEX idx_gene_pheno_gene ON gene_phenotype(wormbase_gene);
CREATE INDEX idx_gene_pheno_term ON gene_phenotype(term_id);
""")

def parse_obo(path, prefix, sink, synonym_sink=None, rel_sink=None):
    # Captures synonyms when synonym_sink is provided and is_a relations when
    # rel_sink is provided. OBO lines look like:
    #   synonym: "Daf-c" RELATED []
    #   is_a: WBPhenotype:0000900 ! parent term name
    cur_t = None
    def flush_t(t):
        if not t or 'id' not in t or 'name' not in t: return
        if not t['id'].startswith(prefix): return
        sink.append((t['id'], t['name'], t.get('def'), 1 if t.get('obsolete') else 0))
        if synonym_sink is not None:
            for syn in t.get('synonyms', ()):
                synonym_sink.append((t['id'], syn))
        if rel_sink is not None:
            for parent in t.get('is_a', ()):
                if parent.startswith(prefix):
                    rel_sink.append((t['id'], parent))
    with open(path, encoding='utf-8') as f:
        in_t = False
        for raw in f:
            line = raw.rstrip('\n')
            if line == '[Term]':
                flush_t(cur_t); cur_t = {}; in_t = True; continue
            if line.startswith('['):
                flush_t(cur_t); cur_t = None; in_t = False; continue
            if not in_t or not line.strip() or ':' not in line: continue
            k, _, v = line.partition(': '); v = v.strip()
            if k == 'id': cur_t['id'] = v
            elif k == 'name': cur_t['name'] = v
            elif k == 'def':
                if v.startswith('"'):
                    end = v.rfind('"')
                    if end > 0: v = v[1:end]
                cur_t['def'] = v
            elif k == 'is_obsolete' and v == 'true':
                cur_t['obsolete'] = True
            elif k == 'is_a':
                cur_t.setdefault('is_a', []).append(v.split(' !')[0].strip())
            elif k == 'synonym':
                if v.startswith('"'):
                    end = v.find('"', 1)
                    if end > 0:
                        cur_t.setdefault('synonyms', []).append(v[1:end])
        flush_t(cur_t)

pheno_terms = []
pheno_syns = []  # (term_id, synonym)
pheno_rels = []  # (child_id, parent_id)
parse_obo(wbpheno_obo, 'WBPhenotype:', pheno_terms, pheno_syns, pheno_rels)
cur.executemany('INSERT OR IGNORE INTO phenotype_terms VALUES (?,?,?,?)', pheno_terms)
print(f'phenotype_terms: {len(pheno_terms)}', file=sys.stderr)
cur.executescript("""
CREATE TABLE phenotype_relations (
  child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
  PRIMARY KEY (child_id, parent_id)
);
CREATE INDEX idx_pheno_rel_child  ON phenotype_relations(child_id);
CREATE INDEX idx_pheno_rel_parent ON phenotype_relations(parent_id);
""")
cur.executemany('INSERT OR IGNORE INTO phenotype_relations VALUES (?,?)', pheno_rels)
print(f'phenotype_relations: {len(pheno_rels)}', file=sys.stderr)
# A simple side-table keeps the phenotype_terms schema unchanged while still
# letting the FTS aggregation reach synonyms by term_id.
cur.executescript("""
CREATE TABLE phenotype_synonyms (term_id TEXT NOT NULL, synonym TEXT NOT NULL);
CREATE INDEX idx_pheno_syn_term ON phenotype_synonyms(term_id);
""")
cur.executemany('INSERT INTO phenotype_synonyms VALUES (?,?)', pheno_syns)
print(f'phenotype_synonyms: {len(pheno_syns)}', file=sys.stderr)

# Allele-level phenotype associations from WormBase's GAF.
cur.executescript("""
CREATE TABLE allele_phenotype (
  allele_id     TEXT NOT NULL,
  wormbase_gene TEXT NOT NULL,
  term_id       TEXT NOT NULL,
  reference     TEXT,
  evidence_code TEXT,
  PRIMARY KEY (allele_id, wormbase_gene, term_id, reference)
);
CREATE INDEX idx_allele_pheno_gene   ON allele_phenotype(wormbase_gene);
CREATE INDEX idx_allele_pheno_allele ON allele_phenotype(allele_id);
CREATE INDEX idx_allele_pheno_term   ON allele_phenotype(term_id);
""")
gp_rows = []; ap_rows = []
seen_gp = set(); seen_ap = set()
variant_to_gene = {}
with gzip.open(wb_pheno_gz, 'rt', encoding='utf-8', errors='replace') as f:
    for line in f:
        if not line or line.startswith('!'): continue
        cols = line.rstrip('\n').split('\t')
        if len(cols) < 15: continue
        wb = cols[1].strip()
        if not wb.startswith('WBGene'): continue
        qualifier = cols[3].strip().upper()
        if 'NOT' in qualifier.split('|'): continue
        term_raw = cols[4].strip()
        ref = cols[5].strip() or None
        evidence = cols[6].strip() or None
        with_from = cols[7].strip()  # WB:WBVar... | WB:WBRNAi... etc, may be empty
        if not term_raw.startswith('WBPhenotype:'): continue
        # Gene-level: collapsed to (gene, term) pairs.
        key_g = (wb, term_raw, ref)
        if key_g not in seen_gp:
            seen_gp.add(key_g)
            gp_rows.append((wb, term_raw, None, (ref.split(':',1)[1] if ref and ':' in ref else None), wb))
        # Allele-level: only keep WBVar entries (skip transgenes / RNAi).
        for piece in with_from.split('|'):
            piece = piece.strip()
            if not piece.startswith('WB:WBVar'): continue
            allele = piece.replace('WB:', '')
            variant_to_gene.setdefault(allele, wb)
            key_a = (allele, wb, term_raw, ref)
            if key_a in seen_ap: continue
            seen_ap.add(key_a)
            ap_rows.append((allele, wb, term_raw, ref, evidence))

# Alliance Phenotype JSON
# Records keyed by objectId of three flavors:
#   WBGene -> direct gene-level annotation (free; just dedup against WB GAF)
#   WBVar  -> variant; remap via variant_to_gene built above
#   WBTrans -> transgene; skip (no clean gene mapping in this data source)
gp_alliance = 0; variant_remapped = 0; variant_unmapped = 0
import json as _json
with gzip.open(pheno_json_gz, 'rt', encoding='utf-8') as f:
    payload = _json.load(f)
for rec in payload.get('data', []):
    oid = rec.get('objectId', '')
    if oid.startswith('WB:'): oid = oid[3:]
    if not oid: continue
    terms = rec.get('phenotypeTermIdentifiers') or []
    if not terms: continue
    ev = rec.get('evidence') or {}
    xref = ev.get('crossReference') or {}
    ref = xref.get('id') or ev.get('publicationId') or None
    wb = None
    if oid.startswith('WBGene'):
        wb = oid
    elif oid.startswith('WBVar'):
        wb = variant_to_gene.get(oid)
        if wb: variant_remapped += 1
        else:  variant_unmapped += 1
    else:
        continue  # skip transgenes etc.
    if not wb: continue
    for t in terms:
        term_raw = (t.get('termId') or '').strip()
        if term_raw.startswith('WB:'): term_raw = term_raw[3:]
        if not term_raw.startswith('WBPhenotype:'): continue
        key_g = (wb, term_raw, ref)
        if key_g in seen_gp: continue
        seen_gp.add(key_g)
        ref_short = ref.split(':',1)[1] if ref and ':' in ref else ref
        gp_rows.append((wb, term_raw, None, ref_short, wb))
        gp_alliance += 1

cur.executemany('INSERT INTO gene_phenotype VALUES (?,?,?,?,?)', gp_rows)
cur.executemany('INSERT OR IGNORE INTO allele_phenotype VALUES (?,?,?,?,?)', ap_rows)
print(f'gene_phenotype: {len(gp_rows)} ({gp_alliance} from Alliance, {variant_remapped} variants remapped, {variant_unmapped} variants unmapped)', file=sys.stderr)
print(f'allele_phenotype: {len(ap_rows)} (allele-mediated)', file=sys.stderr)

# Public allele names, kept only for alleles that carry phenotypes. Alleles the
# Alliance file does not name stay unnamed and the UI shows the WBVar id.
cur.executescript("""
CREATE TABLE allele_names (
  allele_id TEXT PRIMARY KEY,
  name      TEXT NOT NULL
);
""")
_ap_ids = {r[0] for r in ap_rows}
allele_name_rows = []
with gzip.open(allele_json_gz, 'rt') as f:
    for a in json.load(f).get('data', []):
        aid = (a.get('primaryId') or '').removeprefix('WB:')
        name = (a.get('symbolText') or a.get('symbol') or '').strip()
        if aid in _ap_ids and name and name != aid:
            allele_name_rows.append((aid, name))
cur.executemany('INSERT OR IGNORE INTO allele_names VALUES (?,?)', allele_name_rows)
print(f'allele_names: {len(allele_name_rows)} of {len(_ap_ids)} phenotyped alleles named', file=sys.stderr)

# ---------- Anatomy (TEA) ----------
cur.executescript("""
CREATE TABLE anatomy_terms (
  term_id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT,
  is_obsolete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE gene_anatomy (
  wormbase_gene TEXT NOT NULL, term_id TEXT NOT NULL, evidence_code TEXT,
  PRIMARY KEY (wormbase_gene, term_id, evidence_code)
);
CREATE INDEX idx_gene_anat_gene ON gene_anatomy(wormbase_gene);
CREATE INDEX idx_gene_anat_term ON gene_anatomy(term_id);
""")
anat_terms = []
anat_syns = []
parse_obo(anatomy_obo, 'WBbt:', anat_terms, anat_syns)
cur.executemany('INSERT OR IGNORE INTO anatomy_terms VALUES (?,?,?,?)', anat_terms)
cur.executescript("""
CREATE TABLE anatomy_synonyms (term_id TEXT NOT NULL, synonym TEXT NOT NULL);
CREATE INDEX idx_anat_syn_term ON anatomy_synonyms(term_id);
""")
cur.executemany('INSERT INTO anatomy_synonyms VALUES (?,?)', anat_syns)
print(f'anatomy_terms: {len(anat_terms)} | syns: {len(anat_syns)}', file=sys.stderr)

ga_rows = []; seen_ga = set()
opener = gzip.open if anatomy_assoc.endswith('.gz') else open
with opener(anatomy_assoc, 'rt', encoding='utf-8', errors='replace') as f:
    in_header = True
    for raw in f:
        if not raw or raw.startswith('#'): continue
        parts = raw.rstrip('\n').split('\t')
        if in_header:
            if parts and parts[0] == 'Species': in_header = False
            continue
        if len(parts) < 18: continue
        wb_raw = parts[2].strip()
        assay = parts[7].strip() if len(parts) > 7 else ''
        term = parts[16].strip()
        qualifier = parts[18].strip().lower() if len(parts) > 18 else ''
        if not wb_raw.startswith('WB:WBGene'): continue
        wb = wb_raw[3:]
        if not term.startswith('WBbt:'): continue
        if 'not' in qualifier.split('|'): continue
        key = (wb, term, assay)
        if key in seen_ga: continue
        seen_ga.add(key)
        ga_rows.append((wb, term, assay or None))
cur.executemany('INSERT OR IGNORE INTO gene_anatomy VALUES (?,?,?)', ga_rows)
print(f'gene_anatomy: {len(ga_rows)} associations', file=sys.stderr)

# ---------- xrefs ----------
cur.executescript("""
CREATE TABLE gene_xrefs (
  wormbase_gene TEXT, transcript_seq_name TEXT, wormpep_acc TEXT,
  insdc_parent_acc TEXT, insdc_locus_tag TEXT, insdc_protein_id TEXT, uniprot_acc TEXT
);
CREATE INDEX idx_xrefs_wb ON gene_xrefs(wormbase_gene);
""")
xrows = []
with gzip.open(xrefs_path, 'rt', encoding='utf-8') as f:
    for line in f:
        if line.startswith('//') or not line.strip(): continue
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 9: continue
        _seq, wb, _cgc, tx, wormpep, ipar, iloc, iprot, uniprot = parts[:9]
        if not wb.startswith('WBGene'): continue
        na = lambda v: None if (not v or v == '.') else v
        xrows.append((wb, na(tx), na(wormpep), na(ipar), na(iloc), na(iprot), na(uniprot)))
cur.executemany('INSERT INTO gene_xrefs VALUES (?,?,?,?,?,?,?)', xrows)
print(f'gene_xrefs: {len(xrows)} rows', file=sys.stderr)

# ---------- CeNGEN L4 neuronal expression ----------
# Per-replicate TMM-normalized counts; aggregate to mean-by-neuron-type
# (replicate naming convention is NEURON + 'r' + digits, eg ADLr171). Only
# store entries above 0.5 TMM to keep the table compact while retaining
# all meaningful signal.
cur.executescript("""
CREATE TABLE cengen_neurons (
  neuron_type TEXT PRIMARY KEY,
  n_replicates INTEGER NOT NULL DEFAULT 0,
  has_binary INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE cengen_expression (
  wormbase_gene TEXT NOT NULL,
  neuron_type TEXT NOT NULL,
  tmm REAL NOT NULL,
  PRIMARY KEY (wormbase_gene, neuron_type)
) WITHOUT ROWID;
CREATE INDEX idx_cengen_gene ON cengen_expression(wormbase_gene);
CREATE INDEX idx_cengen_neuron ON cengen_expression(neuron_type);
-- Binary "expressed" calls per (gene, neuron) at the most-stringent CeNGEN
-- threshold passed (1=liberal, 2=medium, 3=conservative, 4=stringent). FACS-
-- calibrated calls used by the CeNGEN paper and web app.
CREATE TABLE cengen_calls (
  wormbase_gene TEXT NOT NULL,
  neuron_type TEXT NOT NULL,
  max_threshold INTEGER NOT NULL,
  PRIMARY KEY (wormbase_gene, neuron_type)
) WITHOUT ROWID;
CREATE INDEX idx_cengen_calls_gene ON cengen_calls(wormbase_gene);
CREATE INDEX idx_cengen_calls_neuron ON cengen_calls(neuron_type);
""")
NEURON_RE = re.compile(r'^(.+?)r\d+$')
# Wide tab-separated matrix: header is the neuron types, each row is WBGene then one value per
# type. Values are already averaged per type, so no replicate aggregation happens here.
def load_cengen_matrix(path):
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as f:
        types = [h.strip('"') for h in next(f).rstrip('\n').split('\t') if h.strip('"')]
        genes, rows = [], []
        for line in f:
            toks = line.rstrip('\n').split('\t')
            wb = toks[0].strip('"')
            if not wb.startswith('WBGene'): continue
            vals = []
            for v in toks[1:1 + len(types)]:
                try:
                    vals.append(float(v))
                except ValueError:
                    vals.append(0.0)
            if len(vals) < len(types): vals += [0.0] * (len(types) - len(vals))
            genes.append(wb); rows.append(vals)
    return types, genes, rows

cengen_types, cengen_genes, cengen_rows = load_cengen_matrix(cengen_tsv)
# Replicates per type come from the per-sample bulk header ("ADLr171", ...). DD and VD were sorted
# separately but the single-cell atlas does not split them, so the integrated matrix carries VD_DD.
rep_counts = {}
with gzip.open(cengen_bulk, 'rt', encoding='utf-8') as f:
    for h in next(f).rstrip('\n').split('\t'):
        m = NEURON_RE.match(h.strip('"'))
        if m: rep_counts[m.group(1)] = rep_counts.get(m.group(1), 0) + 1
rep_counts['VD_DD'] = rep_counts.pop('VD', 0) + rep_counts.pop('DD', 0)
type_to_idx = {nt: [0] * rep_counts.get(nt, 0) for nt in cengen_types}
# Contamination subtraction leaves most absent genes near zero; below 0.1 is treated as not detected.
CENGEN_MIN_VALUE = 0.1
expr_rows = []
for wb, vals in zip(cengen_genes, cengen_rows):
    for nt, v in zip(cengen_types, vals):
        if v < CENGEN_MIN_VALUE: continue
        expr_rows.append((wb, nt, round(v, 2)))
cur.executemany('INSERT INTO cengen_expression VALUES (?,?,?)', expr_rows)
print(f'cengen_expression: {len(expr_rows)} rows, {len(cengen_types)} neuron types with bulk data', file=sys.stderr)

# Binary thresholds: each CSV has the same 128-neuron schema. We track the
# *highest* threshold passed per (gene, neuron) so the UI can render a 4-dot
# confidence indicator (gene called liberally, medium, conservatively, or
# stringent). A pair absent from threshold1 is not called expressed at all.
binary_files = [(1, cengen_t1), (2, cengen_t2), (3, cengen_t3), (4, cengen_t4)]
binary_neurons = []  # neuron types present in the binary files
max_thresh = {}      # (wb, neuron) -> highest level passed
for level, path in binary_files:
    with open(path, encoding='utf-8', newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        # Header: ['', 'gene_name', 'Wormbase_ID', nt1, nt2, ...]
        neuron_cols = header[3:]
        if not binary_neurons:
            binary_neurons = neuron_cols[:]
        for row in reader:
            if len(row) < 4: continue
            wb = row[2]
            if not wb.startswith('WBGene'): continue
            for j, nt in enumerate(neuron_cols):
                v = row[3 + j]
                if not v: continue
                try:
                    val = float(v)
                except ValueError:
                    continue
                if val > 0:
                    key = (wb, nt)
                    if max_thresh.get(key, 0) < level:
                        max_thresh[key] = level
calls_rows = [(wb, nt, lvl) for (wb, nt), lvl in max_thresh.items()]
cur.executemany('INSERT INTO cengen_calls VALUES (?,?,?)', calls_rows)
print(f'cengen_calls: {len(calls_rows)} rows across {len(binary_neurons)} neuron types', file=sys.stderr)

# Union of neuron types from both sources. has_binary marks the 128 types
# covered by the FACS-calibrated binary calls; n_replicates is non-zero only
# for the types with bulk data (52, VD_DD merged).
all_neurons = set(type_to_idx.keys()) | set(binary_neurons)
neuron_rows = [
    (nt, len(type_to_idx.get(nt, [])), 1 if nt in binary_neurons else 0)
    for nt in sorted(all_neurons)
]
cur.executemany('INSERT INTO cengen_neurons VALUES (?,?,?)', neuron_rows)
print(f'cengen_neurons: {len(neuron_rows)} total ({len(binary_neurons)} with binary calls, {len(type_to_idx)} with bulk data)', file=sys.stderr)

# ---------- gene_rnai (WormBase rnai_phenotypes) ----------
# 5-column TSV: WBGene  seq_name  phenotype_name  WBPhenotype:id  WBRNAi|WBPaper[ WBRNAi|WBPaper ...]
# The last column is a space-separated list of reagent|paper pairs supporting
# that phenotype call. We explode it into one row per (gene, reagent, phenotype, paper).
# No clone-name or library tag is in this file; the UI deep-links each WBRNAi
# to wormbase.org for the bench-side clone metadata (sjj_*/mv_*, Ahringer plate).
cur.executescript("""
CREATE TABLE gene_rnai (
  wormbase_gene TEXT NOT NULL,
  wbrnai_id TEXT NOT NULL,
  phenotype_id TEXT,
  paper_id TEXT
);
CREATE INDEX idx_gene_rnai_wb ON gene_rnai(wormbase_gene);
CREATE INDEX idx_gene_rnai_rnai ON gene_rnai(wbrnai_id);
CREATE INDEX idx_gene_rnai_pheno ON gene_rnai(phenotype_id);
""")
rnai_rows = []
seen_pairs = set()  # dedupe identical (gene, rnai, pheno, paper) tuples
with gzip.open(rnai_pheno_gz, 'rt', encoding='utf-8') as f:
    for line in f:
        if line.startswith('!') or not line.strip(): continue
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 5: continue
        wb = parts[0]
        pheno_id = parts[3] or None
        if not wb.startswith('WBGene'): continue
        # parts[4] is e.g. "WBRNAi00084022|WBPaper00032438 WBRNAi00084023|WBPaper00032438"
        for token in parts[4].split():
            if '|' not in token: continue
            rnai_id, paper_id = token.split('|', 1)
            if not rnai_id.startswith('WBRNAi'): continue
            key = (wb, rnai_id, pheno_id, paper_id or None)
            if key in seen_pairs: continue
            seen_pairs.add(key)
            rnai_rows.append(key)
cur.executemany('INSERT INTO gene_rnai VALUES (?,?,?,?)', rnai_rows)
n_genes = len({r[0] for r in rnai_rows})
n_reagents = len({r[1] for r in rnai_rows})
print(f'gene_rnai: {len(rnai_rows)} rows ({n_genes} genes, {n_reagents} unique WBRNAi reagents)', file=sys.stderr)

# ---------- Disease associations (Alliance) ----------
# C. elegans gene -> human disease ontology terms
cur.executescript("""
CREATE TABLE gene_disease (
  wormbase_gene TEXT NOT NULL,
  do_id TEXT NOT NULL,
  do_name TEXT NOT NULL,
  association_type TEXT,
  with_ortholog TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  reference TEXT,
  PRIMARY KEY (wormbase_gene, do_id)
) WITHOUT ROWID;
CREATE INDEX idx_gene_disease_gene ON gene_disease(wormbase_gene);
CREATE INDEX idx_gene_disease_do   ON gene_disease(do_id);
""")
dz_acc = {}
with gzip.open(disease_tsv, 'rt', encoding='utf-8') as f:
    for line in f:
        if line.startswith('#') or line.startswith('Taxon\t'): continue
        cols = line.rstrip('\n').split('\t')
        if len(cols) < 10: continue
        # WB:WBGene00012345 → strip prefix
        wb = cols[3].split(':', 1)[-1] if cols[3] else ''
        if not wb.startswith('WBGene'): continue
        assoc = cols[5]
        do_id = cols[6]
        do_name = cols[7]
        with_ortho = cols[8]
        ref = cols[15] if len(cols) > 15 else ''
        if not do_id: continue
        key = (wb, do_id)
        if key in dz_acc:
            dz_acc[key]['n'] += 1
            if not dz_acc[key]['ref'] and ref:
                dz_acc[key]['ref'] = ref
        else:
            dz_acc[key] = {
                'name': do_name,
                'assoc': assoc,
                'ortho': with_ortho or None,
                'n': 1,
                'ref': ref or None
            }
cur.executemany(
    'INSERT INTO gene_disease VALUES (?,?,?,?,?,?,?)',
    [
        (wb, do_id, v['name'], v['assoc'], v['ortho'], v['n'], v['ref'])
        for (wb, do_id), v in dz_acc.items()
    ]
)
print(f'gene_disease: {len(dz_acc)} (gene, disease) pairs', file=sys.stderr)

# ---------- CeNGEN co-expression neighbors ----------
# Pearson similarity across the bulk TMM vector (52 neuron types, VD_DD merged)
cur.executescript("""
CREATE TABLE cengen_coexpression (
  wormbase_gene TEXT NOT NULL,
  neighbor      TEXT NOT NULL,
  pearson       REAL NOT NULL,
  mutual_rank   REAL NOT NULL,
  -- Both ranks behind mutual_rank: rank_self is the neighbour's position in this
  -- gene's list, rank_other this gene's position in the neighbour's. The pair
  -- (3, 100) and the pair (30, 30) share a mutual rank and mean different things.
  rank_self     INTEGER NOT NULL,
  rank_other    INTEGER NOT NULL,
  PRIMARY KEY (wormbase_gene, neighbor)
) WITHOUT ROWID;
CREATE INDEX idx_cengen_coexpr_gene ON cengen_coexpression(wormbase_gene);
""")
def _betacf(a, b, x, itmax=300, eps=3e-16):
    """Continued fraction for the incomplete beta function (Lentz's method)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny: d = tiny
    d = 1.0 / d
    h = d
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny: d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny: c = tiny
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny: d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny: c = tiny
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < eps: break
    return h

def _betainc(a, b, x):
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0.0: return 0.0
    if x >= 1.0: return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(lbeta + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b

def pearson_two_sided_p(r, n):
    """Two-sided p-value for a Pearson r over n paired observations."""
    df = n - 2
    if df <= 0: return 1.0
    r = min(abs(r), 1.0 - 1e-15)
    t2 = r * r * df / (1.0 - r * r)
    return _betainc(df / 2.0, 0.5, df / (df + t2))

def pearson_critical_r(n, alpha):
    """Smallest r significant at alpha (two-sided) for n paired observations."""
    lo, hi = 0.0, 1.0 - 1e-12
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if pearson_two_sided_p(mid, n) > alpha:
            lo = mid
        else:
            hi = mid
    return hi

import numpy as np
# Dense per-gene-per-neuron-type matrix from the integrated file parsed above.
print('Building CeNGEN co-expression neighbors...', file=sys.stderr)
type_order = list(cengen_types)
gene_ids = list(cengen_genes)
rows = cengen_rows
M = np.asarray(rows, dtype=np.float32)
# log1p so a few huge counts don't dominate the correlation.
M = np.log1p(M)
# Drop genes with no variance (Pearson undefined). They never become a
# useful neighbor anyway.
var = M.var(axis=1)
keep = var > 1e-8
if keep.sum() < 2:
    raise RuntimeError(f'co-expression matrix has <2 informative genes')
M = M[keep]
keep_ids = [g for g, k in zip(gene_ids, keep.tolist()) if k]
# Row-standardize so X @ X.T / D ≈ Pearson.
mu = M.mean(axis=1, keepdims=True)
std = M.std(axis=1, keepdims=True)
std[std < 1e-8] = 1.0
Z = (M - mu) / std
D = Z.shape[1]
N = Z.shape[0]

# Significance alone keeps 5.4M pairs (~217 MB) because the neighbour
# distribution has a long hub tail; also requiring reciprocity collapses the
# mean without gutting the median, and bounds the table at TOP_K per gene.
COEXPR_P = 0.001
TOP_K = 200
r_min = pearson_critical_r(D, COEXPR_P)
print(f'cengen co-expression: n={D} neuron types, p<{COEXPR_P} => r >= {r_min:.3f}, '
      f'reciprocal within top {TOP_K}', file=sys.stderr)

# Pass 1: significant neighbours per gene, sorted desc and capped at TOP_K.
nbr_idx = [None] * N
nbr_r = [None] * N
CHUNK = 1024
for i0 in range(0, N, CHUNK):
    i1 = min(i0 + CHUNK, N)
    block = Z[i0:i1] @ Z.T / D    # (chunk x N) Pearson
    for ii in range(i0, i1):
        block[ii - i0, ii] = -np.inf   # mask self-similarity
    for r_local in range(i1 - i0):
        row = block[r_local]
        idx = np.flatnonzero(row >= r_min)
        if idx.size == 0:
            nbr_idx[i0 + r_local] = np.empty(0, dtype=np.int32)
            nbr_r[i0 + r_local] = np.empty(0, dtype=np.float32)
            continue
        if idx.size > TOP_K:
            keep_top = np.argpartition(-row[idx], TOP_K)[:TOP_K]
            idx = idx[keep_top]
        order = np.argsort(-row[idx], kind='stable')
        idx = idx[order].astype(np.int32)
        nbr_idx[i0 + r_local] = idx
        nbr_r[i0 + r_local] = row[idx].astype(np.float32)

# Pass 2: keep reciprocal pairs, scored by mutual rank so broadly expressed
# genes don't head every list. Membership is tested by gene index rather than by
# comparing correlations: r_ij and r_ji come from different chunks, and a tie at
# the TOP_K boundary would keep a pair in one direction only.
sorted_nb = [None] * N   # neighbour ids in index order, for binary search
sorted_pos = [None] * N  # their positions in the rank-ordered list
for i in range(N):
    perm = np.argsort(nbr_idx[i], kind='stable')
    sorted_nb[i] = nbr_idx[i][perm]
    sorted_pos[i] = perm.astype(np.int32)

def rank_in(j, i):
    """1-based rank of gene i within gene j's list, or 0 when absent."""
    arr = sorted_nb[j]
    k = int(np.searchsorted(arr, i))
    if k >= arr.shape[0] or int(arr[k]) != i:
        return 0
    return int(sorted_pos[j][k]) + 1

coexpr_rows = []
kept_degree = [0] * N
for i in range(N):
    idx_i = nbr_idx[i]
    r_i = nbr_r[i]
    wb_src = keep_ids[i]
    for pos in range(idx_i.shape[0]):
        j = int(idx_i[pos])
        rank_j = rank_in(j, i)
        if rank_j == 0:
            continue   # not reciprocal: i is outside j's top-K
        rank_self = pos + 1
        mr = math.sqrt(rank_self * rank_j)
        coexpr_rows.append(
            (wb_src, keep_ids[j], round(float(r_i[pos]), 3), round(mr, 2), rank_self, rank_j)
        )
        kept_degree[i] += 1

cur.executemany('INSERT OR IGNORE INTO cengen_coexpression VALUES (?,?,?,?,?,?)', coexpr_rows)
med = int(np.median(kept_degree)) if kept_degree else 0
mean = float(np.mean(kept_degree)) if kept_degree else 0.0
print(f'cengen_coexpression: {len(coexpr_rows)} rows ({N} informative genes, '
      f'median {med} / mean {mean:.0f} neighbors per gene)', file=sys.stderr)

# ---------- KEGG cel pathways (worm-native: insulin/IGF, TGF-beta, longevity, etc.) ----------
cur.executescript("""
CREATE TABLE kegg_pathway (
  pathway_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE gene_kegg_pathway (
  wormbase_gene TEXT NOT NULL,
  pathway_id TEXT NOT NULL,
  PRIMARY KEY (wormbase_gene, pathway_id)
) WITHOUT ROWID;
CREATE INDEX idx_gkp_path ON gene_kegg_pathway(pathway_id);
CREATE INDEX idx_gkp_wb ON gene_kegg_pathway(wormbase_gene);
""")


class _KeggDisabled(Exception):
    pass


try:
    import os as _kegg_os
    if _kegg_os.environ.get('DISABLE_KEGG', '').strip().lower() in ('1', 'true', 'yes', 'on'):
        cur.executescript("""
        CREATE TABLE IF NOT EXISTS kegg_kgml (pathway_id TEXT PRIMARY KEY, xml TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS kegg_image (
          pathway_id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          width INTEGER, height INTEGER,
          bytes BLOB NOT NULL
        );
        """)
        print('KEGG ingest skipped: DISABLE_KEGG set. kegg_* tables left empty.', file=sys.stderr)
        raise _KeggDisabled()
    import urllib.request
    def kegg_fetch(path):
        with urllib.request.urlopen(f'https://rest.kegg.jp{path}', timeout=60) as r:
            return r.read().decode('utf-8')
    pathways_raw = kegg_fetch('/list/pathway/cel')
    pathway_rows = []
    for line in pathways_raw.splitlines():
        if not line: continue
        pid, _, name = line.partition('\t')
        if pid and name:
            # Normalize: KEGG /list returns "cel00010"; /link returns "path:cel00010".
            # Store with the "path:" prefix to match the link output.
            pid_norm = pid if pid.startswith('path:') else f'path:{pid}'
            pathway_rows.append((pid_norm, name.split(' - ')[0].strip()))
    cur.executemany('INSERT OR REPLACE INTO kegg_pathway VALUES (?,?)', pathway_rows)
    print(f'kegg_pathway: {len(pathway_rows)} pathways', file=sys.stderr)

    # KEGG cel uses sequence-based IDs ("cel:CELE_F14B4.2"), not entrez. Other
    # KEGG organisms use entrez. Build a multi-key lookup so both forms work,
    # plus a sequence_name index from annotations.
    entrez_to_wb_map = dict(cur.execute('SELECT entrez_id, wormbase_gene FROM entrez_to_wb'))
    seq_to_wb_map = {
        (row[0] or '').upper(): row[1]
        for row in cur.execute('SELECT sequence_name, wormbase_gene FROM annotations')
        if row[0]
    }
    links_raw = kegg_fetch('/link/cel/pathway')
    gkp_rows = []
    seen = set()
    missing = 0
    for line in links_raw.splitlines():
        if not line: continue
        pid, _, gene = line.partition('\t')
        if not (pid and gene): continue
        raw = gene.split(':', 1)[1] if ':' in gene else gene
        wb = None
        if raw.isdigit():
            wb = entrez_to_wb_map.get(raw)
        if not wb:
            # KEGG cel format: "CELE_F14B4.2" -> sequence_name "F14B4.2"
            seq = raw[5:] if raw.startswith('CELE_') else raw
            wb = seq_to_wb_map.get(seq.upper())
        if not wb:
            missing += 1
            continue
        key = (wb, pid)
        if key in seen: continue
        seen.add(key)
        gkp_rows.append(key)
    cur.executemany('INSERT OR IGNORE INTO gene_kegg_pathway VALUES (?,?)', gkp_rows)
    print(f'gene_kegg_pathway: {len(gkp_rows)} pairs ({missing} KEGG entries with no WBGene)', file=sys.stderr)

    # KO -> worm gene. KEGG's /link/cel/ko returns ko:Kxxxxx<TAB>cel:CELE_xxx
    # rows; we reuse the same entrez/sequence resolver to land in WBGene space.
    # Lets the pathway-map renderer make `ortholog` entries clickable.
    cur.executescript("""
    CREATE TABLE ko_to_wb (
      ko_id TEXT NOT NULL,
      wormbase_gene TEXT NOT NULL,
      PRIMARY KEY (ko_id, wormbase_gene)
    ) WITHOUT ROWID;
    CREATE INDEX idx_ko_to_wb_wb ON ko_to_wb(wormbase_gene);
    """)
    try:
        ko_raw = kegg_fetch('/link/cel/ko')
        ko_rows = []
        ko_seen = set()
        ko_missing = 0
        for line in ko_raw.splitlines():
            if not line: continue
            ko, _, gene = line.partition('\t')
            if not (ko and gene): continue
            raw = gene.split(':', 1)[1] if ':' in gene else gene
            wb = None
            if raw.isdigit():
                wb = entrez_to_wb_map.get(raw)
            if not wb:
                seq = raw[5:] if raw.startswith('CELE_') else raw
                wb = seq_to_wb_map.get(seq.upper())
            if not wb:
                ko_missing += 1
                continue
            key = (ko, wb)
            if key in ko_seen: continue
            ko_seen.add(key)
            ko_rows.append(key)
        cur.executemany('INSERT OR IGNORE INTO ko_to_wb VALUES (?,?)', ko_rows)
        print(f'ko_to_wb: {len(ko_rows)} pairs ({ko_missing} unmapped)', file=sys.stderr)
    except Exception as e:
        print(f'ko_to_wb ingest failed (network or REST change): {e}', file=sys.stderr)

    # KGML (pathway map XML with node coordinates) + the pre-rendered map image
    # that KEGG.jp uses as its background. Storing both means /pathway/[id] can
    # render the polished KEGG image with clickable KGML overlay hotspots, same
    # approach as kegg.jp and `pathview`. KEGG REST has no CORS so we fetch at
    # build time, cache raw PNG to .cache/, and re-encode to lossless WebP for
    # storage (typically 20-50% smaller than PNG for diagrammatic content;
    # PNG's own DEFLATE then no longer steals bytes from the outer gzip pass).
    import os, concurrent.futures, urllib.request, io
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        Image = None
    cur.executescript("""
    CREATE TABLE kegg_kgml (pathway_id TEXT PRIMARY KEY, xml TEXT NOT NULL);
    CREATE TABLE kegg_image (
      pathway_id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      width INTEGER, height INTEGER,
      bytes BLOB NOT NULL
    );
    """)
    cache_root = os.environ.get('CACHE', '.cache')
    kgml_dir = os.path.join(cache_root, 'kegg-kgml')
    png_dir = os.path.join(cache_root, 'kegg-png')
    os.makedirs(kgml_dir, exist_ok=True)
    os.makedirs(png_dir, exist_ok=True)
    paths_with_genes = {pid for (wb, pid) in gkp_rows}
    targets = [(pid, name) for pid, name in pathway_rows if pid in paths_with_genes]
    print(f'kegg assets: {len(targets)} pathways with ≥1 worm gene (skipping {len(pathway_rows) - len(targets)})', file=sys.stderr)
    def kegg_fetch_bytes(path):
        with urllib.request.urlopen(f'https://rest.kegg.jp{path}', timeout=60) as r:
            return r.read()
    def encode_webp(png_bytes):
        if Image is None:
            return 'image/png', None, None, png_bytes
        try:
            img = Image.open(io.BytesIO(png_bytes))
            w, h = img.size
            buf = io.BytesIO()
            # method=6 is slowest/best; lossless preserves text crispness.
            img.save(buf, format='WebP', lossless=True, method=6, quality=100)
            data = buf.getvalue()
            # If WebP came out larger than the source PNG (rare), keep PNG.
            if len(data) < len(png_bytes):
                return 'image/webp', w, h, data
            return 'image/png', w, h, png_bytes
        except Exception:
            return 'image/png', None, None, png_bytes
    def fetch_one(pid):
        bare = pid.split(':', 1)[1] if ':' in pid else pid
        kgml_path = os.path.join(kgml_dir, f'{bare}.xml')
        png_path = os.path.join(png_dir, f'{bare}.png')
        xml = None
        png = None
        if os.path.exists(kgml_path):
            try:
                with open(kgml_path, encoding='utf-8') as f:
                    xml = f.read()
            except Exception:
                pass
        if xml is None:
            try:
                xml = kegg_fetch(f'/get/{bare}/kgml')
                with open(kgml_path, 'w', encoding='utf-8') as f:
                    f.write(xml)
            except Exception:
                xml = None
        if os.path.exists(png_path):
            try:
                with open(png_path, 'rb') as f:
                    png = f.read()
            except Exception:
                pass
        if png is None:
            try:
                png = kegg_fetch_bytes(f'/get/{bare}/image')
                with open(png_path, 'wb') as f:
                    f.write(png)
            except Exception:
                png = None
        return pid, xml, png
    kgml_count = 0
    img_count = 0
    raw_total = 0
    enc_total = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for pid, xml, png in pool.map(fetch_one, (pid for pid, _ in targets)):
            if xml:
                cur.execute('INSERT OR REPLACE INTO kegg_kgml VALUES (?,?)', (pid, xml))
                kgml_count += 1
            if png:
                mime, w, h, data = encode_webp(png)
                raw_total += len(png)
                enc_total += len(data)
                cur.execute(
                    'INSERT OR REPLACE INTO kegg_image VALUES (?,?,?,?,?)',
                    (pid, mime, w, h, data),
                )
                img_count += 1
    if raw_total:
        ratio = enc_total / raw_total
        print(
            f'kegg_image: {img_count} maps · raw {raw_total/1e6:.1f} MB → enc {enc_total/1e6:.1f} MB '
            f'({ratio*100:.0f}% of raw)',
            file=sys.stderr,
        )
    print(f'kegg_kgml: {kgml_count} XML maps', file=sys.stderr)
except _KeggDisabled:
    pass
except Exception as e:
    print(f'KEGG pathway ingest failed (network or REST change): {e}', file=sys.stderr)

# ---------- GO IDF ----------
cur.executescript("""
CREATE TABLE go_term_freq (go_id TEXT PRIMARY KEY, df INTEGER NOT NULL, idf REAL NOT NULL);
""")
# NOT-qualified rows are display-only and must not count toward the frequencies
# the enrichment background and rarity weights are built from.
GO_POSITIVE = "qualifier IS NULL OR instr('|' || qualifier || '|', '|NOT|') = 0"
N_total = cur.execute(f'SELECT COUNT(DISTINCT wormbase_gene) FROM gene_go WHERE {GO_POSITIVE}').fetchone()[0] or 1
idf_rows = []
for go_id, df in cur.execute(f'SELECT go_id, COUNT(DISTINCT wormbase_gene) FROM gene_go WHERE {GO_POSITIVE} GROUP BY go_id'):
    if df > 0:
        idf_rows.append((go_id, df, max(math.log(N_total / df), 0.0)))
cur.executemany('INSERT INTO go_term_freq VALUES (?,?,?)', idf_rows)
print(f'go_term_freq: {len(idf_rows)} terms (N_total={N_total})', file=sys.stderr)

# ---------- WormCat IDF ----------
# Depth is not specificity: 'Non-coding RNA: ncRNA' is a Category 2 holding
# thousands of genes. Weight by rarity, as GO already is.
cur.executescript("""
CREATE TABLE wormcat_term_freq (
  level    INTEGER NOT NULL,
  category TEXT NOT NULL,
  df       INTEGER NOT NULL,
  idf      REAL NOT NULL,
  PRIMARY KEY (level, category)
) WITHOUT ROWID;
""")
wc_total = cur.execute('SELECT COUNT(DISTINCT wormbase_gene) FROM wormcat').fetchone()[0] or 1
wc_idf_rows = []
for lvl, col in ((1, 'category_1'), (2, 'category_2'), (3, 'category_3')):
    for cat, df in cur.execute(
        f'SELECT {col}, COUNT(DISTINCT wormbase_gene) FROM wormcat '
        f'WHERE {col} IS NOT NULL AND {col} != \'\' GROUP BY {col}'
    ):
        if df > 0:
            wc_idf_rows.append((lvl, cat, df, max(math.log(wc_total / df), 0.0)))
cur.executemany('INSERT INTO wormcat_term_freq VALUES (?,?,?,?)', wc_idf_rows)
print(f'wormcat_term_freq: {len(wc_idf_rows)} categories (N_total={wc_total})', file=sys.stderr)

# ---------- FTS5 ----------
# Aggregate per-gene phenotype names, allele IDs, tissue names, and GO term
# names into single strings so they're searchable alongside the existing
# metadata. All aggregation done in Python for clarity.
pheno_per_gene = {}
for wb, name in cur.execute(
    "SELECT gp.wormbase_gene, COALESCE(pt.name, gp.term_id) FROM gene_phenotype gp "
    "LEFT JOIN phenotype_terms pt ON pt.term_id = gp.term_id"
):
    pheno_per_gene.setdefault(wb, set()).add(name)
# Also index phenotype synonyms (e.g. "Daf-c" for "dauer_constitutive") so
# users can search by the abbreviation that appears in the literature.
for wb, syn in cur.execute(
    "SELECT gp.wormbase_gene, ps.synonym FROM gene_phenotype gp "
    "JOIN phenotype_synonyms ps ON ps.term_id = gp.term_id"
):
    pheno_per_gene.setdefault(wb, set()).add(syn)
allele_per_gene = {}
for wb, allele, name in cur.execute(
    "SELECT ap.wormbase_gene, ap.allele_id, an.name FROM allele_phenotype ap "
    "LEFT JOIN allele_names an ON an.allele_id = ap.allele_id"
):
    allele_per_gene.setdefault(wb, set()).add(allele)
    if name:
        allele_per_gene[wb].add(name)
tissue_per_gene = {}
for wb, name in cur.execute(
    "SELECT ga.wormbase_gene, COALESCE(at.name, ga.term_id) FROM gene_anatomy ga "
    "LEFT JOIN anatomy_terms at ON at.term_id = ga.term_id"
):
    tissue_per_gene.setdefault(wb, set()).add(name)
# Anatomy synonyms (e.g. "motoneuron" for "motor neuron")
for wb, syn in cur.execute(
    "SELECT ga.wormbase_gene, asyn.synonym FROM gene_anatomy ga "
    "JOIN anatomy_synonyms asyn ON asyn.term_id = ga.term_id"
):
    tissue_per_gene.setdefault(wb, set()).add(syn)
go_per_gene = {}
for wb, name in cur.execute(
    "SELECT gg.wormbase_gene, t.name FROM gene_go gg JOIN go_terms t ON t.go_id = gg.go_id "
    "WHERE t.is_obsolete = 0"
):
    go_per_gene.setdefault(wb, set()).add(name)
# GO synonyms (e.g. "MAPK cascade" -> "MAP kinase cascade")
for wb, syn in cur.execute(
    "SELECT gg.wormbase_gene, gs.synonym FROM gene_go gg "
    "JOIN go_synonyms gs ON gs.go_id = gg.go_id "
    "JOIN go_terms t ON t.go_id = gg.go_id "
    "WHERE t.is_obsolete = 0"
):
    go_per_gene.setdefault(wb, set()).add(syn)
wormcat_per_gene = {}
for wb, c1, c2, c3 in cur.execute(
    "SELECT wormbase_gene, category_1, category_2, category_3 FROM wormcat"
):
    s = wormcat_per_gene.setdefault(wb, set())
    if c1: s.add(c1)
    if c2: s.add(c2)
    if c3: s.add(c3)
neuronal_per_gene = {}
for wb, cat, sc in cur.execute(
    "SELECT wormbase_gene, category, supercategory FROM neuronal"
):
    s = neuronal_per_gene.setdefault(wb, set())
    if cat: s.add(cat)
    if sc: s.add(sc)
# Synaptogenesis: index class + subclass + curator notes so users can search
# "active zone", "innexin", "sjj", "PHR/MAPK", etc. and get hits. Underscores
# in class/subclass IDs are split into separate tokens to match natural-text
# queries (chat_cholinergic -> "chat cholinergic").
synapto_per_gene = {}
for wb, klass, subclass, notes in cur.execute(
    "SELECT wormbase_gene, class, subclass, notes FROM synaptogenesis"
):
    s = synapto_per_gene.setdefault(wb, set())
    if klass:    s.add(klass.replace('_', ' '))
    if subclass: s.add(subclass.replace('_', ' '))
    if notes:    s.add(notes)
ortho_per_gene = {}
for wb, sym in cur.execute(
    "SELECT wormbase_gene, ortholog_symbol FROM orthologs"
):
    ortho_per_gene.setdefault(wb, set()).add(sym)

# Per-gene KEGG pathway membership (pathway names, for FTS)
pathway_per_gene = {}
for wb, pname in cur.execute(
    "SELECT gkp.wormbase_gene, COALESCE(p.name, gkp.pathway_id) "
    "FROM gene_kegg_pathway gkp "
    "LEFT JOIN kegg_pathway p ON p.pathway_id = gkp.pathway_id"
):
    pathway_per_gene.setdefault(wb, set()).add(pname)

cur.executescript("""
CREATE VIRTUAL TABLE genes_fts USING fts5(
  wormbase_gene UNINDEXED, gene_name, wb_id, entrez_id, sequence_name, other_names,
  gene_class_description, concise_description, legacy_description,
  phenotypes, alleles, tissues, go_terms, wormcat, neuronal, orthologs, synaptogenesis, pathways,
  tokenize = "unicode61 remove_diacritics 2"
);
""")
fts_rows = []
wb_to_entrez_map = {w: e for w, e in cur.execute('SELECT wormbase_gene, entrez_id FROM wb_to_entrez')}
for wb, name, seq, other, gc, cd, ld in cur.execute(
    "SELECT wormbase_gene, gene_name, sequence_name, other_names, "
    "gene_class_description, concise_description, legacy_description FROM annotations"
):
    ph = ' '.join(pheno_per_gene.get(wb, ()))
    al = ' '.join(allele_per_gene.get(wb, ()))
    ts = ' '.join(tissue_per_gene.get(wb, ()))
    go = ' '.join(go_per_gene.get(wb, ()))
    wc = ' '.join(wormcat_per_gene.get(wb, ()))
    nu = ' '.join(neuronal_per_gene.get(wb, ()))
    orth = ' '.join(ortho_per_gene.get(wb, ()))
    syn = ' '.join(synapto_per_gene.get(wb, ()))
    pw = ' '.join(pathway_per_gene.get(wb, ()))
    entrez = wb_to_entrez_map.get(wb, '')
    fts_rows.append((
        wb, name or '', wb, entrez, seq or '', other or '', gc or '', cd or '', ld or '',
        ph, al, ts, go, wc, nu, orth, syn, pw
    ))
cur.executemany(
    "INSERT INTO genes_fts(wormbase_gene, gene_name, wb_id, entrez_id, sequence_name, other_names,"
    " gene_class_description, concise_description, legacy_description,"
    " phenotypes, alleles, tissues, go_terms, wormcat, neuronal, orthologs, synaptogenesis, pathways)"
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    fts_rows
)
print(f'genes_fts: {len(fts_rows)} rows (full per-gene index)', file=sys.stderr)
cur.executescript("""

CREATE VIRTUAL TABLE go_fts USING fts5(
  go_id UNINDEXED, name, definition, namespace UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2"
);
INSERT INTO go_fts(go_id, name, definition, namespace)
SELECT go_id, name, COALESCE(definition,''), namespace FROM go_terms WHERE is_obsolete = 0;

CREATE VIRTUAL TABLE wormcat_fts USING fts5(
  wormbase_gene UNINDEXED, category_1, category_2, category_3, auto_description,
  tokenize = "unicode61 remove_diacritics 2"
);
INSERT INTO wormcat_fts(wormbase_gene, category_1, category_2, category_3, auto_description)
SELECT wormbase_gene, COALESCE(category_1,''), COALESCE(category_2,''),
       COALESCE(category_3,''), COALESCE(auto_description,'')
FROM wormcat;

CREATE VIRTUAL TABLE kegg_fts USING fts5(
  pathway_id UNINDEXED, name,
  tokenize = "unicode61 remove_diacritics 2"
);
INSERT INTO kegg_fts(pathway_id, name)
SELECT pathway_id, name FROM kegg_pathway;
""")
print('fts5 built', file=sys.stderr)

# ---------- gene_paper (NCBI gene2pubmed) ----------
# Comprehensive per-gene literature list, joined to genes via entrez_to_wb.
cur.executescript("""
CREATE TABLE gene_paper (
  wormbase_gene TEXT NOT NULL,
  pmid          TEXT NOT NULL,
  PRIMARY KEY (wormbase_gene, pmid)
);
CREATE INDEX idx_gene_paper_gene ON gene_paper(wormbase_gene);
""")
gp_rows = []
with open(gene2pubmed_ce) as fh:
    for line in fh:
        entrez, pmid = line.rstrip('\n').split('\t')
        wb = cur.execute('SELECT wormbase_gene FROM entrez_to_wb WHERE entrez_id = ?', (entrez,)).fetchone()
        if wb:
            gp_rows.append((wb[0], pmid))
cur.executemany('INSERT OR IGNORE INTO gene_paper VALUES (?,?)', gp_rows)
print(f'gene_paper: {len(gp_rows)} gene-paper links (NCBI gene2pubmed)', file=sys.stderr)

# ---------- paper_meta (titles + DOIs) ----------
cur.executescript("""
CREATE TABLE paper_meta (
  paper_id TEXT PRIMARY KEY,
  pmid     TEXT,
  doi      TEXT,
  title    TEXT,
  journal  TEXT,
  year     TEXT,
  authors  TEXT
);
CREATE INDEX idx_paper_meta_pmid ON paper_meta(pmid);
""")

# Every paper id a gene page can surface: GO/phenotype evidence refs (by WBPaper
# or PMID) plus the comprehensive gene2pubmed PMIDs.
ref_wbpapers, ref_pmids = set(), set()
for (ref,) in cur.execute(
    "SELECT DISTINCT reference FROM gene_go WHERE reference IS NOT NULL "
    "UNION SELECT DISTINCT reference FROM allele_phenotype WHERE reference IS NOT NULL"):
    if ref.startswith('WB_REF:WBPaper'):
        ref_wbpapers.add(ref[len('WB_REF:'):])
    elif ref.startswith('PMID:'):
        ref_pmids.add(ref[len('PMID:'):])
ref_pmids.update(p for (p,) in cur.execute('SELECT DISTINCT pmid FROM gene_paper'))

with gzip.open(reference_json_gz, 'rt') as fh:
    _refdoc = json.load(fh)
_records = _refdoc.get('data', _refdoc) if isinstance(_refdoc, dict) else _refdoc

def _author_short(label):
    # Some dump records and all WormBase REST labels are "Surname, Given";
    # the rest of the dump and NCBI use "Surname GI". Rewrite to match.
    last, sep, given = label.partition(',')
    parts = given.replace('.', ' ').replace('-', ' ').split()
    if not sep or not parts:
        return label.strip()
    if all(p.isupper() and len(p) <= 3 for p in parts):
        initials = ''.join(parts)
    else:
        initials = ''.join(p[0].upper() for p in parts)
    return f'{last.strip()} {initials}'

paper_rows = []
for r in _records:
    # A record's WBPaper id, DOI and PMID may each be in primaryId or in
    # crossReferences (about half the dump is keyed by PMID). Scan both.
    pid = doi = pmid = None
    ids = [r.get('primaryId') or ''] + [x.get('id', '') for x in (r.get('crossReferences') or [])]
    for xid in ids:
        if xid.startswith('WB:WBPaper') and not pid:
            pid = xid[len('WB:'):]
        elif xid.startswith('DOI:') and not doi:
            doi = xid[len('DOI:'):]
        elif xid.startswith('PMID:') and not pmid:
            pmid = xid[len('PMID:'):]
    if not pid:
        continue
    if pid not in ref_wbpapers and (pmid or '') not in ref_pmids:
        continue
    year = (r.get('datePublished') or '')[:4]
    if not year.isdigit():
        year = None
    authors = r.get('authors') or []
    if authors:
        short = _author_short(authors[0].get('name') or '') + (' et al.' if len(authors) > 1 else '')
    else:
        short = None
    paper_rows.append((pid, pmid, doi, r.get('title'), r.get('resourceAbbreviation'), year, short or None))

cur.executemany('INSERT OR IGNORE INTO paper_meta VALUES (?,?,?,?,?,?,?)', paper_rows)
print(f'paper_meta: {len(paper_rows)} papers resolved (Alliance bibliography)', file=sys.stderr)

# Resolve papers the dump lacks (mostly post-2022) from live, unauthenticated
# APIs: WBPaper ids via WormBase REST (per-paper), PMIDs via NCBI esummary
# (batched). Best-effort; failures leave a plain WBPaper/PMID link. Cached on
# disk so later builds only fetch new papers. SKIP_PAPER_FALLBACK=1 for offline.
import os, time, subprocess

if os.environ.get('SKIP_PAPER_FALLBACK') == '1':
    print('paper_meta: freshness fallback skipped (SKIP_PAPER_FALLBACK=1)', file=sys.stderr)
else:
    resolved_wb = {pid for (pid,) in cur.execute('SELECT paper_id FROM paper_meta')}
    resolved_pmid = {p for (p,) in cur.execute('SELECT pmid FROM paper_meta WHERE pmid IS NOT NULL')}
    missing_wb = sorted(ref_wbpapers - resolved_wb)
    missing_pmid = sorted(p for p in (ref_pmids - resolved_pmid) if p)

    # Runaway guard: if the dump failed to load almost everything is "missing".
    MAX_FALLBACK = 6000
    n_missing = len(missing_wb) + len(missing_pmid)
    if n_missing > MAX_FALLBACK:
        print(f'paper_meta: {n_missing} missing exceeds cap {MAX_FALLBACK} '
              f'(dump likely incomplete) - resolving first {MAX_FALLBACK}', file=sys.stderr)
        missing_wb = missing_wb[:MAX_FALLBACK]
        missing_pmid = missing_pmid[:max(0, MAX_FALLBACK - len(missing_wb))]

    cache_dir = Path(paper_cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    def _read_cache(name):
        cf = cache_dir / name
        if cf.exists():
            txt = cf.read_text()
            return ('', None) if txt == '' else ('hit', json.loads(txt))
        return ('miss', None)

    def _get(url, timeout=30):
        # Use curl (system trust store) rather than urllib: robust behind a
        # TLS-intercepting proxy and consistent with the rest of the script.
        r = subprocess.run(
            ['curl', '-fsSL', '--max-time', str(timeout),
             '-H', 'Accept: application/json', '-H', 'User-Agent: wormie-build/1.0', url],
            capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'curl exit {r.returncode}: {r.stderr.strip()[:200]}')
        return r.stdout

    extra = []
    for pid in missing_wb:
        state, d = _read_cache(f'wb_{pid}.json')
        if state == 'miss':
            try:
                raw = _get(f'https://rest.wormbase.org/rest/widget/paper/{pid}/overview')
                (cache_dir / f'wb_{pid}.json').write_text(raw)
                d = json.loads(raw)
                time.sleep(0.2)
            except Exception as e:
                (cache_dir / f'wb_{pid}.json').write_text('')
                print(f'  WB fetch failed {pid}: {e}', file=sys.stderr)
                d = None
        if not d:
            continue
        f = d.get('fields', {}) or {}
        def g(k):
            v = f.get(k, {})
            return v.get('data') if isinstance(v, dict) else None
        title = g('title')
        if not title:
            continue
        au = g('authors') or []
        short = (_author_short(au[0].get('label') or '') + (' et al.' if len(au) > 1 else '')) if isinstance(au, list) and au else None
        year = g('year')
        extra.append((pid, g('pmid'), g('doi'), title, g('journal'),
                      str(year) if year else None, short or None))

    def _row_from_esummary(pmid, u):
        if not u or not u.get('title'):
            return None
        doi = next((a['value'] for a in u.get('articleids', []) if a.get('idtype') == 'doi'), None)
        year = (u.get('pubdate') or '')[:4]
        au = u.get('authors') or []
        short = ((au[0].get('name') or '') + (' et al.' if len(au) > 1 else '')) if au else None
        # No WBPaper id for a PMID-only ref: synthetic key, resolved via pmid index.
        return (f'PMID:{pmid}', pmid, doi, u.get('title'), u.get('source'),
                year if year.isdigit() else None, short or None)

    need_fetch = []
    for pmid in missing_pmid:
        state, d = _read_cache(f'pmid_{pmid}.json')
        if state == 'miss':
            need_fetch.append(pmid)
        elif state == 'hit':
            row = _row_from_esummary(pmid, d)
            if row:
                extra.append(row)
    for i in range(0, len(need_fetch), 200):
        batch = need_fetch[i:i + 200]
        try:
            raw = _get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'
                       f'?db=pubmed&id={",".join(batch)}&retmode=json')
            res = (json.loads(raw).get('result') or {})
            for pmid in batch:
                u = res.get(pmid)
                (cache_dir / f'pmid_{pmid}.json').write_text(json.dumps(u) if u else '')
                row = _row_from_esummary(pmid, u)
                if row:
                    extra.append(row)
            time.sleep(0.34)
        except Exception as e:
            print(f'  NCBI batch fetch failed ({len(batch)} pmids): {e}', file=sys.stderr)

    cur.executemany('INSERT OR IGNORE INTO paper_meta VALUES (?,?,?,?,?,?,?)', extra)
    print(f'paper_meta: +{len(extra)} resolved live '
          f'({len(missing_wb)} WBPaper + {len(missing_pmid)} PMID)', file=sys.stderr)

# ---------- output assertions ----------
# A build that quietly drops a feature and still publishes can do it again.
# Roughly half of the 2026-08-13 build (measured counts alongside), so a table
# losing most of its rows fails while ordinary source drift does not.
MIN_ROWS = {
    'annotations': 25000,          # 52110
    'gene_go': 250000,             # 537378 (direct + propagated)
    'go_terms': 24000,             # 48329
    'go_term_freq': 5000,          # 9519
    'wormcat': 15000,              # 31389
    'wormcat_term_freq': 350,      # 750
    'neuronal': 600,               # 1313
    'synaptogenesis': 120,         # 178
    'interactions': 25000,         # 49087
    'cengen_expression': 250000,   # 507574
    'cengen_coexpression': 500000, # 2104706
    'cengen_calls': 350000,        # 790889
    'gene_disease': 15000,         # 30325
    'gene_phenotype': 55000,       # 119053
    'gene_paper': 80000,           # 167180
    'paper_meta': 9000,            # 18725
    'orthologs': 45000,            # 98628
}
import os as _assert_os
if _assert_os.environ.get('DISABLE_KEGG', '').strip().lower() not in ('1', 'true', 'yes', 'on'):
    MIN_ROWS['kegg_pathway'] = 75          # 153
    MIN_ROWS['gene_kegg_pathway'] = 3500   # 7486

failures = []
for tbl, floor in sorted(MIN_ROWS.items()):
    try:
        n = cur.execute(f'SELECT COUNT(*) FROM {tbl}').fetchone()[0]
    except sqlite3.Error as e:
        failures.append(f'{tbl}: unreadable ({e})')
        continue
    if n < floor:
        failures.append(f'{tbl}: {n} rows, expected >= {floor}')
if failures:
    print('BUILD ASSERTION FAILED:', file=sys.stderr)
    for f in failures:
        print(f'  {f}', file=sys.stderr)
    sys.exit(1)
print(f'output assertions: {len(MIN_ROWS)} tables above their row floors', file=sys.stderr)

conn.commit()
conn.executescript('VACUUM; ANALYZE;')
conn.close()
PY

VERSION=$(date +%Y%m%d-%H%M%S)
RAW_SIZE=$(stat -c%s "$TMP_DB" 2>/dev/null || stat -f%z "$TMP_DB")

gzip -9c "$TMP_DB" >"$DEST_DIR/wormie.sqlite.gz"
GZ_SIZE=$(stat -c%s "$DEST_DIR/wormie.sqlite.gz" 2>/dev/null || stat -f%z "$DEST_DIR/wormie.sqlite.gz")

# Pull a few real version stamps out of cached files
set +o pipefail
ALLIANCE_VER="$(gunzip -c "$BGI_JSON" 2>/dev/null | head -c 8000 | grep -oE 'Alliance Database Version[^"]*: [^"]+' | head -1 | sed 's/.*: //' | tr -d ' ' || true)"
EXPR_VER="$(head -c 4000 "$EXPR_TSV" 2>/dev/null | grep -oE 'Alliance Database Version: [^ ]+' | head -1 | awk '{print $NF}' || true)"
set -o pipefail
ALLIANCE_VER="${ALLIANCE_VER:-unknown}"
EXPR_VER="${EXPR_VER:-unknown}"
# The GO release from the ontology header: a build date is not a data version.
# GNU and BSD stat take different flags, and a wrong guess here silently writes
# the other tool's output into version.json. Try GNU, fall back to BSD, then keep
# only a leading YYYY-MM-DD.
file_mtime_date() {
  local d
  d="$(stat -c '%y' "$1" 2>/dev/null | cut -d' ' -f1)"
  [ -n "$d" ] || d="$(stat -f '%Sm' -t '%Y-%m-%d' "$1" 2>/dev/null)"
  printf '%s' "$d" | tr -d '\n' | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}' || true
}

GO_DATE="$(grep -m1 -oE '^data-version: releases/[0-9]{4}-[0-9]{2}-[0-9]{2}' "$OBO" 2>/dev/null | sed 's|.*/||' || true)"
if [[ -z "$GO_DATE" ]]; then
  GO_DATE="$(grep -m1 -oE '^date: [0-9]{2}:[0-9]{2}:[0-9]{4}' "$OBO" 2>/dev/null | awk '{print $2}' | awk -F: '{print $3 "-" $2 "-" $1}' || true)"
fi
# Download date of the file actually used; sources are cached and reused.
GO_FETCHED="$(file_mtime_date "$OBO")"
GO_FETCHED="${GO_FETCHED:-$(date -u +%Y-%m-%d)}"
GO_DATE="${GO_DATE:-$GO_FETCHED}"
WB_DATE="$(file_mtime_date "$GENE_IDS")"
WBBT_DATE="$(file_mtime_date "$WBBT_OBO")"

# Per-table counts, so quoted numbers come from one identified artifact.
RECORDS_JSON="$("${PY[@]}" -c '
import json, sqlite3, sys
tables = ["annotations", "go_terms", "gene_go", "wormcat", "neuronal", "synaptogenesis", "gene_location",
          "interactions", "gene_phenotype", "allele_phenotype", "allele_names", "cengen_expression",
          "cengen_coexpression", "gene_disease", "orthologs", "gene_paper", "paper_meta",
          "kegg_pathway", "gene_kegg_pathway"]
con = sqlite3.connect(sys.argv[1])
out = {}
for t in tables:
    try:
        out[t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    except sqlite3.Error:
        pass
print(json.dumps(out, indent=4)[1:-1].strip())
' "$TMP_DB")"

# Published as SAF (exon rows only) rather than the GTF: featureCounts needs
# nothing else for gene-level counting, and the GTF expands to 174 MB in memory
# against 9 MB for this.
ANNOTATION_FILE=""
ANNOTATION_SIZE=0
if [[ -s "$GTF_GZ" ]]; then
  "${PY[@]}" -c '
import gzip, re, sys
src, dst = sys.argv[1], sys.argv[2]
n = 0
with gzip.open(src, "rt") as f, gzip.open(dst, "wt") as o:
    o.write("GeneID\tChr\tStart\tEnd\tStrand\n")
    for line in f:
        if line.startswith("#"):
            continue
        p = line.rstrip("\n").split("\t")
        if len(p) < 9 or p[2] != "exon":
            continue
        m = re.search(r"gene_id .([^\"]+).", p[8])
        if not m:
            continue
        o.write(f"{m.group(1)}\t{p[0]}\t{p[3]}\t{p[4]}\t{p[6]}\n")
        n += 1
if n == 0:
    sys.exit("annotation: no exon rows found in " + src)
print(f"annotation.saf: {n} exon rows", file=sys.stderr)
' "$GTF_GZ" "$DEST_DIR/annotation.saf.gz"
  ANNOTATION_FILE="annotation.saf.gz"
  ANNOTATION_SIZE=$(stat -c%s "$DEST_DIR/annotation.saf.gz" 2>/dev/null || stat -f%z "$DEST_DIR/annotation.saf.gz")
fi

cat >"$DEST_DIR/version.json" <<EOF
{
  "version": "$VERSION",
  "db_file": "wormie.sqlite.gz",
  "raw_size": $RAW_SIZE,
  "gz_size": $GZ_SIZE,
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "annotation": {
    "file": "$ANNOTATION_FILE",
    "release": "$WB_RELEASE",
    "gz_size": $ANNOTATION_SIZE,
    "format": "saf",
    "source": "WormBase canonical geneset, exon rows"
  },
  "records": {
    $RECORDS_JSON
  },
  "sources": {
    "wormbase": { "release": "$WB_RELEASE", "date": "$WB_DATE" },
    "go": { "date": "$GO_DATE", "fetched": "$GO_FETCHED" },
    "biogrid": { "version": "$BIOGRID_VERSION" },
    "alliance_orthology": { "version": "$ALLIANCE_VER" },
    "wormbase_phenotype": { "release": "$WB_RELEASE", "date": "$WB_DATE" },
    "alliance_expression": { "version": "$EXPR_VER" },
    "wbbt": { "date": "$WBBT_DATE" },
    "cengen": { "release": "$CENGEN_VERSION", "citation": "Barrett et al. 2025 (bioRxiv 10.1101/2025.01.26.634951; eLife reviewed preprint 106183), contamination-subtracted integrated matrix from github.com/cengenproject/CeNGEN_integrated_analysis_2024" },
    "alliance_bibliography": { "source": "REFERENCE_WB", "note": "Alliance of Genome Resources bulk bibliography (WBPaper -> title/DOI/PMID)" },
    "gene2pubmed": { "source": "NCBI gene2pubmed", "note": "Gene-to-publication links (comprehensive per-gene literature)" }
  }
}
EOF

# version.json is parsed by the client on every load; a malformed one silently
# costs the app its own build metadata. Fail here instead of publishing it.
"${PY[@]}" -c '
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception as e:
    sys.exit(f"version.json is not valid JSON: {e}")
for k in ("version", "gz_size", "raw_size", "records", "sources"):
    if k not in d:
        sys.exit(f"version.json is missing {k}")
import re
for src, val in d["sources"].items():
    for field, v in val.items():
        if isinstance(v, str) and ("\n" in v or "\t" in v):
            sys.exit(f"version.json: sources.{src}.{field} contains a control character")
        if field in ("date", "fetched") and v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            sys.exit(f"version.json: sources.{src}.{field} is not a date: {v!r}")
print("version.json validated")
' "$DEST_DIR/version.json"

echo
echo "Built $DEST_DIR/wormie.sqlite.gz:"
echo "  raw:  $(numfmt --to=iec $RAW_SIZE 2>/dev/null || echo "$RAW_SIZE bytes")"
echo "  gzip: $(numfmt --to=iec $GZ_SIZE 2>/dev/null || echo "$GZ_SIZE bytes")"
echo "  WS:   $WB_RELEASE"
echo "  BioGRID: $BIOGRID_VERSION"
echo "  version: $VERSION"
