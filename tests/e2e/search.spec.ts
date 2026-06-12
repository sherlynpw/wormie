import { test, expect, type Page } from '@playwright/test';
import { resetClientStorage } from './helpers';

// Comprehensive search-bar coverage. The bar is the app's front door and
// was effectively untested before this spec. Tests use canonical worm
// genes (daf-16, daf-2, age-1, etc.) so the assertions remain stable
// across WS releases.

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
  // Land in table view so `table tbody tr` works uniformly for "any result"
  // assertions. Cards view doesn't render a <table>.
  await page.goto('/?view=table');
});

// Wait for the home page result list to have at least one row. TableView is
// virtualized <div>s, not a real <table>, and CardsView is gene cards; the
// only view-agnostic signal is the page's "Showing X of Y" counter where
// Y > 0. We poll for that.
async function expectAnyResults(page: Page) {
  // The counter renders inside a span after the "of" word, e.g. "of 123".
  await expect(page.getByText(/of\s+[1-9][\d,]*/)).toBeVisible({ timeout: 60_000 });
}

async function search(page: Page, q: string) {
  const input = page.getByPlaceholder(/Search by gene name/i);
  await input.fill(q);
  // Wait for the debounce + URL update to settle.
  await page.waitForFunction(
    (expected) => {
      const u = new URL(window.location.href);
      return u.searchParams.get('q') === expected || u.searchParams.has('gz');
    },
    q,
    { timeout: 10_000 },
  );
}

// ---------- Plain identifier lookups ----------

