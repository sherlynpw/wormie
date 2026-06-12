const DB_CACHE = 'wormie-sqlite';
const RECOVERY_FLAG = 'sw-recovery-attempted';

export async function recoverFromStaleServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    if (sessionStorage.getItem(RECOVERY_FLAG)) return;
    sessionStorage.setItem(RECOVERY_FLAG, '1');
  } catch {
    return; // sessionStorage unavailable: bail rather than risk a reload loop
  }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== DB_CACHE).map((k) => caches.delete(k)));
    }
  } catch {
    /* best effort; reload anyway */
  }
  location.reload();
}
