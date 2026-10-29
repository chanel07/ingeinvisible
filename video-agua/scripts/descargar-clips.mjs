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

// Videos raros que no queremos: hechos con IA, animados, de fantasia o disfrazados.
// Los bancos gratuitos tienen cada vez mas de estos y se ven falsos en un video real.
const RAROS = /\b(ai|a\.i\.|generated|artificial intelligence|anthropomorphic|humanoid|cartoon|animation|animated|3d|render|rendering|cgi|fantasy|surreal|costume|mask|illustration|digital art|midjourney|stable diffusion)\b/i;
const esRaro = (descripcion) => RAROS.test(String(descripcion).toLowerCase().replace(/[-_/]+/g, ' '));

// Palabra obligatoria (opcional). En los videos de perros el workflow pone
// CLIPS_OBLIGATORIA=dog|puppy, y asi ningun clip entra si no tiene un perro.
const OBLIG_TXT = (process.env.CLIPS_OBLIGATORIA ?? '').trim();
const OBLIGATORIA = OBLIG_TXT ? new RegExp(`\\b(${OBLIG_TXT})`, 'i') : null;
const RESPALDO_OBLIG = (process.env.CLIPS_RESPALDO ?? 'happy dog').trim();
if (OBLIGATORIA) console.log(`Todos los clips deben tener: ${OBLIG_TXT}`);

// Modo vertical (videos de perros): busca primero clips verticales y en alta
// resolucion, para que no haya que agrandarlos y se vean nitidos.
const VERTICAL = (process.env.CLIPS_VERTICAL ?? 'no').toLowerCase() === 'si';
if (VERTICAL) console.log('Modo vertical: primero clips verticales en alta resolucion');

// ¿La descripcion del video tiene las palabras de la busqueda?
// Con 1 o 2 palabras clave deben estar todas; con mas, al menos la mitad.
const coincide = (q, descripcion) => {
  const claves = palabrasClave(q);
  const texto = descripcion.toLowerCase().replace(/[^a-z]/g, ' ');
  if (OBLIGATORIA && !OBLIGATORIA.test(texto)) return false;
  if (!claves.length) return true;
  const hallados = claves.filter((c) => texto.includes(c)).length;
  const minimo = claves.length <= 2 ? claves.length : Math.ceil(claves.length / 2);
  return hallados >= minimo;
};

const plan = JSON.parse(await fs.readFile('public/plan.json', 'utf8'));
const tomas = Array.isArray(plan) ? plan : plan.plan;
await fs.mkdir('public/clips', {recursive: true});
await fs.mkdir('public/fotos-tmp', {recursive: true});

const usados = new Set();

// Historial de clips usados en videos anteriores, para no repetirlos.
// Se guarda en clips-usados.json y el workflow lo sube al repo.
const HISTORIAL = process.env.CLIPS_HISTORIAL || 'clips-usados.json';
let historial = [];
try {
  historial = JSON.parse(await fs.readFile(HISTORIAL, 'utf8'));
} catch {
  historial = [];
}
const vistos = new Set(historial);
const nuevos = [];
let ignorarHistorial = false;
console.log(`Historial: ${vistos.size} clips ya usados en videos anteriores`);
const yaUsado = (id) => usados.has(id) || (!ignorarHistorial && vistos.has(id));

