import { test, expect } from '@playwright/test';
import { resetClientStorage } from './helpers';

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
  await page.goto('/counts');
  await page
    .getByRole('region', { name: /inputs/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
});

function fakeBam(name: string, size = 4096): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, 0x42) };
}
function fakeGtf(): { name: string; mimeType: string; buffer: Buffer } {
  const body = '# stub GTF\nI\tsource\texon\t1\t100\t.\t+\t.\tgene_id "g1";\n';
  return { name: 'stub.gtf', mimeType: 'text/plain', buffer: Buffer.from(body) };
}

test('page renders and shows BAM picker', async ({ page }) => {
  await expect(page.getByRole('region', { name: /inputs/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose bam file/i })).toBeVisible();
  // "Choose annotation" without a bundled GTF; "Or choose your own" when
  // version.json advertises the shipped WormBase annotation.
  await expect(
    page.getByRole('button', { name: /choose annotation|choose your own/i }),
  ).toBeVisible();
});

test('adds BAMs cumulatively and supports remove + clear', async ({ page }) => {
  const bamInput = page.locator('input[type="file"][accept=".bam"]');

  await bamInput.setInputFiles([fakeBam('s1.bam'), fakeBam('s2.bam')]);
  await expect(page.locator('text=s1.bam')).toBeVisible();
  await expect(page.locator('text=s2.bam')).toBeVisible();
  await expect(page.getByRole('button', { name: /add more bams/i })).toBeVisible();

  // Cumulative append: picking again should add, not replace.
  await bamInput.setInputFiles([fakeBam('s3.bam')]);
  await expect(page.locator('text=s3.bam')).toBeVisible();
  await expect(page.locator('text=s1.bam')).toBeVisible();

  await page.getByRole('button', { name: /^remove s2.bam$/i }).click();
  await expect(page.locator('text=s2.bam')).toHaveCount(0);

  await page.getByRole('button', { name: /clear all/i }).click();
  await expect(page.locator('text=s1.bam')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /choose bam file/i })).toBeVisible();
});

test('accepts a GTF annotation', async ({ page }) => {
  const gtfInput = page.locator('input[type="file"][accept*=".gtf"]');
  await gtfInput.setInputFiles(fakeGtf());
  await expect(page.locator('text=stub.gtf')).toBeVisible();
});

test('Run button is disabled until BAM + GTF are present', async ({ page }) => {
  const runBtn = page.getByRole('button', { name: /^run /i });
  await expect(runBtn).toBeDisabled();

  await page.locator('input[type="file"][accept=".bam"]').setInputFiles(fakeBam('s1.bam'));
  await expect(runBtn).toBeDisabled();

  await page.locator('input[type="file"][accept*=".gtf"]').setInputFiles(fakeGtf());
  await expect(runBtn).toBeEnabled();
});
