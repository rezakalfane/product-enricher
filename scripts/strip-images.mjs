/**
 * Remove the downloaded image from half of the products in fixtures/images-manifest.json,
 * so those products can be re-matched and re-enriched through the app.
 * Pass --dry to preview. Marks each stripped entry in the manifest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { bc } from './bc.mjs';

const DRY = process.argv.includes('--dry');
const MANIFEST = 'fixtures/images-manifest.json';
const rows = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// Every other entry — a spread of products rather than the first half of the catalog.
const targets = rows.filter((_, i) => i % 2 === 0);
console.log(`${targets.length} of ${rows.length} products will lose their image.${DRY ? ' (dry run)' : ''}\n`);

let stripped = 0;
for (const r of targets) {
  try {
    if (!DRY) {
      await bc(`/v3/catalog/products/${r.product_id}/images/${r.image_id}`, { method: 'DELETE' });
    }
    r.stripped = !DRY;
    stripped++;
    console.log(`  ✓ #${r.product_id} ${r.product_name} — image ${r.image_id} removed`);
  } catch (err) {
    console.warn(`  ! #${r.product_id} ${r.product_name}: ${err.message}`);
  }
}

if (!DRY) writeFileSync(MANIFEST, JSON.stringify(rows, null, 2));
console.log(`\nDone — ${stripped} image(s) removed. Their files remain in fixtures/images/.`);
