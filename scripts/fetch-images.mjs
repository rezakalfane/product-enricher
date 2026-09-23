/**
 * Download one primary image from each of 50 channel products into fixtures/images/,
 * writing a manifest that the strip script consumes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bc, channelProductIds, chunk } from './bc.mjs';

const OUT = 'fixtures/images';
const TARGET = Number(process.argv[2] ?? 50);

const ids = await channelProductIds();
console.log(`Channel has ${ids.length} products.`);

const products = [];
for (const group of chunk(ids, 50)) {
  const rows = await bc('/v3/catalog/products', {
    query: { 'id:in': group.join(','), limit: 50, include: 'images' },
  });
  products.push(...rows);
}

const withImages = products.filter((p) => (p.images ?? []).length > 0);
console.log(`${withImages.length} of them have at least one image.`);

mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const p of withImages.slice(0, TARGET)) {
  const img = p.images.find((i) => i.is_thumbnail) ?? p.images[0];
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const ext = (img.url_zoom.split('?')[0].split('.').pop() ?? 'jpg').toLowerCase();
  const filename = `${slug}.${ext.length <= 4 ? ext : 'jpg'}`;

  const res = await fetch(img.url_zoom);
  if (!res.ok) {
    console.warn(`  ! skipped ${p.name} (${res.status})`);
    continue;
  }
  writeFileSync(join(OUT, filename), Buffer.from(await res.arrayBuffer()));

  manifest.push({
    product_id: p.id,
    product_name: p.name,
    sku: p.sku,
    image_id: img.id,
    image_url: img.url_zoom,
    is_thumbnail: img.is_thumbnail,
    sort_order: img.sort_order,
    description: img.description,
    total_images: p.images.length,
    file: filename,
  });
  console.log(`  ✓ ${filename}`);
}

writeFileSync('fixtures/images-manifest.json', JSON.stringify(manifest, null, 2));
console.log(`\nSaved ${manifest.length} images → ${OUT}/ and fixtures/images-manifest.json`);
