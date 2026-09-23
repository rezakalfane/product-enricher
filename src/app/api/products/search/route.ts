import { NextResponse } from 'next/server';
import { searchProducts } from '@/lib/bigcommerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Manual product lookup, used by the "pick a different product" search in the review modal. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json({ products: [] });

  try {
    const products = await searchProducts([q], 20);
    return NextResponse.json({
      products: products.slice(0, 20).map((p) => ({
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        image: p.images?.[0]?.url_thumbnail ?? null,
        variants: (p.variants ?? []).map((v) => ({
          id: v.id,
          label: v.option_values.map((o) => o.label).join(' / ') || v.sku,
        })),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed.' },
      { status: 500 },
    );
  }
}
