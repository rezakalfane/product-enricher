import type { ExtractedPrices } from './ai';
import type { ProposedField } from './types';

/** BigCommerce price fields. Prices come from `prices`, never from the model's free-form fields. */
const PRICE_FIELD_NAMES = new Set(['price', 'cost_price', 'retail_price', 'sale_price']);
const PRICE_LABEL = /\b(price|rrp|msrp|srp|trade|unit cost|cost|wholesale)\b/i;

/** Drop prices the model also reported as ordinary fields, so each price is proposed once. */
export function withoutPriceFields(fields: ProposedField[]): ProposedField[] {
  return fields.filter((f) => !PRICE_FIELD_NAMES.has(f.name) && !PRICE_LABEL.test(f.label));
}

/** The price shoppers pay: the RRP when given, else a price the source didn't label. */
export function sellingPrice(prices: ExtractedPrices): number | null {
  return (prices.retail ?? prices.unlabelled)?.value ?? null;
}

const labelled = (p: { label: string; value: number; currency: string | null }) =>
  `"${p.label}" ${p.currency ? `${p.currency} ` : ''}${p.value}`;

/**
 * Map classified prices onto BigCommerce fields: trade/unit cost → `cost_price`, RRP →
 * `retail_price` and the selling `price`. On an existing product the selling price is proposed
 * switched off, so an RRP doesn't silently replace the store's own pricing.
 */
export function priceFields(
  prices: ExtractedPrices,
  { isNew }: { isNew: boolean },
): { fields: ProposedField[]; notes: string[] } {
  const fields: ProposedField[] = [];
  const notes: string[] = [];
  const { cost, retail, unlabelled } = prices;

  if (cost) {
    fields.push({
      name: 'cost_price',
      label: 'Cost price',
      value: String(cost.value),
      custom: false,
      evidence: cost.evidence,
    });
  }
  if (retail) {
    fields.push({
      name: 'retail_price',
      label: 'RRP',
      value: String(retail.value),
      custom: false,
      evidence: retail.evidence,
    });
  }

  const selling = retail ?? unlabelled;
  if (selling) {
    fields.push({
      name: 'price',
      label: 'Price',
      value: String(selling.value),
      custom: false,
      evidence: selling.evidence,
      disabled: !isNew,
    });
    if (!retail) {
      notes.push(
        `The source doesn't say what kind of price ${labelled(selling)} is — it's proposed as ` +
          'the selling price. Check it isn’t a trade cost.',
      );
    }
    if (!isNew) {
      notes.push(`Selling price from ${labelled(selling)} is switched off — turn it on to replace the current price.`);
    }
  } else if (isNew) {
    // A new product needs a selling price; leave an empty field for the reviewer to fill in.
    fields.push({
      name: 'price',
      label: 'Price',
      value: '',
      custom: false,
      evidence: 'Not stated in the source — enter the selling price.',
    });
    notes.push(
      cost
        ? `Only a cost price (${labelled(cost)}) is given — set a selling price before creating.`
        : 'No price in the source — set a selling price before creating.',
    );
  }

  return { fields, notes };
}
