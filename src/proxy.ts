import { NextResponse, type NextRequest } from 'next/server';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The app has no authentication, so it must not be reachable through a tunnel. Requests
 * addressed to any host other than this machine (e.g. a trycloudflare.com URL) may only reach
 * the channel ingest endpoint, which checks its own shared secret.
 *
 * Not applied on Vercel, where the deployment's own domain is the normal way in and access is
 * governed by Deployment Protection instead.
 */
export function proxy(request: NextRequest) {
  if (process.env.VERCEL) return NextResponse.next();
  const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  if (LOCAL_HOSTS.has(host)) return NextResponse.next();
  if (request.nextUrl.pathname === '/api/ingest') return NextResponse.next();
  return new NextResponse('Not found', { status: 404 });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
