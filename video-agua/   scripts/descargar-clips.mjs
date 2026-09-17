import fs from 'node:fs/promises';
import path from 'node:path';

const KEY = process.env.PEXELS_KEY;
if (!KEY) {
  console.error('Falta la clave. Usa: PEXELS_KEY=tu_clave node scripts/descargar-clips.mjs');
  process.exit(1);
}

const plan = JSON.parse(await fs.readFile('public/plan.json', 'utf8'));
await fs.mkdir('public/clips', {recursive: true});
const hechos = new Set();

for (const toma of plan) {
  if (hechos.has(toma.clip)) continue;
  hechos.add(toma.clip);
  const destino = path.join('public/clips', toma.clip);

  try {
    await fs.access(destino);
    console.log(`✓ ya existe: ${toma.clip}`);
    continue;
  } catch {}

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(toma.buscar)}&orientation=landscape&per_page=10`;
  const res = await fetch(url, {headers: {Authorization: KEY}});
  if (!res.ok) {
    console.error(`✗ error ${res.status} buscando "${toma.buscar}"`);
    continue;
  }
  const data = await res.json();

  let elegido = null;
  for (const v of data.videos ?? []) {
    if (v.duration < 6) continue;
    const archivos = (v.video_files ?? [])
      .filter((f) => f.file_type === 'video/mp4' && f.width >= 1280 && f.width <= 1920)
      .sort((a, b) => b.width - a.width);
    if (archivos.length) {
      elegido = {video: v, archivo: archivos[0]};
      break;
    }
  }

  if (!elegido) {
    console.error(`✗ sin resultados para "${toma.buscar}"`);
    continue;
  }

  const bin = await fetch(elegido.archivo.link);
  await fs.writeFile(destino, Buffer.from(await bin.arrayBuffer()));
  console.log(`✓ ${toma.clip} ← "${toma.buscar}" (${elegido.archivo.width}px, ${elegido.video.duration}s)`);
}

console.log('Listo.');