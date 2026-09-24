import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const KEY = process.env.PEXELS_KEY;
if (!KEY) {
  console.error('Falta la clave. Usa: PEXELS_KEY=tu_clave node scripts/descargar-clips.mjs');
  process.exit(1);
}

const plan = JSON.parse(await fs.readFile('public/plan.json', 'utf8'));
const tomas = Array.isArray(plan) ? plan : plan.plan;
await fs.mkdir('public/clips', {recursive: true});
await fs.mkdir('public/fotos-tmp', {recursive: true});

const usados = new Set(); // ids de Pexels ya usados, para no repetir
const hechos = new Set();
const listos = [];
const pendientes = [];
let nVideos = 0;
let nFotos = 0;

const pedir = async (url) => {
  const res = await fetch(url, {headers: {Authorization: KEY}});
  if (!res.ok) {
    console.error(`  error ${res.status} en Pexels`);
    return null;
  }
  return res.json();
};

const buscarVideo = async (q) => {
  const data = await pedir(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=15`);
  for (const v of data?.videos ?? []) {
    if (usados.has(`v${v.id}`) || v.duration < 5) continue;
    const archivos = (v.video_files ?? [])
      .filter((f) => f.file_type === 'video/mp4' && f.width >= 1280 && f.width <= 1920)
      .sort((a, b) => b.width - a.width);
    if (archivos.length) {
      return {id: `v${v.id}`, link: archivos[0].link, info: `video ${archivos[0].width}px ${v.duration}s`};
    }
  }
  return null;
};

const buscarFoto = async (q) => {
  const data = await pedir(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=15`);
  for (const p of data?.photos ?? []) {
    if (usados.has(`f${p.id}`)) continue;
    const link = p.src?.large2x || p.src?.original;
    if (link) return {id: `f${p.id}`, link, info: 'FOTO', foto: true};
  }
  return null;
};

const descargar = async (link, destino) => {
  const bin = await fetch(link);
  if (!bin.ok) throw new Error(`descarga ${bin.status}`);
  await fs.writeFile(destino, Buffer.from(await bin.arrayBuffer()));
};

// Convierte una foto en un clip de 12 segundos para que Remotion la trate como video
const fotoAVideo = (jpg, mp4) => {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-i', jpg,
    '-t', '12', '-r', '30',
    '-vf', 'scale=1920:-2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    mp4,
  ]);
};

for (const toma of tomas) {
  if (hechos.has(toma.clip)) continue;
  hechos.add(toma.clip);
  const destino = path.join('public/clips', toma.clip);
  const corta = toma.buscar.split(' ').slice(0, 2).join(' ');

  // Orden: video exacto, foto exacta, video con búsqueda corta, foto con búsqueda corta
  const intentos = [
    () => buscarVideo(toma.buscar),
    () => buscarFoto(toma.buscar),
    () => (corta !== toma.buscar ? buscarVideo(corta) : null),
    () => (corta !== toma.buscar ? buscarFoto(corta) : null),
  ];

  let elegido = null;
  for (const intento of intentos) {
    try {
      elegido = await intento();
    } catch (e) {
      console.error(`  fallo buscando: ${e.message}`);
    }
    if (elegido) break;
  }

  if (elegido) {
    try {
      if (elegido.foto) {
        const jpg = path.join('public/fotos-tmp', `${elegido.id}.jpg`);
        await descargar(elegido.link, jpg);
        fotoAVideo(jpg, destino);
        nFotos++;
      } else {
        await descargar(elegido.link, destino);
        nVideos++;
      }
      usados.add(elegido.id);
      listos.push(destino);
      console.log(`✓ ${toma.clip} ← "${toma.buscar}" (${elegido.info})`);
      continue;
    } catch (e) {
      console.error(`  fallo guardando ${toma.clip}: ${e.message}`);
    }
  }

  pendientes.push({clip: toma.clip, destino, buscar: toma.buscar});
}

// Último recurso: si una toma no consiguió nada, copia otro clip para que el render no falle
if (pendientes.length && !listos.length) {
  console.error('✗ No se consiguió ningún clip ni foto. Revisa la clave de Pexels o las búsquedas.');
  process.exit(1);
}
for (const [i, p] of pendientes.entries()) {
  await fs.copyFile(listos[i % listos.length], p.destino);
  console.log(`⚠ ${p.clip} ← nada para "${p.buscar}", copio otro clip`);
}

await fs.rm('public/fotos-tmp', {recursive: true, force: true});
console.log(`RESUMEN: ${nVideos} videos, ${nFotos} fotos, ${pendientes.length} copiados`);
console.log('Listo.');
