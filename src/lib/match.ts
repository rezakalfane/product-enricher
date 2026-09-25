import { findBySku, findVariantBySku, getProduct, searchProducts, type BCProduct } from './bigcommerce';
import { rankMatches } from './ai';
import type { MatchCandidate, ProposedVariant } from './types';

function imageOf(p: BCProduct): string | null {
  const imgs = p.images ?? [];
  return (imgs.find((i) => i.is_thumbnail) ?? imgs[0])?.url_thumbnail ?? null;
}

function toCandidate(p: BCProduct, score: number, reason: string): MatchCandidate {
  return {
    product_id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    image: imageOf(p),
    url: p.custom_url?.url ?? null,
    score,
    reason,
  };
}

/**
 * Find catalog products that could be the one described in the source.
 * An exact SKU hit short-circuits the model; otherwise we keyword-search the channel
 * and let the model score the shortlist.
 */
export async function findMatches(args: {
  name: string;
  sku: string | null;
  brand: string | null;
  variantHint: string | null;
  searchTerms: string[];
  descriptionForModel: string;
}): Promise<{ candidates: MatchCandidate[]; isNew: boolean }> {
  if (args.sku) {
    const exact = await findBySku(args.sku).catch(() => null);
    if (exact) {
      return { candidates: [toCandidate(exact, 1, `Exact SKU match on ${args.sku}.`)], isNew: false };
    }
    const variant = await findVariantBySku(args.sku).catch(() => null);
    if (variant) {
      const parent = await getProduct(variant.product_id).catch(() => null);
      if (parent) {
        const label = variant.option_values.map((o) => o.label).join(' / ');
        return {
          candidates: [
            {
              ...toCandidate(parent, 1, `Exact variant SKU match on ${args.sku}.`),
              variant_id: variant.id,
              variant_label: label,
            },
          ],
          isNew: false,
        };
      }
    }
  }

  // searchProducts runs at most 6 queries. Specific phrases go first so their hits lead the
  // shortlist, but the brand must make the cut: phrases fail on a single misread word
  // ("OMG" for "0MG"), while the brand alone almost always finds the product family.
  const terms = [
    ...new Set([...args.searchTerms.slice(0, 4), args.brand ?? '', args.name].filter(Boolean)),
  ];
  const pool = await searchProducts(terms);
  if (pool.length === 0) return { candidates: [], isNew: true };

  const shortlist = pool.slice(0, 20);
  const ranked = await rankMatches({
    extracted: args.descriptionForModel,
    candidates: shortlist.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.price })),
  });

  const byId = new Map(shortlist.map((p) => [p.id, p]));
  const candidates = ranked.matches
    .map((m) => {
      const p = byId.get(m.product_id);
      return p ? toCandidate(p, m.score, m.reason) : null;
    })
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.score - a.score);

  // Attach the matching variant when the source named a specific colourway/size.
  if (args.variantHint && candidates[0]) {
    const top = byId.get(candidates[0].product_id);
    const hint = args.variantHint.toLowerCase();
    const v = top?.variants?.find((variant) =>
      variant.option_values.some((o) => hint.includes(o.label.toLowerCase())),
    );
    if (v) {
      candidates[0].variant_id = v.id;
      candidates[0].variant_label = v.option_values.map((o) => o.label).join(' / ');
    }
  }

  return { candidates, isNew: ranked.isNew || (candidates[0]?.score ?? 0) < 0.6 };
}

/** Drop proposed fields whose value already matches what's in BigCommerce. */
export async function pruneUnchangedFields<T extends { name: string; value: string; custom: boolean }>(
  productId: number,
  fields: T[],
): Promise<T[]> {
  const product = await getProduct(productId).catch(() => null);
  if (!product) return fields;
  const custom = new Map((product.custom_fields ?? []).map((f) => [f.name.toLowerCase(), f.value]));
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

  return fields.filter((f) => {
    const existing = f.custom
      ? custom.get(f.name.toLowerCase())
      : (product as unknown as Record<string, unknown>)[f.name];
    if (existing === undefined || existing === null || existing === '') return true;
    return norm(existing) !== norm(f.value);
  });
}

/** Option labels as a comparable key, independent of option order and case. */
export function optionKey(options: { value: string }[]): string {
  return options
    .map((o) => o.value.trim().toLowerCase())
    .sort()
    .join('|');
}

/** Drop proposed variants the product already has, by SKU or by option values. */
export async function pruneExistingVariants(
  productId: number,
  variants: ProposedVariant[],
): Promise<ProposedVariant[]> {
  if (variants.length === 0) return variants;
  const product = await getProduct(productId, 'variants').catch(() => null);
  if (!product) return variants;
  const existing = product.variants ?? [];
  const skus = new Set(existing.map((v) => v.sku.toLowerCase()).filter(Boolean));
  const keys = new Set(
    existing
      .filter((v) => v.option_values.length > 0)
      .map((v) => optionKey(v.option_values.map((o) => ({ value: o.label })))),
  );
  return variants.filter(
    (v) => !(v.sku && skus.has(v.sku.toLowerCase())) && !keys.has(optionKey(v.options)),
  );
}
