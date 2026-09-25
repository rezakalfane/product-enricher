import type { ExtractedPrices } from './ai';
import type { ProposedField } from './types';

/** BigCommerce price fields. Prices come from `prices`, never from the model's free-form fields. */
const PRICE_FIELD_NAMES = new Set(['price', 'cost_price', 'retail_price', 'sale_price']);
const PRICE_LABEL = /\b(price|rrp|msrp|srp|trade|unit cost|cost|wholesale)\b/i;

/** Drop prices the model also reported as ordinary fields, so each price is proposed once. */
export function withoutPriceFields(fields: ProposedField[]): ProposedField[] {
  return fields.filter((f) => !PRICE_FIELD_NAMES.has(f.name) && !PRICE_LABEL.test(f.label));
}

/**
 * The catalog price. The channel is a trade (distribution) channel, so its products are priced
 * at the trade price — the supplier's trade/unit cost, or a price the source didn't label.
 */
export function catalogPrice(prices: ExtractedPrices): number | null {
  return (prices.cost ?? prices.unlabelled)?.value ?? null;
}

const labelled = (p: { label: string; value: number; currency: string | null }) =>
  `"${p.label}" ${p.currency ? `${p.currency} ` : ''}${p.value}`;

/**
 * Map classified prices onto BigCommerce fields: trade/unit cost (or an unlabelled price) →
 * `price`, RRP → `retail_price`. `cost_price` is never written.
 */
export function priceFields(
  prices: ExtractedPrices,
  { isNew }: { isNew: boolean },
): { fields: ProposedField[]; notes: string[] } {
  const fields: ProposedField[] = [];
  const notes: string[] = [];
  const trade = prices.cost ?? prices.unlabelled;

  if (trade) {
    fields.push({
      name: 'price',
      label: 'Price',
      value: String(trade.value),
      custom: false,
      evidence: trade.evidence,
    });
  } else if (isNew) {
    // A new product needs a price; leave an empty field for the reviewer to fill in.
    fields.push({
      name: 'price',
      label: 'Price',
      value: '',
      custom: false,
      evidence: 'Not stated in the source — enter the trade price.',
    });
    notes.push(
      prices.retail
        ? `Only an RRP (${labelled(prices.retail)}) is given — set the trade price before creating.`
        : 'No price in the source — set the trade price before creating.',
    );
  }

  if (prices.retail) {
    fields.push({
      name: 'retail_price',
      label: 'RRP',
      value: String(prices.retail.value),
      custom: false,
      evidence: prices.retail.evidence,
    });
  }

  return { fields, notes };
}
