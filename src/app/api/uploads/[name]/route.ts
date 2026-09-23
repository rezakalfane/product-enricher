import { getUpload } from '@/lib/storage';

export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
};

/**
 * Serve an uploaded image back to the review modal.
 * Blobs are private, so this proxies the bytes in both modes rather than exposing a CDN URL.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  try {
    const buf = await getUpload(name);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
