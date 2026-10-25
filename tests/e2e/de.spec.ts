import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

function makeSyntheticCounts() {
  const samples = ['s1', 's2', 's3', 's4', 's5', 's6'];
  // A hyphenated level: resultsNames() rewrites it, which once made apeglm fail silently.
  const conditions = ['WT', 'WT', 'WT', 'daf-2', 'daf-2', 'daf-2'];
  let seed = 1;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lines = [
    '# Program:test',
    ['Geneid', 'Chr', 'Start', 'End', 'Strand', 'Length', ...samples].join('\t'),
  ];
  const NGENES = 1500;
  for (let g = 0; g < NGENES; g++) {
    const isDE = g < 200;
    const mu = 20 + Math.floor(rand() * 200);
    const row = [`g${g}`, 'I', '1', '1000', '+', '1000'];
    for (let s = 0; s < samples.length; s++) {
      let m = mu;
      if (isDE && conditions[s] === 'daf-2') m *= 1.5 + rand() * 0.5;
      const v = Math.max(0, Math.round(m + (rand() - 0.5) * Math.sqrt(m) * 4));
      row.push(String(v));
    }
    lines.push(row.join('\t'));
  }
  return { tsv: lines.join('\n'), samples, conditions };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  await page.goto('/');
  await resetClientStorage(page);
  await page.evaluate(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  await page.goto('/de');
});

test('page renders without inputs and design card is hidden', async ({ page }) => {
  // The page shell sits behind the DB download gate; allow a cold CI import.
  await expect(page.getByRole('button', { name: /upload counts/i })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole('button', { name: /run deseq2/i })).toHaveCount(0);
});

test('paste counts.tsv populates design rows', async ({ page }) => {
  const { tsv, samples } = makeSyntheticCounts();
  await page.waitForSelector('textarea');
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, tsv);
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(samples.length, {
    timeout: 10_000,
  });
});

test('synthetic fit produces a Results card with contrast chips', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const { tsv, samples, conditions } = makeSyntheticCounts();

  await page.waitForSelector('textarea');
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, tsv);

  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(samples.length, {
    timeout: 10_000,
  });
  const condInputs = page.locator('input[placeholder*="WT"]');
  await expect(condInputs).toHaveCount(samples.length);
  for (let i = 0; i < samples.length; i++) {
    await condInputs.nth(i).fill(conditions[i]);
  }
  await page.waitForFunction(() => {
    const el = document.getElementById('ref') as unknown as HTMLSelectElement | null;
    return !!el && el.value !== '';
  });

  const runBtn = page.getByRole('button', { name: /run deseq2/i });
  await expect(runBtn).toBeEnabled();
  await runBtn.click();

  await expect(page.getByText(/fit \d+\.\d+s · \d+\/\d+ contrasts computed/i)).toBeVisible({
    timeout: 5 * 60_000,
  });

  // Fit-QC viz is tabbed. PCA is the default; other tabs lazy-mount.
  await expect(page.getByText(/^Fit QC$/)).toBeVisible();
  await expect(page.locator('svg[aria-label="PCA scatter"]')).toHaveCount(1);
  await page.getByRole('button', { name: /^Sample distance$/ }).click();
  await expect(page.locator('text=/Sample distance \\(Euclidean on VST\\)/i')).toBeVisible();
  await page
    .getByRole('button', { name: /^Dispersion$/ })
    .first()
    .click();
  await expect(page.locator('svg[aria-label="Dispersion plot"]')).toHaveCount(1);
  await page.getByRole('button', { name: /^Counts$/ }).click();
  await expect(page.locator('svg[aria-label="Counts boxplot"]')).toHaveCount(2);

  const chip = page.locator('button:has-text("daf-2_vs_WT")').first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByText(/shrink: apeglm/i)).toBeVisible({ timeout: 5 * 60_000 });

  // Per-contrast viz is tabbed: Volcano (default) / MA / p-value hist.
  await expect(page.locator('svg[aria-label="Volcano plot"]')).toHaveCount(1);
  await page.getByRole('button', { name: /^MA plot$/ }).click();
  await expect(page.locator('svg[aria-label="Volcano plot"]')).toHaveCount(1);
  await page.getByRole('button', { name: /^p-value hist$/ }).click();
  await expect(page.locator('svg[aria-label="p-value histogram"]')).toHaveCount(1);

  // Table now lives behind a tab; mount it on demand.
  await page.getByRole('button', { name: /^Gene table$/ }).click();
  const filter = page.getByPlaceholder(/filter by gene name/i);
  await expect(filter).toBeVisible();
  await expect(page.locator('text=/[\\d,]+ \\/ [\\d,]+ genes/')).toBeVisible();

  // Filter to a known synthetic gene and confirm the table narrows to 1.
  await filter.fill('g0');
  await expect(page.locator('text=/^1 \\/ /')).toBeVisible({ timeout: 5_000 });

  // Click the row → per-gene drilldown opens with a StripPlot.
  const row = page
    .locator('div[role="button"][style*="height: 32px"]')
    .filter({ hasText: 'g0' })
    .first();
  await row.click();
  await expect(page.locator('svg[aria-label="Strip plot"]')).toHaveCount(1);
  // Drilldown shows the contrast stats line.
  await expect(page.getByText(/baseMean/).first()).toBeVisible();
  // Close button clears it.
  await page.getByRole('button', { name: /^close$/i }).click();
  await expect(page.locator('svg[aria-label="Strip plot"]')).toHaveCount(0);
});