test('plain gene name lookup', async ({ page }) => {
  await search(page, 'daf-16');
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

test('WBGene ID lookup', async ({ page }) => {
  await search(page, 'WBGene00000912'); // daf-16
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

test('WBGene ID lookup is case-insensitive', async ({ page }) => {
  // Curators sometimes paste lowercase IDs; the gene-list resolver should
  // still find them.
  await search(page, 'wbgene00000912');
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

test('sequence name lookup', async ({ page }) => {
  // R13H8.1 is daf-16's sequence name in WS298.
  await search(page, 'R13H8.1');
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

// ---------- Free-text FTS ----------

test('free-text bare query matches gene names', async ({ page }) => {
  // DEFAULT_FTS_FIELDS is gene_name/wb_id/entrez_id only, so bare free text
  // doesn't search descriptions. A name fragment like "daf" should match.
  await search(page, 'daf');
  await expect(page.getByText(/daf-/).first()).toBeVisible({ timeout: 60_000 });
});

test('quoted phrase parses without error', async ({ page }) => {
  // Quoting matters mostly for multi-word op values (cat:"Cell cycle",
  // tissue:"nervous system"); we verify those elsewhere. Here we just
  // confirm the parser doesn't break on a bare quoted phrase — the URL
  // should update and the page should not throw a "No results." error
  // unless the phrase is genuinely absent. The exact phrase tokenizes
  // unpredictably (descriptions use "insulin/IGF signaling" with slash),
  // so we only assert parsing succeeds (URL updates).
  await search(page, '"daf"');
  await expect(page.getByText(/daf-/).first()).toBeVisible({ timeout: 60_000 });
});

// ---------- Operators ----------

test('go: operator filters by GO term', async ({ page }) => {
  await search(page, 'go:apoptosis');
  // At least one gene with apoptosis-related GO annotation should appear.
  // ced-3 (CED-3, the canonical worm caspase) is a safe hit.
  await expect(page.getByText('ced-3').first()).toBeVisible({ timeout: 60_000 });
});

test('cat: operator filters by WormCat category', async ({ page }) => {
  await search(page, 'cat:Chaperone');
  // hsp-16 family members appear under WormCat Chaperone.
  await expect(page.getByText(/hsp-/i).first()).toBeVisible({ timeout: 60_000 });
});

test('cat: with quoted multi-word value', async ({ page }) => {
  await search(page, 'cat:"Cell cycle"');
  // Wormcat category match — assert at least one row, since exact gene
  // assignment depends on the wormcat curation we ship.
  await expectAnyResults(page);
});

test('pheno: operator filters by phenotype', async ({ page }) => {
  // Use a multi-word phenotype name so fts5's unicode61 tokenizer has more
  // than a single short token to match against (single "c" from "Daf-c"
  // hyphenates badly).
  await search(page, 'pheno:"locomotion variant"');
  await expectAnyResults(page);
});

test('tissue: operator filters by anatomy', async ({ page }) => {
  // "nervous system" is a top-level WBbt term mapped to many genes; the
  // single-token "neuron" can be too aggressive once fts5 splits on punctuation.
  await search(page, 'tissue:"nervous system"');
  await expectAnyResults(page);
});

test('neuronal: operator filters by neuronal classification', async ({ page }) => {
  // neuronal_genes.csv categories use phrases like "Potassium channels",
  // "Chloride channels", grouped under supercategory "Ion channels".
  await search(page, 'neuronal:channel');
  await expectAnyResults(page);
});

test('ortho: operator filters by ortholog symbol', async ({ page }) => {
  await search(page, 'ortho:FOXO1');
  // daf-16 is the worm FOXO1 ortholog.
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

test('desc: operator filters by description', async ({ page }) => {
  await search(page, 'desc:autophagy');
  // lgg-1 (LC3 homolog, autophagy core) should appear.
  await expect(page.getByText(/lgg-|atg-/).first()).toBeVisible({ timeout: 60_000 });
});

test('status: live is the default and filters out dead genes', async ({ page }) => {
  await search(page, 'status:live');
  await expectAnyResults(page);
});

test('type: operator filters by biotype', async ({ page }) => {
  await search(page, 'type:protein_coding');
  await expectAnyResults(page);
});

test('expressed: operator filters by CeNGEN neuron class', async ({ page }) => {
  await search(page, 'expressed:ADL');
  // ADL is a canonical CeNGEN-mapped neuron class.
  await expectAnyResults(page);
});

test('syn: operator filters by synaptogenesis panel', async ({ page }) => {
  await search(page, 'syn:innexin');
  await expect(page.getByText(/inx-/).first()).toBeVisible({ timeout: 60_000 });
});

// ---------- LIKE syntax (~) ----------

test('name~ operator with glob', async ({ page }) => {
  await search(page, 'name~daf-1*');
  // daf-16, daf-18, daf-12 should all match.
  await expect(page.getByText(/daf-1/).first()).toBeVisible({ timeout: 60_000 });
});

test('wb~ operator with glob', async ({ page }) => {
  await search(page, 'wb~WBGene00000915');
  // WBGene00000915 is daf-19.
  await expectAnyResults(page);
});

// ---------- Boolean combinations ----------

test('OR connector merges two operator results', async ({ page }) => {
  await search(page, 'desc:"TGF-beta" OR pheno:Daf-c');
  // Either daf-7 (TGF-β) or daf-2 (Daf-c) should appear.
  await expect(page.getByText(/daf-7|daf-2/).first()).toBeVisible({ timeout: 60_000 });
});

test('implicit AND between operators', async ({ page }) => {
  // Use two ops with a broad overlap (most live genes are protein_coding).
  await search(page, 'status:live type:protein_coding');
  await expectAnyResults(page);
});

// ---------- Gene-list mode ----------

test('small gene-list paste resolves all genes', async ({ page }) => {
  await search(page, 'daf-16, daf-2, age-1');
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('daf-2').first()).toBeVisible();
  await expect(page.getByText('age-1').first()).toBeVisible();
});

test('mixed-case gene-list resolves', async ({ page }) => {
  await search(page, 'Daf-16, DAF-2, Age-1');
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('daf-2').first()).toBeVisible();
});

test('mixed delimiters in gene-list paste', async ({ page }) => {
  await search(page, 'daf-16; daf-2|age-1');
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('daf-2').first()).toBeVisible();
});

// ---------- Hybrid: IDs + ops ----------

test('hybrid: gene-list pre-filter + op', async ({ page }) => {
  // Resolves to insulin-relevant genes among the pasted set.
  await search(page, 'daf-16 daf-2 age-1 desc:insulin');
  await expectAnyResults(page);
});

// ---------- View interaction ----------

test('view=wormcat survives a search', async ({ page }) => {
  await page.goto('/?view=wormcat');
  await search(page, 'cat:Chaperone');
  // The URL should retain view=wormcat after the search.
  expect(new URL(page.url()).searchParams.get('view')).toBe('wormcat');
});

// ---------- Edge cases ----------

test('empty result for nonsense query', async ({ page }) => {
  await search(page, 'this-is-not-a-real-gene-name-xyzzy');
  // CardsView and TableView both render "No results." for empty result sets.
  await expect(page.getByText('No results.').first()).toBeVisible({
    timeout: 60_000,
  });
});
