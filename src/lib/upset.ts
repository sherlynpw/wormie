// Compute UpSet-style intersections for N labeled sets. Each combo is an inclusion pattern;
// members belong to exactly the sets in that pattern. Empty combos are dropped.

export interface UpSetInput {
  label: string;
  members: Iterable<string>;
}

export interface UpSetCombo {
  mask: number; // 1-bit per input set, LSB = sets[0]; stable key.
  indices: number[]; // Included set indices, sorted asc.
  size: number;
  members: string[];
}

export interface UpSetData {
  sets: { label: string; size: number }[];
  combos: UpSetCombo[];
}

export function computeUpSet(inputs: UpSetInput[]): UpSetData {
  const sets = inputs.map((s) => {
    const members = new Set<string>();
    for (const m of s.members) members.add(m);
    return { label: s.label, members };
  });

  // Map each element to a bitmask of containing sets (single union pass).
  const elementMask = new Map<string, number>();
  for (let i = 0; i < sets.length; i++) {
    const bit = 1 << i;
    for (const el of sets[i].members) {
      elementMask.set(el, (elementMask.get(el) ?? 0) | bit);
    }
  }

  const byMask = new Map<number, string[]>();
  for (const [el, mask] of elementMask) {
    if (mask === 0) continue;
    const list = byMask.get(mask);
    if (list) list.push(el);
    else byMask.set(mask, [el]);
  }

  const combos: UpSetCombo[] = [];
  for (const [mask, members] of byMask) {
    const indices: number[] = [];
    for (let i = 0; i < sets.length; i++) {
      if (mask & (1 << i)) indices.push(i);
    }
    members.sort();
    combos.push({ mask, indices, size: members.length, members });
  }

  // Sort by size desc, then degree asc (large shared combos first).
  combos.sort((a, b) => b.size - a.size || a.indices.length - b.indices.length);

  return {
    sets: sets.map((s) => ({ label: s.label, size: s.members.size })),
    combos,
  };
}
