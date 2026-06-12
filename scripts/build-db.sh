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
# Curated synaptogenesis gene panel (Andrew lab; mirrored from
# celegans-pipeline at refs/gene_sets/synaptogenesis_genes.tsv). Tab-separated
# with columns `symbol class subclass notes`. Symbols are resolved to
# wormbase_gene at ingest time via the annotations table.
SYNAPTO_TSV="${SYNAPTO_TSV:-$ROOT/data/synaptogenesis_genes.tsv}"

mkdir -p "$CACHE" "$DEST_DIR"

# --- WormBase WS release: auto-detect latest on EBI mirror if not pinned ---
if [[ -z "${WB_RELEASE:-}" ]]; then
  WB_RELEASE="$(curl -fsS --max-time 10 'https://ftp.ebi.ac.uk/pub/databases/wormbase/releases/' 2>/dev/null | grep -oE 'WS[0-9]+' | sort -u -t S -k 2 -n | tail -1)"
  WB_RELEASE="${WB_RELEASE:-WS298}"
fi
echo "WormBase release: $WB_RELEASE"

EBI_WB="https://ftp.ebi.ac.uk/pub/databases/wormbase/releases/${WB_RELEASE}/species/c_elegans/PRJNA13758/annotation"
GENE_IDS="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.geneIDs.txt.gz"
FUNC_DESC="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.functional_descriptions.txt.gz"
XREFS="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.xrefs.txt.gz"
# Allele-level phenotype associations (GAF 2.0). Each row links a gene to a
# phenotype with the originating allele/variant ID in the with/from column,
# so we get gene_phenotype + allele_phenotype tables out of a single file.
WB_PHENO="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.phenotype_association.wb.gz"
# RNAi reagent → gene → phenotype mapping (5-column TSV). Lists every
# WBRNAi reagent that knocked down each gene and the phenotypes observed.
# Does NOT carry library tags or clone names; users follow the WBRNAi link
# to wormbase.org for sjj_*/mv_* clone-name + library details.
RNAI_PHENO="$CACHE/c_elegans.PRJNA13758.${WB_RELEASE}.rnai_phenotypes.wb.gz"

# --- Always-latest URLs for every other source ---
GAF_URL="https://current.geneontology.org/annotations/wb.gaf.gz"
OBO_URL="https://current.geneontology.org/ontology/go.obo"
ALLIANCE_ORTHO_URL="https://fms.alliancegenome.org/download/ORTHOLOGY-ALLIANCE_COMBINED.tsv.gz"
ALLIANCE_PHENO_URL="https://fms.alliancegenome.org/download/PHENOTYPE_WB.json.gz"
ALLIANCE_EXPR_URL="https://fms.alliancegenome.org/download/EXPRESSION-ALLIANCE_WB.tsv"
ALLIANCE_DISEASE_URL="https://fms.alliancegenome.org/download/DISEASE-ALLIANCE_WB.tsv.gz"
ALLIANCE_BGI_URL="https://fms.alliancegenome.org/download/BGI_WB.json.gz"
WBPHENO_OBO_URL="https://raw.githubusercontent.com/obophenotype/c-elegans-phenotype-ontology/master/wbphenotype.obo"
WBBT_OBO_URL="https://raw.githubusercontent.com/obophenotype/c-elegans-gross-anatomy-ontology/master/wbbt.obo"
# BioGRID Latest-Release symlink → always newest. The extracted tab3 contains
# the version in its filename; we resolve it after unzip.
BIOGRID_ZIP_URL="https://downloads.thebiogrid.org/Download/BioGRID/Latest-Release/BIOGRID-ORGANISM-LATEST.tab3.zip"
# CeNGEN L4 integrated single-cell + bulk normalized counts (Barrett et al. 2022,
# the canonical "is gene X expressed in neuron Y" matrix all recent papers cite).
# Per-replicate TMM counts (143 cols × ~22k genes); we aggregate to neuron type
# at ingest time.
CENGEN_URL="https://cengen.org/storage/Average_integrated_TMM_counts_lengthNormalized_111521.tsv"
CENGEN_VERSION="2021-11-15-L4-integrated"
# CeNGEN per-neuron binary expression calls at four thresholds. These are the
# FACS-calibrated "is gene X expressed in neuron Y" calls that the CeNGEN paper
# and web app use. Cover all 128 neuron types (the integrated TMM file only
# has 41). Convention: a (gene, neuron) pair "passes threshold N" if the value
# at index N is > 0; we store the max passed level per pair.
CENGEN_T1_URL="https://cengen.org/storage/021821_liberal_threshold1.csv"
CENGEN_T2_URL="https://cengen.org/storage/021821_medium_threshold2.csv"
CENGEN_T3_URL="https://cengen.org/storage/021821_conservative_threshold3.csv"
CENGEN_T4_URL="https://cengen.org/storage/021821_stringent_threshold4.csv"

