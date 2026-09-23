import { env } from './env';

export type BCImage = {
  id: number;
  product_id: number;
  url_standard: string;
  url_zoom: string;
  url_thumbnail: string;
  is_thumbnail: boolean;
  sort_order: number;
  description: string;
};

export type BCVariant = {
  id: number;
  product_id: number;
  sku: string;
  price: number | null;
  image_url: string;
  option_values: { id: number; label: string; option_id: number; option_display_name: string }[];
};

export type BCProduct = {
  id: number;
  name: string;
  sku: string;
  type: string;
  description: string;
  price: number;
  weight: number;
  brand_id?: number;
  categories?: number[];
  custom_url?: { url: string };
  images?: BCImage[];
  variants?: BCVariant[];
  custom_fields?: { id?: number; name: string; value: string }[];
};

type Query = Record<string, string | number | boolean | undefined>;

function url(path: string, query: Query = {}) {
  const u = new URL(`${env.apiUrl}/stores/${env.storeHash}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function bc<T>(
  path: string,
  { query, method = 'GET', body }: { query?: Query; method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url(path, query), {
    method,
    headers: {
      'X-Auth-Token': env.accessToken,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BigCommerce ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data?: T } & T;
  return (json.data ?? json) as T;
}

/** Product IDs assigned to the configured channel. Cached for the life of the server process. */
let channelIdsCache: { ids: Set<number>; at: number } | null = null;

export async function channelProductIds(force = false): Promise<Set<number>> {
  if (!force && channelIdsCache && Date.now() - channelIdsCache.at < 5 * 60_000) {
    return channelIdsCache.ids;
  }
  const ids = new Set<number>();
  for (let page = 1; page <= 50; page++) {
    const data = await bc<{ product_id: number }[]>('/v3/catalog/products/channel-assignments', {
      query: { 'channel_id:in': env.channelId, limit: 250, page },
    });
    data.forEach((a) => ids.add(a.product_id));
    if (data.length < 250) break;
  }
  channelIdsCache = { ids, at: Date.now() };
  return ids;
}

export async function getProduct(id: number, include = 'images,variants,custom_fields') {
  return bc<BCProduct>(`/v3/catalog/products/${id}`, { query: { include } });
}

/**
 * Keyword search across the channel's products. BigCommerce `keyword` covers name/sku/description,
 * so we issue one request per distinct term and merge, rather than relying on a single long query
 * string that would match nothing.
 */
export async function searchProducts(terms: string[], limit = 25): Promise<BCProduct[]> {
  const seen = new Map<number, BCProduct>();
  const inChannel = await channelProductIds();
  const queries = terms.map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 6);

  for (const keyword of queries) {
    let data: BCProduct[] = [];
    try {
      data = await bc<BCProduct[]>('/v3/catalog/products', {
        query: { keyword, limit, include: 'images,variants', include_fields: '' },
      });
    } catch {
      continue;
    }
    for (const p of data) {
      if (inChannel.size && !inChannel.has(p.id)) continue;
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
  }
  return [...seen.values()];
}

export async function findBySku(sku: string): Promise<BCProduct | null> {
  const data = await bc<BCProduct[]>('/v3/catalog/products', {
    query: { 'sku:in': sku, limit: 5, include: 'images,variants' },
  });
  return data[0] ?? null;
}

export async function findVariantBySku(sku: string): Promise<BCVariant | null> {
  const data = await bc<BCVariant[]>('/v3/catalog/variants', { query: { sku, limit: 5 } });
  return data[0] ?? null;
}
