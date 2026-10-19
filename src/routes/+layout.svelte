<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { db } from '$lib/stores/db.svelte';
  import { selection } from '$lib/stores/selection.svelte';
  import { recents } from '$lib/stores/recents.svelte';
  import { presets } from '$lib/stores/presets.svelte';
  import { datasets } from '$lib/stores/datasets.svelte';
  import { pwaInstall } from '$lib/stores/pwa-install.svelte';
  import CommandPalette, { openPalette } from '$lib/components/CommandPalette.svelte';
  import ShortcutsHelp, { openHelp } from '$lib/components/ShortcutsHelp.svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { Sheet, SheetTrigger, SheetContent } from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import Menu from 'lucide-svelte/icons/menu';
  import PWAUpdatePrompt from '$lib/components/PWAUpdatePrompt.svelte';
  import DataFreshness from '$lib/components/DataFreshness.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import TourOverlay from '$lib/components/TourOverlay.svelte';
  import { tour } from '$lib/stores/tour.svelte';
  import HelpCircle from 'lucide-svelte/icons/help-circle';
  import SelectionBar from '$lib/components/SelectionBar.svelte';
  import JobOverlay from '$lib/components/JobOverlay.svelte';
  import { Toaster } from 'svelte-sonner';
  import { Card, CardContent } from '$lib/components/ui/card';

  let { children } = $props();

  onMount(() => {
    theme.init();
    selection.init();
    recents.init();
    presets.init();
    datasets.init();
    tour.init();
    pwaInstall.init();
    db.ensure('/data/wormie.sqlite.gz', '1');
    if (import.meta.env.DEV) {
      (window as unknown as { __goto: typeof goto }).__goto = goto;
      void import('$lib/bench').then((m) => m.installBenchHook());
    }
    // First-time visitors get the tour auto-launched after the DB settles.
    if (!tour.hasCompleted) {
      setTimeout(() => {
        if (!tour.active && !tour.hasCompleted) tour.start();
      }, 1200);
    }

    const G_CHORDS: Record<string, string> = {
      c: '/?view=cards',
      t: '/?view=table',
      w: '/?view=wormcat',
      o: '/?view=go',
      n: '/?view=neuronal',
      s: '/?view=synaptogenesis',
    };
    let chordPrefix: 'g' | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    function clearChord() {
      chordPrefix = null;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (editable) return;

      // Modifier keys disable single-letter shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (chordPrefix === 'g') {
        const k = e.key.toLowerCase();
        const target = G_CHORDS[k];
        clearChord();
        if (target) {
          e.preventDefault();
          goto(resolve(target as '/'));
        }
        return;
      }

      if (e.key === '/') {
        const input = document.querySelector(
          'input[placeholder^="Search by gene name"]',
        ) as HTMLInputElement | null;
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      } else if (e.key === '?') {
        e.preventDefault();
        openHelp();
      } else if (e.key === 'g') {
        e.preventDefault();
        chordPrefix = 'g';
        chordTimer = setTimeout(clearChord, 1200);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearChord();
    };
  });

  function fmtMB(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground">
  <header
    class="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-card px-4 md:px-6"
  >
    <div class="flex items-center gap-2">
      <Sheet>
        <SheetTrigger>
          {#snippet child({ props }: { props: Record<string, unknown> })}
            <Button variant="ghost" size="icon" class="md:hidden" aria-label="Open menu" {...props}>
              <Menu />
            </Button>
          {/snippet}
        </SheetTrigger>
        <SheetContent side="left" class="p-0">
          <Sidebar mobile />
        </SheetContent>
      </Sheet>
      <div class="flex items-center gap-3">
        <a
          href={resolve('/')}
          class="flex items-center gap-2 transition-opacity hover:opacity-80"
          aria-label="WormIE home"
          title="wormie.rs.ht, explorer of the worm seas"
        >
          <Logo class="h-9 w-auto" />
          <span class="sr-only">wormie.rs.ht</span>
        </a>
        <span class="hidden text-xs text-muted-foreground sm:inline">Worm Integrated Explorer</span>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={() => openPalette()}
        class="hidden h-8 gap-2 text-xs text-muted-foreground md:inline-flex"
        aria-label="Open command palette"
      >
        <span>Search</span>
        <kbd class="rounded bg-muted px-1 py-0.5 text-[0.6rem]">⌘K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={() => tour.start()}
        class="hidden h-8 gap-1.5 text-xs sm:inline-flex"
        title="Take the guided tour"
      >
        <HelpCircle class="h-3.5 w-3.5" />
        Tour
      </Button>
      <DataFreshness />
      <ThemeToggle />
    </div>
  </header>

  <div class="flex flex-1">
    <Sidebar />

    <!-- Bottom padding clears the fixed selection bar so page-end controls stay reachable. -->
    <main class="min-w-0 flex-1 {selection.ids.length > 0 ? 'pb-24' : ''}">
      {#if db.phase === 'loading'}
        <div class="mx-auto max-w-2xl p-6">
          <Card>
            <CardContent class="pt-6">
              <div class="mb-2 font-medium">{db.status}</div>
              {#if db.progress > 0}
                <div class="font-mono text-xs text-muted-foreground">
                  {fmtMB(db.progress)} decompressed
                </div>
              {:else}
                <div class="text-xs text-muted-foreground">
                  First-time load caches the database{db.gzSize
                    ? ` (${fmtMB(db.gzSize)} compressed)`
                    : ''} for offline use.
                </div>
              {/if}
            </CardContent>
          </Card>
        </div>
      {:else if db.phase === 'error'}
        <div class="mx-auto max-w-2xl p-6">
          <Card class="border-destructive bg-destructive/5">
            <CardContent class="space-y-3 pt-6">
              <div>
                <div class="mb-1 font-medium text-destructive">Failed to load database</div>
                <div class="font-mono text-xs text-destructive/80">{db.error}</div>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={async () => {
                    try {
                      const root = await navigator.storage?.getDirectory?.();
                      if (root) {
                        for await (const entry of (root as any).values()) {
                          try {
                            await (root as any).removeEntry(entry.name, { recursive: true });
                          } catch {
                            /* ignore */
                          }
                        }
                      }
                      location.reload();
                    } catch {
                      location.reload();
                    }
                  }}
                >
                  Reset local database
                </Button>
                <Button variant="outline" size="sm" onclick={() => location.reload()}>Retry</Button>
              </div>
              <div class="text-xs text-muted-foreground">
                If reset doesn't help, close any other tabs of this site and reload.
              </div>
            </CardContent>
          </Card>
        </div>
      {:else if db.phase === 'ready'}
        {@render children()}
      {/if}
    </main>
  </div>
  <SelectionBar />
  <CommandPalette />
  <ShortcutsHelp />
  <PWAUpdatePrompt />
  <TourOverlay />
  <JobOverlay />
  <Toaster
    richColors
    closeButton
    position="top-right"
    theme={theme.mode}
    toastOptions={{ duration: 2500 }}
  />
</div>