GAF="$CACHE/wb.gaf.gz"
OBO="$CACHE/go.obo"
ORTHO="$CACHE/ORTHOLOGY-ALLIANCE_COMBINED.tsv.gz"
PHENO_JSON="$CACHE/PHENOTYPE_WB.json.gz"
EXPR_TSV="$CACHE/EXPRESSION-ALLIANCE_WB.tsv"
DISEASE_TSV="$CACHE/DISEASE-ALLIANCE_WB.tsv.gz"
BGI_JSON="$CACHE/BGI_WB.json.gz"
WBPHENO_OBO="$CACHE/wbphenotype.obo"
WBBT_OBO="$CACHE/wbbt.obo"
BIOGRID_ZIP="$CACHE/BIOGRID-ORGANISM-LATEST.tab3.zip"
BIOGRID_TAB="" # set after unzip
CENGEN_TSV="$CACHE/cengen_L4_integrated_TMM.tsv"
CENGEN_T1="$CACHE/cengen_threshold1_liberal.csv"
CENGEN_T2="$CACHE/cengen_threshold2_medium.csv"
CENGEN_T3="$CACHE/cengen_threshold3_conservative.csv"
CENGEN_T4="$CACHE/cengen_threshold4_stringent.csv"

fetch() {
  local url="$1" dest="$2"
  if [[ ! -f "$dest" ]]; then
    echo "Downloading $(basename "$dest")..."
    curl -fsSL "$url" -o "$dest"
  fi
}

fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.geneIDs.txt.gz" "$GENE_IDS"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.functional_descriptions.txt.gz" "$FUNC_DESC"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.xrefs.txt.gz" "$XREFS"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.phenotype_association.wb.gz" "$WB_PHENO"
fetch "$EBI_WB/c_elegans.PRJNA13758.${WB_RELEASE}.rnai_phenotypes.wb.gz" "$RNAI_PHENO"
fetch "$GAF_URL" "$GAF"
fetch "$OBO_URL" "$OBO"
fetch "$ALLIANCE_ORTHO_URL" "$ORTHO"
fetch "$ALLIANCE_PHENO_URL" "$PHENO_JSON"
fetch "$ALLIANCE_EXPR_URL" "$EXPR_TSV"
fetch "$ALLIANCE_DISEASE_URL" "$DISEASE_TSV"
fetch "$ALLIANCE_BGI_URL" "$BGI_JSON"
fetch "$WBPHENO_OBO_URL" "$WBPHENO_OBO"
fetch "$WBBT_OBO_URL" "$WBBT_OBO"
fetch "$BIOGRID_ZIP_URL" "$BIOGRID_ZIP"
fetch "$CENGEN_URL" "$CENGEN_TSV"
fetch "$CENGEN_T1_URL" "$CENGEN_T1"
fetch "$CENGEN_T2_URL" "$CENGEN_T2"
fetch "$CENGEN_T3_URL" "$CENGEN_T3"
fetch "$CENGEN_T4_URL" "$CENGEN_T4"

# Unzip BioGRID and resolve the C. elegans tab3 filename (contains the version)
(cd "$CACHE" && unzip -o BIOGRID-ORGANISM-LATEST.tab3.zip 'BIOGRID-ORGANISM-Caenorhabditis_elegans-*.tab3.txt' >/dev/null)
BIOGRID_TAB="$(ls "$CACHE"/BIOGRID-ORGANISM-Caenorhabditis_elegans-*.tab3.txt | head -1)"
BIOGRID_VERSION="$(basename "$BIOGRID_TAB" | sed -E 's/.*-([0-9.]+)\.tab3\.txt/\1/')"
echo "BioGRID version: $BIOGRID_VERSION"

TMP_DB="$(mktemp)"
trap 'rm -f "$TMP_DB" "$TMP_DB-wal" "$TMP_DB-shm"' EXIT

