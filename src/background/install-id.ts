import { getItem, setItem } from '@/storage/storage';

/** This install's random id, made on first use (see `installId` in storage/schema.ts). Not tied to anyone. */
export async function installId(): Promise<string> {
  const existing = await getItem('installId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setItem('installId', id);
  return id;
}
