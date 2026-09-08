import { test, expect } from './fixtures';
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
});

function syntheticCounts(samples: string[]): string {
  const header = ['Geneid', 'Chr', 'Start', 'End', 'Strand', 'Length', ...samples].join('\t');
  const rows = Array.from({ length: 80 }, (_, i) =>
    [`g${i}`, 'I', '1', '1000', '+', '1000', ...samples.map((_, j) => 100 + i + j * 5)].join('\t'),
  );
  return ['# Program:test', header, ...rows].join('\n');
}

function syntheticDeRows(): string {
  const lines = ['gene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj'];
  for (let i = 0; i < 50; i++) {
    const lfc = (i % 5) - 2 + Math.random() * 0.5;
    const stat = lfc * 4;
    const p = Math.exp(-Math.abs(stat));
    lines.push(
      [`WBGene${String(i).padStart(8, '0')}`, 100 + i, lfc, 0.4, stat, p, p * 2].join('\t'),
    );
  }
  return lines.join('\n');
}

test('counts → /de handoff fills the design table', async ({ page }) => {
  const samples = ['sA', 'sB', 'sC', 'sD'];
  const tsv = syntheticCounts(samples);
  await page.goto('/counts');
  await page
    .getByRole('region', { name: /inputs/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __pipelineHandoff?: object }).__pipelineHandoff,
  );
  await page.evaluate(
    ([t, s]) => {
      const w = window as unknown as {
        __pipelineHandoff: {
          counts: { set: (v: { tsv: string; samples: string[] }) => void };
        };
      };
      w.__pipelineHandoff.counts.set({ tsv: t as string, samples: s as string[] });
    },
    [tsv, samples] as const,
  );
  await page.evaluate(() => {
    return (window as unknown as { __goto: (u: string) => Promise<void> }).__goto(
      '/de?from=counts',
    );
  });
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(samples.length, {
    timeout: 15_000,
  });
});

test('de → /gsea handoff seeds the paste textarea with stat-ranked rows', async ({ page }) => {
  // Land on /de first so the next SPA navigation to /gsea fires its onMount.
  await page.goto('/de');
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __pipelineHandoff?: object }).__pipelineHandoff,
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      __pipelineHandoff: {
        gsea: {
          set: (v: { contrastName: string; rows: { gene: string; score: number }[] }) => void;
        };
      };
    };
    const rows = Array.from({ length: 20 }, (_, i) => ({
      gene: `WBGene${String(i).padStart(8, '0')}`,
      score: (10 - i) * 0.3,
    }));
    w.__pipelineHandoff.gsea.set({ contrastName: 'TGFb_vs_WT', rows });
  });
  await page.evaluate(() => {
    return (window as unknown as { __goto: (u: string) => Promise<void> }).__goto('/gsea?from=de');
  });
  // Toast confirms; textarea should hold the gene\tstat header + rows.
  await expect(page.getByText(/Loaded ranked list from \/de/i)).toBeVisible({ timeout: 5_000 });
  const ta = page.locator('textarea').first();
  await expect(ta).toHaveValue(/gene\tstat/);
});

test('de → /de/diff handoff fills both contrast textareas', async ({ page }) => {
  const tsv = syntheticDeRows();
  // Land on /de first so the next SPA navigation to /de/diff fires onMount.
  await page.goto('/de');
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __pipelineHandoff?: object }).__pipelineHandoff,
  );
  await page.evaluate((t) => {
    const w = window as unknown as {
      __pipelineHandoff: {
        deseqDiff: {
          set: (v: { a: { name: string; tsv: string }; b: { name: string; tsv: string } }) => void;
        };
      };
    };
    w.__pipelineHandoff.deseqDiff.set({
      a: { name: 'TGFb_vs_WT', tsv: t },
      b: { name: 'BMP_vs_WT', tsv: t },
    });
  }, tsv);
  await page.evaluate(() => {
    return (window as unknown as { __goto: (u: string) => Promise<void> }).__goto(
      '/de/diff?from=de',
    );
  });
  await expect(page.getByText(/Loaded contrasts from \/de/i)).toBeVisible({ timeout: 5_000 });
  // Both label inputs should reflect the contrast names.
  await expect(page.locator('input[placeholder="Label for contrast A"]')).toHaveValue('TGFb_vs_WT');
  await expect(page.locator('input[placeholder="Label for contrast B"]')).toHaveValue('BMP_vs_WT');
});
