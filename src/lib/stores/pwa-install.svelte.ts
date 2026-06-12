// Captures BeforeInstallPromptEvent and exposes an install store.
// Chromium-family only; Safari/iOS does not fire this event.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class PwaInstallStore {
  available = $state(false);
  installing = $state(false);
  private deferredEvent: BeforeInstallPromptEvent | null = null;

  init() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredEvent = e as BeforeInstallPromptEvent;
      this.available = true;
    });
    window.addEventListener('appinstalled', () => {
      this.deferredEvent = null;
      this.available = false;
    });
  }

  async install() {
    const e = this.deferredEvent;
    if (!e) return;
    this.installing = true;
    try {
      await e.prompt();
      await e.userChoice;
    } finally {
      this.installing = false;
      this.deferredEvent = null;
      this.available = false;
    }
  }
}

export const pwaInstall = new PwaInstallStore();