# Pick a Python interpreter that has numpy available. We use uv (if installed)
# to spin up an ephemeral env with numpy for the CeNGEN co-expression step;
# everything else only needs stdlib. Falls back to plain `python3` if uv isn't
# present; the co-expression block is wrapped in a try/except that logs a
# warning when numpy is missing rather than aborting the whole build.
if command -v uv >/dev/null 2>&1; then
  PY=(uv run --quiet --with numpy --with Pillow python3)
else
  PY=(python3)
fi

"${PY[@]}" - "$TMP_DB" "$WORMCAT_CSV" "$NEURONAL_CSV" "$GAF" "$OBO" "$ORTHO" "$BIOGRID_TAB" "$PHENO_JSON" "$WBPHENO_OBO" "$WBBT_OBO" "$EXPR_TSV" "$BGI_JSON" "$GENE_IDS" "$FUNC_DESC" "$XREFS" "$WB_PHENO" "$CENGEN_TSV" "$CENGEN_T1" "$CENGEN_T2" "$CENGEN_T3" "$CENGEN_T4" "$DISEASE_TSV" "$RNAI_PHENO" "$SYNAPTO_TSV" <<'PY'
import csv, gzip, json, math, re, sqlite3, sys
from pathlib import Path

(db_path, wormcat_csv, neuronal_csv, gaf_path, obo_path, ortho_gz,
 biogrid_tab, pheno_json_gz, wbpheno_obo, anatomy_obo, anatomy_assoc,
 bgi_json_gz, gene_ids_path, func_desc_path, xrefs_path, wb_pheno_gz,
 cengen_tsv, cengen_t1, cengen_t2, cengen_t3, cengen_t4, disease_tsv,
 rnai_pheno_gz, synapto_tsv) = sys.argv[1:25]

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
for g in bgi.get('data', []):
    wb_raw = (g.get('basicGeneticEntity', {}) or {}).get('primaryId') or ''
    if not wb_raw.startswith('WB:WBGene'): continue
    wb = wb_raw[3:]
    for x in (g.get('basicGeneticEntity', {}) or {}).get('crossReferences', []) or []:
        xid = x.get('id', '')
        if xid.startswith('NCBI_Gene:'):
            e_rows.append((xid.split(':', 1)[1], wb))
            break
cur.executemany('INSERT OR REPLACE INTO entrez_to_wb VALUES (?,?)', e_rows)
cur.executemany('INSERT OR REPLACE INTO wb_to_entrez VALUES (?,?)', [(wb, eid) for eid, wb in e_rows])
print(f'entrez_to_wb: {len(e_rows)} mappings', file=sys.stderr)

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
if Path(neuronal_csv).is_file():
    with open(neuronal_csv, newline='') as f:
        for row in csv.DictReader(f):
            wb = (row.get('wormbase_id') or '').strip()
            if not wb: continue
            n_rows.append((
                wb,
                (row.get('gene_name') or '').strip() or None,
                (row.get('category') or '').strip() or None,
                (row.get('supercategory') or '').strip() or None,
            ))
    cur.executemany('INSERT OR REPLACE INTO neuronal VALUES (?,?,?,?)', n_rows)
    print(f'neuronal: {len(n_rows)} rows', file=sys.stderr)

# ---------- Synaptogenesis panel ----------
# Curated 215-gene C. elegans synaptogenesis panel grouped into 13 functional
# classes (proneural fate, terminal selectors, active zone, SV release,
# innexins, postsynaptic, Wnt/PHR signaling, ...). Source TSV has the symbol
# only; we resolve to wormbase_gene by joining against the annotations table
# (gene_name → wormbase_gene). Unresolved symbols are reported but not fatal
# so a stale panel doesn't break the build.
cur.executescript("""
CREATE TABLE synaptogenesis (
  wormbase_gene TEXT NOT NULL,
  gene_name TEXT,
  class TEXT NOT NULL,
  subclass TEXT,
  notes TEXT,
  PRIMARY KEY (wormbase_gene, class)
);
CREATE INDEX idx_synapto_class ON synaptogenesis(class);
CREATE INDEX idx_synapto_subclass ON synaptogenesis(subclass);
""")
# Build a symbol → wormbase_gene resolver from annotations. Lower-cased so we
# survive case differences between curated lists and WormBase canonical names.
sym_to_wb = {}
for wb, name in cur.execute(
    'SELECT wormbase_gene, gene_name FROM annotations WHERE gene_name IS NOT NULL'
).fetchall():
    sym_to_wb.setdefault(name.lower(), wb)
