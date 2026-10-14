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

// Palabras que no sirven para saber de que trata un video
const VACIAS = new Set(['the', 'and', 'with', 'from', 'into', 'over', 'under', 'close', 'view', 'slow', 'motion', 'shot', 'footage', 'video', 'stock', 'background', 'night', 'day', 'person', 'people', 'man', 'woman', 'hand', 'hands']);

const raiz = (w) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const palabrasClave = (q) => [...new Set(q.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !VACIAS.has(w)).map(raiz))];

// ¿La descripcion del video tiene las palabras de la busqueda?
// Con 1 o 2 palabras clave deben estar todas; con mas, al menos la mitad.
const coincide = (q, descripcion) => {
  const claves = palabrasClave(q);
  if (!claves.length) return true;
  const texto = descripcion.toLowerCase().replace(/[^a-z]/g, ' ');
  const hallados = claves.filter((c) => texto.includes(c)).length;
  const minimo = claves.length <= 2 ? claves.length : Math.ceil(claves.length / 2);
  return hallados >= minimo;
};

const plan = JSON.parse(await fs.readFile('public/plan.json', 'utf8'));
const tomas = Array.isArray(plan) ? plan : plan.plan;
await fs.mkdir('public/clips', {recursive: true});
await fs.mkdir('public/fotos-tmp', {recursive: true});

const usados = new Set();
const hechos = new Set();
const listos = [];
const pendientes = [];
const cuenta = {pexels: 0, pixabay: 0, fotos: 0, sinCoincidir: 0};
let ultimaBuena = '';
const TEMA_RESPALDO = 'city street';

const pedir = async (url, headers = {}) => {
  const res = await fetch(url, {headers});
  if (!res.ok) {
    console.error(`  error ${res.status} en ${new URL(url).hostname}`);
    return null;
  }
  return res.json();
};

// Las respuestas se guardan para no repetir la misma busqueda dos veces
const cache = new Map();
const pedirUnaVez = async (url, headers) => {
  if (!cache.has(url)) cache.set(url, await pedir(url, headers));
  return cache.get(url);
};

// ---------- Pexels ----------
const buscarVideoPexels = async (q, estricto) => {
  const data = await pedirUnaVez(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=20`, {Authorization: KEY});
  for (const v of data?.videos ?? []) {
    if (usados.has(`v${v.id}`) || v.duration < 5) continue;
    if (estricto && !coincide(q, v.url ?? '')) continue;
    const archivos = (v.video_files ?? [])
      .filter((f) => f.file_type === 'video/mp4' && f.width >= 1280 && f.width <= 1920)
      .sort((a, b) => b.width - a.width);
    if (archivos.length) {
      return {id: `v${v.id}`, link: archivos[0].link, info: `Pexels video ${archivos[0].width}px ${v.duration}s${estricto ? '' : ', SIN COINCIDIR'}`, fuente: 'pexels', estricto};
    }
  }
  return null;
};

const buscarFotoPexels = async (q, estricto) => {
  const data = await pedirUnaVez(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=20`, {Authorization: KEY});
  for (const p of data?.photos ?? []) {
    if (usados.has(`f${p.id}`)) continue;
    if (estricto && !coincide(q, `${p.alt ?? ''} ${p.url ?? ''}`)) continue;
    const link = p.src?.large2x || p.src?.original;
    if (link) return {id: `f${p.id}`, link, info: `Pexels FOTO${estricto ? '' : ', SIN COINCIDIR'}`, foto: true, estricto};
  }
  return null;
};

// ---------- Pixabay ----------
const buscarVideoPixabay = async (q, estricto) => {
  if (!PIXABAY) return null;
  const data = await pedirUnaVez(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=20&safesearch=true`);
  for (const v of data?.hits ?? []) {
    if (usados.has(`x${v.id}`) || (v.duration ?? 0) < 5) continue;
    if (estricto && !coincide(q, `${v.tags ?? ''} ${v.pageURL ?? ''}`)) continue;
    const opciones = ['large', 'medium', 'small']
      .map((k) => v.videos?.[k])
      .filter((f) => f && f.url && f.width >= 1280 && f.width <= 1920 && f.width > f.height);
    if (opciones.length) {
      const f = opciones[0];
      return {id: `x${v.id}`, link: f.url, info: `Pixabay video ${f.width}px ${v.duration}s${estricto ? '' : ', SIN COINCIDIR'}`, fuente: 'pixabay', estricto};
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
  } else if (!/^PROPIA:/i.test(buscar)) {
    ultimaBuena = buscar;
  }
  // Imagen o video propio: la busqueda dice PROPIA:nombre.png y el archivo esta en public/propias/
  const propia = buscar.match(/^PROPIA:\s*(.+)$/i);
  if (propia) {
    const origen = path.join('public/propias', propia[1].trim());
    try {
      await fs.access(origen);
      if (/\.(png|jpe?g|webp)$/i.test(origen)) fotoAVideo(origen, destino);
      else await fs.copyFile(origen, destino);
      listos.push(destino);
      console.log(`✓ ${toma.clip} ← imagen propia ${propia[1].trim()}`);
      continue;
    } catch (e) {
      console.log(`⚠ ${toma.clip}: no encontré public/propias/${propia[1].trim()}, busco en los bancos de video`);
      buscar = ultimaBuena || TEMA_RESPALDO;
    }
  }

  const corta = buscar.split(' ').slice(0, 2).join(' ');
  const hayCorta = corta !== buscar;

  // Primero solo videos que coincidan con la busqueda; si nadie tiene, se relaja
  const intentos = [
    () => buscarVideoPexels(buscar, true),
    () => buscarVideoPixabay(buscar, true),
    () => (hayCorta ? buscarVideoPexels(corta, true) : null),
    () => (hayCorta ? buscarVideoPixabay(corta, true) : null),
    () => buscarFotoPexels(buscar, true),
    () => buscarVideoPexels(buscar, false),
    () => buscarVideoPixabay(buscar, false),
    () => buscarFotoPexels(buscar, false),
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
      if (!elegido.estricto) cuenta.sinCoincidir++;
      usados.add(elegido.id);
      listos.push(destino);
      console.log(`${elegido.estricto ? '✓' : '⚠'} ${toma.clip} ← "${buscar}" (${elegido.info})`);
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
console.log(`RESUMEN: ${cuenta.pexels} de Pexels, ${cuenta.pixabay} de Pixabay, ${cuenta.fotos} fotos, ${pendientes.length} copiados, ${cuenta.sinCoincidir} sin coincidir`);
if (cuenta.sinCoincidir) console.log('REVISA las tomas marcadas con ⚠: puede que no muestren lo que dice la voz.');
console.log('Listo.');
