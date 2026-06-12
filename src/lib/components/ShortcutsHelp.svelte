<script lang="ts" module>
  let openState = $state(false);
  export function openHelp() {
    openState = true;
  }
  export function closeHelp() {
    openState = false;
  }
  export function helpIsOpen() {
    return openState;
  }
</script>

<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { tour } from '$lib/stores/tour.svelte';
  import { hints } from '$lib/stores/hints.svelte';
  import { onMount } from 'svelte';

  onMount(() => hints.init());

  function resetEverything() {
    hints.resetAll();
    location.reload();
  }

  type Section = { title: string; items: { keys: string[]; label: string }[] };
  const SECTIONS: Section[] = [
    {
      title: 'Global',
      items: [
        { keys: ['⌘', 'K'], label: 'Open command palette' },
        { keys: ['/'], label: 'Focus search bar' },
        { keys: ['?'], label: 'Show keyboard shortcuts' },
        { keys: ['Esc'], label: 'Close modal / palette' },
      ],
    },
    {
      title: 'Navigation',
      items: [
        { keys: ['g', 'c'], label: 'Go to Cards view' },
        { keys: ['g', 't'], label: 'Go to Table view' },
        { keys: ['g', 'w'], label: 'Go to WormCat view' },
        { keys: ['g', 'o'], label: 'Go to GO Terms view' },
        { keys: ['g', 'n'], label: 'Go to Neuronal view' },
        { keys: ['g', 's'], label: 'Go to Synaptogenesis view' },
      ],
    },
    {
      title: 'In the table',
      items: [
        { keys: ['Enter'], label: 'Copy focused cell text' },
        { keys: ['Click row chevron'], label: 'Expand row for full descriptions' },
      ],
    },
  ];

  function bind(open: boolean) {
    openState = open;
  }
</script>

<DialogPrimitive.Root bind:open={() => openState, bind}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <DialogPrimitive.Content
      class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-5 shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
    >
      <DialogPrimitive.Title class="mb-3 text-base font-semibold">
        Keyboard shortcuts
      </DialogPrimitive.Title>
      <DialogPrimitive.Description class="sr-only">
        Available keyboard shortcuts
      </DialogPrimitive.Description>
      <div class="space-y-4">
        {#each SECTIONS as section (section.title)}
          <div>
            <div
              class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {section.title}
            </div>
            <dl class="space-y-1">
              {#each section.items as item, i (i)}
                <div class="flex items-center justify-between gap-3 text-sm">
                  <dt class="text-foreground">{item.label}</dt>
                  <dd class="flex items-center gap-1">
                    {#each item.keys as key, j (j)}
                      {#if j > 0}
                        <span class="text-xs text-muted-foreground">then</span>
                      {/if}
                      <kbd
                        class="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs"
                      >
                        {key}
                      </kbd>
                    {/each}
                  </dd>
                </div>
              {/each}
            </dl>
          </div>
        {/each}
      </div>
      <div class="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs">
        <button
          type="button"
          onclick={() => {
            closeHelp();
            tour.start();
          }}
          class="text-primary hover:underline"
          title="Launch the guided walkthrough"
        >
          Replay guided tour
        </button>
        <button
          type="button"
          onclick={resetEverything}
          class="text-primary hover:underline"
          title="Re-enable every page-strip and control-icon hint, then reload"
        >
          Show all hints again
          {#if hints.initialized && hints.totalCount() > 0}
            <span class="text-muted-foreground">({hints.totalCount()} dismissed)</span>
          {/if}
        </button>
      </div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
