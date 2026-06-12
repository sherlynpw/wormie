<script lang="ts">
  import { jobs } from '$lib/stores/jobs.svelte';
  import Loader from 'lucide-svelte/icons/loader-2';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';

  let now = $state(Date.now());
  // 1s tick so the elapsed timer updates live.
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  function elapsed(startedAt: number): string {
    const s = Math.floor((now - startedAt) / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
</script>

{#if jobs.jobs.length > 0}
  <div
    class="pointer-events-none fixed bottom-3 right-3 z-[60] flex max-w-sm flex-col gap-2"
    aria-live="polite"
  >
    {#each jobs.jobs as job (job.id)}
      {@const pct =
        job.total && job.current !== undefined ? Math.round((job.current / job.total) * 100) : null}
      <div
        class="pointer-events-auto overflow-hidden rounded-lg border bg-card/95 shadow-lg backdrop-blur"
      >
        <div class="flex items-center gap-2 px-3 py-2">
          {#if job.error}
            <AlertCircle class="h-4 w-4 shrink-0 text-destructive" />
          {:else}
            <Loader class="h-4 w-4 shrink-0 animate-spin text-primary" />
          {/if}
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-semibold leading-tight">{job.label}</div>
            <div class="truncate text-[0.7rem] leading-tight text-muted-foreground">
              {job.error ?? job.phase}
            </div>
          </div>
          <div class="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground">
            {elapsed(job.startedAt)}
          </div>
        </div>
        {#if pct !== null && !job.error}
          <div class="h-1 bg-muted">
            <div
              class="h-full bg-primary transition-[width] duration-300"
              style="width: {pct}%"
            ></div>
          </div>
        {:else if !job.error}
          <div class="h-1 overflow-hidden bg-muted">
            <div class="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] bg-primary"></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <style>
    @keyframes slide {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(400%);
      }
    }
  </style>
{/if}
