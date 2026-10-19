// Static reference + class metadata for the curated synapse development and
// function panel (v6; references checked against Crossref, with the per-gene
// reading record in SYNAPTOGENESIS.txt of the transdaomic-pipeline repo).
// Gene-to-class membership and each gene's own citations are in the SQLite
// `synaptogenesis` table; this module carries the bibliographic entries and the
// per-class editorial layer surfaced by the UI.

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
    id: 'R66',
    authors: 'Liao EH, Hung W, Abrams B, Zhen M',
    year: 2004,
    title: 'An SCF-like ubiquitin ligase complex that controls presynaptic differentiation',
    journal: 'Nature 430(6997):345-350',
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
  {
    id: 'R68',
    authors: 'Doitsidou M, Flames N, Topalidou I, et al.',
    year: 2013,
    title:
      'A combinatorial regulatory signature controls terminal differentiation of the dopaminergic nervous system in C. elegans',
    journal: 'Genes Dev 27(12):1391-1405',
    doi: '10.1101/gad.217224.113',
  },
  {
    id: 'R69',
    authors: 'Lakhina V, Arey RN, Kaletsky R, et al.',
    year: 2015,
    title:
      'Genome-wide Functional Analysis of CREB/Long-Term Memory-Dependent Transcription Reveals Distinct Basal and Memory Gene Expression Programs',
    journal: 'Neuron 85(2):330-345',
    doi: '10.1016/j.neuron.2014.12.029',
  },
  {
    id: 'R70',
    authors: 'Shen K, Bargmann CI',
    year: 2003,
    title:
      'The Immunoglobulin Superfamily Protein SYG-1 Determines the Location of Specific Synapses in C. elegans',
    journal: 'Cell 112(5):619-630',
    doi: '10.1016/S0092-8674(03)00113-2',
  },
  {
    id: 'R71',
    authors: 'Shen K, Fetter RD, Bargmann CI',
    year: 2004,
    title:
      'Synaptic Specificity Is Generated by the Synaptic Guidepost Protein SYG-2 and Its Receptor, SYG-1',
    journal: 'Cell 116(6):869-881',
    doi: '10.1016/S0092-8674(04)00251-X',
  },
  {
    id: 'R72',
    authors: 'Philbrook A, Ramachandran S, Lambert CM, et al.',
    year: 2018,
    title: 'Neurexin directs partner-specific synaptic connectivity in C. elegans',
    journal: 'eLife 7:e35692',
    doi: '10.7554/eLife.35692',
  },
  {
    id: 'R73',
    authors: 'Hu Z, Hom S, Kudze T, et al.',
    year: 2012,
    title: 'Neurexin and Neuroligin Mediate Retrograde Synaptic Inhibition in C. elegans',
    journal: 'Science 337(6097):980-984',
    doi: '10.1126/science.1224896',
  },
  {
    id: 'R74',
    authors: 'Maro GS, Gao S, Olechwier AM, et al.',
    year: 2015,
    title:
      'MADD-4/Punctin and Neurexin Organize C. elegans GABAergic Postsynapses through Neuroligin',
    journal: 'Neuron 86(6):1420-1432',
    doi: '10.1016/j.neuron.2015.05.015',
  },
  {
    id: 'R75',
    authors: 'Pinan-Lucarré B, Tu H, Pierron M, et al.',
    year: 2014,
    title:
      'C. elegans Punctin specifies cholinergic versus GABAergic identity of postsynaptic domains',
    journal: 'Nature 511(7510):466-470',
    doi: '10.1038/nature13313',
  },
  {
    id: 'R76',
    authors: 'Colón-Ramos DA, Margeta MA, Shen K',
    year: 2007,
    title: 'Glia Promote Local Synaptogenesis Through UNC-6 (Netrin) Signaling in C. elegans',
    journal: 'Science 318(5847):103-106',
    doi: '10.1126/science.1143762',
  },
  {
    id: 'R77',
    authors: 'Stavoe AK, Colón-Ramos DA',
    year: 2012,
    title:
      'Netrin instructs synaptic vesicle clustering through Rac GTPase, MIG-10, and the actin cytoskeleton',
    journal: 'J Cell Biol 197(1):75-88',
    doi: '10.1083/jcb.201110127',
  },
  {
    id: 'R78',
    authors: 'Poon VY, Klassen MP, Shen K',
    year: 2008,
    title:
      'UNC-6/netrin and its receptor UNC-5 locally exclude presynaptic components from dendrites',
    journal: 'Nature 455(7213):669-673',
    doi: '10.1038/nature07291',
  },
  {
    id: 'R79',
    authors: 'Mizumoto K, Shen K',
    year: 2013,
    title: 'Interaxonal Interaction Defines Tiled Presynaptic Innervation in C. elegans',
    journal: 'Neuron 77(4):655-666',
    doi: '10.1016/j.neuron.2012.12.031',
  },
  {
    id: 'R80',
    authors: 'Stavoe AK, Nelson JC, Martínez-Velázquez LA, Klein M, Samuel AD, Colón-Ramos DA',
    year: 2012,
    title:
      'Synaptic vesicle clustering requires a distinct MIG-10/Lamellipodin isoform and ABI-1 downstream from Netrin',
    journal: 'Genes Dev 26(19):2206-2221',
    doi: '10.1101/gad.193409.112',
  },
  {
    id: 'R81',
    authors: 'Crawley O, Giles AC, Desbois M, Kashyap S, Birnbaum R, Grill B',
    year: 2017,
    title:
      'A MIG-15/JNK-1 MAP kinase cascade opposes RPM-1 signaling in synapse formation and learning',
    journal: 'PLoS Genet 13(12):e1007095',
    doi: '10.1371/journal.pgen.1007095',
  },
  {
    id: 'R82',
    authors: 'Chia PH, Patel MR, Shen K',
    year: 2012,
    title:
      'NAB-1 instructs synapse assembly by linking adhesion molecules and F-actin to active zone proteins',
    journal: 'Nat Neurosci 15(2):234-242',
    doi: '10.1038/nn.2991',
  },
  {
    id: 'R83',
    authors: 'Cherra SJ, Jin Y',
    year: 2016,
    title:
      'A Two-Immunoglobulin-Domain Transmembrane Protein Mediates an Epidermal-Neuronal Interaction to Maintain Synapse Density',
    journal: 'Neuron 89(2):325-336',
    doi: '10.1016/j.neuron.2015.12.024',
  },
  {
    id: 'R84',
    authors: 'Shao Z, Watanabe S, Christensen R, Jorgensen EM, Colón-Ramos DA',
    year: 2013,
    title: 'Synapse Location during Growth Depends on Glia Location',
    journal: 'Cell 154(2):337-350',
    doi: '10.1016/j.cell.2013.06.028',
  },
  {
    id: 'R85',
    authors: 'Hallam SJ, Goncharov A, McEwen J, Baran R, Jin Y',
    year: 2002,
    title:
      'SYD-1, a presynaptic protein with PDZ, C2 and rhoGAP-like domains, specifies axon identity in C. elegans',
    journal: 'Nat Neurosci 5(11):1137-1146',
    doi: '10.1038/nn959',
  },
  {
    id: 'R86',
    authors: 'Zhen M, Jin Y',
    year: 1999,
    title:
      'The liprin protein SYD-2 regulates the differentiation of presynaptic termini in C. elegans',
    journal: 'Nature 401(6751):371-375',
    doi: '10.1038/43886',
  },
  {
    id: 'R87',
    authors: 'Dai Y, Taru H, Deken SL, et al.',
    year: 2006,
    title: 'SYD-2 Liprin-α organizes presynaptic active zone formation through ELKS',
    journal: 'Nat Neurosci 9(12):1479-1487',
    doi: '10.1038/nn1808',
  },
  {
    id: 'R88',
    authors: 'Koushika SP, Richmond JE, Hadwiger G, Weimer RM, Jorgensen EM, Nonet ML',
    year: 2001,
    title: 'A post-docking role for active zone protein Rim',
    journal: 'Nat Neurosci 4(10):997-1005',
    doi: '10.1038/nn732',
  },
  {
    id: 'R89',
    authors: 'Kushibiki Y, Suzuki T, Jin Y, Taru H',
    year: 2019,
    title:
      'RIMB-1/RIM-Binding Protein and UNC-10/RIM Redundantly Regulate Presynaptic Localization of the Voltage-Gated Calcium Channel in Caenorhabditis elegans',
    journal: 'J Neurosci 39(44):8617-8631',
    doi: '10.1523/JNEUROSCI.0506-19.2019',
  },
  {
    id: 'R90',
    authors: 'Ackley BD, Harrington RJ, Hudson ML, et al.',
    year: 2005,
    title:
      'The Two Isoforms of the Caenorhabditis elegans Leukocyte-Common Antigen Related Receptor Tyrosine Phosphatase PTP-3 Function Independently in Axon Guidance and Synapse Formation',
    journal: 'J Neurosci 25(33):7517-7528',
    doi: '10.1523/jneurosci.2010-05.2005',
  },
  {
    id: 'R91',
    authors: 'Varshney A, Benedetti K, Watters K, et al.',
    year: 2018,
    title:
      'The receptor protein tyrosine phosphatase CLR-1 is required for synaptic partner recognition',
    journal: 'PLoS Genet 14(5):e1007312',
    doi: '10.1371/journal.pgen.1007312',
  },
  {
    id: 'R92',
    authors: 'Crump JG, Zhen M, Jin Y, Bargmann CI',
    year: 2001,
    title: 'The SAD-1 Kinase Regulates Presynaptic Vesicle Clustering and Axon Termination',
    journal: 'Neuron 29(1):115-129',
    doi: '10.1016/S0896-6273(01)00184-2',
  },
  {
    id: 'R93',
    authors: 'Patel MR, Shen K',
    year: 2009,
    title: 'RSY-1 Is a Local Inhibitor of Presynaptic Assembly in C. elegans',
    journal: 'Science 323(5920):1500-1503',
    doi: '10.1126/science.1169025',
  },
  {
    id: 'R94',
    authors: 'Hall DH, Hedgecock EM',
    year: 1991,
    title:
      'Kinesin-related gene unc-104 is required for axonal transport of synaptic vesicles in C. elegans',
    journal: 'Cell 65(5):837-847',
    doi: '10.1016/0092-8674(91)90391-B',
  },
  {
    id: 'R95',
    authors: 'Byrd DT, Kawasaki M, Walcoff M, Hisamoto N, Matsumoto K, Jin Y',
    year: 2001,
    title: 'UNC-16, a JNK-Signaling Scaffold Protein, Regulates Vesicle Transport in C. elegans',
    journal: 'Neuron 32(5):787-800',
    doi: '10.1016/s0896-6273(01)00532-3',
  },
  {
    id: 'R96',
    authors: 'Monteiro MI, Ahlawat S, Kowalski JR, Malkin E, Koushika SP, Juo P',
    year: 2012,
    title:
      'The kinesin-3 family motor KLP-4 regulates anterograde trafficking of GLR-1 glutamate receptors in the ventral nerve cord of Caenorhabditis elegans',
    journal: 'Mol Biol Cell 23(18):3647-3662',
    doi: '10.1091/mbc.e12-04-0334',
  },
  {
    id: 'R97',
    authors: 'Sakamoto R, Byrd DT, Brown HM, Hisamoto N, Matsumoto K, Jin Y',
    year: 2005,
    title:
      'The Caenorhabditis elegans UNC-14 RUN Domain Protein Binds to the Kinesin-1 and UNC-16 Complex and Regulates Synaptic Vesicle Localization',
    journal: 'Mol Biol Cell 16(2):483-496',
    doi: '10.1091/mbc.e04-07-0553',
  },
  {
    id: 'R98',
    authors: 'Klassen MP, Wu YE, Maeder CI, et al.',
    year: 2010,
    title:
      'An Arf-like Small G Protein, ARL-8, Promotes the Axonal Transport of Presynaptic Cargoes by Suppressing Vesicle Aggregation',
    journal: 'Neuron 66(5):710-723',
    doi: '10.1016/j.neuron.2010.04.033',
  },
  {
    id: 'R99',
    authors: 'Sumakovic M, Hegermann J, Luo L, et al.',
    year: 2009,
    title:
      'UNC-108/RAB-2 and its effector RIC-19 are involved in dense core vesicle maturation in Caenorhabditis elegans',
    journal: 'J Cell Biol 186(6):897-914',
    doi: '10.1083/jcb.200902096',
  },
  {
    id: 'R100',
    authors: 'Edwards SL, Charlie NK, Richmond JE, Hegermann J, Eimer S, Miller KG',
    year: 2009,
    title: 'Impaired dense core vesicle maturation in Caenorhabditis elegans mutants lacking Rab2',
    journal: 'J Cell Biol 186(6):881-895',
    doi: '10.1083/jcb.200902095',
  },
  {
    id: 'R101',
    authors: 'Richmond JE, Davis WS, Jorgensen EM',
    year: 1999,
    title: 'UNC-13 is required for synaptic vesicle fusion in C. elegans',
    journal: 'Nat Neurosci 2(11):959-964',
    doi: '10.1038/14755',
  },
  {
    id: 'R102',
    authors: 'Weimer RM, Richmond JE, Davis WS, Hadwiger G, Nonet ML, Jorgensen EM',
    year: 2003,
    title: 'Defects in synaptic vesicle docking in unc-18 mutants',
    journal: 'Nat Neurosci 6(10):1023-1030',
    doi: '10.1038/nn1118',
  },
  {
    id: 'R103',
    authors: 'Saifee O, Wei L, Nonet ML',
    year: 1998,
    title:
      'The Caenorhabditis elegans unc-64 Locus Encodes a Syntaxin That Interacts Genetically with Synaptobrevin',
    journal: 'Mol Biol Cell 9(6):1235-1252',
    doi: '10.1091/mbc.9.6.1235',
  },
  {
    id: 'R104',
    authors: 'Nonet ML, Saifee O, Zhao H, Rand JB, Wei L',
    year: 1998,
    title: 'Synaptic Transmission Deficits in Caenorhabditis elegans Synaptobrevin Mutants',
    journal: 'J Neurosci 18(1):70-80',
    doi: '10.1523/JNEUROSCI.18-01-00070.1998',
  },
  {
    id: 'R105',
    authors: 'Miller KG, Alfonso A, Nguyen M, Crowell JA, Johnson CD, Rand JB',
    year: 1996,
    title: 'A genetic selection for Caenorhabditis elegans synaptic transmission mutants',
    journal: 'Proc Natl Acad Sci USA 93(22):12593-12598',
    doi: '10.1073/pnas.93.22.12593',
  },
  {
    id: 'R106',
    authors: 'Nonet ML, Grundahl K, Meyer BJ, Rand JB',
    year: 1993,
    title:
      'Synaptic function is impaired but not eliminated in C. elegans mutants lacking synaptotagmin',
    journal: 'Cell 73(7):1291-1305',
    doi: '10.1016/0092-8674(93)90357-v',
  },
  {
    id: 'R107',
    authors: 'Gracheva EO, Burdina AO, Holgado AM, et al.',
    year: 2006,
    title: 'Tomosyn Inhibits Synaptic Vesicle Priming in Caenorhabditis elegans',
    journal: 'PLoS Biol 4(8):e261',
    doi: '10.1371/journal.pbio.0040261',
  },
  {
    id: 'R108',
    authors: 'Nonet ML, Staunton JE, Kilgard MP, et al.',
    year: 1997,
    title:
      'Caenorhabditis elegans rab-3 Mutant Synapses Exhibit Impaired Function and Are Partially Depleted of Vesicles',
    journal: 'J Neurosci 17(21):8061-8073',
    doi: '10.1523/JNEUROSCI.17-21-08061.1997',
  },
  {
    id: 'R109',
    authors: 'Yu SC, Liewald JF, Shao J, Steuer Costa W, Gottschalk A',
    year: 2021,
    title:
      'Synapsin Is Required for Dense Core Vesicle Capture and cAMP-Dependent Neuropeptide Release',
    journal: 'J Neurosci 41(19):4187-4201',
    doi: '10.1523/JNEUROSCI.2631-20.2021',
  },
  {
    id: 'R110',
    authors: 'Abraham C, Hutter H, Palfreyman MT, et al.',
    year: 2006,
    title:
      'Synaptic tetraspan vesicle membrane proteins are conserved but not needed for synaptogenesis and neuronal function in Caenorhabditis elegans',
    journal: 'Proc Natl Acad Sci USA 103(21):8227-8232',
    doi: '10.1073/pnas.0509400103',
  },
  {
    id: 'R111',
    authors: 'Pujol N, Bonnerot C, Ewbank JJ, Kohara Y, Thierry-Mieg D',
    year: 2001,
    title:
      'The Caenorhabditis elegans unc-32 Gene Encodes Alternative Forms of a Vacuolar ATPase aSubunit',
    journal: 'J Biol Chem 276(15):11913-11921',
    doi: '10.1074/jbc.M009451200',
  },
  {
    id: 'R112',
    authors: 'Mullen GP, Grundahl KM, Gu M, et al.',
    year: 2012,
    title:
      'UNC-41/Stonin Functions with AP2 to Recycle Synaptic Vesicles in Caenorhabditis elegans',
    journal: 'PLoS ONE 7(7):e40095',
    doi: '10.1371/journal.pone.0040095',
  },
  {
    id: 'R113',
    authors: 'Nonet ML, Holgado AM, Brewer F, et al.',
    year: 1999,
    title:
      'UNC-11, a Caenorhabditis elegans AP180 Homologue, Regulates the Size and Protein Composition of Synaptic Vesicles',
    journal: 'Mol Biol Cell 10(7):2343-2360',
    doi: '10.1091/mbc.10.7.2343',
  },
  {
    id: 'R114',
    authors: 'Gu M, Liu Q, Watanabe S, et al.',
    year: 2013,
    title: 'AP2 hemicomplexes contribute independently to synaptic vesicle endocytosis',
    journal: 'eLife 2:e00190',
    doi: '10.7554/eLife.00190',
  },
  {
    id: 'R115',
    authors: 'Kass J, Jacob TC, Kim P, Kaplan JM',
    year: 2001,
    title:
      'The EGL-3 Proprotein Convertase Regulates Mechanosensory Responses of Caenorhabditis elegans',
    journal: 'J Neurosci 21(23):9265-9272',
    doi: '10.1523/JNEUROSCI.21-23-09265.2001',
  },
  {
    id: 'R116',
    authors: 'Mathews EA, García E, Santi CM, et al.',
    year: 2003,
    title:
      'Critical Residues of the Caenorhabditis elegans unc-2 Voltage-Gated Calcium Channel That Affect Behavioral and Physiological Properties',
    journal: 'J Neurosci 23(16):6537-6545',
    doi: '10.1523/JNEUROSCI.23-16-06537.2003',
  },
  {
    id: 'R117',
    authors: 'Saheki Y, Bargmann CI',
    year: 2009,
    title: 'Presynaptic CaV2 calcium channel traffic requires CALF-1 and the α2δ subunit UNC-36',
    journal: 'Nat Neurosci 12(10):1257-1265',
    doi: '10.1038/nn.2383',
  },
  {
    id: 'R118',
    authors: 'Jospin M, Jacquemond V, Mariol MC, Ségalat L, Allard B',
    year: 2002,
    title:
      'The L-type voltage-dependent Ca2+ channel EGL-19 controls body wall muscle function in Caenorhabditis elegans',
    journal: 'J Cell Biol 159(2):337-348',
    doi: '10.1083/jcb.200203055',
  },
  {
    id: 'R119',
    authors: 'Wang ZW, Saifee O, Nonet ML, Salkoff L',
    year: 2001,
    title:
      'SLO-1 Potassium Channels Control Quantal Content of Neurotransmitter Release at the C. elegans Neuromuscular Junction',
    journal: 'Neuron 32(5):867-881',
    doi: '10.1016/S0896-6273(01)00522-0',
  },
  {
    id: 'R120',
    authors: 'Stavoe AK, Kargbo-Hill SE, Hall DH, Colón-Ramos DA',
    year: 2016,
    title: 'KIF1A/UNC-104 Transports ATG-9 to Regulate Neurodevelopment and Autophagy at Synapses',
    journal: 'Dev Cell 38(2):171-185',
    doi: '10.1016/j.devcel.2016.06.012',
  },
  {
    id: 'R121',
    authors: 'Yang S, Park D, Manning L, et al.',
    year: 2022,
    title: 'Presynaptic autophagy is coupled to the synaptic vesicle cycle via ATG-9',
    journal: 'Neuron 110(5):824-840',
    doi: '10.1016/j.neuron.2021.12.031',
  },
  {
    id: 'R122',
    authors: 'Crawley O, Opperman KJ, Desbois M, et al.',
    year: 2019,
    title: 'Autophagy is inhibited by ubiquitin ligase activity in the nervous system',
    journal: 'Nat Commun 10(1):5017',
    doi: '10.1038/s41467-019-12804-3',
  },
  {
    id: 'R123',
    authors: 'Fleming JT, Squire MD, Barnes TM, et al.',
    year: 1997,
    title:
      'Caenorhabditis elegans Levamisole Resistance Genes lev-1, unc-29, and unc-38 Encode Functional Nicotinic Acetylcholine Receptor Subunits',
    journal: 'J Neurosci 17(15):5843-5857',
    doi: '10.1523/JNEUROSCI.17-15-05843.1997',
  },
  {
    id: 'R124',
    authors: 'Culetto E, Baylis HA, Richmond JE, et al.',
    year: 2004,
    title:
      'The Caenorhabditis elegans unc-63 Gene Encodes a Levamisole-sensitive Nicotinic Acetylcholine Receptor α Subunit',
    journal: 'J Biol Chem 279(41):42476-42483',
    doi: '10.1074/jbc.M404370200',
  },
  {
    id: 'R125',
    authors: 'Towers PR, Edwards B, Richmond JE, Sattelle DB',
    year: 2005,
    title:
      'The Caenorhabditis elegans lev-8 gene encodes a novel type of nicotinic acetylcholine receptor α subunit',
    journal: 'J Neurochem 93(1):1-9',
    doi: '10.1111/j.1471-4159.2004.02951.x',
  },
  {
    id: 'R126',
    authors: 'Touroutine D, Fox RM, Von Stetina SE, Burdina A, Miller DM, Richmond JE',
    year: 2005,
    title:
      'acr-16 Encodes an Essential Subunit of the Levamisole-resistant Nicotinic Receptor at the Caenorhabditis elegans Neuromuscular Junction',
    journal: 'J Biol Chem 280(29):27013-27021',
    doi: '10.1074/jbc.M502818200',
  },
  {
    id: 'R127',
    authors: 'Petrash HA, Philbrook A, Haburcak M, Barbagallo B, Francis MM',
    year: 2013,
    title:
      'ACR-12 Ionotropic Acetylcholine Receptor Complexes Regulate Inhibitory Motor Neuron Activity in Caenorhabditis elegans',
    journal: 'J Neurosci 33(13):5524-5532',
    doi: '10.1523/jneurosci.4384-12.2013',
  },
  {
    id: 'R128',
    authors: 'Jospin M, Qi YB, Stawicki TM, et al.',
    year: 2009,
    title:
      'A Neuronal Acetylcholine Receptor Regulates the Balance of Muscle Excitation and Inhibition in Caenorhabditis elegans',
    journal: 'PLoS Biol 7(12):e1000265',
    doi: '10.1371/journal.pbio.1000265',
  },
  {
    id: 'R129',
    authors: 'Bamber BA, Beg AA, Twyman RE, Jorgensen EM',
    year: 1999,
    title:
      'The Caenorhabditis elegans unc-49 Locus Encodes Multiple Subunits of a Heteromultimeric GABA Receptor',
    journal: 'J Neurosci 19(13):5348-5359',
    doi: '10.1523/JNEUROSCI.19-13-05348.1999',
  },
  {
    id: 'R130',
    authors: 'Hart AC, Sims S, Kaplan JM',
    year: 1995,
    title: 'Synaptic code for sensory modalities revealed by C. elegans GLR-1 glutamate receptor',
    journal: 'Nature 378(6552):82-85',
    doi: '10.1038/378082a0',
  },
  {
    id: 'R131',
    authors: 'Polli JR, Dobbins DL, Kobet RA, et al.',
    year: 2015,
    title:
      'Drug-dependent behaviors and nicotinic acetylcholine receptor expressions in Caenorhabditis elegans following chronic nicotine exposure',
    journal: 'Neurotoxicology 47:27-36',
    doi: '10.1016/j.neuro.2014.12.005',
  },
  {
    id: 'R132',
    authors: 'Sellings L, Pereira S, Qian C, et al.',
    year: 2013,
    title:
      'Nicotine-motivated behavior in Caenorhabditis elegans requires the nicotinic acetylcholine receptor subunits acr-5 and acr-15',
    journal: 'Eur J Neurosci 37(5):743-756',
    doi: '10.1111/ejn.12099',
  },
  {
    id: 'R133',
    authors: 'Takayanagi-Kiya S, Zhou K, Jin Y',
    year: 2016,
    title:
      'Release-dependent feedback inhibition by a presynaptically localized ligand-gated anion channel',
    journal: 'eLife 5:e21734',
    doi: '10.7554/eLife.21734',
  },
  {
    id: 'R134',
    authors: 'Ranganathan R, Cannon SC, Horvitz HR',
    year: 2000,
    title:
      'MOD-1 is a serotonin-gated chloride channel that modulates locomotory behaviour in C. elegans',
    journal: 'Nature 408(6811):470-475',
    doi: '10.1038/35044083',
  },
  {
    id: 'R135',
    authors: 'Ohnishi N, Kuhara A, Nakamura F, Okochi Y, Mori I',
    year: 2011,
    title:
      'Bidirectional regulation of thermotaxis by glutamate transmissions in Caenorhabditis elegans',
    journal: 'EMBO J 30(7):1376-1388',
    doi: '10.1038/emboj.2011.13',
  },
  {
    id: 'R136',
    authors: 'Wang M, Witvliet D, Wu M, Kang L, Shao Z',
    year: 2021,
    title:
      'Temperature regulates synaptic subcellular specificity mediated by inhibitory glutamate signaling',
    journal: 'PLoS Genet 17(1):e1009295',
    doi: '10.1371/journal.pgen.1009295',
  },
  {
    id: 'R137',
    authors: 'Dittman JS, Kaplan JM',
    year: 2008,
    title:
      'Behavioral Impact of Neurotransmitter-Activated G-Protein-Coupled Receptors: Muscarinic and GABABReceptors Regulate Caenorhabditis elegans Locomotion',
    journal: 'J Neurosci 28(28):7104-7112',
    doi: '10.1523/jneurosci.0378-08.2008',
  },
  {
    id: 'R138',
    authors: 'Chase DL, Pepper JS, Koelle MR',
    year: 2004,
    title: 'Mechanism of extrasynaptic dopamine signaling in Caenorhabditis elegans',
    journal: 'Nat Neurosci 7(10):1096-1103',
    doi: '10.1038/nn1316',
  },
  {
    id: 'R139',
    authors: 'Donnelly JL, Clark CM, Leifer AM, et al.',
    year: 2013,
    title: 'Monoaminergic Orchestration of Motor Programs in a Complex C. elegans Behavior',
    journal: 'PLoS Biol 11(4):e1001529',
    doi: '10.1371/journal.pbio.1001529',
  },
  {
    id: 'R140',
    authors: 'Rongo C, Kaplan JM',
    year: 1999,
    title: 'CaMKII regulates the density of central glutamatergic synapses in vivo',
    journal: 'Nature 402(6758):195-199',
    doi: '10.1038/46065',
  },
  {
    id: 'R141',
    authors: 'Johnson CD, Rand JB, Herman RK, Stern BD, Russell RL',
    year: 1988,
    title:
      'The acetylcholinesterase genes of C. elegans: identification of a third gene (ace-3) and mosaic mapping of a synthetic lethal phenotype',
    journal: 'Neuron 1(2):165-173',
    doi: '10.1016/0896-6273(88)90201-2',
  },
  {
    id: 'R142',
    authors: 'Gally C, Eimer S, Richmond JE, Bessereau JL',
    year: 2004,
    title:
      'A transmembrane protein required for acetylcholine receptor clustering in Caenorhabditis elegans',
    journal: 'Nature 431(7008):578-582',
    doi: '10.1038/nature02893',
  },
  {
    id: 'R143',
    authors: 'Sandoval GM, Duerr JS, Hodgkin J, Rand JB, Ruvkun G',
    year: 2006,
    title:
      'A genetic interaction between the vesicular acetylcholine transporter VAChT/UNC-17 and synaptobrevin/SNB-1 in C. elegans',
    journal: 'Nat Neurosci 9(5):599-601',
    doi: '10.1038/nn1685',
  },
  {
    id: 'R144',
    authors: 'Rand JB, Russell RL',
    year: 1984,
    title: 'Choline acetyltransferase-deficient mutants of the nematode Caenorhabditis elegans',
    journal: 'Genetics 106(2):227-248',
    doi: '10.1093/genetics/106.2.227',
  },
  {
    id: 'R145',
    authors: 'Jin Y, Jorgensen E, Hartwieg E, Horvitz HR',
    year: 1999,
    title:
      'The Caenorhabditis elegans Gene unc-25 Encodes Glutamic Acid Decarboxylase and Is Required for Synaptic Transmission But Not Synaptic Development',
    journal: 'J Neurosci 19(2):539-548',
    doi: '10.1523/JNEUROSCI.19-02-00539.1999',
  },
  {
    id: 'R146',
    authors: 'McIntire SL, Reimer RJ, Schuske K, Edwards RH, Jorgensen EM',
    year: 1997,
    title: 'Identification and characterization of the vesicular GABA transporter',
    journal: 'Nature 389(6653):870-876',
    doi: '10.1038/39908',
  },
  {
    id: 'R147',
    authors: 'Lee RYN, Sawin ER, Chalfie M, Horvitz HR, Avery L',
    year: 1999,
    title:
      'EAT-4, a Homolog of a Mammalian Sodium-Dependent Inorganic Phosphate Cotransporter, Is Necessary for Glutamatergic Neurotransmission in Caenorhabditis elegans',
    journal: 'J Neurosci 19(1):159-167',
    doi: '10.1523/JNEUROSCI.19-01-00159.1999',
  },
  {
    id: 'R148',
    authors: 'Sze JY, Victor M, Loer C, Shi Y, Ruvkun G',
    year: 2000,
    title:
      'Food and metabolic signalling defects in a Caenorhabditis elegans serotonin-synthesis mutant',
    journal: 'Nature 403(6769):560-564',
    doi: '10.1038/35000609',
  },
  {
    id: 'R149',
    authors: 'Okuda T, Haga T, Kanai Y, Endou H, Ishihara T, Katsura I',
    year: 2000,
    title: 'Identification and characterization of the high-affinity choline transporter',
    journal: 'Nat Neurosci 3(2):120-125',
    doi: '10.1038/72059',
  },
  {
    id: 'R150',
    authors: 'Mullen GP, Mathews EA, Saxena P, et al.',
    year: 2006,
    title:
      'The Caenorhabditis elegans snf-11 Gene Encodes a Sodium-dependent GABA Transporter Required for Clearance of Synaptic GABA',
    journal: 'Mol Biol Cell 17(7):3021-3030',
    doi: '10.1091/mbc.e06-02-0155',
  },
  {
    id: 'R151',
    authors: 'Starich TA, Xu J, Skerrett IM, Nicholson BJ, Shaw JE',
    year: 2009,
    title:
      'Interactions between innexins UNC-7 and UNC-9 mediate electrical synapse specificity in the Caenorhabditis elegans locomotory nervous system',
    journal: 'Neural Dev 4:16',
    doi: '10.1186/1749-8104-4-16',
  },
  {
    id: 'R152',
    authors: 'Starich TA, Lee RY, Panzarella C, Avery L, Shaw JE',
    year: 1996,
    title:
      'eat-5 and unc-7 represent a multigene family in Caenorhabditis elegans involved in cell-cell coupling',
    journal: 'J Cell Biol 134(2):537-548',
    doi: '10.1083/jcb.134.2.537',
  },
  {
    id: 'R153',
    authors: 'Petersen SC, Watson JD, Richmond JE, Sarov M, Walthall WW, Miller DM',
    year: 2011,
    title:
      'A Transcriptional Program Promotes Remodeling of GABAergic Synapses in Caenorhabditis elegans',
    journal: 'J Neurosci 31(43):15362-15375',
    doi: '10.1523/JNEUROSCI.3181-11.2011',
  },
  {
    id: 'R154',
    authors: 'Thompson-Peer KL, Bai J, Hu Z, Kaplan JM',
    year: 2012,
    title: 'HBL-1 Patterns Synaptic Remodeling in C. elegans',
    journal: 'Neuron 73(3):453-465',
    doi: '10.1016/j.neuron.2011.11.025',
  },
  {
    id: 'R155',
    authors: 'Meng J, Ma X, Tao H, et al.',
    year: 2017,
    title:
      'Myrf ER-Bound Transcription Factors Drive C. elegans Synaptic Plasticity via Cleavage-Dependent Nuclear Translocation',
    journal: 'Dev Cell 41(2):180-194',
    doi: '10.1016/j.devcel.2017.03.022',
  },
  {
    id: 'R156',
    authors: 'Hallam SJ, Jin Y',
    year: 1998,
    title: 'lin-14 regulates the timing of synaptic remodelling in Caenorhabditis elegans',
    journal: 'Nature 395(6697):78-82',
    doi: '10.1038/25757',
  },
  {
    id: 'R157',
    authors: 'Zhou HM, Walthall WW',
    year: 1998,
    title:
      'UNC-55, an Orphan Nuclear Hormone Receptor, Orchestrates Synaptic Specificity among Two Classes of Motor Neurons in Caenorhabditis elegans',
    journal: 'J Neurosci 18(24):10438-10444',
    doi: '10.1523/JNEUROSCI.18-24-10438.1998',
  },
  {
    id: 'R158',
    authors: 'He S, Philbrook A, McWhirter R, et al.',
    year: 2015,
    title:
      'Transcriptional Control of Synaptic Remodeling through Regulated Expression of an Immunoglobulin Superfamily Protein',
    journal: 'Curr Biol 25(19):2541-2548',
    doi: '10.1016/j.cub.2015.08.022',
  },
  {
    id: 'R159',
    authors: 'Howell K, White JG, Hobert O',
    year: 2015,
    title: 'Spatiotemporal control of a novel synaptic organizer molecule',
    journal: 'Nature 523(7558):83-87',
    doi: '10.1038/nature14545',
  },
];

