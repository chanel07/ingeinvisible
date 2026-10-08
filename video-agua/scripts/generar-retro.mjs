import fs from 'node:fs/promises';

// Guion y plan de tomas para la página retro "Soy Mailo".
// Escribe: public/guion.txt, public/plan.json, public/titulo.txt y out/descripcion.txt

const KEY = process.env.GEMINI_KEY;
const TEMA = (process.env.TEMA ?? '').trim();

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const quitarBackticks = (t) => t.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
const textoDe = (data) => (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();

async function llamar(modelo, cuerpo) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
  return fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(cuerpo),
  });
}

// ---------- PASO 1: investigación con Google ----------
const MODELOS_INVESTIGACION = ['gemini-2.5-flash', 'gemini-3.6-flash'];

async function investigar() {
  const prompt = `Investiga este tema de nostalgia para un video corto en español: ${TEMA}

Entrega NOTAS en viñetas, en español, con:
- En qué años fue popular y desde cuándo existe, si se sabe con certeza.
- De 3 a 5 datos curiosos y verificables: origen, cifras, cómo se usaba o se jugaba, por qué desapareció o cambió.
- Cómo se le decía en distintos países de Latinoamérica, sobre todo en Colombia, si cambia.
- Detalles sensoriales que la gente recuerda: sonidos, olores, texturas, frases típicas.
No inventes nada. Si un dato no está claro, no lo incluyas.`;

  for (const modelo of MODELOS_INVESTIGACION) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        console.log(`Investigando con ${modelo} (intento ${intento}/3)...`);
        const res = await llamar(modelo, {
          contents: [{parts: [{text: prompt}]}],
          tools: [{google_search: {}}],
          generationConfig: {temperature: 0.3, maxOutputTokens: 8192},
        });
        if (res.status === 404 || res.status === 400) {
          console.log(`  ${modelo} no acepta búsqueda (${res.status})`);
          break;
        }
        if (res.status === 429) {
          console.log('  429 (límite), esperando 60s...');
          await esperar(60000);
          continue;
        }
        if (!res.ok) {
          console.log(`  respuesta ${res.status}, esperando 30s...`);
          await esperar(30000);
          continue;
        }
        const notas = textoDe(await res.json());
        if (notas.length > 150) return notas;
        console.log('  notas muy cortas, reintento...');
      } catch (e) {
        console.log(`  fallo: ${e.message}`);
        await esperar(5000);
      }
    }
  }
  return '';
}

// ---------- PASO 2: guion, plan, título y descripción ----------
function promptGuion(notas) {
  return `Eres el guionista de "Soy Mailo", una página de Facebook de nostalgia sobre juguetes, juegos, dulces, tecnología y costumbres de los años 80, 90 y 2000. El público son adultos de 30 a 50 años de Colombia y Latinoamérica que vivieron esa época.

TEMA:
${TEMA}

NOTAS DE INVESTIGACIÓN (úsalas como fuente; no inventes datos):
${notas || '(sin notas: usa solo conocimiento seguro y evita fechas o cifras dudosas)'}

REGLAS DEL GUION:
- Entre 60 y 75 palabras (unos 25 a 30 segundos). Solo el texto que dice el narrador.
- TONO: un amigo de la misma generación recordando contigo. Cálido, cercano, con humor suave. Háblale de tú. Español colombiano natural pero entendible en toda Latinoamérica.
- Estructura obligatoria, en este orden:
  1. Gancho de máximo 12 palabras que despierte el recuerdo de inmediato (por ejemplo: "Si tuviste uno de estos, ya sabes cuántos años tienes").
  2. El recuerdo: describe la escena como se vivía, con un detalle sensorial (un sonido, un olor, una frase típica).
  3. Al menos UN dato curioso y verificable de las notas (un año, un origen, una cifra).
  4. Un remate emotivo o divertido sobre cómo era antes comparado con hoy.
  5. Cierre: una pregunta sincera al espectador sobre su propio recuerdo (por ejemplo: "¿Cuál era el tuyo?" o "¿A qué edad tuviste el tuyo?").
- Frases cortas, máximo 18 palabras cada una.
- Escribe los números en letras (mil novecientos noventa y cinco, no 1995).
- PROHIBIDO: "comenta sí", "dale like", "comparte si", "suscríbete", "en este video", "hoy te voy a contar", "no lo vas a creer". Nada de pedir likes ni compartidos.
- PROHIBIDO dentro del guion: títulos, notas de tomas o escenas, emojis, hashtags y corchetes.

REGLAS DEL PLAN DE TOMAS:
- Entre 4 y 7 tomas, en el orden del guion.
- "desde": frase EXACTA de 3 a 6 palabras copiada del guion donde empieza esa toma. La primera toma lleva "desde": "".
- "clip": nombre único en español con guiones, terminado en .mp4 (por ejemplo casete-viejo.mp4).
- "buscar": búsqueda en INGLÉS para video de stock, GENÉRICA y visual. Los bancos de video casi no tienen productos específicos, así que usa descripciones como "vintage toys", "old cassette tape", "retro video game console", "kids playing in the street", "old television", "rotary phone", "1990s bedroom". NUNCA marcas, nombres de productos, personajes de caricaturas ni programas de TV.
- "etiquetas": lista con 0 o 1 etiqueta por toma: {"texto": "máximo 3 palabras", "cuando": "frase exacta del guion"}. Útil para años, por ejemplo "AÑO 1996".

TÍTULO Y DESCRIPCIÓN:
- "titulo": pregunta o frase nostálgica de máximo 7 palabras que sale en pantalla al inicio (por ejemplo "¿Tuviste uno de estos?").
- "descripcion": texto para la publicación de Facebook: 1 o 2 frases nostálgicas, una pregunta al público y de 3 a 5 hashtags (#nostalgia #retro #los90 y otros del tema).

Responde SOLO con este JSON:
{"guion": "...", "titulo": "...", "descripcion": "...", "plan": [{"desde": "", "clip": "nombre.mp4", "buscar": "english query", "etiquetas": [{"texto": "TEXTO", "cuando": "frase"}]}]}`;
}

