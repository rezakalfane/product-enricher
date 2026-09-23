import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { env } from './env';

/**
 * Uploaded source images.
 *
 * Vercel's filesystem is ephemeral and not shared between function instances, so on Vercel
 * these live in Blob. Locally (no BLOB_READ_WRITE_TOKEN) they stay on disk, which keeps dev
 * self-contained. A stored file is identified by an opaque `key` either way.
 *
 * Blobs are private: nothing needs a public URL, since apply.ts sends bytes to BigCommerce and
 * the review modal reads through /api/uploads.
 */
export type StoredFile = { key: string; filename: string };

const blobEnabled = () => Boolean(env.blobToken);
// basename() keeps a crafted key from escaping uploads/, in Blob as on disk.
const blobPath = (key: string) => `uploads/${basename(key)}`;

export async function putUpload(key: string, body: Buffer, mime: string): Promise<void> {
  if (blobEnabled()) {
    const { put } = await import('@vercel/blob');
    await put(blobPath(key), body, {
      access: 'private',
      token: env.blobToken,
      contentType: mime,
      // Keys are already prefixed with a job id, so keep them stable and predictable.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  mkdirSync(env.uploadDir, { recursive: true });
  writeFileSync(join(env.uploadDir, basename(key)), body);
}

export async function getUpload(key: string): Promise<Buffer> {
  if (blobEnabled()) {
    const { get } = await import('@vercel/blob');
    const res = await get(blobPath(key), { access: 'private', token: env.blobToken });
    if (!res || res.statusCode !== 200) throw new Error(`Could not read upload ${key}.`);
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  }
  // basename() keeps a crafted key from escaping the upload directory.
  return readFileSync(join(env.uploadDir, basename(key)));
}

/** Every upload key currently in storage. */
export async function listUploads(): Promise<string[]> {
  if (blobEnabled()) {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'uploads/', token: env.blobToken });
    return blobs.map((b) => b.pathname.replace(/^uploads\//, ''));
  }
  try {
    return readdirSync(env.uploadDir);
  } catch {
    return [];
  }
}

/** Remove a stored upload. Safe to call for a key that is already gone. */
export async function deleteUpload(key: string): Promise<void> {
  try {
    if (blobEnabled()) {
      const { del } = await import('@vercel/blob');
      await del(blobPath(key), { token: env.blobToken });
      return;
    }
    rmSync(join(env.uploadDir, basename(key)), { force: true });
  } catch {
    // Already deleted, or never written — nothing to do.
  }
}
