// Static reference + class metadata for the curated synaptogenesis panel
// (source: celegans-pipeline:SYNAPTOGENESIS.txt v3, PDF-verified).
// Gene-to-class membership is in the SQLite `synaptogenesis` table; this module
// carries only the bibliographic and per-class editorial layer surfaced by the UI.

export interface PanelReference {
  id: string; // "R1", "R2", ...
  authors: string;
  year: number;
  title: string;
  journal: string;
  doi: string;
}

export interface PanelClass {
  id: string; // Matches `class` column in the `synaptogenesis` table.
  label: string; // Display label (numeric prefix omitted for visual cleanliness).
  description: string;
  refIds: string[];
  note?: string; // Curator note, e.g. "DAUER-RELEVANT" tags or heterochrony flags.
}

export const SYNAPTOGENESIS_REFERENCES: PanelReference[] = [
  {
    id: 'R1',
    authors: 'Hobert O, Kratsios P',
    year: 2018,
    title: 'Neuronal identity control by terminal selectors in worms, flies, and chordates',
    journal: 'Curr Opin Neurobiol 56:97-105',
    doi: '10.1016/j.conb.2018.12.006',
  },
  {
    id: 'R2',
    authors: 'Yee C, Xiao Y, Chen H, et al.',
    year: 2024,
    title: 'An activity-regulated transcriptional program directly drives synaptogenesis',
    journal: 'Nature Neuroscience',
    doi: '10.1038/s41593-024-01728-x',
  },
  {
    id: 'R3',
    authors: 'Cuentas-Condori A, Miller DM III',
    year: 2020,
    title: 'Synaptic Remodeling, Lessons from C. elegans',
    journal: 'J Neurogenet 34(3-4):307-322',
    doi: '10.1080/01677063.2020.1802725',
  },
  {
    id: 'R4',
    authors: 'Hendi A, Kurashina M, Mizumoto K',
    year: 2019,
    title: 'Intrinsic and extrinsic mechanisms of synapse formation and specificity in C. elegans',
    journal: 'Cell Mol Life Sci 76:2719-2738',
    doi: '10.1007/s00018-019-03109-1',
  },
  {
    id: 'R5',
    authors: 'Xuan Z, Manning L, Nelson J, et al.',
    year: 2017,
    title:
      'Clarinet (CLA-1), a novel active zone protein required for synaptic vesicle clustering and release',
    journal: 'eLife 6:e29276',
    doi: '10.7554/eLife.29276',
  },
  {
    id: 'R6',
    authors: 'Maeder CI, Kim J-I, Liang X, et al.',
    year: 2018,
    title:
      'The THO Complex Coordinates Transcripts for Synapse Development and Dopamine Neuron Survival',
    journal: 'Cell 174(6):1436-1449',
    doi: '10.1016/j.cell.2018.07.046',
  },
  {
    id: 'R7',
    authors: 'Hobert O',
    year: 2016,
    title: 'A map of terminal regulators of neuronal identity in Caenorhabditis elegans',
    journal: 'WIREs Dev Biol 5(4):474-498',
    doi: '10.1002/wdev.233',
  },
  {
    id: 'R8',
    authors: 'Bhattacharya A, Aghayeva U, Berghoff EG, Hobert O',
    year: 2019,
    title: 'Plasticity of the Electrical Connectome of C. elegans',
    journal: 'Cell 176(5):1174-1189',
    doi: '10.1016/j.cell.2018.12.024',
  },
  {
    id: 'R9',
    authors: 'Klassen MP, Shen K',
    year: 2007,
    title:
      'Wnt Signaling Positions Neuromuscular Connectivity by Inhibiting Synapse Formation in C. elegans',
    journal: 'Cell 130(4):704-716',
    doi: '10.1016/j.cell.2007.06.046',
  },
  {
    id: 'R10',
    authors: 'Schaefer AM, Hadwiger GD, Nonet ML',
    year: 2000,
    title:
      'rpm-1, A Conserved Neuronal Gene that Regulates Targeting and Synaptogenesis in C. elegans',
    journal: 'Neuron 26(2):345-356',
    doi: '10.1016/S0896-6273(00)81168-X',
  },
  {
    id: 'R11',
    authors: 'Nakata K, Abrams B, Grill B, et al.',
    year: 2005,
    title:
      'Regulation of a DLK-1 and p38 MAP Kinase Pathway by the Ubiquitin Ligase RPM-1 is Required for Presynaptic Development',
    journal: 'Cell 120(3):407-420',
    doi: '10.1016/j.cell.2004.12.017',
  },
  {
    id: 'R12',
    authors: 'Hobert O',
    year: 2008,
    title: 'Regulatory logic of neuronal diversity: terminal selector genes and selector motifs',
    journal: 'PNAS 105(51):20067-20071',
    doi: '10.1073/pnas.0806070105',
  },
  {
    id: 'R13',
    authors: 'Patel MR, Lehrman EK, Poon VY, et al.',
    year: 2006,
    title: 'Hierarchical assembly of presynaptic components in defined C. elegans synapses',
    journal: 'Nat Neurosci 9(11):1488-1498',
    doi: '10.1038/nn1806',
  },
  {
    id: 'R14',
    authors: 'Shi Y, Qin L, Wu M, Zheng J, Xie T, Shao Z',
    year: 2022,
    title: 'Gut neuroendocrine signaling regulates synaptic assembly in C. elegans',
    journal: 'EMBO Reports 23(9):e53267',
    doi: '10.15252/embr.202153267',
  },
  {
    id: 'R15',
    authors: 'Hobert O',
    year: 2016,
    title: 'Terminal Selectors of Neuronal Identity',
    journal: 'Curr Top Dev Biol 116 ch.25:455-475',
    doi: '10.1016/bs.ctdb.2015.12.007',
  },
  {
    id: 'R16',
    authors: 'Senti G, Swoboda P',
    year: 2008,
    title:
      'Distinct Isoforms of the RFX Transcription Factor DAF-19 Regulate Ciliogenesis and Maintenance of Synaptic Activity',
    journal: 'Mol Biol Cell 19(12):5517-5528',
    doi: '10.1091/mbc.E08-04-0392',
  },
  {
    id: 'R17',
    authors: 'Mason DA, Rabinowitz JS, Portman DS',
    year: 2008,
    title:
      'dmd-3, a doublesex-related gene regulated by tra-1, governs sex-specific morphogenesis in C. elegans',
    journal: 'Development 135(14):2373-2382',
    doi: '10.1242/dev.017046',
  },
  {
    id: 'R18',
    authors: 'Li Y, Osuma A, Correa E, et al.',
    year: 2020,
    title:
      'Establishment and maintenance of motor neuron identity via temporal modularity in terminal selector function',
    journal: 'eLife 9:e59464',
    doi: '10.7554/eLife.59464',
  },
  {
    id: 'R19',
    authors: 'Nolan KM, Sarafi-Reinach TR, Horne JG, Saffer AM, Sengupta P',
    year: 2002,
    title:
      'The DAF-7 TGF-beta signaling pathway regulates chemosensory receptor gene expression in C. elegans',
    journal: 'Genes Dev 16(23):3061-3073',
    doi: '10.1101/gad.1027702',
  },
  {
    id: 'R20',
    authors: 'Cochella L, Hobert O',
    year: 2012,
    title:
      'Embryonic priming of a miRNA locus predetermines postmitotic neuronal left-right asymmetry in C. elegans',
    journal: 'Cell 151(6):1229-1242',
    doi: '10.1016/j.cell.2012.10.049',
  },
  {
    id: 'R21',
    authors: 'Chen X, Shibata ACE, Hendi A, et al.',
    year: 2018,
    title: 'Rap2 and TNIK control Plexin-dependent tiled synaptic innervation in C. elegans',
    journal: 'eLife 7:e38801',
    doi: '10.7554/eLife.38801',
  },
  {
    id: 'R22',
    authors: 'Kim JSM, Hung W, Narbonne P, Roy R, Zhen M',
    year: 2010,
    title:
      'C. elegans STRADα and SAD cooperatively regulate neuronal polarity and synaptic organization',
    journal: 'Development 137(1):93-102',
    doi: '10.1242/dev.041459',
  },
  {
    id: 'R23',
    authors: 'Park M, Watanabe S, Poon VYN, Ou C-Y, Jorgensen EM, Shen K',
    year: 2011,
    title:
      'CYY-1/Cyclin Y and CDK-5 Differentially Regulate Synapse Elimination and Formation for Rewiring Neural Circuits',
    journal: 'Neuron 70(4):742-757',
    doi: '10.1016/j.neuron.2011.04.002',
  },
  {
    id: 'R24',
    authors: 'Oh KH, Krout MD, Richmond JE, Kim H',
    year: 2023,
    title:
      'Active Zone Trafficking of CaV2/UNC-2 Channels Is Independent of β/CCB-1 and α2δ/UNC-36 Subunits',
    journal: 'J Neurosci 43(28):5142-5157',
    doi: '10.1523/JNEUROSCI.0273-23.2023',
  },
  {
    id: 'R25',
    authors: 'Patel T, Hobert O',
    year: 2017,
    title: 'Coordinated control of terminal differentiation and restriction of cellular plasticity',
    journal: 'eLife 6:e24100',
    doi: '10.7554/eLife.24100',
  },
];

