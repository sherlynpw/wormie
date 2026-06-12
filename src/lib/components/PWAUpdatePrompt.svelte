<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';

  let needRefresh = $state(false);
  let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

  onMount(async () => {
    // virtual:pwa-register is injected by vite-plugin-pwa at build time; absent in dev.
    try {
      const mod = await import(/* @vite-ignore */ 'virtual:pwa-register');
      updateSW = mod.registerSW({
        immediate: true,
        onNeedRefresh() {
          needRefresh = true;
        },
        onOfflineReady() {
          // could show a toast here
        },
      });
    } catch {
      // module absent in dev or builds without the PWA plugin
    }
  });

  async function applyUpdate() {
    if (updateSW) await updateSW(true);
  }
</script>

{#if needRefresh}
  <div
    class="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border bg-card p-3 shadow-lg"
  >
    <div class="text-sm">
      <div class="font-medium">Update available</div>
      <div class="text-xs text-muted-foreground">A newer version of the app is ready.</div>
    </div>
    <Button size="sm" onclick={applyUpdate}>Reload</Button>
  </div>
{/if}
