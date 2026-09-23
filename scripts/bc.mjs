/** Shared BigCommerce helpers for the fixture scripts. Run with `node --env-file=.env.local`. */
const HASH = process.env.BIGCOMMERCE_STORE_HASH;
const TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const BASE = `${process.env.BIGCOMMERCE_API_URL ?? 'https://api.bigcommerce.com'}/stores/${HASH}`;
export const CHANNEL_ID = Number(process.env.BIGCOMMERCE_CHANNEL_ID ?? 1);

if (!HASH || !TOKEN) throw new Error('Missing BIGCOMMERCE_STORE_HASH / BIGCOMMERCE_ACCESS_TOKEN.');

export async function bc(path, { method = 'GET', body, query = {} } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      'X-Auth-Token': TOKEN,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (res.status === 204) return null;
  const json = await res.json();
  return json.data ?? json;
}

/** Every product id assigned to the configured channel. */
export async function channelProductIds() {
  const ids = [];
  for (let page = 1; page <= 40; page++) {
    const rows = await bc('/v3/catalog/products/channel-assignments', {
      query: { 'channel_id:in': CHANNEL_ID, limit: 250, page },
    });
    ids.push(...rows.map((r) => r.product_id));
    if (rows.length < 250) break;
  }
  return [...new Set(ids)];
}

export const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