syn_rows = []
syn_unresolved = []
if Path(synapto_tsv).is_file():
    with open(synapto_tsv, encoding='utf-8') as f:
        header_seen = False
        for line in f:
            if not line.strip() or line.startswith('#'): continue
            if not header_seen:
                header_seen = True
                continue  # skip header
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2: continue
            symbol = parts[0].strip()
            klass = parts[1].strip()
            subclass = parts[2].strip() if len(parts) > 2 else None
            notes = parts[3].strip() if len(parts) > 3 else None
            if not symbol or not klass: continue
            wb = sym_to_wb.get(symbol.lower())
            if not wb:
                syn_unresolved.append(symbol)
                continue
            syn_rows.append((wb, symbol, klass, subclass or None, notes or None))
    cur.executemany(
        'INSERT OR REPLACE INTO synaptogenesis VALUES (?,?,?,?,?)', syn_rows
    )
    msg = f'synaptogenesis: {len(syn_rows)} rows'
    if syn_unresolved:
        msg += f' ({len(syn_unresolved)} unresolved symbols: ' + ', '.join(syn_unresolved[:8])
        if len(syn_unresolved) > 8: msg += ', ...'
        msg += ')'
    print(msg, file=sys.stderr)

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

seen_pair = set((g, go) for g, go, *_ in gaf_rows)
prop_rows = []
for g, direct_go, *_ in gaf_rows:
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
    # Build STRING-protein → WBGene alias map. Each protein has multiple
    # aliases; keep the WormBase-source ones that match WBGene-style IDs.
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

# Allele-level phenotype associations from WormBase's GAF. Each row already
# links a gene to a phenotype with the originating allele in the with/from
# column, so we populate both gene_phenotype and allele_phenotype in one pass.
# Coverage jumps from ~20k Alliance-curated gene rows to 440k+ allele-mediated
# rows, capturing the way phenotypes are actually published (per allele).
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
# Variant → gene index built while scanning the WB GAF. Every with/from
# WBVar entry pairs a variant with the gene the GAF row is about, so this
# is a complete (and authoritative) mapping for downstream Alliance JSON
# rows whose objectId is a variant.
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

# Alliance Phenotype JSON: 55k rows we were previously dropping. Records
# keyed by objectId of three flavors:
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
# Despite the .tsv extension and text/tab-separated-values content-type the
# CeNGEN integrated file is space-separated with quoted column names.
with open(cengen_tsv, encoding='utf-8') as f:
    header_tokens = next(f).rstrip('\n').split()
    rep_cols = [h.strip('"') for h in header_tokens]
    type_to_idx = {}
    for i, h in enumerate(rep_cols):
        m = NEURON_RE.match(h)
        if not m: continue
        nt = m.group(1)
        type_to_idx.setdefault(nt, []).append(i)
    expr_rows = []
    for line in f:
        toks = line.rstrip('\n').split()
        if not toks: continue
        wb = toks[0].strip('"')
        if not wb.startswith('WBGene'): continue
        vals = toks[1:]
        for nt, idxs in type_to_idx.items():
            tot = 0.0; n = 0
            for i in idxs:
                if i >= len(vals): continue
                try:
                    v = float(vals[i])
                except ValueError:
                    continue
                tot += v; n += 1
            if n == 0: continue
            avg = tot / n
            if avg < 0.5: continue
            expr_rows.append((wb, nt, round(avg, 1)))
