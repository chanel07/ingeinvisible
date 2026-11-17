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
// Contenido de moda, sensual o con poca ropa: nunca entra, en ningun canal.
// Pexels no tiene filtro de contenido sensible para videos, por eso se revisa la descripcion.
const SENSIBLE = /\b(model|models|modeling|modelling|fashion|posing|pose|poses|photoshoot|photo shoot|glamour|glamorous|beauty|lingerie|underwear|bikini|bikinis|swimsuit|swimsuits|swimwear|bathing suit|sexy|sensual|seductive|nude|naked|topless|erotic|boudoir|bra|panties|thong|fur coat|faux fur|legs|thighs|buttocks|cleavage|provocative|hot girl|hot woman)\b/i;
// Palabras que no deben salir en este video (las pone el workflow con CLIPS_EVITAR,
// por ejemplo "car|engine|fan" en un video de aires acondicionados).
const EVITAR_TXT = (process.env.CLIPS_EVITAR ?? '').split(/[|,]/).map((w) => w.trim().toLowerCase()).filter(Boolean).join('|');
const EVITAR = EVITAR_TXT ? new RegExp(`\\b(${EVITAR_TXT})s?\\b`, 'i') : null;
if (EVITAR) console.log(`Clips prohibidos en este video: ${EVITAR_TXT}`);
const esRaro = (descripcion) => {
  const t = String(descripcion).toLowerCase().replace(/[-_/]+/g, ' ');
  return RAROS.test(t) || SENSIBLE.test(t) || (!!EVITAR && EVITAR.test(t));
};

// Modo estricto: nunca usar un clip que no coincida con la busqueda. Si no hay uno
// que coincida, se repite un clip bueno del mismo video (mejor repetido que incoherente).
const ESTRICTO = (process.env.CLIPS_ESTRICTO ?? 'no').toLowerCase() === 'si';
if (ESTRICTO) console.log('Modo estricto: si no hay un clip que coincida, se repite uno bueno del video');

// Palabra obligatoria (opcional). En los videos de perros el workflow pone
// CLIPS_OBLIGATORIA=dog|puppy, y asi ningun clip entra si no tiene un perro.
const OBLIG_TXT = (process.env.CLIPS_OBLIGATORIA ?? '').trim();
const OBLIGATORIA = OBLIG_TXT ? new RegExp(`\\b(${OBLIG_TXT})`, 'i') : null;
const RESPALDO_OBLIG = (process.env.CLIPS_RESPALDO ?? 'happy dog').trim();
if (OBLIGATORIA) console.log(`Todos los clips deben tener: ${OBLIG_TXT}`);

// Si se piden perros, se rechaza todo lo que mencione otro animal: a veces una
// foto de un erizo o un gato dice "puppy" o "dog" en la descripcion y se colaba.
const OTROS_ANIMALES = /\b(hedgehogs?|cats?|kittens?|kitty|rabbits?|bunny|bunnies|hamsters?|guinea pigs?|ferrets?|foxes|fox|squirrels?|porcupines?|raccoons?|birds?|parrots?|horses?|goats?|cows?|sheep|pigs?|piglets?|monkeys?|bears?|lions?|tigers?|mice|mouse|rats?|otters?|seals?|deer)\b/i;
const otroAnimal = (descripcion) => !!OBLIGATORIA && OTROS_ANIMALES.test(String(descripcion).toLowerCase().replace(/[-_/]+/g, ' '));

// Modo vertical (videos de perros): busca primero clips verticales y en alta
// resolucion, para que no haya que agrandarlos y se vean nitidos.
const VERTICAL = (process.env.CLIPS_VERTICAL ?? 'no').toLowerCase() === 'si';
if (VERTICAL) console.log('Modo vertical: primero clips verticales en alta resolucion');

// ---------- Revision con IA (Gemini mira el clip antes de usarlo) ----------
// Por cada toma se revisan hasta MAX_REVISIONES candidatos: Gemini ve dos fotos del
// clip y dice si de verdad muestra lo que dice la voz. Se apaga con CLIPS_REVISAR=no
// o si no hay GEMINI_KEY. Si Gemini se queda sin cupo, se sigue como antes (sin revisar).
const GEMINI = (process.env.GEMINI_KEY ?? '').trim();
let REVISAR = !!GEMINI && (process.env.CLIPS_REVISAR ?? 'si').toLowerCase() !== 'no';
const MAX_REVISIONES = Number(process.env.CLIPS_MAX_REVISIONES ?? 5) || 5;
// Primero los modelos livianos (tienen cupo aparte del que usa el guion); los nombres
// "latest" siempre apuntan al modelo vigente, por si Google retira uno viejo.
const MODELOS_VISION = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const modelosVivos = [...MODELOS_VISION];
const cuentaIA = {ok: 0, no: 0, sinRevisar: 0};
console.log(REVISAR ? `Revisión con IA: encendida (hasta ${MAX_REVISIONES} candidatos por toma)` : 'Revisión con IA: apagada');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const fotoBase64 = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const tipo = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    if (!tipo.startsWith('image/')) return null;
    return {mime_type: tipo, data: Buffer.from(await res.arrayBuffer()).toString('base64')};
  } catch {
    return null;
  }
};

