import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const KEY = process.env.PEXELS_KEY;
const PIXABAY = process.env.PIXABAY_KEY || '';
if (!KEY) {
  console.error('Falta la clave. Usa: PEXELS_KEY=tu_clave node scripts/descargar-clips.mjs');
  process.exit(1);
}
console.log(PIXABAY ? 'Fuentes: Pexels + Pixabay' : 'Fuentes: solo Pexels (no hay PIXABAY_KEY)');

// Busquedas que traen plantillas de YouTube en ingles ("subscribe", "thank you for watching"...)
const PROHIBIDAS = /subscri|thank|watching|outro|end ?screen|youtube|like button|follow us|channel|bell icon|social media/i;

const plan = JSON.parse(await fs.readFile('public/plan.json', 'utf8'));
const tomas = Array.isArray(plan) ? plan : plan.plan;
await fs.mkdir('public/clips', {recursive: true});
await fs.mkdir('public/fotos-tmp', {recursive: true});

const usados = new Set();
const hechos = new Set();
const listos = [];
const pendientes = [];
const cuenta = {pexels: 0, pixabay: 0, fotos: 0};
let ultimaBuena = '';

const pedir = async (url, headers = {}) => {
  const res = await fetch(url, {headers});
  if (!res.ok) {
    console.error(`  error ${res.status} en ${new URL(url).hostname}`);
    return null;
  }
  return res.json();
};

// ---------- Pexels ----------
const buscarVideoPexels = async (q) => {
  const data = await pedir(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=15`, {Authorization: KEY});
  for (const v of data?.videos ?? []) {
    if (usados.has(`v${v.id}`) || v.duration < 5) continue;
    const archivos = (v.video_files ?? [])
      .filter((f) => f.file_type === 'video/mp4' && f.width >= 1280 && f.width <= 1920)
      .sort((a, b) => b.width - a.width);
    if (archivos.length) {
      return {id: `v${v.id}`, link: archivos[0].link, info: `Pexels video ${archivos[0].width}px ${v.duration}s`, fuente: 'pexels'};
    }
  }
  return null;
};

const buscarFotoPexels = async (q) => {
  const data = await pedir(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=15`, {Authorization: KEY});
  for (const p of data?.photos ?? []) {
    if (usados.has(`f${p.id}`)) continue;
    const link = p.src?.large2x || p.src?.original;
    if (link) return {id: `f${p.id}`, link, info: 'Pexels FOTO', foto: true};
  }
  return null;
};

// ---------- Pixabay ----------
const buscarVideoPixabay = async (q) => {
  if (!PIXABAY) return null;
  const data = await pedir(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=20&safesearch=true`);
  for (const v of data?.hits ?? []) {
    if (usados.has(`x${v.id}`) || (v.duration ?? 0) < 5) continue;
    // Se prefiere el tamano mas grande que no pase de 1920 de ancho y que sea horizontal
    const opciones = ['large', 'medium', 'small']
      .map((k) => v.videos?.[k])
      .filter((f) => f && f.url && f.width >= 1280 && f.width <= 1920 && f.width > f.height);
    if (opciones.length) {
      const f = opciones[0];
      return {id: `x${v.id}`, link: f.url, info: `Pixabay video ${f.width}px ${v.duration}s`, fuente: 'pixabay'};
    }
  }
  return null;
};

const descargar = async (link, destino) => {
  const bin = await fetch(link);
  if (!bin.ok) throw new Error(`descarga ${bin.status}`);
  await fs.writeFile(destino, Buffer.from(await bin.arrayBuffer()));
};

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

  let buscar = String(toma.buscar ?? '').trim();
  if (!buscar || PROHIBIDAS.test(buscar)) {
    const reemplazo = ultimaBuena || tomas.map((t) => String(t.buscar ?? '')).find((b) => b && !PROHIBIDAS.test(b)) || 'ocean waves';
    console.log(`⚠ ${toma.clip}: la búsqueda "${buscar}" trae plantillas, uso "${reemplazo}"`);
    buscar = reemplazo;
  } else {
    ultimaBuena = buscar;
  }
  const corta = buscar.split(' ').slice(0, 2).join(' ');

  // Orden: video Pexels, video Pixabay, foto Pexels, y lo mismo con la busqueda corta
  const intentos = [
    () => buscarVideoPexels(buscar),
    () => buscarVideoPixabay(buscar),
    () => buscarFotoPexels(buscar),
    () => (corta !== buscar ? buscarVideoPexels(corta) : null),
    () => (corta !== buscar ? buscarVideoPixabay(corta) : null),
    () => (corta !== buscar ? buscarFotoPexels(corta) : null),
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
        cuenta.fotos++;
      } else {
        await descargar(elegido.link, destino);
        cuenta[elegido.fuente]++;
      }
      usados.add(elegido.id);
      listos.push(destino);
      console.log(`✓ ${toma.clip} ← "${buscar}" (${elegido.info})`);
      continue;
    } catch (e) {
      console.error(`  fallo guardando ${toma.clip}: ${e.message}`);
    }
  }

  pendientes.push({clip: toma.clip, destino, buscar});
}

if (pendientes.length && !listos.length) {
  console.error('✗ No se consiguió ningún clip ni foto. Revisa las claves o las búsquedas.');
  process.exit(1);
}
for (const [i, p] of pendientes.entries()) {
  await fs.copyFile(listos[i % listos.length], p.destino);
  console.log(`⚠ ${p.clip} ← nada para "${p.buscar}", copio otro clip`);
}

await fs.rm('public/fotos-tmp', {recursive: true, force: true});
console.log(`RESUMEN: ${cuenta.pexels} de Pexels, ${cuenta.pixabay} de Pixabay, ${cuenta.fotos} fotos, ${pendientes.length} copiados`);
console.log('Listo.');
