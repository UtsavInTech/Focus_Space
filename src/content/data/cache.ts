/**
 * In-memory request cache with TTL and in-flight de-duplication: two
 * components asking for the same playlist share one request.
 */
const memory = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((err: unknown) => {
    memory.delete(key);
    throw err;
  });
  memory.set(key, { at: Date.now(), value });
  if (memory.size > 300) memory.delete(memory.keys().next().value as string);
  return value;
}
