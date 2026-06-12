<script lang="ts">
  import { theme } from '$lib/stores/theme.svelte';
  import { Button } from '$lib/components/ui/button';
  import Sun from 'lucide-svelte/icons/sun';
  import Moon from 'lucide-svelte/icons/moon';
</script>

<Button
  variant="ghost"
  size="icon"
  onclick={() => theme.toggle()}
  aria-label="Toggle color theme"
  title="Toggle theme ({theme.mode === 'dark' ? 'dark' : 'light'})"
>
  {#if theme.mode === 'dark'}
    <Sun />
  {:else}
    <Moon />
  {/if}
</Button>
