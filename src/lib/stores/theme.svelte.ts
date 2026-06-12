type Mode = 'light' | 'dark';

class ThemeStore {
  mode = $state<Mode>('light');

  init() {
    if (typeof document === 'undefined') return;
    const stored = localStorage.getItem('theme') as Mode | null;
    const initial: Mode =
      stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.mode = initial;
    this.apply();
  }

  toggle() {
    this.mode = this.mode === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', this.mode);
    this.apply();
  }

  private apply() {
    document.documentElement.classList.toggle('dark', this.mode === 'dark');
  }
}

export const theme = new ThemeStore();
