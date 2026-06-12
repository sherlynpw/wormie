<script lang="ts">
  import { buildMethods, loadBundle, type MethodsContext } from '$lib/methods-export';
  import { toast } from 'svelte-sonner';

  let { ctx }: { ctx: MethodsContext } = $props();

  async function generate(action: 'copy' | 'download') {
    const bundle = await loadBundle();
    const md = buildMethods(ctx, bundle);
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(md);
        toast.success('Methods paragraph copied to clipboard');
      } catch {
        toast.error('Clipboard blocked; use Download instead');
      }
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `methods-${ctx.tool}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<span class="inline-flex gap-1">
  <button
    class="rounded border px-2 py-0.5 text-xs hover:bg-accent"
    onclick={() => generate('copy')}
  >
    Copy methods
  </button>
  <button
    class="rounded border px-2 py-0.5 text-xs hover:bg-accent"
    onclick={() => generate('download')}
  >
    .md
  </button>
</span>