// Mezcla los primeros resultados para no elegir siempre el mismo clip
const mezclar = (lista) => {
  const arriba = lista.slice(0, 20);
  for (let i = arriba.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arriba[i], arriba[j]] = [arriba[j], arriba[i]];
  }
  return [...arriba, ...lista.slice(20)];
};
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
const buscarVideoPexels = async (q, estricto, orientacion = VERTICAL ? 'portrait' : 'landscape') => {
  const data = await pedirUnaVez(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=${orientacion}&per_page=40`, {Authorization: KEY});
  for (const v of mezclar(data?.videos ?? [])) {
    if (yaUsado(`v${v.id}`) || v.duration < 5) continue;
    if (esRaro(v.url ?? '')) continue;
    if (estricto && !coincide(q, v.url ?? '')) continue;
    const archivos = (v.video_files ?? [])
      .filter((f) => f.file_type === 'video/mp4')
      .filter((f) => (orientacion === 'portrait'
        ? f.height >= 1280 && f.height <= 2400 && f.height > f.width
        : f.width >= 1280 && f.width <= 1920))
      .sort((a, b) => (orientacion === 'portrait' ? b.height - a.height : b.width - a.width));
    if (archivos.length) {
      const f = archivos[0];
      return {id: `v${v.id}`, link: f.link, info: `Pexels video ${f.width}x${f.height} ${v.duration}s${estricto ? '' : ', SIN COINCIDIR'}`, fuente: 'pexels', estricto};
    }
  }
  return null;
};

const buscarFotoPexels = async (q, estricto) => {
  const data = await pedirUnaVez(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=40`, {Authorization: KEY});
  for (const p of mezclar(data?.photos ?? [])) {
    if (yaUsado(`f${p.id}`)) continue;
    if (esRaro(`${p.alt ?? ''} ${p.url ?? ''}`)) continue;
    if (estricto && !coincide(q, `${p.alt ?? ''} ${p.url ?? ''}`)) continue;
    const link = p.src?.large2x || p.src?.original;
    if (link) return {id: `f${p.id}`, link, info: `Pexels FOTO${estricto ? '' : ', SIN COINCIDIR'}`, foto: true, estricto};
  }
  return null;
};

// ---------- Pixabay ----------
const buscarVideoPixabay = async (q, estricto) => {
  if (!PIXABAY) return null;
  const data = await pedirUnaVez(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=40&safesearch=true`);
  for (const v of mezclar(data?.hits ?? [])) {
    if (yaUsado(`x${v.id}`) || (v.duration ?? 0) < 5) continue;
    if (esRaro(`${v.tags ?? ''} ${v.pageURL ?? ''}`)) continue;
    if (estricto && !coincide(q, `${v.tags ?? ''} ${v.pageURL ?? ''}`)) continue;
    const opciones = ['large', 'medium', 'small']
      .map((k) => v.videos?.[k])
      .filter((f) => f && f.url && (VERTICAL
        ? (f.height > f.width ? f.height >= 1280 : f.width >= 1280 && f.width <= 1920)
        : f.width >= 1280 && f.width <= 1920 && f.width > f.height))
      .sort((a, b) => (VERTICAL ? (b.height > b.width) - (a.height > a.width) : 0));
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
    ...(VERTICAL ? [() => buscarVideoPexels(buscar, true, 'landscape')] : []),
    () => buscarVideoPixabay(buscar, true),
    () => (hayCorta ? buscarVideoPexels(corta, true) : null),
    () => (hayCorta ? buscarVideoPixabay(corta, true) : null),
    () => buscarFotoPexels(buscar, true),
  ];
  if (OBLIGATORIA) {
    // Nunca un clip sin la palabra obligatoria: si no hay, se usa una busqueda segura
    intentos.push(
      () => buscarVideoPexels(RESPALDO_OBLIG, true),
      () => buscarVideoPixabay(RESPALDO_OBLIG, true),
      () => buscarVideoPexels(RESPALDO_OBLIG, false),
    );
  } else {
    intentos.push(
      () => buscarVideoPexels(buscar, false),
      () => buscarVideoPixabay(buscar, false),
      () => buscarFotoPexels(buscar, false),
    );
  }

  // Primero sin repetir clips de videos anteriores; si no hay, se permiten
  let elegido = null;
  for (const pase of [false, true]) {
    ignorarHistorial = pase;
    for (const intento of intentos) {
      try {
        elegido = await intento();
      } catch (e) {
        console.error(`  fallo buscando: ${e.message}`);
      }
      if (elegido) break;
    }
    if (elegido) break;
  }
  ignorarHistorial = false;

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
      nuevos.push(elegido.id);
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
historial = [...new Set([...historial, ...nuevos])].slice(-3000);
await fs.writeFile(HISTORIAL, JSON.stringify(historial), 'utf8');
console.log(`Historial actualizado: ${nuevos.length} clips nuevos, ${historial.length} en total`);
console.log(`RESUMEN: ${cuenta.pexels} de Pexels, ${cuenta.pixabay} de Pixabay, ${cuenta.fotos} fotos, ${pendientes.length} copiados, ${cuenta.sinCoincidir} sin coincidir`);
if (cuenta.sinCoincidir) console.log('REVISA las tomas marcadas con ⚠: puede que no muestren lo que dice la voz.');
console.log('Listo.');
