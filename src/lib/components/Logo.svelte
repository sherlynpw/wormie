<script lang="ts">
  type Props = {
    class?: string;
    title?: string;
  };
  let { class: className = '', title = 'wormie.bio' }: Props = $props();
</script>

<svg
  viewBox="0 0 132 48"
  xmlns="http://www.w3.org/2000/svg"
  class={className}
  role="img"
  aria-label={title}
>
  <title>{title}</title>

  <defs>
    <linearGradient id="wb-logo-body" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" class="[stop-color:hsl(var(--primary)/0.95)]" />
      <stop offset="1" class="[stop-color:hsl(var(--primary))]" />
    </linearGradient>
  </defs>

  <!-- worm body: S-curve, thick rounded stroke -->
  <path
    d="M 10 30 C 26 14, 46 42, 66 26 S 90 14, 100 22"
    stroke="url(#wb-logo-body)"
    stroke-width="11"
    stroke-linecap="round"
    fill="none"
  />

  <!-- tail taper -->
  <circle cx="7" cy="31.5" r="2.6" class="fill-primary" />
  <circle cx="4.5" cy="32.5" r="1.3" class="fill-primary" />

  <!-- cuticle annulations: transverse rings across body -->
  <path
    d="M 10 30 C 26 14, 46 42, 66 26 S 90 14, 100 22"
    class="stroke-primary-foreground"
    stroke-width="11"
    stroke-dasharray="1.6 5"
    stroke-dashoffset="3"
    fill="none"
    opacity="0.7"
  />

  <!-- pirate cutlass, brandished above the body -->
  <g transform="translate(32 38) rotate(-50)">
    <!-- blade -->
    <rect
      x="0"
      y="-1.6"
      width="34"
      height="3.2"
      rx="1.6"
      fill="#E5E7EB"
      class="stroke-foreground"
      stroke-width="0.6"
    />
    <!-- subtle fuller line along the blade -->
    <line x1="2" y1="0" x2="31" y2="0" stroke="#9AA0A6" stroke-width="0.5" stroke-linecap="round" />
    <!-- guard (crossbar) -->
    <rect x="-1.6" y="-6" width="3.2" height="12" rx="1" class="fill-foreground" />
    <!-- grip -->
    <rect x="-7" y="-1.5" width="6" height="3" rx="0.8" class="fill-foreground" />
    <!-- pommel -->
    <circle cx="-8.5" cy="0" r="1.7" class="fill-foreground" />
  </g>

  <!-- head bulge -->
  <circle cx="102" cy="22" r="9" fill="url(#wb-logo-body)" />

  <!-- cheeky cheek -->
  <circle cx="98.5" cy="26" r="1.3" class="fill-primary-foreground/25" />

  <!-- eyepatch strap -->
  <path
    d="M 92 19.5 Q 102 17 111 21"
    class="stroke-foreground"
    stroke-width="1"
    fill="none"
    stroke-linecap="round"
  />
  <!-- eyepatch -->
  <rect x="97" y="18.5" width="5" height="4.2" rx="0.9" class="fill-foreground" />

  <!-- good eye -->
  <circle cx="106" cy="22" r="2" class="fill-background" />
  <circle cx="106.5" cy="22.3" r="1.1" class="fill-foreground" />
  <circle cx="106.8" cy="21.9" r="0.4" class="fill-background" />

  <!-- tiny smile -->
  <path
    d="M 103.5 26.5 Q 105.5 28 107.8 26.8"
    class="stroke-foreground"
    stroke-width="0.9"
    fill="none"
    stroke-linecap="round"
  />

  <!-- pirate tricorn hat -->
  <g class="fill-foreground">
    <path d="M 86 14 Q 102 -2 118 14 Q 110 11 102 11 Q 94 11 86 14 Z" />
    <ellipse cx="102" cy="14" rx="15" ry="2.2" />
  </g>

  <!-- skull & crossbones on hat -->
  <g class="fill-background">
    <circle cx="102" cy="9.5" r="2" />
    <rect x="101.1" y="11" width="1.8" height="1.3" rx="0.25" />
    <!-- crossbones -->
    <rect x="99" y="12.3" width="6" height="0.7" rx="0.3" transform="rotate(20 102 12.6)" />
    <rect x="99" y="12.3" width="6" height="0.7" rx="0.3" transform="rotate(-20 102 12.6)" />
  </g>
  <g class="fill-foreground">
    <circle cx="101.2" cy="9.3" r="0.45" />
    <circle cx="102.8" cy="9.3" r="0.45" />
  </g>
</svg>
