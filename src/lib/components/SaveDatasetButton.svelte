<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { datasets, type DatasetType, labelFor } from '$lib/stores/datasets.svelte';
  import Save from 'lucide-svelte/icons/save';
  import { toast } from 'svelte-sonner';

  let {
    type,
    body,
    meta,
    disabled = false,
    defaultName,
    variant = 'outline',
    size = 'sm',
  }: {
    type: DatasetType;
    body: string | (() => string);
    meta?: Record<string, unknown>;
    disabled?: boolean;
    defaultName?: string;

    variant?: any;

    size?: any;
  } = $props();

  let popoverOpen = $state(false);
  let nameInput = $state('');
  let popoverRef: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (!popoverOpen) return;
    nameInput = defaultName ?? `${labelFor(type)} ${new Date().toLocaleDateString()}`;
    const onClick = (e: MouseEvent) => {
      if (popoverRef && !popoverRef.contains(e.target as Node)) popoverOpen = false;
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });

  async function save() {
    const text = typeof body === 'function' ? body() : body;
    if (!text || !text.trim()) {
      toast.error('Nothing to save', { description: 'Provide content first.' });
      return;
    }
    if (!nameInput.trim()) {
      toast.error('Name required');
      return;
    }
    try {
      const ds = await datasets.add({ name: nameInput.trim(), type, body: text, meta });
      popoverOpen = false;
      toast.success('Saved to datasets', { description: ds.name });
    } catch (e) {
      toast.error('Save failed', { description: String(e) });
    }
  }
</script>

<div bind:this={popoverRef} class="relative inline-block">
  <Button {variant} {size} {disabled} onclick={() => (popoverOpen = !popoverOpen)}>
    <Save class="h-3 w-3" />
    Save
  </Button>
  {#if popoverOpen}
    <div
      role="menu"
      class="absolute right-0 z-50 mt-1 w-64 space-y-2 rounded-md border bg-popover p-2 shadow-md"
    >
      <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Save as {labelFor(type).toLowerCase()}
      </div>
      <input
        bind:value={nameInput}
        placeholder="dataset name"
        class="w-full rounded border bg-background px-2 py-1 text-sm"
        onkeydown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') popoverOpen = false;
        }}
      />
      <div class="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onclick={() => (popoverOpen = false)}>Cancel</Button>
        <Button size="sm" onclick={save}>Save</Button>
      </div>
    </div>
  {/if}
</div>
