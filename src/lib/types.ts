export interface Gene {
  wormbase_gene: string;
  gene_name: string | null;
  sequence_name: string | null;
  gene_type: string | null;
  status: string | null;
  gene_class_description: string | null;
  concise_description: string | null;
  legacy_description: string | null;
  other_names: string | null;
  operon: string | null;
  entrez_id: string | null;
  /** WBcel235 location; null on a database built before gene_location existed. */
  chromosome: string | null;
  start_pos: number | null;
  end_pos: number | null;
  strand: string | null;
  /** Genetic map position in cM, from the gene's clone or interpolated by base pair. */
  cm: number | null;
}