const MODELOS_GUION = ['gemini-3.6-flash', 'gemini-2.5-flash'];

async function generarGuion(notas) {
  const prompt = promptGuion(notas);
  for (const modelo of MODELOS_GUION) {
    for (let intento = 1; intento <= 4; intento++) {
      try {
        console.log(`Escribiendo guion con ${modelo} (intento ${intento}/4)...`);
        const config = {temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json'};
        if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
        const res = await llamar(modelo, {contents: [{parts: [{text: prompt}]}], generationConfig: config});
        if (res.status === 404) {
          console.log(`  ${modelo} no disponible, paso al siguiente`);
          break;
        }
        if (res.status === 429) {
          console.log('  429 (límite), esperando 60s...');
          await esperar(60000);
          continue;
        }
        if (!res.ok) {
          console.log(`  respuesta ${res.status}, esperando 40s...`);
          await esperar(40000);
          continue;
        }
        const json = JSON.parse(quitarBackticks(textoDe(await res.json())));
        if (typeof json.guion === 'string' && json.guion.trim() && Array.isArray(json.plan) && json.plan.length >= 2) {
          console.log(`  guion escrito con ${modelo}`);
          return json;
        }
        console.log('  respuesta incompleta, reintento...');
      } catch (e) {
        console.log(`  JSON inválido o cortado (${e.message}), reintento...`);
        await esperar(5000);
      }
    }
  }
  return null;
}

// ---------- Limpieza y validación ----------
const PAL = /^\s*[(\[]?\s*\d*[.)]?\s*(clip|toma|escena|visual|imagen|b-roll|secci[oó]n|section|parte|cap[ií]tulo|t[ií]tulo|nota)\s*\d*\s*:.*$/gim;
const MARCA_EN_LINEA = /[(\[]\s*(clip|toma|escena|visual|imagen|secci[oó]n|nota)\s*\d*\s*:[^)\]]*[)\]]/gi;
const PROHIBIDAS_BUSQUEDA = /subscri|thank|watching|intro|outro|end ?screen|youtube|like button|channel/i;

const limpiarGuion = (g) =>
  g
    .replace(PAL, '')
    .replace(MARCA_EN_LINEA, '')
    .replace(/[#*_\[\]]/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

function normalizarPlan(plan) {
  const usados = new Set();
  let ultimaBusqueda = 'vintage toys';
  return plan
    .filter((t) => t && typeof t === 'object')
    .map((t, i) => {
      let clip =
        String(t.clip ?? `toma-${i + 1}`)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\.mp4$/, '')
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '') || `toma-${i + 1}`;
      while (usados.has(clip)) clip += `-${i + 1}`;
      usados.add(clip);

      let buscar = String(t.buscar ?? '').trim();
      if (!buscar || PROHIBIDAS_BUSQUEDA.test(buscar)) buscar = ultimaBusqueda;
      else ultimaBusqueda = buscar;

      let etiquetas = t.etiquetas;
      if (typeof etiquetas === 'string') etiquetas = [{texto: etiquetas}];
      if (!Array.isArray(etiquetas)) etiquetas = [];
      etiquetas = etiquetas
        .map((e) => (typeof e === 'string' ? {texto: e} : e))
        .filter((e) => e && typeof e.texto === 'string' && e.texto.trim())
        .slice(0, 1)
        .map((e) => ({texto: e.texto.trim(), ...(e.cuando ? {cuando: String(e.cuando)} : {})}));

      return {desde: i === 0 ? '' : String(t.desde ?? ''), clip: `${clip}.mp4`, buscar, etiquetas};
    });
}

// ---------- Ejecución ----------
console.log(`Generando video retro para: "${TEMA}"`);

const notas = await investigar();
if (notas) {
  console.log('\n----- NOTAS DE INVESTIGACIÓN -----\n' + notas + '\n----------------------------------\n');
  console.log('Pausa de 20s antes de escribir el guion...');
  await esperar(20000);
} else {
  console.log('AVISO: sin investigación, sigo solo con el tema');
}

const resultado = await generarGuion(notas);
if (!resultado) {
  console.error('No se pudo generar el guion después de varios intentos');
  process.exit(1);
}

const guion = limpiarGuion(resultado.guion);
const plan = normalizarPlan(resultado.plan);
const titulo = String(resultado.titulo ?? '').replace(/#\S+/g, '').trim();
const descripcion = String(resultado.descripcion ?? '').trim();

const palabras = guion.split(/\s+/).filter(Boolean).length;
console.log(`TÍTULO: ${titulo}`);
console.log(`PALABRAS: ${palabras}${palabras > 80 ? ' (AVISO: largo)' : ''}${palabras < 50 ? ' (AVISO: corto)' : ''}`);

await fs.mkdir('out', {recursive: true});
await fs.writeFile('public/guion.txt', guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(plan, null, 2), 'utf8');
await fs.writeFile('public/titulo.txt', titulo, 'utf8');
await fs.writeFile('out/descripcion.txt', `${descripcion}\n`, 'utf8');

console.log(`Plan: ${plan.length} tomas`);
plan.forEach((t, i) => console.log(`  ${i + 1}. ${t.clip} <- "${t.buscar}"${t.desde ? ` desde "${t.desde}"` : ''}`));
console.log('\n----- DESCRIPCIÓN PARA FACEBOOK -----\n' + descripcion);
console.log('Listo.');
