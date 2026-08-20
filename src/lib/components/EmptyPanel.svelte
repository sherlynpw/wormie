<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { id, title, message }: { id: string; title: string; message: string } = $props();
</script>

<Card {id} class="border-dashed bg-muted/20 shadow-none">
  <CardHeader class="pb-2">
    <CardTitle class="text-base text-muted-foreground">{title}</CardTitle>
  </CardHeader>
  <CardContent class="pt-0 text-sm text-muted-foreground">{message}</CardContent>
</Card>
