// BioGRID experimental system definitions (physical and genetic).
// Source: https://wiki.thebiogrid.org/doku.php/experimental_systems

export interface SystemInfo {
  type: 'physical' | 'genetic';
  description: string;
}

export const BIOGRID_SYSTEMS: Record<string, SystemInfo> = {
  // ---------- Physical ----------
  'Affinity Capture-Luminescence': {
    type: 'physical',
    description:
      'An interaction inferred by tagging one protein with a luminescent reporter and capturing partners by affinity purification.',
  },
  'Affinity Capture-MS': {
    type: 'physical',
    description:
      'A bait protein is purified by affinity (often with an epitope tag) and interacting prey proteins are identified by mass spectrometry.',
  },
  'Affinity Capture-RNA': {
    type: 'physical',
    description:
      'RNA-protein interaction detected by capturing a tagged protein and identifying co-purifying RNAs.',
  },
  'Affinity Capture-Western': {
    type: 'physical',
    description:
      'A bait protein is pulled down by affinity purification and the interacting prey is identified by western blot using a specific antibody.',
  },
  'Biochemical Activity': {
    type: 'physical',
    description:
      'A direct biochemical activity of one protein on another, such as kinase phosphorylating substrate, or protease cleaving target.',
  },
  'Co-crystal Structure': {
    type: 'physical',
    description:
      'Interaction inferred from a structure containing both proteins, solved by X-ray crystallography or cryo-EM.',
  },
  'Co-fractionation': {
    type: 'physical',
    description:
      'Proteins co-elute in non-affinity fractionation (e.g. gel filtration, sucrose gradient), suggesting physical association.',
  },
  'Co-localization': {
    type: 'physical',
    description:
      'Both proteins shown to localize to the same subcellular region, often by colocalized fluorescence.',
  },
  'Co-purification': {
    type: 'physical',
    description:
      'Proteins co-purify through multiple chromatographic steps without affinity tagging.',
  },
  'Far Western': {
    type: 'physical',
    description:
      'After SDS-PAGE separation, a probe protein is applied to detect direct binding to immobilized prey.',
  },
  FRET: {
    type: 'physical',
    description:
      'Förster Resonance Energy Transfer: close proximity (<10 nm) of two fluorescently tagged proteins inferred from energy transfer.',
  },
  PCA: {
    type: 'physical',
    description:
      'Protein-fragment Complementation Assay: each protein fused to half of a reporter (e.g. DHFR, β-gal); interaction reconstitutes activity.',
  },
  'Protein-peptide': {
    type: 'physical',
    description:
      'Interaction with a synthetic peptide segment, often used to map binding sites within a protein.',
  },
  'Protein-RNA': {
    type: 'physical',
    description: 'Direct protein-RNA binding interaction.',
  },
  'Proximity Label-MS': {
    type: 'physical',
    description:
      'Proximity labeling (BioID, TurboID, APEX) tags neighboring proteins in vivo; partners identified by mass spectrometry.',
  },
  'Reconstituted Complex': {
    type: 'physical',
    description:
      'Direct interaction shown by mixing purified proteins in vitro and detecting complex formation.',
  },
  'Two-hybrid': {
    type: 'physical',
    description:
      'Yeast two-hybrid: bait and prey expressed as DNA-binding-domain / activation-domain fusions; interaction reconstitutes transcription of a reporter gene.',
  },

  // ---------- Genetic ----------
  'Dosage Growth Defect': {
    type: 'genetic',
    description:
      'Overexpression of one gene causes a growth defect in a strain mutated for the other gene.',
  },
  'Dosage Lethality': {
    type: 'genetic',
    description: 'Overexpression of one gene is lethal in a strain mutated for the other gene.',
  },
  'Dosage Rescue': {
    type: 'genetic',
    description:
      'Overexpression of one gene rescues a phenotype caused by mutation of the other gene.',
  },
  'Negative Genetic': {
    type: 'genetic',
    description:
      'Combined mutations produce a fitness defect worse than expected from the individual mutations alone (epistasis).',
  },
  'Phenotypic Enhancement': {
    type: 'genetic',
    description:
      'A mutation in one gene worsens a phenotype caused by mutation or perturbation of the other gene.',
  },
  'Phenotypic Suppression': {
    type: 'genetic',
    description:
      'A mutation in one gene rescues or suppresses a phenotype caused by mutation of the other gene.',
  },
  'Positive Genetic': {
    type: 'genetic',
    description:
      'Combined mutations produce a fitness benefit greater than expected from the individual mutations alone.',
  },
  'Synthetic Growth Defect': {
    type: 'genetic',
    description:
      'Two mutations together cause a growth defect that neither single mutation produces alone.',
  },
  'Synthetic Haploinsufficiency': {
    type: 'genetic',
    description:
      'A loss of one copy of one gene reveals a phenotype caused by mutation of another gene.',
  },
  'Synthetic Lethality': {
    type: 'genetic',
    description:
      'Two mutations together are lethal, while either mutation alone is viable. A classic indicator of redundant or compensating pathways.',
  },
  'Synthetic Rescue': {
    type: 'genetic',
    description:
      'A mutation in one gene rescues a lethal or sick phenotype caused by mutation of the other gene.',
  },
};

export function describeSystem(name: string): SystemInfo | null {
  return BIOGRID_SYSTEMS[name] ?? null;
}
