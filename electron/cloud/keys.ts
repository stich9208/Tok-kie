export interface ManagementApiKey {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly api_key?: unknown;
  readonly key?: unknown;
}

const PUBLIC_NAMES = new Set(['anon', 'publishable', 'publishable_key']);
const FORBIDDEN_MARKERS = ['service_role', 'service-role', 'secret', 'private'];

export function assertPublicDataPlaneKey(key: string): string {
  if (key.length < 20 || /\s/.test(key)) throw new Error('Invalid publishable/anon key');
  if (key.startsWith('sb_publishable_')) return key;
  if (key.startsWith('eyJ')) {
    try {
      const segments = key.split('.');
      const claims = JSON.parse(Buffer.from(segments[1] ?? '', 'base64url').toString('utf8')) as { role?: unknown };
      if (segments.length === 3 && claims.role === 'anon') return key;
    } catch {
      // Fall through to the single generic error to avoid leaking parser detail.
    }
  }
  throw new Error('Invalid publishable/anon key');
}

/** Never falls back to an unclassified key, service-role key, or secret key. */
export function selectPublishableKey(entries: readonly ManagementApiKey[]): string {
  const candidates = entries.flatMap((entry) => {
    const name = typeof entry.name === 'string' ? entry.name.toLowerCase() : '';
    const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
    const classification = type || name;
    if (FORBIDDEN_MARKERS.some((marker) => name.includes(marker) || type.includes(marker))) return [];
    if (!PUBLIC_NAMES.has(classification) && !PUBLIC_NAMES.has(name)) return [];
    const value = typeof entry.api_key === 'string' ? entry.api_key :
      typeof entry.key === 'string' ? entry.key : '';
    try {
      return [{ value: assertPublicDataPlaneKey(value), priority: classification === 'publishable' ? 0 : 1 }];
    } catch {
      return [];
    }
  });
  if (!candidates.length) throw new Error('Project has no publishable/anon API key');
  const bestPriority = Math.min(...candidates.map((candidate) => candidate.priority));
  const best = [...new Set(candidates.filter((candidate) => candidate.priority === bestPriority)
    .map((candidate) => candidate.value))];
  if (best.length !== 1) throw new Error('Project API key response is ambiguous');
  return best[0];
}