// Devuelve {ok, ve} o null si no se pudo revisar (sin fotos, sin cupo, error)
const revisarConIA = async (candidato, frase, buscar) => {
  if (!REVISAR || !candidato.fotos?.length) return null;
  const fotos = (await Promise.all(candidato.fotos.slice(0, 2).map(fotoBase64))).filter(Boolean);
  if (!fotos.length) return null;
  const prompt = `Eres el editor de un canal de YouTube de divulgación. Revisa si este clip de video de stock sirve para esta parte del video.
La voz dice en este momento: "${frase || buscar}"
Lo que se buscó: "${buscar}"
Te mando ${fotos.length} foto(s) del mismo clip.
Responde ok=true solo si en las fotos se ve claramente el objeto o la acción principal de la que habla la voz, aunque el ángulo o los detalles cambien.
Responde ok=false si muestra otra cosa (por ejemplo: una uña cuando se habla de un clavo, la puerta de una habitación cuando se habla de una nevera, el motor de un carro cuando se habla de un aire acondicionado), si es contenido sensual o con poca ropa, si parece hecho con IA o animado, o si tiene textos o logos grandes.
Responde SOLO con JSON: {"ok": true o false, "ve": "lo que se ve, máximo 8 palabras, en español"}`;
  while (modelosVivos.length) {
    const modelo = modelosVivos[0];
    // Espacio de sobra: los modelos nuevos "piensan" antes de responder y gastan de este cupo
    const config = {temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json'};
    if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({contents: [{parts: [{text: prompt}, ...fotos.map((f) => ({inline_data: f}))]}], generationConfig: config}),
      });
    } catch (e) {
      console.log(`    revisión falló (${e.message})`);
      return null;
    }
    if (res.status === 404 || res.status === 400) {
      console.log(`    ${modelo} no sirve para revisar (${res.status}), pruebo otro`);
      modelosVivos.shift();
      continue;
    }
    if (res.status === 429) {
      const msg = (await res.text()).replace(/\s+/g, ' ');
      if (/exceeded your current quota|per day/i.test(msg)) {
        console.log(`    ${modelo} sin cupo, pruebo otro`);
        modelosVivos.shift();
        continue;
      }
      await pausa(20000);
      continue;
    }
    if (!res.ok) {
      console.log(`    revisión con error ${res.status}`);
      return null;
    }
    try {
      const data = await res.json();
      const texto = (data?.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').replace(/```json|```/g, '').trim();
      const j = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
      await pausa(4500); // para no pasar el limite de solicitudes por minuto
      return {ok: j.ok === true || /^(true|si|sí|yes)$/i.test(String(j.ok)), ve: String(j.ve ?? '').slice(0, 80)};
    } catch {
      // Respuesta vacia o rara: ese modelo no sirve para esto, se prueba el siguiente
      console.log(`    ${modelo} no dio una respuesta clara, pruebo otro`);
      modelosVivos.shift();
      continue;
    }
  }
  console.log('AVISO: Gemini sin cupo para revisar; el resto de clips se escoge sin revisión');
  REVISAR = false;
  return null;
};

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
let rechazados = new Set(); // clips que la IA rechazo para la toma actual
const yaUsado = (id) => usados.has(id) || rechazados.has(id) || (!ignorarHistorial && vistos.has(id));

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
    if (esRaro(v.url ?? '') || otroAnimal(v.url ?? '')) continue;
    if (estricto && !coincide(q, v.url ?? '')) continue;
    const archivos = (v.video_files ?? [])
      .filter((f) => f.file_type === 'video/mp4')
      .filter((f) => (orientacion === 'portrait'
        ? f.height >= 1280 && f.height <= 2400 && f.height > f.width
        : f.width >= 1280 && f.width <= 1920))
      .sort((a, b) => (orientacion === 'portrait' ? b.height - a.height : b.width - a.width));
    if (archivos.length) {
      const f = archivos[0];
      const cuadros = (v.video_pictures ?? []).map((p) => p.picture).filter(Boolean);
      const fotos = [cuadros[Math.floor(cuadros.length / 2)], v.image].filter(Boolean);
      return {id: `v${v.id}`, link: f.link, fotos, info: `Pexels video ${f.width}x${f.height} ${v.duration}s${estricto ? '' : ', SIN COINCIDIR'} | ${v.url ?? ''}`, fuente: 'pexels', estricto};
    }
  }
  return null;
};

