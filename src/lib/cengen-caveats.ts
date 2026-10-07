// Genes CeNGEN itself flags as unreliable in its expression matrices. Two sources: the warning on
// cengen.org (17 genes overexpressed as transgenes in the sorted strains) and the marker list in
// CeNGEN_integrated_analysis_2024/R/filter_marker_promoters.R (promoters used in the reporter
// constructs for FACS, whose own expression can be artifactual). Keyed by WormBase gene id.
const WEBSITE_WARNING = [
  'WBGene00023498', // lin-15A
  'WBGene00023497', // lin-15B
  'WBGene00004397', // rol-6
  'WBGene00006843', // unc-119
  'WBGene00004010', // pha-1
  'WBGene00006789', // unc-54
  'WBGene00001135', // eat-4
  'WBGene00001079', // dpy-20
  'WBGene00006783', // unc-47
  'WBGene00000501', // cho-1
  'WBGene00006788', // unc-53
  'WBGene00001555', // gcy-35
  'WBGene00206533', // C30A5.16
  'WBGene00011964', // saeg-2
  'WBGene00018172', // F38B6.2
  'WBGene00016259', // C30F8.3
  'WBGene00023407', // cex-1
];
const REPORTER_PROMOTERS = [
  'WBGene00044791', // bnc-1
  'WBGene00000298', // cat-4
  'WBGene00000440', // ceh-17
  'WBGene00000447', // ceh-24
  'WBGene00000450', // ceh-28
  'WBGene00000457', // ceh-36
  'WBGene00000903', // daf-7
  'WBGene00000934', // dat-1
  'WBGene00001135', // eat-4
  'WBGene00009095', // F23H12.7
  'WBGene00009100', // rgef-1
  'WBGene00009879', // F49C12.10
  'WBGene00001453', // flp-10
  'WBGene00001454', // flp-11
  'WBGene00001455', // flp-12
  'WBGene00001456', // flp-13
  'WBGene00001460', // flp-17
  'WBGene00001462', // flp-19
  'WBGene00001463', // flp-20
  'WBGene00001446', // flp-3
  'WBGene00011586', // flp-33
  'WBGene00001444', // flp-1
  'WBGene00001555', // gcy-35
  'WBGene00001532', // gcy-5
  'WBGene00001534', // gcy-7
  'WBGene00001535', // gcy-8
  'WBGene00001612', // glr-1
  'WBGene00001614', // glr-3
  'WBGene00001666', // gpa-4
  'WBGene00011327', // hlh-34
  'WBGene00002218', // klp-6
  'WBGene00002243', // lad-2
  'WBGene00012915', // lgc-35
  'WBGene00013338', // lgc-8
  'WBGene00003178', // mec-17
  'WBGene00003167', // mec-3
  'WBGene00003232', // mgl-1
  'WBGene00003755', // nlp-17
  'WBGene00003774', // nmr-1
  'WBGene00003840', // ocr-3
  'WBGene00003878', // pept-3
  'WBGene00004267', // rab-3
  'WBGene00004370', // rig-3
  'WBGene00004397', // rol-6
  'WBGene00004777', // ser-2
  'WBGene00005170', // srg-13
  'WBGene00005166', // srg-8
  'WBGene00005359', // srh-142
  'WBGene00005714', // srv-3
  'WBGene00005866', // srw-119
  'WBGene00006069', // str-1
  'WBGene00006541', // tbh-1
  'WBGene00006562', // tdc-1
  'WBGene00006600', // tph-1
  'WBGene00044187', // ttll-9
  'WBGene00007304', // ttr-39
  'WBGene00006654', // ttx-3
  'WBGene00006845', // unc-122
  'WBGene00006762', // unc-25
  'WBGene00006744', // unc-4
  'WBGene00006783', // unc-47
  'WBGene00006788', // unc-53
  'WBGene00012190', // W02A2.5
];

export const CENGEN_TRANSGENE_GENES: ReadonlySet<string> = new Set([
  ...WEBSITE_WARNING,
  ...REPORTER_PROMOTERS,
]);

export const CENGEN_TRANSGENE_NOTE =
  'CeNGEN flags the expression values of this gene as unreliable: it is part of the reporter or transgene constructs used to sort neurons, so its signal can be inflated.';
