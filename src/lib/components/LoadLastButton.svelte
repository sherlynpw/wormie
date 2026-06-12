<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { lastInputs } from '$lib/stores/lastInputs.svelte';
  import type { DatasetType } from '$lib/stores/datasets.svelte';
  import History from 'lucide-svelte/icons/history';

  let {
    type,
    onload,
  }: {
    type: DatasetType;
    onload: (body: string) => void;
  } = $props();

  const last = $derived(lastInputs.byKind[type]);

  function relTime(ms: number): string {
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }
</script>

{#if last}
  <Button
    variant="ghost"
    size="sm"
    onclick={() => onload(last.body)}
    title={`Restore the last ${type} you ran (${(last.body.length / 1024).toFixed(1)} KB)`}
  >
    <History class="h-3 w-3" />
    Last ({relTime(last.at)})
  </Button>
{/if}
