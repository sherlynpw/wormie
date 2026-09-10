// The paper has to state the testbed, so the harness records it rather than
// leaving it to be typed by hand from whatever machine happened to run.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

export function hostInfo() {
  const sysctl = (k) => {
    try {
      return execFileSync('sysctl', ['-n', k], { encoding: 'utf8' }).trim();
    } catch {
      return null; // non-Darwin, or sysctl unavailable
    }
  };
  const cpus = os.cpus();
  return {
    cpu: sysctl('machdep.cpu.brand_string') ?? cpus[0]?.model ?? null,
    physicalCores: Number(sysctl('hw.physicalcpu')) || null,
    logicalCores: cpus.length,
    memoryBytes: os.totalmem(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
  };
}
