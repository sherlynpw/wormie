// Analysis sessions: serializable snapshots of a tool's inputs + params, stored as a
// 'session' Dataset (body is JSON). Inputs are inlined as text (not dataset refs) so the
// session is self-contained even if source datasets are later deleted.

import { datasets } from '$lib/stores/datasets.svelte';
import { resolve } from '$app/paths';

export type SessionTool = 'enrichment' | 'gsea' | 'gmt';

export interface Session {
  v: 1;
  tool: SessionTool;
  inputs: Record<string, string>;
  params: Record<string, unknown>;
  // Optional result snapshot. Per-tool shape; consumers cast as needed.
  // Omitting keeps the session config-only.
  results?: Record<string, unknown>;
}

export function encodeSession(s: Session): string {
  return JSON.stringify(s);
}

export function decodeSession(body: string): Session | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed && parsed.v === 1 && typeof parsed.tool === 'string') return parsed as Session;
  } catch {
    /* fall through */
  }
  return null;
}

export async function saveSession(
  name: string,
  session: Session,
  metaExtra?: Record<string, unknown>,
) {
  const body = encodeSession(session);
  // Compact meta lets the datasets list show a summary without parsing the body.
  const inputSizes: Record<string, number> = {};
  for (const [k, v] of Object.entries(session.inputs)) inputSizes[k] = v.length;
  return datasets.add({
    name,
    type: 'session',
    body,
    meta: {
      tool: session.tool,
      inputSizes,
      hasResults: !!session.results,
      bodySize: body.length,
      ...(metaExtra ?? {}),
    },
  });
}

export function sessionToolPath(tool: SessionTool): string {
  switch (tool) {
    case 'enrichment':
      return resolve('/enrichment');
    case 'gsea':
      return resolve('/gsea');
    case 'gmt':
      return resolve('/gmt');
  }
}

export function sessionToolLabel(tool: SessionTool): string {
  switch (tool) {
    case 'enrichment':
      return 'Over-representation';
    case 'gsea':
      return 'Ranked-list enrichment';
    case 'gmt':
      return 'Custom gene set testing';
  }
}
