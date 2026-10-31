import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Inputs and summaries the manuscript describes for the reads-to-enrichment pages:
// the shapes of table each page has to read, and the counts it has to report.

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  await page.goto('/');
  await resetClientStorage(page);
});

test('contrast comparison Venn is drawn from the two significant sets', async ({ page }) => {
  const header = 'gene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj';
  // [gene, lfcA, padjA, lfcB, padjB]
  const genes: [string, number, number, number, number][] = [
    ['WBGene00000001', 2, 0.001, 2, 0.001], // shared up
    ['WBGene00000002', -2, 0.001, -2, 0.001], // shared down
    ['WBGene00000003', 2, 0.001, -2, 0.001], // flipped: significant in both, opposite signs
    ['WBGene00000004', 1, 0.5, -1, 0.5], // opposite signs but significant in neither: not flipped
    ['WBGene00000005', 1.5, 0.001, -1, 0.5], // opposite signs, significant in A only: A-only up
    ['WBGene00000006', -1, 0.001, 0.1, 0.9], // A-only down
    ['WBGene00000007', 0.1, 0.9, 2, 0.001], // B-only up
  ];
  const table = (lfc: 1 | 3) =>
    [header, ...genes.map((g) => `${g[0]}\t100\t${g[lfc]}\t0.3\t5\t0.001\t${g[lfc + 1]}`)].join(
      '\n',
    );
  await page.goto('/de/diff');
  const areas = page.locator('textarea');
  await areas.nth(0).fill(table(1));
  await areas.nth(1).fill(table(3));
  await page.getByRole('button', { name: 'Parse', exact: true }).click();

  const venn = page.locator('svg').filter({ hasText: 'Shared' }).first();
  await expect(venn).toBeVisible();
  const texts = (await venn.locator('text').allTextContents()).map((t) => t.trim());
  // A only: 1 Down, 1 Up. B only: 0 Down, 1 Up. Shared: 1 Down, 1 Up, +1 flipped.
  expect(texts).toEqual(expect.arrayContaining(['0 Down', '(+1 flipped)']));
  expect(texts.filter((t) => t === '1 Up')).toHaveLength(3);
  expect(texts.filter((t) => t === '1 Down')).toHaveLength(2);

  // Scatter corners: category genes over all genes in the quadrant. Lower right holds the
  // flipped gene, one significant in A only and one significant in neither.
  const scatter = page.locator('svg[aria-label="log2FC diff scatter"]');
  await expect(scatter.getByText('1 / 3')).toBeVisible();
  await expect(scatter.getByText('(33%)')).toBeVisible();
  await expect(page.getByRole('button', { name: /Flipped\s*1/ })).toBeVisible();
});

test('ranked-list enrichment ranks an edgeR table by its signed test statistic', async ({
  page,
}) => {
  // write.table() default: the header has no field for the row names.
  const edgeR = [
    'logFC\tlogCPM\tLR\tPValue\tFDR',
    'daf-16\t-2.1\t5\t40\t1e-9\t1e-7',
    'daf-2\t1.5\t6\t20\t1e-5\t1e-3',
    'age-1\t0.8\t6\t3\t0.08\t0.2',
  ].join('\n');
  await page.goto('/gsea');
  await page.locator('textarea').first().fill(edgeR);
  await page.locator('button', { hasText: 'Resolve & run' }).click();
  await expect(page.getByText('Ranked by lr')).toBeVisible({ timeout: 60_000 });
});

