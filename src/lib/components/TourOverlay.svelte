<script lang="ts">
  // Spotlight tour overlay: fixed SVG mask punched around the target's bounding rect,
  // tooltip card anchored beside it, recomputed on scroll/resize.
  import { onDestroy } from 'svelte';
  import { tour, TOUR_STEPS } from '$lib/stores/tour.svelte';
  import { Button } from '$lib/components/ui/button';
  import X from 'lucide-svelte/icons/x';

  const PADDING = 8;
  const TIP_W = 320;
  const TIP_GAP = 12;

  let rect = $state<DOMRect | null>(null);
  let viewport = $state({ w: 0, h: 0 });

  // Skip auto-scroll when the element is already comfortably visible (e.g. sticky sidebar).
  function isInViewport(r: DOMRect): boolean {
    const margin = 40;
    const visibleH = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    const visibleW = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
    if (visibleH <= 0 || visibleW <= 0) return false;
    const enoughVertical = visibleH >= Math.min(r.height, window.innerHeight - margin * 2) * 0.6;
    const enoughHorizontal = visibleW >= Math.min(r.width, window.innerWidth - margin * 2) * 0.6;
    return enoughVertical && enoughHorizontal;
  }

  function measure() {
    if (typeof window === 'undefined') return;
    viewport = { w: window.innerWidth, h: window.innerHeight };
    const sel = tour.step?.selector;
    if (!sel) {
      rect = null;
      return;
    }
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) {
      // Route just changed; retry after target mounts.
      rect = null;
      setTimeout(() => {
        if (!tour.active) return;
        const e = document.querySelector(sel) as HTMLElement | null;
        if (!e) return;
        const r = e.getBoundingClientRect();
        if (!isInViewport(r))
          e.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        rect = e.getBoundingClientRect();
      }, 200);
      return;
    }
    const r0 = el.getBoundingClientRect();
    if (isInViewport(r0)) {
      rect = r0;
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    // Recompute after smooth scroll settles.
    setTimeout(() => {
      if (!tour.active) return;
      rect = el.getBoundingClientRect();
    }, 250);
    rect = r0;
  }

  $effect(() => {
    // Re-measure on step/navigation change.
    void tour.stepIndex;
    void tour.active;
    measure();
  });

  function onScrollOrResize() {
    measure();
  }

  $effect(() => {
    if (!tour.active) return;
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, { capture: true } as never);
      window.removeEventListener('resize', onScrollOrResize);
    };
  });

  onDestroy(() => {
    window.removeEventListener('scroll', onScrollOrResize, { capture: true } as never);
    window.removeEventListener('resize', onScrollOrResize);
  });

  const tipPos = $derived.by(() => {
    if (!rect) {
      // No target: center in viewport.
      return {
        left: viewport.w / 2 - TIP_W / 2,
        top: viewport.h / 2 - 140,
        arrow: null as null | 'top' | 'bottom' | 'left' | 'right',
      };
    }
    const placement = tour.step?.placement ?? 'bottom';
    const cx = rect.left + rect.width / 2;
    let left = cx - TIP_W / 2;
    let top = rect.bottom + TIP_GAP;
    let arrow: 'top' | 'bottom' | 'left' | 'right' = 'top';
    if (placement === 'top') {
      top = rect.top - TIP_GAP - 200;
      arrow = 'bottom';
    } else if (placement === 'right') {
      left = rect.right + TIP_GAP;
      top = rect.top + rect.height / 2 - 80;
      arrow = 'left';
    } else if (placement === 'left') {
      left = rect.left - TIP_GAP - TIP_W;
      top = rect.top + rect.height / 2 - 80;
      arrow = 'right';
    }
    // Clamp tooltip to viewport edges.
    left = Math.max(12, Math.min(left, viewport.w - TIP_W - 12));
    top = Math.max(12, Math.min(top, viewport.h - 240));
    return { left, top, arrow };
  });

  function onKey(e: KeyboardEvent) {
    if (!tour.active) return;
    if (e.key === 'Escape') tour.stop();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') tour.next();
    else if (e.key === 'ArrowLeft') tour.prev();
  }

  $effect(() => {
    if (!tour.active) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if tour.active && tour.step}
  {@const step = tour.step}
  {@const last = tour.stepIndex >= TOUR_STEPS.length - 1}
  <!-- Backdrop: SVG mask rect + cutout rect punch a hole around the target. -->
  <div class="pointer-events-none fixed inset-0 z-[100]">
    <svg
      width={viewport.w}
      height={viewport.h}
      viewBox="0 0 {viewport.w} {viewport.h}"
      class="block"
    >
      <defs>
        <mask id="tour-mask">
          <rect x="0" y="0" width={viewport.w} height={viewport.h} fill="white" />
          {#if rect}
            <rect
              x={rect.left - PADDING}
              y={rect.top - PADDING}
              width={rect.width + PADDING * 2}
              height={rect.height + PADDING * 2}
              rx="6"
              fill="black"
            />
          {/if}
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width={viewport.w}
        height={viewport.h}
        fill="hsl(var(--background))"
        fill-opacity="0.75"
        mask="url(#tour-mask)"
        class="pointer-events-auto"
        onclick={() => tour.stop()}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') tour.stop();
        }}
        role="button"
        tabindex="-1"
      />
      {#if rect}
        <rect
          x={rect.left - PADDING}
          y={rect.top - PADDING}
          width={rect.width + PADDING * 2}
          height={rect.height + PADDING * 2}
          rx="6"
          fill="none"
          stroke="hsl(var(--primary))"
          stroke-width="2"
        />
      {/if}
    </svg>
  </div>

  <!-- Tooltip card (pointer-events: auto for button interaction). -->
  <div
    class="pointer-events-auto fixed z-[101]"
    style="left: {tipPos.left}px; top: {tipPos.top}px; width: {TIP_W}px;"
  >
    <div class="space-y-3 rounded-lg border bg-popover p-4 shadow-xl">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Step {tour.stepIndex + 1} of {TOUR_STEPS.length}
          </div>
          <h2 class="mt-0.5 text-base font-semibold leading-tight">{step.title}</h2>
        </div>
        <button
          type="button"
          onclick={() => tour.stop()}
          class="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Skip tour"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
      <p class="text-sm leading-relaxed text-foreground/90">{step.body}</p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => tour.stop()}
          class="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Skip
        </button>
        <div class="ml-auto flex items-center gap-1">
          {#each TOUR_STEPS as _, i (i)}
            <span
              class={i === tour.stepIndex
                ? 'h-1.5 w-4 rounded-full bg-foreground'
                : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/30'}
            ></span>
          {/each}
        </div>
        <Button
          variant="outline"
          size="sm"
          onclick={() => tour.prev()}
          disabled={tour.stepIndex === 0}
        >
          Back
        </Button>
        <Button size="sm" onclick={() => tour.next()}>
          {last ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>
  </div>
{/if}
