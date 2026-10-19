import fs from 'node:fs/promises';

// Videos de HUMOR para la pagina de perros: el perro habla en primera persona
// sobre una situacion que todos los duenos reconocen. Es independiente del
// script educativo (generar-perros.mjs) y no cambia nada de ese.

const KEY = process.env.GEMINI_KEY;
let TEMA = (process.env.TEMA ?? '').trim();

if (!KEY) {
  console.error('Falta GEMINI_KEY');
  process.exit(1);
}

// Si no se escribe tema, se elige una situacion al azar
const SITUACIONES = [
  'Cuando tu humano dice que vuelve en cinco minutos y se demora tres horas',
  'Cuando suena la bolsa de la comida desde el otro lado de la casa',
  'El baño de los sábados, visto por el perro',
  'Cuando llega el domiciliario o el cartero a la puerta',
  'Cuando tu humano se sienta a comer y el perro lo mira fijo',
  'Cuando alguien dice la palabra paseo',
  'Cuando el humano se pone los zapatos y el perro no sabe si lo van a llevar',
  'Cuando el perro ve su reflejo en el espejo',
  'Cuando le compran una cama nueva y prefiere dormir en el sofá',
  'Cuando el humano llega a la casa después del trabajo',
  'Cuando hay un gato en el muro del vecino',
  'Cuando el perro escucha el ruido de un paquete de galletas',
];
if (!TEMA) {
  TEMA = SITUACIONES[Math.floor(Math.random() * SITUACIONES.length)];
  console.log(`Sin tema escrito, elijo una situacion al azar: "${TEMA}"`);
}

// Frases exactas que el tema puede pedir: la primera y la pregunta final
const GANCHO = (() => {
  const m = TEMA.match(/primera frase del guion debe ser exactamente:\s*(.+?)(?=\s+OBLIGATORIO|$)/i);
  return m ? m[1].trim() : '';
})();
const PREGUNTA = (() => {
  const m = TEMA.match(/pregunta final:\s*(¿?[^?]+\?)/i);
  if (!m) return '';
  const q = m[1].trim();
  return q.startsWith('¿') ? q.charAt(0) + q.charAt(1).toUpperCase() + q.slice(2) : '¿' + q.charAt(0).toUpperCase() + q.slice(1);
})();

const CONFIG = {
  segundos: '15 a 25',
  palabras: '40 y 60',
  minPalabras: 32,
  maxPalabras: 72,
  tomas: 'entre 7 y 9 tomas. NO menos de 7',
  minTomas: 6,
};

const PRIMERAS = [
  'funny dog looking at camera',
  'dog tilting head',
  'dog waiting at door',
  'dog lying on sofa',
  'dog begging at table',
  'happy dog running',
  'dog sitting looking up',
  'puppy looking at camera',
];

