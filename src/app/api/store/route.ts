import { NextResponse } from 'next/server';
import { bc, channelProductIds } from '@/lib/bigcommerce';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Connection banner data: store name, channel, and how many products are in scope. */
export async function GET() {
  try {
    const store = await bc<{ name: string; domain: string }>('/v2/store');
    const ids = await channelProductIds();
    return NextResponse.json({
      connected: true,
      storeName: store.name,
      storeHash: env.storeHash,
      channelName: env.channelName,
      channelId: env.channelId,
      productCount: ids.size,
      model: env.model,
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      error: err instanceof Error ? err.message : 'Could not reach BigCommerce.',
      channelName: env.channelName,
      model: env.model,
    });
  }
}
