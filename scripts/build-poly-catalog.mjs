// Builds the library indexes in public/catalog/ from creator profiles on poly.pizza:
//   poly-google.json  Poly by Google (CC-BY 3.0)
//   quaternius.json   Quaternius (mostly CC0), with each animated model's clip names
// One page request per creator returns every model's id, title, preview and licence; no API key is needed.
// For creators with `probe`, each GLB's JSON chunk is read with two small range requests to find its animations.
// Run: npm run catalog (or `node scripts/build-poly-catalog.mjs quaternius` for one)
import { writeFileSync, mkdirSync } from 'node:fs';
import { argv } from 'node:process';

const CREATORS = [
  { key: 'google', creator: 'Poly by Google', out: 'poly-google.json', probe: false },
  { key: 'quaternius', creator: 'Quaternius', out: 'quaternius.json', probe: true },
];
const LICENCES = ['CC-BY 3.0', 'CC0 1.0'];
const CDN = 'https://static.poly.pizza';

const only = argv[2];
for (const c of CREATORS) if (!only || only === c.key) await build(c);

async function build({ creator, out, probe }) {
  const source = `https://poly.pizza/u/${encodeURIComponent(creator)}`;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`poly.pizza returned ${res.status}`);
  const html = await res.text();
  const match = html.match(/window\.__SERVER_APP_STATE__\s*=\s*(\{.*?\});?\s*<\/script>/s);
  if (!match) throw new Error(`Could not find model data on ${source}`);
  const models = JSON.parse(match[1]).initialData.User.models;

  const rows = models.map((m) => {
    const file = m.previewUrl.match(/static\.poly\.pizza\/([0-9a-f-]{36})\.webp$/)?.[1];
    if (!file) throw new Error(`Unexpected preview URL for ${m.publicID}: ${m.previewUrl}`);
    const lic = LICENCES.indexOf(m.licence);
    if (lic < 0) throw new Error(`Unknown licence ${m.licence} on ${m.publicID}`);
    // Compact row: [publicID, file uuid, title, licence index, clip names?, humanoid?]
    return [m.publicID, file, m.title.trim(), lic];
  });

  if (probe) {
    let done = 0;
    let failed = 0;
    await pool(rows, 16, async (row) => {
      try {
        const info = await probeGlb(`${CDN}/${row[1]}.glb`);
        if (info.clips.length) row.push(info.clips, info.humanoid ? 1 : 0);
      } catch (err) {
        failed++;
        console.warn(`  ${row[2]} (${row[0]}): ${err.message}`);
      }
      if (++done % 100 === 0) console.log(`  probed ${done}/${rows.length}`);
    });
    console.log(`  ${rows.filter((r) => r[4]).length} animated, ${failed} could not be read`);
  }

  rows.sort((a, b) => a[2].localeCompare(b[2]));
  const url = new URL(`../public/catalog/${out}`, import.meta.url);
  mkdirSync(new URL('.', url), { recursive: true });
  writeFileSync(
    url,
    JSON.stringify({
      format: 'previzxr.catalog',
      version: 2,
      creator,
      source,
      licences: LICENCES,
      fetched: new Date().toISOString().slice(0, 10),
      models: rows,
    }),
  );
  console.log(`Wrote ${rows.length} ${creator} models to ${out}`);
}

/** Animation names of a GLB and whether it is a skinned humanoid (head, arms and legs in its node names). */
async function probeGlb(url) {
  const head = new DataView(await range(url, 0, 19));
  if (head.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const length = head.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(await range(url, 20, 19 + length)));
  const clips = (json.animations ?? []).map((a, i) => (a.name || `Clip ${i + 1}`).slice(0, 80));
  const names = (json.nodes ?? []).map((n) => n.name ?? '').join(' ').replace(/armature/gi, '');
  const humanoid = !!json.skins?.length && /head/i.test(names) && /(arm|hand)/i.test(names) && /(leg|foot|thigh)/i.test(names);
  return { clips: [...new Set(clips)], humanoid };
}

async function range(url, from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
      if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      return r.status === 206 ? buf : buf.slice(from, to + 1);
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
    }
  }
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}
