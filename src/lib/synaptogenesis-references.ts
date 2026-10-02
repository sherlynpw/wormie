// Static reference + class metadata for the curated synaptogenesis panel
// (source: celegans-pipeline:SYNAPTOGENESIS.txt v4; references checked against
// Crossref and PubMed, with the per-reference reading record in that file).
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
    year: 2019,
    title: 'Neuronal identity control by terminal selectors in worms, flies, and chordates',
    journal: 'Curr Opin Neurobiol 56:97-105',
    doi: '10.1016/j.conb.2018.12.006',
  },
  {
    id: 'R2',
    authors: 'Yee C, Xiao Y, Chen H, et al.',
    year: 2024,
    title: 'An activity-regulated transcriptional program directly drives synaptogenesis',
    journal: 'Nat Neurosci 27(9):1695-1707',
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
    journal: 'Nat Neurosci 9(12):1488-1498',
    doi: '10.1038/nn1806',
  },
  {
    id: 'R14',
    authors: 'Shi Y, Qin L, Wu M, Zheng J, Xie T, Shao Z',
    year: 2022,
    title: 'Gut neuroendocrine signaling regulates synaptic assembly in C. elegans',
    journal: 'EMBO Reports 23(8):e53267',
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
    doi: '10.1091/mbc.E08-04-0416',
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
    authors: 'Chen X, Shibata AC, Hendi A, et al.',
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
    authors: 'Oh KH, Xiong A, Choe JY, Richmond JE, Kim H',
    year: 2023,
    title:
      'Active Zone Trafficking of CaV2/UNC-2 Channels Is Independent of β/CCB-1 and α2δ/UNC-36 Subunits',
    journal: 'J Neurosci 43(28):5142-5157',
    doi: '10.1523/JNEUROSCI.2264-22.2023',
  },
  {
    id: 'R25',
    authors: 'Patel T, Hobert O',
    year: 2017,
    title: 'Coordinated control of terminal differentiation and restriction of cellular plasticity',
    journal: 'eLife 6:e24100',
    doi: '10.7554/eLife.24100',
  },
  {
    id: 'R26',
    authors: 'Hallam S, Singer E, Waring D, Jin Y',
    year: 2000,
    title:
      'The C. elegans NeuroD homolog cnd-1 functions in multiple aspects of motor neuron fate specification',
    journal: 'Development 127(19):4239-52',
    doi: '10.1242/dev.127.19.4239',
  },
  {
    id: 'R27',
    authors: 'Aquino-Nunez W, Mielko ZE, Dunn T, et al.',
    year: 2020,
    title:
      'cnd-1/NeuroD1 Functions with the Homeobox Gene ceh-5/Vax2 and Hox Gene ceh-13/labial To Specify Aspects of RME and DD Neuron Fate in Caenorhabditis elegans',
    journal: 'G3 (Bethesda) 10(9):3071-3085',
    doi: '10.1534/g3.120.401515',
  },
  {
    id: 'R28',
    authors: 'Nakano S, Ellis RE, Horvitz HR',
    year: 2010,
    title:
      'Otx-dependent expression of proneural bHLH genes establishes a neuronal bilateral asymmetry in C. elegans',
    journal: 'Development 137(23):4017-27',
    doi: '10.1242/dev.058834',
  },
  {
    id: 'R29',
    authors: 'Christensen EL, Beasley A, Radchuk J, et al.',
    year: 2020,
    title:
      'ngn-1/neurogenin Activates Transcription of Multiple Terminal Selector Transcription Factors in the Caenorhabditis elegans Nervous System',
    journal: 'G3 (Bethesda) 10(6):1949-1962',
    doi: '10.1534/g3.120.401126',
  },
  {
    id: 'R30',
    authors: 'Doonan R, Hatzold J, Raut S, Conradt B, Alfonso A',
    year: 2008,
    title:
      'HLH-3 is a C. elegans Achaete/Scute protein required for differentiation of the hermaphrodite-specific motor neurons',
    journal: 'Mech Dev 125(9-10):883-93',
    doi: '10.1016/j.mod.2008.06.002',
  },
  {
    id: 'R31',
    authors: 'Wrischnik LA, Kenyon CJ',
    year: 1997,
    title:
      'The role of lin-22, a hairy/enhancer of split homolog, in patterning the peripheral nervous system of C. elegans',
    journal: 'Development 124(15):2875-88',
    doi: '10.1242/dev.124.15.2875',
  },
  {
    id: 'R32',
    authors: 'Frank CA, Hawkins NC, Guenther C, Horvitz HR, Garriga G',
    year: 2005,
    title:
      'C. elegans HAM-1 positions the cleavage plane and regulates apoptosis in asymmetric neuroblast divisions',
    journal: 'Dev Biol 284(2):301-10',
    doi: '10.1016/j.ydbio.2005.05.026',
  },
  {
    id: 'R33',
    authors: 'Sarafi-Reinach TR, Sengupta P',
    year: 2000,
    title: 'The forkhead domain gene unc-130 generates chemosensory neuron diversity in C. elegans',
    journal: 'Genes Dev 14(19):2472-85',
    doi: '10.1101/gad.832300',
  },
  {
    id: 'R34',
    authors: 'Aguilar GR, Vidal B, Ji H, et al.',
    year: 2025,
    title:
      'Functional analysis of conserved C. elegans bHLH family members uncovers lifespan control by a peptidergic hub neuron',
    journal: 'PLoS Biol 23(1):e3002979',
    doi: '10.1371/journal.pbio.3002979',
  },
  {
    id: 'R35',
    authors: 'Kim K, Kim R, Sengupta P',
    year: 2010,
    title:
      'The HMX/NKX homeodomain protein MLS-2 specifies the identity of the AWC sensory neuron type via regulation of the ceh-36 Otx gene in C. elegans',
    journal: 'Development 137(6):963-74',
    doi: '10.1242/dev.044719',
  },
  {
    id: 'R36',
    authors: 'Grill B, Bienvenut WV, Brown HM, Ackley BD, Quadroni M, Jin Y',
    year: 2007,
    title:
      'C. elegans RPM-1 regulates axon termination and synaptogenesis through the Rab GEF GLO-4 and the Rab GTPase GLO-1',
    journal: 'Neuron 55(4):587-601',
    doi: '10.1016/j.neuron.2007.07.009',
  },
  {
    id: 'R37',
    authors: 'Wang DY, Wang Y',
    year: 2009,
    title:
      'HLB-1 functions as a new regulator for the organization and function of neuromuscular junctions in nematode Caenorhabditis elegans',
    journal: 'Neurosci Bull 25(2):75-86',
    doi: '10.1007/s12264-009-0119-9',
  },
  {
    id: 'R38',
    authors: 'Jensen M, Hoerndli FJ, Brockie PJ, et al.',
    year: 2012,
    title:
      'Wnt signaling regulates acetylcholine receptor translocation and synaptic plasticity in the adult nervous system',
    journal: 'Cell 149(1):173-87',
    doi: '10.1016/j.cell.2011.12.038',
  },
  {
    id: 'R39',
    authors: 'Mizumoto K, Shen K',
    year: 2013,
    title: 'Two Wnts instruct topographic synaptic innervation in C. elegans',
    journal: 'Cell Rep 5(2):389-96',
    doi: '10.1016/j.celrep.2013.09.011',
  },
  {
    id: 'R40',
    authors: 'Dreier L, Burbea M, Kaplan JM',
    year: 2005,
    title:
      'LIN-23-mediated degradation of beta-catenin regulates the abundance of GLR-1 glutamate receptors in the ventral nerve cord of C. elegans',
    journal: 'Neuron 46(1):51-64',
    doi: '10.1016/j.neuron.2004.12.058',
  },
  {
    id: 'R41',
    authors: 'Sharma P, Li L, Liu H, Tikiyani V, Hu Z, Babu K',
    year: 2018,
    title:
      'The Claudin-like Protein HPO-30 Is Required to Maintain LAChRs at the C. elegans Neuromuscular Junction',
    journal: 'J Neurosci 38(32):7072-7087',
    doi: '10.1523/JNEUROSCI.3487-17.2018',
  },
  {
    id: 'R42',
    authors: 'Mellem JE, Brockie PJ, Zheng Y, Madsen DM, Maricq AV',
    year: 2002,
    title:
      'Decoding of polymodal sensory stimuli by postsynaptic glutamate receptors in C. elegans',
    journal: 'Neuron 36(5):933-44',
    doi: '10.1016/s0896-6273(02)01088-7',
  },
  {
    id: 'R43',
    authors: 'Brockie PJ, Mellem JE, Hills T, Madsen DM, Maricq AV',
    year: 2001,
    title:
      'The C. elegans glutamate receptor subunit NMR-1 is required for slow NMDA-activated currents that regulate reversal frequency during locomotion',
    journal: 'Neuron 31(4):617-30',
    doi: '10.1016/s0896-6273(01)00394-4',
  },
  {
    id: 'R44',
    authors: 'Kano T, Brockie PJ, Sassa T, et al.',
    year: 2008,
    title:
      'Memory in Caenorhabditis elegans is mediated by NMDA-type ionotropic glutamate receptors',
    journal: 'Curr Biol 18(13):1010-5',
    doi: '10.1016/j.cub.2008.05.051',
  },
  {
    id: 'R45',
    authors: 'Gendrel M, Rapti G, Richmond JE, Bessereau JL',
    year: 2009,
    title:
      'A secreted complement-control-related protein ensures acetylcholine receptor clustering',
    journal: 'Nature 461(7266):992-6',
    doi: '10.1038/nature08430',
  },
  {
    id: 'R46',
    authors: 'Rapti G, Richmond J, Bessereau JL',
    year: 2011,
    title:
      'A single immunoglobulin-domain protein required for clustering acetylcholine receptors in C. elegans',
    journal: 'EMBO J 30(4):706-18',
    doi: '10.1038/emboj.2010.355',
  },
  {
    id: 'R47',
    authors: 'Glodowski DR, Wright T, Martinowich K, Chang HC, Beach D, Rongo C',
    year: 2005,
    title:
      'Distinct LIN-10 domains are required for its neuronal function, its epithelial function, and its synaptic localization',
    journal: 'Mol Biol Cell 16(3):1417-26',
    doi: '10.1091/mbc.e04-10-0885',
  },
  {
    id: 'R48',
    authors: 'Zhou X, Gueydan M, Jospin M, et al.',
    year: 2020,
    title:
      'The netrin receptor UNC-40/DCC assembles a postsynaptic scaffold and sets the synaptic content of GABA(A) receptors',
    journal: 'Nat Commun 11(1):2674',
    doi: '10.1038/s41467-020-16473-5',
  },
  {
    id: 'R49',
    authors: 'Emtage L, Chang H, Tiver R, Rongo C',
    year: 2009,
    title:
      'MAGI-1 modulates AMPA receptor synaptic localization and behavioral plasticity in response to prior experience',
    journal: 'PLoS One 4(2):e4613',
    doi: '10.1371/journal.pone.0004613',
  },
  {
    id: 'R50',
    authors: 'Babu K, Hu Z, Chien SC, Garriga G, Kaplan JM',
    year: 2011,
    title:
      'The immunoglobulin super family protein RIG-3 prevents synaptic potentiation and regulates Wnt signaling',
    journal: 'Neuron 71(1):103-16',
    doi: '10.1016/j.neuron.2011.05.034',
  },
  {
    id: 'R51',
    authors: 'Mialon M, Patrash L, Granger L, et al.',
    year: 2026,
    title:
      'A trans-synaptic IgLON adhesion molecular complex directly contacts and clusters a nicotinic receptor',
    journal: 'Nat Commun 17(1):1404',
    doi: '10.1038/s41467-025-68141-1',
  },
  {
    id: 'R52',
    authors: 'Kim B, Emmons SW',
    year: 2017,
    title:
      'Multiple conserved cell adhesion protein interactions mediate neural wiring of a sensory circuit in C. elegans',
    journal: 'Elife 6',
    doi: '10.7554/eLife.29257',
  },
  {
    id: 'R53',
    authors: 'Opperman K, Moseley-Alldredge M, Yochem J, Bell L, Kanayinkal T, Chen L',
    year: 2015,
    title:
      'A novel nondevelopmental role of the sax-7/L1CAM cell adhesion molecule in synaptic regulation in Caenorhabditis elegans',
    journal: 'Genetics 199(2):497-509',
    doi: '10.1534/genetics.114.169581',
  },
  {
    id: 'R54',
    authors: 'Najarro EH, Wong L, Zhen M, et al.',
    year: 2012,
    title:
      'Caenorhabditis elegans flamingo cadherin fmi-1 regulates GABAergic neuronal development',
    journal: 'J Neurosci 32(12):4196-211',
    doi: '10.1523/JNEUROSCI.3094-11.2012',
  },
  {
    id: 'R55',
    authors: 'Schuske K, Palfreyman MT, Watanabe S, Jorgensen EM',
    year: 2007,
    title: 'UNC-46 is required for trafficking of the vesicular GABA transporter',
    journal: 'Nat Neurosci 10(7):846-53',
    doi: '10.1038/nn1920',
  },
  {
    id: 'R56',
    authors: 'Duerr JS, Frisby DL, Gaskin J, et al.',
    year: 1999,
    title:
      'The cat-1 gene of Caenorhabditis elegans encodes a vesicular monoamine transporter required for specific monoamine-dependent behaviors',
    journal: 'J Neurosci 19(1):72-84',
    doi: '10.1523/JNEUROSCI.19-01-00072.1999',
  },
  {
    id: 'R57',
    authors: 'Lints R, Emmons SW',
    year: 1999,
    title:
      'Patterning of dopaminergic neurotransmitter identity among Caenorhabditis elegans ray sensory neurons by a TGFbeta family signaling pathway and a Hox gene',
    journal: 'Development 126(24):5819-31',
    doi: '10.1242/dev.126.24.5819',
  },
  {
    id: 'R58',
    authors: 'Ranganathan R, Sawin ER, Trent C, Horvitz HR',
    year: 2001,
    title:
      'Mutations in the Caenorhabditis elegans serotonin reuptake transporter MOD-5 reveal serotonin-dependent and -independent activities of fluoxetine',
    journal: 'J Neurosci 21(16):5871-84',
    doi: '10.1523/JNEUROSCI.21-16-05871.2001',
  },
  {
    id: 'R59',
    authors: 'McDonald PW, Hardie SL, Jessen TN, Carvelli L, Matthies DS, Blakely RD',
    year: 2007,
    title:
      'Vigorous motor activity in Caenorhabditis elegans requires efficient clearance of dopamine mediated by synaptic localization of the dopamine transporter DAT-1',
    journal: 'J Neurosci 27(51):14216-27',
    doi: '10.1523/JNEUROSCI.2992-07.2007',
  },
  {
    id: 'R60',
    authors: 'Zhou KM, Dong YM, Ge Q, et al.',
    year: 2007,
    title:
      'PKA activation bypasses the requirement for UNC-31 in the docking of dense core vesicles from C. elegans neurons',
    journal: 'Neuron 56(4):657-69',
    doi: '10.1016/j.neuron.2007.09.015',
  },
  {
    id: 'R61',
    authors: 'Harris TW, Hartwieg E, Horvitz HR, Jorgensen EM',
    year: 2000,
    title: 'Mutations in synaptojanin disrupt synaptic vesicle recycling',
    journal: 'J Cell Biol 150(3):589-600',
    doi: '10.1083/jcb.150.3.589',
  },
  {
    id: 'R62',
    authors: 'Schuske KR, Richmond JE, Matthies DS, et al.',
    year: 2003,
    title: 'Endophilin is required for synaptic vesicle endocytosis by localizing synaptojanin',
    journal: 'Neuron 40(4):749-62',
    doi: '10.1016/s0896-6273(03)00667-6',
  },
  {
    id: 'R63',
    authors: 'Clark SG, Shurland DL, Meyerowitz EM, Bargmann CI, van der Bliek AM',
    year: 1997,
    title:
      'A dynamin GTPase mutation causes a rapid and reversible temperature-inducible locomotion defect in C. elegans',
    journal: 'Proc Natl Acad Sci U S A 94(19):10438-43',
    doi: '10.1073/pnas.94.19.10438',
  },
  {
    id: 'R64',
    authors: 'Armakola M, Ruvkun G',
    year: 2019,
    title: 'Regulation of Caenorhabditis elegans neuronal polarity by heterochronic genes',
    journal: 'Proc Natl Acad Sci U S A 116(25):12327-12336',
    doi: '10.1073/pnas.1820928116',
  },
  {
    id: 'R65',
    authors: 'McGehee AM, Moss BJ, Juo P',
    year: 2015,
    title:
      'The DAF-7/TGF-beta signaling pathway regulates abundance of the Caenorhabditis elegans glutamate receptor GLR-1',
    journal: 'Mol Cell Neurosci 67:66-74',
    doi: '10.1016/j.mcn.2015.06.003',
  },
  {
    id: 'R66',
    authors: 'Liao EH, Hung W, Abrams B, Zhen M',
    year: 2004,
    title: 'An SCF-like ubiquitin ligase complex that controls presynaptic differentiation',
    journal: 'Nature 430(6997):345-50',
    doi: '10.1038/nature02647',
  },
  {
    id: 'R67',
    authors: 'Jacob TC, Kaplan JM',
    year: 2003,
    title:
      'The EGL-21 carboxypeptidase E facilitates acetylcholine release at Caenorhabditis elegans neuromuscular junctions',
    journal: 'J Neurosci 23(6):2122-2130',
    doi: '10.1523/jneurosci.23-06-02122.2003',
  },
];

