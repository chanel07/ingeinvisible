// Capitulos para la descripcion de YouTube (0:00 Nombre, 1:12 Otro...).
// Toma las secciones del plan, busca en los subtitulos de la voz el segundo exacto
// en que empieza cada una y las mete en out/metadatos.txt, antes de los hashtags.
// YouTube los muestra en la barra del video y Google los usa como "momentos clave".
import fs from 'node:fs/promises';

const leer = async (p) => {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
};

const srt = await leer('public/voz.srt');
const planTxt = await leer('public/plan.json');
if (!srt || !planTxt) {
  console.log('No hay subtítulos o plan: el video sale sin capítulos.');
  process.exit(0);
}
const plan = (() => {
  const j = JSON.parse(planTxt);
  return Array.isArray(j) ? j : j.plan ?? [];
})();

// Palabras de la voz con su segundo aproximado
const aSeg = (t) => {
  const [h, m, s] = t.replace(',', '.').split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};
const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const palabras = [];
for (const bloque of srt.replace(/\r/g, '').split(/\n\n+/)) {
  const lineas = bloque.trim().split('\n');
  const i = lineas.findIndex((l) => l.includes('-->'));
  if (i < 0) continue;
  const [a, b] = lineas[i].split('-->').map((x) => aSeg(x.trim()));
  const ws = lineas.slice(i + 1).join(' ').split(/\s+/).map(norm).filter(Boolean);
  ws.forEach((w, k) => palabras.push({w, t: a + ((b - a) * k) / Math.max(1, ws.length)}));
}
const total = palabras.length ? palabras[palabras.length - 1].t : 0;

const buscar = (frase, desde) => {
  const seq = String(frase ?? '').split(/\s+/).map(norm).filter(Boolean);
  for (let largo = Math.min(seq.length, 5); largo >= 2; largo--) {
    for (let ini = 0; ini + largo <= seq.length; ini++) {
      const trozo = seq.slice(ini, ini + largo);
      for (let j = 0; j <= palabras.length - largo; j++) {
        if (palabras[j].t < desde) continue;
        if (trozo.every((w, k) => palabras[j + k].w === w)) return palabras[j].t;
      }
    }
  }
  return null;
};

// Instante de cada toma (las que no se encuentran se reparten entre las vecinas)
const tiempos = [];
let ultimo = 0;
plan.forEach((toma, i) => {
  if (i === 0) return tiempos.push(0);
  const s = buscar(toma.desde, ultimo + 0.5);
  if (s !== null) ultimo = s;
  tiempos.push(s);
});
for (let i = 1; i < tiempos.length; i++) {
  if (tiempos[i] !== null) continue;
  let j = i;
  while (j < tiempos.length && tiempos[j] === null) j++;
  const despues = j < tiempos.length ? tiempos[j] : total;
  for (let k = i; k < j; k++) tiempos[k] = tiempos[i - 1] + ((despues - tiempos[i - 1]) * (k - i + 1)) / (j - i + 1);
  i = j - 1;
}

let caps = plan
  .map((toma, i) => (toma.seccion ? {t: Math.floor(tiempos[i]), nombre: String(toma.seccion).trim()} : null))
  .filter(Boolean);
// El primero siempre en 0:00 (regla de YouTube)
if (!caps.length || caps[0].t > 0) {
  if (caps.length && caps[0].t < 10) caps[0].t = 0;
  else caps.unshift({t: 0, nombre: 'La pregunta'});
}
// Cada capitulo debe durar al menos 10 segundos
caps = caps.filter((c, i, arr) => i === 0 || c.t - arr[i - 1].t >= 10);

if (caps.length < 3) {
  console.log(`Solo ${caps.length} capítulos: YouTube pide mínimo 3, el video sale sin capítulos.`);
  process.exit(0);
}

const reloj = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const bloque = 'Capítulos:\n' + caps.map((c) => `${reloj(c.t)} ${c.nombre}`).join('\n');
console.log('\n' + bloque + '\n');

const meta = await leer('out/metadatos.txt');
await fs.mkdir('out', {recursive: true});
if (!meta) {
  await fs.writeFile('out/metadatos.txt', bloque + '\n');
} else {
  // Se ponen al final de la descripcion, antes de la linea de hashtags
  const [antes, ...resto] = meta.split('\n\nETIQUETAS:');
  const parrafos = antes.split('\n\n');
  const posHash = parrafos.length > 2 && parrafos[parrafos.length - 1].trim().startsWith('#') ? parrafos.length - 1 : parrafos.length;
  parrafos.splice(posHash, 0, bloque);
  const nuevo = parrafos.join('\n\n') + (resto.length ? '\n\nETIQUETAS:' + resto.join('\n\nETIQUETAS:') : '');
  await fs.writeFile('out/metadatos.txt', nuevo);
}
console.log('Capítulos agregados a out/metadatos.txt');