cur.executemany('INSERT INTO cengen_expression VALUES (?,?,?)', expr_rows)
print(f'cengen_expression: {len(expr_rows)} rows, {len(type_to_idx)} neuron types with bulk TMM', file=sys.stderr)

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
# for the 41 types with bulk TMM data.
all_neurons = set(type_to_idx.keys()) | set(binary_neurons)
neuron_rows = [
    (nt, len(type_to_idx.get(nt, [])), 1 if nt in binary_neurons else 0)
    for nt in sorted(all_neurons)
]
cur.executemany('INSERT INTO cengen_neurons VALUES (?,?,?)', neuron_rows)
print(f'cengen_neurons: {len(neuron_rows)} total ({len(binary_neurons)} with binary calls, {len(type_to_idx)} with bulk TMM)', file=sys.stderr)

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
# C. elegans gene → human disease ontology terms. Many rows per (gene, disease)
# representing distinct evidence codes; we collapse to one row per pair with
# evidence count + first reference and the strongest association_type.
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
# Pearson similarity across the 41-neuron-type bulk TMM vector. For each gene
# keep the top 20 neighbors. Sparse "expressed in only a few neuron types"
# genes get the strongest signal; ubiquitously-expressed genes naturally have
# more neighbors at lower correlation. Used by the gene page to surface
# "co-expressed in neurons" candidates that are independent of GO/curation.
cur.executescript("""
CREATE TABLE cengen_coexpression (
  wormbase_gene TEXT NOT NULL,
  neighbor      TEXT NOT NULL,
  pearson       REAL NOT NULL,
  PRIMARY KEY (wormbase_gene, neighbor)
) WITHOUT ROWID;
CREATE INDEX idx_cengen_coexpr_gene ON cengen_coexpression(wormbase_gene);
""")
try:
    import numpy as np  # numpy is standard in most build envs
    # Re-read the integrated file to build a dense per-gene-per-neuron-type matrix.
    # Aggregate replicates per type at read time (mean), zero-fill missing values.
    print('Building CeNGEN co-expression neighbors...', file=sys.stderr)
    gene_ids = []
    rows = []
    type_order = sorted(type_to_idx.keys())
    with open(cengen_tsv, encoding='utf-8') as f:
        next(f)  # header already parsed
        for line in f:
            toks = line.rstrip('\n').split()
            if not toks: continue
            wb = toks[0].strip('"')
            if not wb.startswith('WBGene'): continue
            vals = toks[1:]
            row = []
            for nt in type_order:
                idxs = type_to_idx[nt]
                tot = 0.0; n = 0
                for i in idxs:
                    if i >= len(vals): continue
                    try:
                        v = float(vals[i])
                    except ValueError:
                        continue
                    tot += v; n += 1
                row.append(tot / n if n else 0.0)
            gene_ids.append(wb)
            rows.append(row)
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
    # n × n matrix; with ~22k genes and D=41 this is ~2GB float32, too big.
    # Process in row chunks instead.
    # Store top 50 neighbors per gene so the per-neuron-type filter in the
    # UI has enough candidates to surface real co-expressed sets even after
    # restricting to one neuron's binary calls.
    K = 50
    coexpr_rows = []
    CHUNK = 1024
    for i0 in range(0, Z.shape[0], CHUNK):
        i1 = min(i0 + CHUNK, Z.shape[0])
        block = Z[i0:i1] @ Z.T / D    # (chunk × N) Pearson
        # Mask self-similarity by setting diagonal to -inf.
        for ii in range(i0, i1):
            block[ii - i0, ii] = -np.inf
        # argpartition for the top K then sort.
        K_eff = min(K, block.shape[1] - 1)
        top_idx_unsorted = np.argpartition(-block, K_eff, axis=1)[:, :K_eff]
        for r_local, row_idx in enumerate(top_idx_unsorted):
            row_idx_sorted = row_idx[np.argsort(-block[r_local, row_idx])]
            wb_src = keep_ids[i0 + r_local]
            for j in row_idx_sorted:
                p = float(block[r_local, j])
                if p < 0.1:  # not a meaningful co-expression
                    break
                coexpr_rows.append((wb_src, keep_ids[int(j)], round(p, 3)))
    cur.executemany('INSERT OR IGNORE INTO cengen_coexpression VALUES (?,?,?)', coexpr_rows)
    print(f'cengen_coexpression: {len(coexpr_rows)} edges ({Z.shape[0]} informative genes)', file=sys.stderr)
except ImportError:
    print('numpy not available; skipping cengen_coexpression', file=sys.stderr)
except Exception as e:
    print(f'cengen_coexpression failed: {e}', file=sys.stderr)

# ---------- KEGG cel pathways (worm-native: insulin/IGF, TGF-beta, longevity, etc.) ----------
# KEGG REST is free for academic use (no auth) but redistribution of the dump
# is license-restricted, so we fetch at build time only and never bundle the
# upstream data alongside the app. Joins to WBGene IDs via the existing
# entrez_to_wb table since KEGG cel uses Entrez gene IDs ("cel:<entrez>").
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
try:
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
except Exception as e:
    print(f'KEGG pathway ingest failed (network or REST change): {e}', file=sys.stderr)