// Class-level editorial layer keyed by the `class` column in the DB.
export const SYNAPTOGENESIS_CLASSES: PanelClass[] = [
  {
    id: '01_proneural_fate',
    label: 'Proneural / fate-specifying TFs',
    description:
      'Upstream, transient. Specify neuroblast identity before terminal selectors take over.',
    refIds: ['R1', 'R7', 'R20', 'R26', 'R27', 'R28', 'R29', 'R30', 'R31', 'R32', 'R33'],
  },
  {
    id: '02_terminal_selector',
    label: 'Terminal selector TFs',
    description:
      'Continuous, lifelong. Master regulators of neuron-type identity; directly activate effector gene batteries.',
    refIds: ['R7', 'R12', 'R15', 'R1', 'R16', 'R18', 'R25', 'R34', 'R35'],
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
    refIds: ['R3', 'R8', 'R19', 'R64', 'R65'],
    note: 'DAUER-RELEVANT',
  },
  {
    id: '05_adhesion_specificity',
    label: 'Synaptic specificity / cell adhesion',
    description:
      'Core synaptic adhesion (SYG, NRX-NLG, MADD-4), IgSF members, axon guidance / cytoskeletal regulators, and clustering factors.',
    refIds: ['R4', 'R9', 'R5', 'R21', 'R50', 'R51', 'R52', 'R53', 'R54'],
  },
  {
    id: '06_active_zone',
    label: 'Active zone scaffolding',
    description:
      'Core AZ scaffold (SYD-1/2, ELKS, UNC-10, RIMB-1, CLA-1) plus kinases / phosphatases shaping AZ assembly.',
    refIds: ['R4', 'R5', 'R13', 'R22', 'R37'],
  },
  {
    id: '07_SV_release',
    label: 'Synaptic vesicle / release machinery',
    description:
      'Pan-neuronal core: SNARE/release proteins, voltage-gated Ca channels, vesicle trafficking + transport machinery, cargo kinases.',
    refIds: ['R4', 'R6', 'R14', 'R23', 'R24', 'R60', 'R61', 'R62', 'R63', 'R67'],
  },
  {
    id: '08_innexin',
    label: 'Electrical synapse / innexins',
    description:
      'The 15 innexins expressed in the nervous system. Bhattacharya 2019 mapped expression across the whole nervous system and showed neuron-specific combinatorial codes and stress plasticity.',
    refIds: ['R8'],
    note: 'DAUER-REMODELED',
  },
  {
    id: '09_postsynaptic',
    label: 'Postsynaptic receptors / clustering',
    description:
      'Levamisole + other nAChRs, GABA-A/B, muscarinic, glutamate (iGluR + mGluR + glc-3), other LGICs, dopamine / serotonin receptors, cleft enzyme ace-2, and clustering scaffolds (lev-9/10, oig-4, lin-2/7/10, dlg-1, magi-1).',
    refIds: ['R3', 'R7', 'R41', 'R42', 'R43', 'R44', 'R45', 'R46', 'R47', 'R48', 'R49'],
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
    refIds: ['R10', 'R11', 'R4', 'R13', 'R36', 'R66'],
  },
  {
    id: '12_wnt_morphogen',
    label: 'Wnt / morphogen synaptic positioning',
    description:
      'Wnt ligands, Frizzled receptors, plus Dishevelled and β-catenin. Klassen & Shen 2007 is the definitive DA9 motor-neuron positioning paradigm.',
    refIds: ['R9', 'R38', 'R39', 'R40'],
  },
  {
    id: '13_NT_identity',
    label: 'Neurotransmitter identity (terminal selector targets)',
    description:
      'Vesicular transporters + biosynthetic enzymes that define cholinergic / GABAergic / glutamatergic / monoamine / dopaminergic / serotonergic identity.',
    refIds: ['R7', 'R55', 'R56', 'R57', 'R58', 'R59'],
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

// A subclass is the gene's role within its class (TSV subclass column), from a
// fixed list per class. Keyed by the TSV slug.
const SUBCLASS_LABELS: Record<string, string> = {
  proneural_bhlh_factors: 'Proneural bHLH factors',
  neuroblast_fate_regulators: 'Neuroblast fate regulators',
  left_right_asymmetry_regulators: 'Left-right asymmetry regulators',
  sensory_specific_selectors: 'Sensory-specific selectors',
  motor_specific_selectors: 'Motor-specific selectors',
  interneuron_specific_selectors: 'Interneuron-specific selectors',
  multi_class_selectors: 'Multi-class selectors',
  activity_induced_factors: 'Activity-induced factors',
  homeobox_cofactors: 'Homeobox cofactors',
  coactivators_and_chromatin_remodelers: 'Co-activators and chromatin remodelers',
  pro_remodeling_factors: 'Pro-remodeling factors',
  anti_remodeling_factors: 'Anti-remodeling factors',
  heterochronic_timers: 'Heterochronic timers',
  dauer_signaling: 'Dauer signaling',
  activity_modulators: 'Activity modulators',
  adhesion_and_organizer_molecules: 'Adhesion and organizer molecules',
  guidance_cues_and_receptors: 'Guidance cues and receptors',
  cytoskeletal_and_signaling_effectors: 'Cytoskeletal and signaling effectors',
  core_scaffold_proteins: 'Core scaffold proteins',
  assembly_regulators: 'Assembly regulators',
  snare_and_fusion_machinery: 'SNARE and fusion machinery',
  vesicle_associated_proteins: 'Vesicle-associated proteins',
  calcium_channels: 'Calcium channels',
  endocytosis_and_recycling_factors: 'Endocytosis and recycling factors',
  vesicle_transport_and_biogenesis_factors: 'Vesicle transport and biogenesis factors',
  neuropeptide_processing_enzymes: 'Neuropeptide processing enzymes',
  neuronal_innexins: 'Neuronally expressed innexins',
  ionotropic_receptors: 'Ionotropic receptors',
  metabotropic_receptors: 'Metabotropic receptors',
  scaffolds_and_clustering_factors: 'Scaffolds and clustering factors',
  signaling_and_cleft_enzymes: 'Signaling and cleft enzymes',
  tho_complex_subunits: 'THO complex subunits',
  export_adaptors_and_cofactors: 'Export adaptors and cofactors',
  phr_ligase_complex_and_effectors: 'PHR ligase complex and effectors',
  mapk_cascade_kinases: 'MAPK cascade kinases',
  wnt_ligands: 'Wnt ligands',
  wnt_receptors_and_coreceptors: 'Wnt receptors and co-receptors',
  intracellular_transducers: 'Intracellular transducers',
  biosynthetic_enzymes: 'Biosynthetic enzymes',
  vesicular_transporters_and_cofactors: 'Vesicular transporters and cofactors',
  reuptake_transporters: 'Reuptake transporters',
  neuropeptide_ligands: 'Neuropeptide ligands',
};

// TSV uses underscores throughout (`01_proneural_fate`, `dauer_signaling`).
// prettySubclass falls back to replacing _ with a space for a slug with no
// label yet; prettyClass also strips the numeric prefix.
export function prettySubclass(value: string | null | undefined): string {
  if (!value) return '';
  return SUBCLASS_LABELS[value] ?? value.replace(/_/g, ' ');
}

// "Hobert 2019" style label for a reference chip.
export function refShortLabel(ref: PanelReference): string {
  return `${ref.authors.split(/[ ,]/)[0]} ${ref.year}`;
}

export function prettyClass(value: string | null | undefined): string {
  if (!value) return '';
  const stripped = value.replace(/^\d+_/, '');
  return stripped.replace(/_/g, ' ');
}
