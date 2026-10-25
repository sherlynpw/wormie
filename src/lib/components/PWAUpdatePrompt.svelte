<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';

  let needRefresh = $state(false);

  onMount(async () => {
    // virtual:pwa-register is injected by vite-plugin-pwa at build time; absent in dev.
    try {
      const mod = await import(/* @vite-ignore */ 'virtual:pwa-register');
      mod.registerSW({
        immediate: true,
        onNeedRefresh() {
          needRefresh = true;
        },
        onRegisteredSW(_url, registration) {
          // A tab left open would otherwise never look for a new app version.
          if (registration)
            setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
        },
        onOfflineReady() {
          // could show a toast here
        },
      });
    } catch {
      // module absent in dev or builds without the PWA plugin
    }
  });

  // The plugin reloads only when a page that was already controlled changes worker.
  // A first visit or a hard reload is uncontrolled, so the click activated the new
  // worker and left the page on the old code. Reload once it is active, whatever the page was.
  async function applyUpdate() {
    const waiting = (await navigator.serviceWorker?.getRegistration())?.waiting;
    if (!waiting) {
      location.reload();
      return;
    }
    waiting.addEventListener('statechange', () => {
      if (waiting.state === 'activated') location.reload();
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
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
