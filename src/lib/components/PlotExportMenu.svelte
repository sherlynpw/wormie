<script lang="ts">
  import { exportSvg, exportPng, exportPdf } from '$lib/export-plot';
  import { Button } from '$lib/components/ui/button';
  import Download from 'lucide-svelte/icons/download';
  import { toast } from 'svelte-sonner';

  let {
    getSvg,
    baseName,
    extra = [],
  }: {
    getSvg: () => SVGSVGElement | null;
    baseName: string;
    /** Non-image exports (e.g. the data behind the plot) appended below the image formats. */
    extra?: { label: string; title?: string; run: () => void }[];
  } = $props();

  let open = $state(false);
  let menuRef: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) open = false;
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });

  async function pick(format: 'svg' | 'png' | 'pdf') {
    const svg = getSvg();
    if (!svg) {
      toast.error('Nothing to export', { description: 'Plot is not rendered.' });
      return;
    }
    open = false;
    try {
      if (format === 'svg') exportSvg(svg, baseName);
      else if (format === 'png') await exportPng(svg, baseName);
      else exportPdf(svg, baseName);
    } catch (e) {
      toast.error('Export failed', { description: String(e instanceof Error ? e.message : e) });
    }
  }
</script>

<div bind:this={menuRef} class="relative inline-block">
  <Button
    variant="outline"
    size="sm"
    onclick={() => (open = !open)}
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <Download class="h-3 w-3" />
    Export
  </Button>
  {#if open}
    <div
      role="menu"
      class="absolute right-0 z-50 mt-1 w-36 overflow-hidden rounded-md border bg-popover shadow-md"
    >
      <button
        type="button"
        class="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
        onclick={() => pick('svg')}
      >
        SVG
      </button>
      <button
        type="button"
        class="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
        onclick={() => pick('png')}
      >
        PNG
      </button>
      <button
        type="button"
        class="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
        onclick={() => pick('pdf')}
        title="Opens the print dialog. Choose 'Save as PDF' to get a vector file, which stays sharp at any size."
      >
        PDF
      </button>
      {#each extra as item (item.label)}
        <button
          type="button"
          class="w-full border-t px-3 py-1.5 text-left text-sm hover:bg-accent"
          title={item.title}
          onclick={() => {
            open = false;
            item.run();
          }}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