test('differential expression reads a plain gene-by-sample matrix', async ({ page }) => {
  const samples = ['WT_1', 'WT_2', 'WT_3', 'mut_1', 'mut_2', 'mut_3', 'mut_4'];
  const matrix = [
    ['gene_id', ...samples].join(','),
    ['WBGene00000001', 10, 12, 9, 40, 44, 38, 41].join(','),
    ['WBGene00000002', 0, 1, 0, 3, 2, 4, 3].join(','),
  ].join('\n');
  await page.goto('/de');
  await page.locator('textarea').first().fill(matrix);
  const rows = page.locator('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(samples.length, { timeout: 10_000 });
  await expect(rows.first()).toContainText('WT_1');
});

test('per-sample gene set scoring resolve a matrix keyed by gene names', async ({ page }) => {
  const names = [
    'daf-2',
    'daf-16',
    'age-1',
    'akt-1',
    'akt-2',
    'pdk-1',
    'sgk-1',
    'daf-18',
    'unc-13',
    'unc-18',
    'unc-64',
    'snb-1',
    'lin-12',
    'glp-1',
    'let-60',
    'mpk-1',
    'sod-3',
    'lys-7',
  ];
  const lines = ['gene\ts1\ts2\ts3\ts4'];
  names.forEach((n, i) => lines.push([n, i + 1, (i * 7) % 19, 20 - i, (i * 3) % 11].join('\t')));
  await page.goto('/ssgsea');
  await page.locator('#expr').fill(lines.join('\n'));
  // Few genes, so let small sets through.
  const minGenes = page.locator('label', { hasText: 'Min genes' }).locator('input');
  await minGenes.fill('1');
  await page.getByRole('button', { name: 'Run scoring' }).click();
  await expect(page.getByText(/Per-sample gene set scoring: [1-9]\d* sets/)).toBeVisible({
    timeout: 120_000,
  });
});

test('read counting loads the bundled WormBase annotation', async ({ page }) => {
  await page.goto('/counts');
  const use = page.getByRole('button', { name: /Use WormBase WS\d+/ });
  await expect(use).toBeVisible({ timeout: 30_000 });
  await use.click();
  await expect(page.getByText(/Using WormBase WS\d+ annotation/)).toBeVisible({ timeout: 60_000 });
});

test('differential expression says why Run is disabled when a batch is blank', async ({ page }) => {
  const matrix = [
    'gene_id,WT_1,WT_2,mut_1,mut_2',
    'WBGene00000001,10,12,40,44',
    'WBGene00000002,0,1,3,2',
  ].join('\n');
  await page.goto('/de');
  await page.locator('textarea').first().fill(matrix);
  const cond = page.locator('input[placeholder*="WT"]');
  await expect(cond).toHaveCount(4);
  for (const [i, c] of ['WT', 'WT', 'mut', 'mut'].entries()) await cond.nth(i).fill(c);
  await page.getByText('Batch covariate').click();
  await page.locator('input[placeholder="e.g. run1"]').first().fill('day1');
  await expect(page.getByRole('button', { name: /run deseq2/i })).toBeDisabled();
  await expect(page.getByText(/Fill in the batch for every sample \(3 empty\)/)).toBeVisible();
});

test('contrast comparison uses the significance cutoff the user sets', async ({ page }) => {
  const header = 'gene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj';
  const table = [
    header,
    'WBGene00000001\t100\t2\t0.3\t5\t0.001\t0.01',
    'WBGene00000002\t100\t-2\t0.3\t5\t0.001\t0.03',
  ].join('\n');
  await page.goto('/de/diff');
  const areas = page.locator('textarea');
  await areas.nth(0).fill(table);
  await areas.nth(1).fill(table);
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  const venn = page.locator('svg').filter({ hasText: 'Shared' }).first();
  await expect(venn.getByText('1 Up')).toBeVisible();
  await expect(venn.getByText('1 Down')).toBeVisible();
  // At padj < 0.02 only the first gene stays significant in both.
  await page.getByLabel(/Significant at padj/).fill('0.02');
  await expect(venn.getByText('1 Down')).toHaveCount(0);
  await expect(page.getByText('(significant in both at padj < 0.02)')).toBeVisible();
});

test('per-sample gene set scoring offer the CeNGEN neuron-type collection', async ({ page }) => {
  const names = [
    'unc-17',
    'cha-1',
    'unc-47',
    'unc-25',
    'eat-4',
    'glr-1',
    'tph-1',
    'cat-2',
    'unc-13',
    'snb-1',
    'rab-3',
    'unc-64',
    'ric-4',
    'egl-3',
    'flp-1',
    'nlp-12',
  ];
  const lines = ['gene\ts1\ts2\ts3'];
  names.forEach((n, i) => lines.push([n, i + 1, (i * 5) % 13, 16 - i].join('\t')));
  await page.goto('/ssgsea');
  await page.locator('#expr').fill(lines.join('\n'));
  await page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Neuron types' }) })
    .selectOption({ label: 'Neuron types' });
  await page.locator('label', { hasText: 'Min genes' }).locator('input').fill('1');
  await page.getByRole('button', { name: 'Run scoring' }).click();
  await expect(page.getByText(/Per-sample gene set scoring: [1-9]\d* sets/)).toBeVisible({
    timeout: 120_000,
  });
});

test('contrast comparison groups download in full', async ({ page }) => {
  const header = 'gene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj';
  const rows = Array.from(
    { length: 250 },
    (_, i) => `WBGene${String(i + 1).padStart(8, '0')}\t100\t2\t0.3\t5\t0.001\t0.01`,
  );
  const table = [header, ...rows].join('\n');
  await page.goto('/de/diff');
  const areas = page.locator('textarea');
  await areas.nth(0).fill(table);
  await areas.nth(1).fill(table);
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  await page.getByRole('button', { name: /Up in both/i }).click();
  await expect(page.getByText(/Showing the first 200 of 250 genes/)).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download this group/i }).click(),
  ]);
  const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  expect(text.trim().split('\n')).toHaveLength(251);
});

test('a failed DESeq2 fit stays on the page with a hint', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  // Six near-identical genes: DESeq2 cannot fit a dispersion trend to them.
  const genes = Array.from({ length: 6 }, (_, i) =>
    [`WBGene0000000${i + 1}`, 100, 101, 99, 100, 102, 98].join('\t'),
  );
  const matrix = ['gene\tWT_1\tWT_2\tWT_3\tmut_1\tmut_2\tmut_3', ...genes].join('\n');
  await page.goto('/de');
  await page.locator('textarea').first().fill(matrix);
  const cond = page.locator('input[placeholder*="WT"]');
  await expect(cond).toHaveCount(6);
  for (let i = 0; i < 6; i++) await cond.nth(i).fill(i < 3 ? 'WT' : 'mut');
  await page.getByRole('button', { name: /run deseq2/i }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'DESeq2 fit failed' });
  await expect(alert).toBeVisible({ timeout: 5 * 60_000 });
  // Still there after the toast would have gone.
  await page.waitForTimeout(6_000);
  await expect(alert).toBeVisible();
  await expect(page.locator('pre').first()).toContainText('[error] DESeq2 fit failed');
  await expect(alert).toContainText(/Too few genes vary between samples/);
});
