// Lazy worker pool for parallel contrast extraction. Each member is a WebR instance
// with the fitted dds blob loaded. Spawning costs ~15-20s per worker (bundle mount + library +
// readRDS), so workers are started lazily on the first `runAll()` call.

import { createWebRInstance, type WebRInstance } from './webr-instance';
import { loadDdsBlob, runContrast } from './extract';
import type { ContrastSpec, DESeq2Contrast, Shrinkage } from './types';

interface PoolMember {
  webR: WebRInstance;
  /** Resolves once this worker has its dds loaded and is ready for runContrast. */
  ready: Promise<void>;
  /** Index of the contrast this worker is currently processing, or null. */
  busy: number | null;
}

export interface PoolOptions {
  /** Max workers. Defaults to navigator.hardwareConcurrency capped at 4. */
  size?: number;
  /** Forwarded to each worker for stdout/stderr surfacing. */
  onLine?: (s: string) => void;
  /** FDR target for results() independent filtering. Defaults to 0.05. */
  alpha?: number;
}

export class ContrastPool {
  private members: PoolMember[] = [];
  private ddsBlob: Uint8Array;
  private reference: string;
  private size: number;
  private onLine?: (s: string) => void;
  private alpha: number;

  constructor(ddsBlob: Uint8Array, reference: string, opts: PoolOptions = {}) {
    this.ddsBlob = ddsBlob;
    this.reference = reference;
    this.onLine = opts.onLine;
    this.alpha = opts.alpha ?? 0.05;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const requested = opts.size ?? 4;
    this.size = Math.max(1, Math.min(requested, cores));
  }

  /** Spawn all workers in parallel. */
  private async ensureMembers(): Promise<PoolMember[]> {
    if (this.members.length === 0) {
      this.onLine?.(`[pool] spawning ${this.size} worker(s) ...`);
      const ddsBlobCopy = this.ddsBlob;
      this.members = await Promise.all(
        Array.from({ length: this.size }, async (_, i) => {
          const lineForMember = (s: string) =>
            this.onLine?.(`[w${i + 1}] ${s.replace(/^\[R\] /, '')}`);
          const webR = await createWebRInstance({ onLine: lineForMember });
          await loadDdsBlob(webR, ddsBlobCopy);
          return { webR, ready: Promise.resolve(), busy: null };
        }),
      );
      this.onLine?.(`[pool] ${this.members.length} worker(s) ready`);
    }
    return this.members;
  }

  /**
   * Distribute pairs across workers: each picks up the next pending pair on
   * completion (slow contrasts don't block fast workers). Returns results in input order.
   */
  async runAll(
    pairs: ContrastSpec[],
    shrinkage: Shrinkage,
    onContrast?: (i: number, c: DESeq2Contrast) => void,
  ): Promise<DESeq2Contrast[]> {
    const members = await this.ensureMembers();
    const results = new Array<DESeq2Contrast | null>(pairs.length).fill(null);
    let nextIdx = 0;
    let done = 0;
    const total = pairs.length;
    const workOne = async (member: PoolMember, idx: number) => {
      for (;;) {
        const i = nextIdx++;
        if (i >= pairs.length) return;
        member.busy = i;
        const pair = pairs[i];
        const name = `${pair.treatment}_vs_${pair.reference}`;
        this.onLine?.(`[w${idx + 1}] start ${name} (${i + 1}/${total})`);
        const c = await runContrast(member.webR, pair, shrinkage, this.reference, this.alpha);
        results[i] = c;
        member.busy = null;
        done++;
        this.onLine?.(`[w${idx + 1}] done  ${name} [${c.shrinkage}] (${done}/${total})`);
        if (c.shrinkError)
          this.onLine?.(`[w${idx + 1}] shrinkage failed for ${name}: ${c.shrinkError}`);
        onContrast?.(i, c);
      }
    };
    await Promise.all(members.map((m, idx) => workOne(m, idx)));
    return results as DESeq2Contrast[];
  }

  /** Tear down all pool workers and release their R sessions. */
  async dispose(): Promise<void> {
    if (this.members.length === 0) return;
    this.onLine?.(`[pool] disposing ${this.members.length} worker(s)`);
    for (const m of this.members) {
      try {
        m.webR.close();
      } catch {
        /* */
      }
    }
    this.members = [];
  }
}