const buscarFotoPexels = async (q, estricto) => {
  const data = await pedirUnaVez(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&per_page=40`, {Authorization: KEY});
  for (const p of mezclar(data?.photos ?? [])) {
    if (yaUsado(`f${p.id}`)) continue;
    if (esRaro(`${p.alt ?? ''} ${p.url ?? ''}`) || otroAnimal(`${p.alt ?? ''} ${p.url ?? ''}`)) continue;
    if (estricto && !coincide(q, `${p.alt ?? ''} ${p.url ?? ''}`)) continue;
    const link = p.src?.large2x || p.src?.original;
    if (link) return {id: `f${p.id}`, link, fotos: [p.src?.medium || link], info: `Pexels FOTO${estricto ? '' : ', SIN COINCIDIR'} | ${p.url ?? ''}`, foto: true, estricto};
  }
  return null;
};

// ---------- Pixabay ----------
const buscarVideoPixabay = async (q, estricto) => {
  if (!PIXABAY) return null;
  const data = await pedirUnaVez(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=40&safesearch=true`);
  for (const v of mezclar(data?.hits ?? [])) {
    if (yaUsado(`x${v.id}`) || (v.duration ?? 0) < 5) continue;
    if (esRaro(`${v.tags ?? ''} ${v.pageURL ?? ''}`) || otroAnimal(`${v.tags ?? ''} ${v.pageURL ?? ''}`)) continue;
    if (estricto && !coincide(q, `${v.tags ?? ''} ${v.pageURL ?? ''}`)) continue;
    const opciones = ['large', 'medium', 'small']
      .map((k) => v.videos?.[k])
      .filter((f) => f && f.url && (VERTICAL
        ? (f.height > f.width ? f.height >= 1280 : f.width >= 1280 && f.width <= 1920)
        : f.width >= 1280 && f.width <= 1920 && f.width > f.height))
      .sort((a, b) => (VERTICAL ? (b.height > b.width) - (a.height > a.width) : 0));
    if (opciones.length) {
      const f = opciones[0];
      const fotos = [f.thumbnail, v.videos?.medium?.thumbnail, v.videos?.large?.thumbnail].filter(Boolean).slice(0, 1);
      return {id: `x${v.id}`, link: f.url, fotos, info: `Pixabay video ${f.width}px ${v.duration}s${estricto ? '' : ', SIN COINCIDIR'} | ${v.pageURL ?? ''}`, fuente: 'pixabay', estricto};
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

// Lo que dice la voz en cada toma (para la revision con IA)
let guionTxt = '';
try {
  guionTxt = await fs.readFile('public/guion.txt', 'utf8');
} catch {
  guionTxt = '';
}
const normTxt = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const oraciones = guionTxt.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
const fraseDe = (toma) => {
  if (!oraciones.length) return '';
  const inicio = normTxt(toma.desde ?? '').split(' ').slice(0, 4).join(' ');
  let i = inicio ? oraciones.findIndex((o) => normTxt(o).includes(inicio)) : 0;
  if (i < 0) i = 0;
  return oraciones.slice(i, i + 2).join(' ').slice(0, 260);
};
// La toma que de verdad muestra cada clip (las tomas con plantilla no muestran el clip)
const tomaVisible = new Map();
for (const t of tomas) if (!t.plantilla && !tomaVisible.has(t.clip)) tomaVisible.set(t.clip, t);

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
    ...(VERTICAL ? [() => (hayCorta ? buscarVideoPexels(corta, true, 'landscape') : null)] : []),
    () => (hayCorta ? buscarVideoPixabay(corta, true) : null),
  ];
  if (OBLIGATORIA) {
    // Nunca un clip sin la palabra obligatoria: si no hay, se usa un video seguro.
    // Las fotos quedan de ultimo recurso, porque un video siempre se ve mejor.
    intentos.push(
      () => buscarVideoPexels(RESPALDO_OBLIG, true),
      ...(VERTICAL ? [() => buscarVideoPexels(RESPALDO_OBLIG, true, 'landscape')] : []),
      () => buscarVideoPixabay(RESPALDO_OBLIG, true),
      () => buscarFotoPexels(buscar, true),
      () => buscarVideoPexels(RESPALDO_OBLIG, false),
    );
  } else {
    intentos.push(() => buscarFotoPexels(buscar, true));
    // Con la revision con IA encendida tambien se prueban clips cuya descripcion no
    // coincide: la IA los mira y solo pasa el que de verdad muestra lo que dice la voz.
    if (!ESTRICTO || REVISAR) {
      intentos.push(
        () => buscarVideoPexels(buscar, false),
        () => buscarVideoPixabay(buscar, false),
        () => buscarFotoPexels(buscar, false),
      );
    }
  }

  // Primero sin repetir clips de videos anteriores; si no hay, se permiten.
  // Cada candidato pasa por la revision con IA (si esta encendida): si Gemini dice
  // que no muestra lo que dice la voz, se descarta y se busca el siguiente.
  const visible = tomaVisible.get(toma.clip);
  const revisarEsta = REVISAR && !!visible;
  const frase = visible ? fraseDe(visible) : '';
  if (revisarEsta) console.log(`Toma ${toma.clip}: "${buscar}"`);
  rechazados = new Set();
  let revisados = 0;
  let agotado = false;
  let primerRechazado = null; // ultimo recurso si al final no hay ningun clip en todo el video
  let elegido = null;
  for (const pase of [false, true]) {
    ignorarHistorial = pase;
    for (const intento of intentos) {
      while (!elegido && !agotado) {
        let cand = null;
        try {
          cand = await intento();
        } catch (e) {
          console.error(`  fallo buscando: ${e.message}`);
        }
        if (!cand) break;
        if (!revisarEsta || !REVISAR) {
          // Sin revision, en modo estricto nunca entra un clip que no coincide
          if (ESTRICTO && !cand.estricto) {
            rechazados.add(cand.id);
            continue;
          }
          elegido = cand;
          break;
        }
        if (revisados >= MAX_REVISIONES) {
          // Ya se revisaron suficientes: en modo estricto se repite un clip bueno
          if (ESTRICTO || OBLIGATORIA) agotado = true;
          else {
            elegido = cand;
            cuentaIA.sinRevisar++;
          }
          break;
        }
        const r = await revisarConIA(cand, frase, buscar);
        revisados++;
        if (r === null) {
          // No se pudo revisar: en modo estricto solo entra si su descripcion coincide
          if (ESTRICTO && !cand.estricto) {
            rechazados.add(cand.id);
            continue;
          }
          console.log(`  candidato ${revisados} sin revisar (no se pudo)`);
          cuentaIA.sinRevisar++;
          elegido = cand;
          break;
        }
        if (r.ok) {
          if (!cand.estricto) {
            cand.estricto = true;
            cand.info = cand.info.replace(', SIN COINCIDIR', ', aprobado por la IA');
          }
          console.log(`  candidato ${revisados} ✓ (${r.ve})`);
          cuentaIA.ok++;
          elegido = cand;
          break;
        }
        console.log(`  candidato ${revisados} ✗ (${r.ve})`);
        cuentaIA.no++;
        rechazados.add(cand.id);
        if (!primerRechazado) primerRechazado = cand;
      }
      if (elegido || agotado) break;
    }
    if (elegido || agotado) break;
  }
  ignorarHistorial = false;
  if (!elegido && revisarEsta) console.log(`  ninguno sirvió para "${buscar}"`);

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

  pendientes.push({clip: toma.clip, destino, buscar, primerRechazado});
}

// Si la IA rechazo todo en todas las tomas, se usan los primeros candidatos para no fallar
if (pendientes.length && !listos.length) {
  for (const p of pendientes) {
    if (!p.primerRechazado) continue;
    try {
      if (p.primerRechazado.foto) {
        const jpg = path.join('public/fotos-tmp', `${p.primerRechazado.id}.jpg`);
        await descargar(p.primerRechazado.link, jpg);
        fotoAVideo(jpg, p.destino);
      } else {
        await descargar(p.primerRechazado.link, p.destino);
      }
      listos.push(p.destino);
      p.listo = true;
      console.log(`⚠ ${p.clip} ← la IA rechazó todo, uso el primer candidato (revísalo): ${p.primerRechazado.info}`);
    } catch (e) {
      console.error(`  fallo guardando ${p.clip}: ${e.message}`);
    }
  }
  pendientes.splice(0, pendientes.length, ...pendientes.filter((p) => !p.listo));
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
if (GEMINI) console.log(`REVISIÓN CON IA: ${cuentaIA.ok} aprobados, ${cuentaIA.no} rechazados, ${cuentaIA.sinRevisar} sin revisar`);
console.log('Listo.');