const prompt = `Eres el guionista de humor de una pagina de perros en Santa Marta, Colombia. Creas Reels verticales de ${CONFIG.segundos} segundos donde EL PERRO HABLA EN PRIMERA PERSONA y cuenta, con drama exagerado, una situacion que todos los duenos han vivido.

SITUACION E INSTRUCCIONES DEL PRODUCTOR:
${TEMA}

PRIORIDAD: si la SITUACION trae un formato (por ejemplo un diario con el reloj que avanza: Segundo uno, Minuto diez, Hora uno), momentos concretos, frases exactas o reglas OBLIGATORIO, SIGUELOS al pie de la letra, por encima de las reglas generales de abajo. Usa los detalles concretos que trae la SITUACION, no los cambies por otros mas genericos.
${GANCHO ? `La PRIMERA FRASE del guion debe ser exactamente: ${GANCHO}` : ''}
${PREGUNTA ? `La ULTIMA FRASE del guion debe ser exactamente: ${PREGUNTA}` : ''}

ORTOGRAFIA: el guion se escribe en espanol con ortografia perfecta, con TODAS las tildes (está, también, volvió, traición, mañana) y con los signos de apertura ¿ y ¡. Aunque estas instrucciones no tengan tildes, el guion SI las lleva.

ESTILO:
- El narrador es el perro. Habla de "mi humano", nunca de "el dueno".
- Humor blanco y tierno, como un perro dramatico y exagerado. Se vale exagerar sus emociones como chiste (ofenderse, hacer drama, sentirse traicionado), porque es evidente que es humor.
- Frases MUY cortas, con ritmo de chiste: situacion, exageracion, remate.

ESTRUCTURA:
1. GANCHO (primera frase, maximo 10 palabras): el perro arranca directo en la situacion, algo que el dueno reconozca al instante.
   Si la SITUACION trae una frase exacta para empezar, usa ESA frase.
2. ESCALADA (3 a 5 frases cortas): el drama del perro va subiendo, cada frase mas exagerada que la anterior.
3. REMATE (una frase): el giro gracioso final, inesperado.
4. PREGUNTA FINAL (una frase corta, dicha por el perro a los humanos que ven el video), para que comenten. Ejemplo: "¿Tu perro tambien te hace este drama?"

PROHIBIDO:
- Groserias, dobles sentidos, burlas a personas, razas o paises.
- Mostrar o sugerir maltrato, castigos o situaciones peligrosas para el perro como algo gracioso.
- Consejos de salud, comida, medicamentos o veterinarios. Esto es solo humor.
- Dar datos o afirmaciones como si fueran ciertas ("los perros siempre...", "esta probado que...").
- Mencionar marcas.
- Decir suscribete, sigueme o dale like.

Ejemplo de tono (NO lo copies, es solo para que entiendas el estilo):
"Mi humano dijo que volvía en cinco minutos. Han pasado tres horas. Ya revisé la puerta veinte veces. Ya le aullé a la ventana. Ya hablé con el gato del vecino. Mañana busco abogado. ¿Tu perro también te hace este drama cuando sales?"

LARGO: entre ${CONFIG.palabras} palabras. Ni menos ni mas.
Espanol neutro latinoamericano, cercano: "carro" no "coche". NO uses punto y coma.

Responde SOLO con JSON, sin backticks:

{
  "guion": "${CONFIG.palabras} palabras. Gancho. Escalada. Remate. Pregunta final.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS DEL PLAN:
- plan: ${CONFIG.tomas}.
- Cada toma dura 2 o 3 segundos. Cortes rapidos.
- Cada toma usa un archivo de clip DISTINTO y una busqueda DISTINTA.
- buscar: en INGLES, generico y visual, SIEMPRE con perros, que muestre lo que dice esa parte (por ejemplo "dog waiting at door", "dog looking out window", "sad dog lying floor", "dog begging food", "excited dog jumping").
- PROHIBIDO usar "close up", "closeup", "macro" o "extreme" en las busquedas.
- etiquetas: maximo 1 por toma, maximo 3 palabras. Si el guion usa el reloj (Segundo uno, Minuto diez...), pon una etiqueta en cada momento del reloj, por ejemplo "SEGUNDO 1", "MINUTO 10", "HORA 1". Si no, solo en 2 o 3 tomas, graciosas, por ejemplo "MODO DRAMA".
- clip: nombre en espanol con guiones .mp4, SIN tildes y SIN la letra ñ (usa n).

REGLA CRITICA DEL CAMPO "desde":
- La primera toma lleva desde: ""
- CADA toma siguiente lleva en "desde" un fragmento EXACTO y literal del guion, de 3 a 6 palabras seguidas.
- Tiene que aparecer TEXTUALMENTE en el guion. No lo reescribas ni cambies una palabra.
- En el mismo orden del guion, sin repetirse, repartidos de principio a fin.

SOLO el JSON.`;

