import { all, one, type QueueAction } from './db';
import { deleteUpload, listUploads } from './storage';
import type { ActionPayload } from './types';

/**
 * Uploaded files are kept only while they are still needed.
 *
 * A packshot destined for BigCommerce is the payload of its action, so it has to survive
 * until that action is applied — but no longer. Everything else (document text, transcribed
 * photos) is discarded during analysis and never reaches storage in the first place.
 */
function imageKeyOf(row: Pick<QueueAction, 'payload'>): string | null {
  try {
    return (JSON.parse(row.payload) as ActionPayload).image?.path ?? null;
  } catch {
    return null;
  }
}

/** Drop the upload belonging to a single action, once it is resolved. */
export async function releaseActionUpload(id: string): Promise<void> {
  const row = await one<QueueAction>('SELECT payload FROM actions WHERE id = ?', [id]);
  if (!row) return;
  const key = imageKeyOf(row);
  if (key) await deleteUpload(key);
}

/** Drop the uploads belonging to every action matching a set of ids. */
export async function releaseUploads(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all<QueueAction>(
    `SELECT payload FROM actions WHERE id IN (${placeholders})`,
    ids,
  );
  await Promise.all(
    rows.map((r) => {
      const key = imageKeyOf(r);
      return key ? deleteUpload(key) : Promise.resolve();
    }),
  );
}

/** Drop every upload still referenced by the queue — used when the queue is cleared. */
export async function releaseAllUploads(): Promise<void> {
  const rows = await all<QueueAction>('SELECT payload FROM actions');
  await Promise.all(
    rows.map((r) => {
      const key = imageKeyOf(r);
      return key ? deleteUpload(key) : Promise.resolve();
    }),
  );
}

/**
 * Delete stored files that no action refers to any more — the residue of a crash, or of a
 * job that died before its action was written. Cheap enough to run after every analysis.
 */
export async function sweepOrphanedUploads(): Promise<number> {
  const [stored, rows] = await Promise.all([
    listUploads(),
    all<QueueAction>('SELECT payload FROM actions'),
  ]);
  const referenced = new Set(
    rows.map(imageKeyOf).filter((k): k is string => k !== null),
  );
  const orphans = stored.filter((key) => !referenced.has(key));
  await Promise.all(orphans.map((key) => deleteUpload(key)));
  return orphans.length;
}