// Class-level editorial layer keyed by the `class` column in the DB.
export const SYNAPTOGENESIS_CLASSES: PanelClass[] = [
  {
    id: '01_activity_regulated',
    label: 'Activity-regulated transcription factors',
    description:
      'Transcription factors, with their co-activators and homeobox cofactors, that promote the transcription of synaptic genes in response to neuronal activity.',
    refIds: ['R2', 'R6', 'R68', 'R69'],
  },
  {
    id: '02_mRNA_export',
    label: 'RNA export and processing',
    description:
      'Genes encoding proteins involved in the export and processing of synaptic transcripts.',
    refIds: ['R6'],
  },
  {
    id: '03_wnt_morphogen',
    label: 'Synapse positioning',
    description:
      'Genes encoding components of the Wnt pathway (ligands, receptors and transducers) that restrict synapse placement to the correct region along the axon.',
    refIds: ['R9', 'R38', 'R39', 'R40'],
  },
  {
    id: '04_adhesion_specificity',
    label: 'Synaptic specificity and cell adhesion',
    description:
      'Genes encoding proteins that direct synapses to the correct partner cell and hold them there.',
    refIds: [
      'R4',
      'R21',
      'R38',
      'R50',
      'R51',
      'R52',
      'R53',
      'R54',
      'R70',
      'R71',
      'R72',
      'R73',
      'R74',
      'R75',
      'R76',
      'R77',
      'R78',
      'R79',
      'R80',
      'R81',
      'R82',
      'R83',
      'R84',
    ],
  },
  {
    id: '05_active_zone',
    label: 'Active zone scaffolding',
    description:
      'Genes encoding the core active zone scaffolds and the kinases and phosphatases that act on them.',
    refIds: [
      'R4',
      'R5',
      'R13',
      'R22',
      'R37',
      'R85',
      'R86',
      'R87',
      'R88',
      'R89',
      'R90',
      'R91',
      'R92',
      'R93',
    ],
  },
  {
    id: '06_PHR_MAPK',
    label: 'Synapse growth control',
    description: 'Genes that limit synapse formation and terminate axon growth.',
    refIds: ['R4', 'R10', 'R11', 'R36', 'R66'],
  },
  {
    id: '07_cargo_transport',
    label: 'Synaptic cargo transport',
    description:
      'Kinesin motors and the adaptors and regulators that carry synaptic vesicle precursors, dense-core vesicles and receptors along the axon.',
    refIds: ['R23', 'R94', 'R95', 'R96', 'R97', 'R98', 'R99', 'R100'],
  },
  {
    id: '08_SV_release',
    label: 'Synaptic vesicle release machinery',
    description:
      'Genes encoding the fusion, release, recycling and acidification machinery of synaptic and dense-core vesicles, with the ion channels on either side of the synapse that gate release and excitation.',
    refIds: [
      'R4',
      'R14',
      'R24',
      'R60',
      'R61',
      'R62',
      'R63',
      'R67',
      'R101',
      'R102',
      'R103',
      'R104',
      'R105',
      'R106',
      'R107',
      'R108',
      'R109',
      'R110',
      'R111',
      'R112',
      'R113',
      'R114',
      'R115',
      'R116',
      'R117',
      'R118',
      'R119',
      'R120',
      'R121',
      'R122',
    ],
  },
  {
    id: '09_postsynaptic',
    label: 'Postsynaptic receptors and clustering',
    description:
      'Genes encoding postsynaptic receptors of every receptor class, with the enzymes and scaffolds that cluster the receptors at their correct positions.',
    refIds: [
      'R3',
      'R7',
      'R14',
      'R41',
      'R42',
      'R43',
      'R44',
      'R45',
      'R46',
      'R47',
      'R48',
      'R49',
      'R123',
      'R124',
      'R125',
      'R126',
      'R127',
      'R128',
      'R129',
      'R130',
      'R131',
      'R132',
      'R133',
      'R134',
      'R135',
      'R136',
      'R137',
      'R138',
      'R139',
      'R140',
      'R141',
      'R142',
    ],
  },
  {
    id: '10_NT_identity',
    label: 'Neurotransmitter identity',
    description:
      'Genes encoding the components that give a neuron its neurotransmitter identity (cholinergic, GABAergic and so on).',
    refIds: [
      'R7',
      'R14',
      'R55',
      'R56',
      'R57',
      'R58',
      'R59',
      'R143',
      'R144',
      'R145',
      'R146',
      'R147',
      'R148',
      'R149',
      'R150',
    ],
  },
  {
    id: '11_innexin',
    label: 'Electrical synapses and innexins',
    description:
      'Genes encoding the 15 innexins shown to be expressed in the nervous system and to rewire under stress and in dauer.',
    refIds: ['R8', 'R151', 'R152'],
    note: 'DAUER-REMODELED',
  },
  {
    id: '12_remodeling',
    label: 'Remodeling transcription factors and effectors',
    description:
      'Transcription factors, heterochronic timers and their effectors that set whether and when a neuron rewires its synapses.',
    refIds: ['R3', 'R64', 'R153', 'R154', 'R155', 'R156', 'R157', 'R158', 'R159'],
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
  activity_induced_factors: 'Activity-induced factors',
  homeobox_cofactors: 'Homeobox cofactors',
  coactivators_and_chromatin_remodelers: 'Co-activators and chromatin remodelers',
  pro_remodeling_factors: 'Pro-remodeling factors',
  anti_remodeling_factors: 'Anti-remodeling factors',
  heterochronic_timers: 'Heterochronic timers',
  adhesion_and_organizer_molecules: 'Adhesion and organizer molecules',
  guidance_cues_and_receptors: 'Guidance cues and receptors',
  cytoskeletal_and_signaling_effectors: 'Cytoskeletal and signaling effectors',
  core_scaffold_proteins: 'Core scaffold proteins',
  assembly_regulators: 'Assembly regulators',
  snare_and_fusion_machinery: 'SNARE and fusion machinery',
  vesicle_associated_proteins: 'Vesicle-associated proteins',
  synaptic_ion_channels: 'Synaptic ion channels',
  endocytosis_and_recycling_factors: 'Endocytosis and recycling factors',
  vesicle_biogenesis_factors: 'Vesicle biogenesis factors',
  neuropeptide_processing_enzymes: 'Neuropeptide processing enzymes',
  kinesin_motors: 'Kinesin motors',
  motor_adaptors_and_regulators: 'Motor adaptors and regulators',
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

// TSV uses underscores throughout (`01_activity_regulated`, `dauer_signaling`).
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