# ---------- GO IDF ----------
cur.executescript("""
CREATE TABLE go_term_freq (go_id TEXT PRIMARY KEY, df INTEGER NOT NULL, idf REAL NOT NULL);
""")
N_total = cur.execute('SELECT COUNT(DISTINCT wormbase_gene) FROM gene_go').fetchone()[0] or 1
idf_rows = []
for go_id, df in cur.execute('SELECT go_id, COUNT(DISTINCT wormbase_gene) FROM gene_go GROUP BY go_id'):
    if df > 0:
        idf_rows.append((go_id, df, max(math.log(N_total / df), 0.0)))
cur.executemany('INSERT INTO go_term_freq VALUES (?,?,?)', idf_rows)
print(f'go_term_freq: {len(idf_rows)} terms (N_total={N_total})', file=sys.stderr)

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
for wb, allele in cur.execute("SELECT wormbase_gene, allele_id FROM allele_phenotype"):
    allele_per_gene.setdefault(wb, set()).add(allele)
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

# Per-gene KEGG pathway membership (pathway names, for FTS) — only present if
# the kegg ingest above succeeded; SELECT works regardless because we created
# the tables unconditionally before the try block.
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

conn.commit()
conn.executescript('VACUUM; ANALYZE;')
conn.close()
PY

VERSION=$(date +%Y%m%d-%H%M%S)
RAW_SIZE=$(stat -c%s "$TMP_DB" 2>/dev/null || stat -f%z "$TMP_DB")

gzip -9c "$TMP_DB" >"$DEST_DIR/wormie.sqlite.gz"
GZ_SIZE=$(stat -c%s "$DEST_DIR/wormie.sqlite.gz" 2>/dev/null || stat -f%z "$DEST_DIR/wormie.sqlite.gz")

# Pull a few real version stamps out of cached files where the source embeds them.
# Run with pipefail disabled because `head -c N` closes its pipe early, which
# would otherwise propagate SIGPIPE up through the pipeline and abort the script.
set +o pipefail
ALLIANCE_VER="$(gunzip -c "$BGI_JSON" 2>/dev/null | head -c 8000 | grep -oE 'Alliance Database Version[^"]*: [^"]+' | head -1 | sed 's/.*: //' | tr -d ' ' || true)"
EXPR_VER="$(head -c 4000 "$EXPR_TSV" 2>/dev/null | grep -oE 'Alliance Database Version: [^ ]+' | head -1 | awk '{print $NF}' || true)"
set -o pipefail
ALLIANCE_VER="${ALLIANCE_VER:-unknown}"
EXPR_VER="${EXPR_VER:-unknown}"
GO_DATE="$(date -u +%Y-%m-%d)" # we always pull current GO
WB_DATE="$(stat -c '%y' "$GENE_IDS" 2>/dev/null | cut -d' ' -f1 || echo '')"
WBBT_DATE="$(stat -c '%y' "$WBBT_OBO" 2>/dev/null | cut -d' ' -f1 || echo '')"

cat >"$DEST_DIR/version.json" <<EOF
{
  "version": "$VERSION",
  "db_file": "wormie.sqlite.gz",
  "raw_size": $RAW_SIZE,
  "gz_size": $GZ_SIZE,
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sources": {
    "wormbase": { "release": "$WB_RELEASE", "date": "$WB_DATE" },
    "go": { "date": "$GO_DATE" },
    "biogrid": { "version": "$BIOGRID_VERSION" },
    "alliance_orthology": { "version": "$ALLIANCE_VER" },
    "wormbase_phenotype": { "release": "$WB_RELEASE", "date": "$WB_DATE" },
    "alliance_expression": { "version": "$EXPR_VER" },
    "wbbt": { "date": "$WBBT_DATE" },
    "cengen": { "release": "$CENGEN_VERSION", "citation": "Barrett et al. 2022 (eLife reviewed preprint 106183)" }
  }
}
EOF

echo
echo "Built $DEST_DIR/wormie.sqlite.gz:"
echo "  raw:  $(numfmt --to=iec $RAW_SIZE 2>/dev/null || echo "$RAW_SIZE bytes")"
echo "  gzip: $(numfmt --to=iec $GZ_SIZE 2>/dev/null || echo "$GZ_SIZE bytes")"
echo "  WS:   $WB_RELEASE"
echo "  BioGRID: $BIOGRID_VERSION"
echo "  version: $VERSION"
