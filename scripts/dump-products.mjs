/** Dump channel products to fixtures/catalog-sample.json so document generation can cite real items. */
import { writeFileSync } from 'node:fs';
import { bc, channelProductIds, chunk } from './bc.mjs';

const ids = await channelProductIds();
const out = [];
for (const group of chunk(ids, 50)) {
  const rows = await bc('/v3/catalog/products', {
    query: { 'id:in': group.join(','), limit: 50, include: 'variants' },
  });
  out.push(
    ...rows.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      weight: p.weight,
      mpn: p.mpn,
      variants: (p.variants ?? []).map((v) => ({
        sku: v.sku,
        label: v.option_values.map((o) => o.label).join(' / '),
      })),
    })),
  );
}
writeFileSync('fixtures/catalog-sample.json', JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} products → fixtures/catalog-sample.json`);