// Class-level editorial layer keyed by the `class` column in the DB.
export const SYNAPTOGENESIS_CLASSES: PanelClass[] = [
  {
    id: '01_proneural_fate',
    label: 'Proneural / fate-specifying TFs',
    description:
      'Upstream, transient. Specify neuroblast identity before terminal selectors take over.',
    refIds: ['R1', 'R7', 'R20'],
  },
  {
    id: '02_terminal_selector',
    label: 'Terminal selector TFs',
    description:
      'Continuous, lifelong. Master regulators of neuron-type identity; directly activate effector gene batteries.',
    refIds: ['R7', 'R12', 'R15', 'R1', 'R16', 'R17', 'R18', 'R25'],
  },
  {
    id: '03_activity_regulated',
    label: 'Activity-regulated / feed-forward synaptogenesis TFs',
    description:
      'Activity-induced FOS-1 + EGL-43/MECOM mutually activate each other and co-bind CUT homeobox factors on synaptic gene promoters in C. elegans dopaminergic neurons.',
    refIds: ['R2'],
  },
  {
    id: '04_remodeling',
    label: 'Remodeling-specific TFs + factors',
    description:
      'Pro- vs anti-remodeling TFs, dauer/heterochronic regulators, and BK-channel modulator slo-1.',
    refIds: ['R3', 'R8', 'R19'],
    note: 'DAUER-RELEVANT',
  },
  {
    id: '05_adhesion_specificity',
    label: 'Synaptic specificity / cell adhesion',
    description:
      'Core synaptic adhesion (SYG, NRX-NLG, MADD-4), IgSF members, axon guidance / cytoskeletal regulators, and clustering factors.',
    refIds: ['R4', 'R9', 'R5', 'R21'],
  },
  {
    id: '06_active_zone',
    label: 'Active zone scaffolding',
    description:
      'Core AZ scaffold (SYD-1/2, ELKS, UNC-10, RIMB-1, CLA-1) plus kinases / phosphatases shaping AZ assembly.',
    refIds: ['R4', 'R5', 'R13', 'R22'],
  },
  {
    id: '07_SV_release',
    label: 'Synaptic vesicle / release machinery',
    description:
      'Pan-neuronal core: SNARE/release proteins, voltage-gated Ca channels, vesicle trafficking + transport machinery, cargo kinases.',
    refIds: ['R4', 'R6', 'R14', 'R23', 'R24'],
  },
  {
    id: '08_innexin',
    label: 'Electrical synapse / innexins',
    description:
      'All 18 inx-* + che-7, eat-5, unc-7, unc-9. Bhattacharya 2019 mapped expression across the whole nervous system and showed neuron-specific combinatorial codes and stress plasticity.',
    refIds: ['R8'],
    note: 'DAUER-REMODELED',
  },
  {
    id: '09_postsynaptic',
    label: 'Postsynaptic receptors / clustering',
    description:
      'Levamisole + other nAChRs, GABA-A/B, muscarinic, glutamate (iGluR + mGluR + glc-3), other LGICs, dopamine / serotonin receptors, cleft enzyme ace-2, and clustering scaffolds (lev-9/10, oig-4, lin-2/7/10, dlg-1, magi-1).',
    refIds: ['R3', 'R7'],
  },
  {
    id: '10_mRNA_export',
    label: 'mRNA export / RNA processing for synaptic transcripts',
    description:
      'THO complex + TREX adaptors + activity-driven CREB binder. Functionally synaptic in this context per Maeder 2018 even though aly-1/2/3 lack synapse GO annotations.',
    refIds: ['R6'],
  },
  {
    id: '11_PHR_MAPK',
    label: 'PHR / MAPK ubiquitin signaling at synapse',
    description:
      'rpm-1 founding paper + the DLK-1 / MKK-4 / PMK-3 cascade and downstream targets. Negative regulator of synapse formation via MAPK signaling.',
    refIds: ['R10', 'R11', 'R4', 'R13'],
  },
  {
    id: '12_wnt_morphogen',
    label: 'Wnt / morphogen synaptic positioning',
    description:
      'Wnt ligands, Frizzled receptors, LRP coreceptors, plus Dishevelled / β-catenin / Axin. Klassen & Shen 2007 is the definitive DA9 motor-neuron positioning paradigm.',
    refIds: ['R9'],
  },
  {
    id: '13_NT_identity',
    label: 'Neurotransmitter identity (terminal selector targets)',
    description:
      'Vesicular transporters + biosynthetic enzymes that define cholinergic / GABAergic / glutamatergic / monoamine / dopaminergic / serotonergic identity.',
    refIds: ['R7'],
  },
];

const REF_BY_ID = new Map(SYNAPTOGENESIS_REFERENCES.map((r) => [r.id, r]));
const CLASS_BY_ID = new Map(SYNAPTOGENESIS_CLASSES.map((c) => [c.id, c]));

export function refById(id: string): PanelReference | undefined {
  return REF_BY_ID.get(id);
}

export function classById(id: string): PanelClass | undefined {
  return CLASS_BY_ID.get(id);
}

export function doiHref(doi: string): string {
  return `https://doi.org/${doi}`;
}

// TSV uses underscores throughout (`01_proneural_fate`, `chat_cholinergic`).
// prettySubclass replaces _ with " · "; prettyClass also strips the numeric prefix.
export function prettySubclass(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' · ');
}

export function prettyClass(value: string | null | undefined): string {
  if (!value) return '';
  const stripped = value.replace(/^\d+_/, '');
  return stripped.replace(/_/g, ' ');
}
