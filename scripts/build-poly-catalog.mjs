// Builds public/catalog/poly-google.json from the Poly by Google profile on poly.pizza.
// One page request returns every model's id, title, preview and licence; no API key is needed.
// Run: npm run catalog
import { writeFileSync, mkdirSync } from 'node:fs';

const CREATOR = 'Poly by Google';
const OUT = new URL('../public/catalog/poly-google.json', import.meta.url);

const res = await fetch(`https://poly.pizza/u/${encodeURIComponent(CREATOR)}`);
if (!res.ok) throw new Error(`poly.pizza returned ${res.status}`);
const html = await res.text();
const match = html.match(/window\.__SERVER_APP_STATE__\s*=\s*(\{.*?\});?\s*<\/script>/s);
if (!match) throw new Error('Could not find model data on the profile page');
const models = JSON.parse(match[1]).initialData.User.models;

const LICENCES = ['CC-BY 3.0', 'CC0 1.0'];
const rows = models.map((m) => {
  const file = m.previewUrl.match(/static\.poly\.pizza\/([0-9a-f-]{36})\.webp$/)?.[1];
  if (!file) throw new Error(`Unexpected preview URL for ${m.publicID}: ${m.previewUrl}`);
  const lic = LICENCES.indexOf(m.licence);
  if (lic < 0) throw new Error(`Unknown licence ${m.licence} on ${m.publicID}`);
  // Compact row: [publicID, file uuid, title, licence index]
  return [m.publicID, file, m.title.trim(), lic];
});
rows.sort((a, b) => a[2].localeCompare(b[2]));

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    format: 'previzxr.catalog',
    version: 1,
    creator: CREATOR,
    source: `https://poly.pizza/u/${encodeURIComponent(CREATOR)}`,
    licences: LICENCES,
    fetched: new Date().toISOString().slice(0, 10),
    models: rows,
  }),
);
console.log(`Wrote ${rows.length} models to ${OUT.pathname}`);