// Primero los dos Gemini; si los dos se quedan sin cupo, Groq como respaldo.
// gemini-2.5-flash primero: el 3.6 sale saturado casi siempre y hace perder tiempo.
const GROQ = (process.env.GROQ_KEY ?? '').trim();
const MODELOS = ['gemini-2.5-flash', 'gemini-3.6-flash'];
if (GROQ) MODELOS.push('groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.6-27b', 'groq:openai/gpt-oss-20b');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(modelo) {
  if (modelo.startsWith('groq:')) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${GROQ}`},
      body: JSON.stringify({
        model: modelo.slice(5),
        messages: [{role: 'user', content: prompt}],
        temperature: 0.8,
        max_tokens: 8192,
        ...(modelo.includes('gpt-oss') ? {reasoning_effort: 'low'} : {}),
        response_format: {type: 'json_object'},
      }),
    });
  }
  const config = {temperature: 0.9, maxOutputTokens: 16000};
  if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
  return fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: config}),
  });
}

async function llamarGemini() {
  for (const modelo of MODELOS) {
    const esGroq = modelo.startsWith('groq:');
    for (let intento = 1; intento <= 3; intento++) {
      console.log(`Intento ${intento}/3 con ${modelo}...`);
      let res;
      try {
        res = await pedir(modelo);
      } catch (e) {
        console.log(`  fallo de conexión: ${e.message}`);
        await esperar(5000);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        const texto = esGroq
          ? data?.choices?.[0]?.message?.content
          : (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (texto && texto.trim()) { console.log(`Respuesta de ${modelo}`); return texto; }
        console.log('  respuesta vacía, reintento...');
        continue;
      }
      const status = res.status;
      const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
      if (status === 404 || (esGroq && status === 400)) { console.log(`${modelo} no disponible (${status}): ${msg}`); break; }
      if (status === 429 && (/exceeded your current quota/i.test(msg) || esGroq)) { console.log(`Se acabó el cupo de ${modelo}, paso al siguiente modelo.`); break; }
      if (status === 503 || status === 429) { console.log(`${modelo} saturado, esperando 30s...`); await esperar(30000); continue; }
      console.error(`Error ${status}:`, msg);
      break;
    }
  }
  return null;
}

// Si el JSON llega cortado o el guion se pasa de largo, vuelve a pedirlo.
console.log(`Generando Reel de humor para: "${TEMA}"...`);
let resultado = null;
let respaldo = null;
for (let vuelta = 1; vuelta <= 4 && !resultado; vuelta++) {
  const texto = await llamarGemini();
  if (!texto) { console.error('Sin respuesta'); process.exit(1); }
  const limpio = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const r = JSON.parse(limpio);
    if (!(r.guion && Array.isArray(r.plan) && r.plan.length)) {
      console.warn(`Vuelta ${vuelta}: falta guion o plan, reintentando...`);
      continue;
    }
    const n = r.guion.trim().split(/\s+/).length;
    if (n > CONFIG.maxPalabras) {
      console.warn(`Vuelta ${vuelta}: guion de ${n} palabras, el maximo es ${CONFIG.maxPalabras}. Reintentando...`);
      if (!respaldo || n < respaldo.n) respaldo = {r, n};
      continue;
    }
    resultado = r;
  } catch (e) {
    console.warn(`Vuelta ${vuelta}: JSON cortado o invalido (${e.message}), reintentando...`);
  }
}
if (!resultado && respaldo) {
  console.warn(`Ninguno cumplio el largo. Uso el mas corto: ${respaldo.n} palabras.`);
  resultado = respaldo.r;
}
if (!resultado) { console.error('No se obtuvo un guion valido despues de 4 vueltas'); process.exit(1); }

const quitarTildes = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Si la IA no respeto la primera frase o la pregunta final exactas, se ponen a mano
const sinSignos = (s) => quitarTildes(s).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
let guion = String(resultado.guion).replace(/\s+/g, ' ').trim();
if (GANCHO && !sinSignos(guion).startsWith(sinSignos(GANCHO).slice(0, 25))) {
  console.log('AVISO: la IA no respeto la primera frase, la pongo yo');
  const resto = guion.replace(/^[^.?!]*[.?!]\s*/, '');
  guion = `${/[.?!]$/.test(GANCHO) ? GANCHO : GANCHO + '.'} ${resto}`.trim();
}
if (PREGUNTA) {
  const frasesG = guion.match(/[^.?!]+[.?!]+/g) ?? [guion];
  const ultimaG = frasesG[frasesG.length - 1];
  if (sinSignos(ultimaG) !== sinSignos(PREGUNTA)) {
    console.log('AVISO: la pregunta final no quedo igual o quedo cortada, la pongo yo');
    const cuerpo = /\?\s*$/.test(ultimaG) ? frasesG.slice(0, -1).join(' ') : guion;
    guion = `${cuerpo.trim()} ${PREGUNTA}`.trim();
  }
}
resultado.guion = guion.replace(/\s+/g, ' ').trim();

// Nombres de clip seguros: sin tildes, sin ñ, sin espacios raros.
const nombreSeguro = (s, i) => {
  const base = quitarTildes(String(s || `toma-${i + 1}`)).replace(/\.mp4$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base || `toma-${i + 1}`}.mp4`;
};
const usados = new Set();
resultado.plan.forEach((t, i) => {
  let n = nombreSeguro(t.clip, i);
  if (usados.has(n)) n = n.replace(/\.mp4$/, `-${i + 1}.mp4`);
  usados.add(n);
  t.clip = n;
});

