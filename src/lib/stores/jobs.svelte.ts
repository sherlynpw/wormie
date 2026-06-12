// Global background job tracker for the JobOverlay (enrichment, GSEA, etc.).

export interface Job {
  id: string;
  label: string; // user-facing title, e.g. "GSEA · GO"
  phase: string; // latest phase string, e.g. "Permutations (1000/bucket)"
  current?: number;
  total?: number;
  startedAt: number;
  error?: string;
}

class JobStore {
  jobs = $state<Job[]>([]);

  start(id: string, label: string) {
    this.jobs = [
      ...this.jobs.filter((j) => j.id !== id),
      { id, label, phase: 'Starting...', startedAt: Date.now() },
    ];
  }

  update(id: string, phase: string, current?: number, total?: number) {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, phase, current, total } : j));
  }

  finish(id: string) {
    this.jobs = this.jobs.filter((j) => j.id !== id);
  }

  fail(id: string, error: string) {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, error, phase: 'Failed' } : j));
    setTimeout(() => this.finish(id), 6000);
  }
}

export const jobs = new JobStore();