// Primera toma: perro al azar, nunca la decide la IA.
const primera = PRIMERAS[Math.floor(Math.random() * PRIMERAS.length)];
resultado.plan[0].buscar = primera;
resultado.plan[0].clip = 'perro-humor-inicio.mp4';
console.log(`PRIMERA TOMA: "${primera}"`);

// Quitar "close up" y obligar a que todas las busquedas tengan un perro.
resultado.plan.forEach((t, i) => {
  const b = String(t.buscar || '');
  let limpia = b.replace(/\b(extreme\s+)?close[\s-]?up\b|\bcloseup\b|\bmacro\b/gi, '').replace(/\s+/g, ' ').trim();
  if (limpia !== b) console.log(`Toma ${i + 1}: quite "close up" de "${b}"`);
  if (!limpia) limpia = 'dog playing';
  if (!/\b(dog|dogs|puppy|puppies|pet)\b/i.test(limpia)) {
    console.log(`Toma ${i + 1}: la busqueda "${limpia}" no tenia perro, la cambio a "dog ${limpia}"`);
    limpia = `dog ${limpia}`;
  }
  t.buscar = limpia;
});

// Duracion
const palabras = resultado.guion.trim().split(/\s+/).length;
const segundos = Math.round(palabras / 2.5);
console.log(`\nPALABRAS: ${palabras} (aprox ${segundos}s de video)`);
if (palabras < CONFIG.minPalabras) console.warn('AVISO: el guion salio corto.');
if (palabras > CONFIG.maxPalabras) console.warn('AVISO: el guion salio largo.');

const tomas = resultado.plan.length;
console.log(`TOMAS: ${tomas} (aprox ${(segundos / tomas).toFixed(1)}s por toma)`);
if (tomas < CONFIG.minTomas) console.warn('AVISO: pocas tomas, el ritmo va a ser lento.');

// Por si se cuela algo de salud o comida en un video de humor
const bajo = quitarTildes(resultado.guion);
const SALUD = ['dosis', 'medicamento', 'miligramos', 'vomito', 'remedio', 'veterinario', 'pastilla'];
const salud = SALUD.filter((v) => bajo.includes(v));
if (salud.length) console.warn(`AVISO: el guion de humor habla de "${salud.join('", "')}". Revisalo antes de publicar.`);

// Sincronia de tomas con el guion
const normalizar = (s) => quitarTildes(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const guionNorm = normalizar(resultado.guion);
let fallos = 0;
resultado.plan.forEach((toma, i) => {
  if (i === 0 || !toma.desde) return;
  if (!guionNorm.includes(normalizar(toma.desde))) {
    console.warn(`AVISO toma ${i + 1}: "${toma.desde}" no aparece en el guion`);
    fallos++;
  }
});
if (fallos) console.warn(`${fallos} de ${tomas} tomas se van a repartir por tiempo.`);

const frases = resultado.guion.trim().split(/(?<=[.!?])\s+/);
console.log(`\nPRIMERA: ${frases[0]}`);
console.log(`ULTIMA:  ${frases[frases.length - 1]}\n`);

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');
console.log(`Guion: ${resultado.guion.length} chars, Plan: ${tomas} tomas`);
