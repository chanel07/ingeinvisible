import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const GROQ = (process.env.GROQ_KEY ?? '').trim();
const TEMA = (process.env.TEMA ?? '').trim();

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

// Primero los dos Gemini; si los dos se quedan sin cupo, Groq como respaldo
const MODELOS = ['gemini-3.6-flash', 'gemini-2.5-flash'];
if (GROQ) MODELOS.push('groq:llama-3.3-70b-versatile', 'groq:openai/gpt-oss-120b');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Frase de gancho obligatoria que viene dentro del tema (si la hay)
const GANCHO = (() => {
  const m = TEMA.match(/primera frase del guion debe ser exactamente:\s*(.+?)(?=\s+OBLIGATORIO|\s+INICIO:|\s+CIERRE:|$)/i);
  return m ? m[1].trim() : '';
})();

async function pedir(modelo, prompt) {
  if (modelo.startsWith('groq:')) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${GROQ}`},
      body: JSON.stringify({model: modelo.slice(5), messages: [{role: 'user', content: prompt}], temperature: 0.8, max_tokens: 8000}),
    });
  }
  const config = {temperature: 0.9, maxOutputTokens: 32000};
  // Los modelos 2.5 gastan espacio "pensando" y pueden cortar la respuesta: se les apaga
  if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
  return fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: config}),
  });
}

async function llamarIA(prompt, etiqueta) {
  for (const modelo of MODELOS) {
    const esGroq = modelo.startsWith('groq:');
    for (let intento = 1; intento <= 3; intento++) {
      console.log(`[${etiqueta}] Intento ${intento}/3 con ${modelo}...`);
      let res;
      try {
        res = await pedir(modelo, prompt);
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
        const razon = esGroq ? data?.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
        if (razon === 'MAX_TOKENS' || razon === 'length') console.warn(`[${etiqueta}] La respuesta se cortó por límite de largo.`);
        if (texto && texto.trim()) {
          console.log(`[${etiqueta}] Respuesta de ${modelo}`);
          return texto;
        }
        console.log('  respuesta vacía, reintento...');
        continue;
      }

      const status = res.status;
      const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
      if (status === 404 || (esGroq && status === 400)) {
        console.log(`  ${modelo} no disponible, paso al siguiente`);
        break;
      }
      if (status === 429 && (/exceeded your current quota/i.test(msg) || esGroq)) {
        console.log(`  Se acabó el cupo de ${modelo}, paso al siguiente modelo.`);
        break;
      }
      if (status === 503 || status === 429) {
        console.log(`  ${modelo} saturado (${status}), esperando 30s...`);
        await esperar(30000);
        continue;
      }
      console.error(`  Error ${status} con ${modelo}: ${msg}`);
      break;
    }
  }
  return null;
}

function parsear(texto, etiqueta) {
  let limpio = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // A veces el modelo mete texto antes o despues del JSON: recortamos.
  const ini = limpio.search(/[{[]/);
  const fin = Math.max(limpio.lastIndexOf('}'), limpio.lastIndexOf(']'));
  if (ini >= 0 && fin > ini) limpio = limpio.slice(ini, fin + 1);
  try {
    const json = JSON.parse(limpio);
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.plan)) return json.plan;
    return null;
  } catch (e) {
    console.error(`[${etiqueta}] JSON inválido:`, e.message);
    console.error(limpio.substring(0, 400));
    return null;
  }
}

// ---------- PASO 1: el guion ----------

const promptGuion = `Eres el guionista del canal "Ingeniería Invisible". Explicas ingeniería cotidiana de forma clara y directa, en videos largos de unos 4 minutos, para un público adulto de toda Latinoamérica.

TEMA E INSTRUCCIONES DEL PRODUCTOR:
${TEMA}

PRIORIDAD: las instrucciones del productor mandan. Si el tema trae partes, orden, inicio, cierre, frases exactas o reglas OBLIGATORIO, síguelas al pie de la letra, por encima de las reglas generales de abajo.

LO MÁS IMPORTANTE: los PRIMEROS 15 SEGUNDOS.
En un video largo la gente abandona en el primer medio minuto. Las primeras tres frases deciden si se queda.
${GANCHO ? `La PRIMERA FRASE debe ser exactamente: ${GANCHO}` : `La PRIMERA FRASE debe tener máximo 12 palabras, hablarle al espectador de tú y contener una consecuencia, un contraste o algo que contradiga lo que la gente cree.`}
NUNCA empieces con: "Imagina", "Sabías que", "En este video", "Hoy vamos a", "La ingeniería", "Alguna vez te has preguntado".

Después del gancho, promete en una frase lo que el espectador va a entender al final.

LA ÚLTIMA FRASE antes de la invitación a suscribirse debe cerrar el círculo: retoma la MISMA imagen de la primera frase, ya con la respuesta.

REGLAS GENERALES:
- Entre 550 y 700 palabras. Español neutro de Latinoamérica, frases cortas, números escritos en letras.
- Tono de conversación con un amigo, no de clase.
- PROHIBIDO inventar porcentajes, estadísticas, fechas o cifras que no vengan en el tema. Si no estás seguro de un dato, no lo pongas.
- PROHIBIDO una parte de introducción: se arranca directo con el gancho.
- Al final, una sola línea invitando a suscribirse a Ingeniería Invisible.

Responde SOLO con el texto del guion. Sin JSON, sin títulos, sin comillas, sin marcas de sección ni números de parte. Solo el texto corrido que va a leer la voz.`;

console.log(`Generando guion para: "${TEMA.slice(0, 120)}"...`);
const textoGuion = await llamarIA(promptGuion, 'guion');
if (!textoGuion) {
  console.error('No se pudo obtener el guion');
  process.exit(1);
}

let guion = textoGuion
  .replace(/```/g, '')
  .replace(/^\s*(guion|guión)\s*:?\s*/i, '')
  .replace(/^\s*(introducci[oó]n|parte\s*\d+|secci[oó]n\s*\d+)\s*:?.*$/gim, '')
  .replace(/[#*_]/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// Si el modelo no respetó el gancho obligatorio, se pone a mano
if (GANCHO) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  if (!norm(guion).startsWith(norm(GANCHO).slice(0, 25))) {
    console.log('AVISO: el modelo no respetó la primera frase, la pongo yo');
    const resto = guion.replace(/^[^.?!]*[.?!]\s*/, '');
    guion = `${/[.?!]$/.test(GANCHO) ? GANCHO : GANCHO + '.'} ${resto}`.trim();
  }
}

const palabras = guion.split(/\s+/).length;
console.log(`\nPALABRAS: ${palabras} (aprox ${Math.round(palabras / 2.6)}s de video)`);
if (palabras < 400) console.warn('AVISO: el guion salió corto.');

// Pausa corta para no chocar con el limite de solicitudes por minuto
await esperar(15000);

// ---------- PASO 2: el plan de tomas ----------

const promptPlan = `Eres el director de fotografía del canal "Ingeniería Invisible". Te dan un guion ya escrito y armas el plan visual.

INSTRUCCIONES DEL PRODUCTOR (úsalas para las búsquedas y los nombres de las secciones):
${TEMA}

GUION:
"""
${guion}
"""

Arma el plan de tomas. Responde SOLO con un array JSON, sin backticks ni texto extra:

[
  {"desde":"","clip":"nombre-en-espanol.mp4","buscar":"english search query for Pexels","seccion":"Nombre de sección","etiquetas":[{"texto":"TEXTO CORTO","cuando":"fragmento exacto del guion"}]}
]

REGLAS:
- 14 a 18 tomas. Cada una es un cambio visual de 12 a 18 segundos.
- clip: nombre descriptivo en español con guiones, terminado en .mp4
- Puedes REPETIR el mismo archivo de clip en tomas distintas. Usa entre 8 y 10 archivos distintos en total.
- buscar: en INGLÉS, concreto y visual, del objeto exacto que se nombra en esa parte. Si el productor dio búsquedas, úsalas. Un archivo de clip siempre lleva la MISMA búsqueda. Nunca uses subscribe, thank you, end screen ni youtube.
- seccion: solo en la primera toma de cada parte del guion; tantas secciones como partes tenga (normalmente de 4 a 6), con 2 o 3 palabras y ortografía perfecta. NUNCA una sección llamada Introducción. En las demás tomas, omite el campo.
- etiquetas: máximo 1 por toma, máximo 4 palabras, y solo en 5 o 6 tomas de todo el video.
- La última toma lleva la etiqueta "Próximo video".

REGLA CRÍTICA DEL CAMPO "desde":
- La primera toma lleva desde: ""
- CADA toma siguiente DEBE llevar en "desde" un fragmento EXACTO y literal del guion de arriba, copiado tal cual, de 4 a 7 palabras seguidas.
- Ese fragmento tiene que aparecer TEXTUALMENTE en el guion. No lo reescribas, no lo resumas, no cambies ni una palabra, no le quites las tildes.
- Los fragmentos van en el mismo orden del guion, sin repetirse, repartidos de principio a fin.
- El campo "cuando" de las etiquetas sigue la misma regla: fragmento exacto del guion.

SOLO el array JSON.`;

const textoPlan = await llamarIA(promptPlan, 'plan');
if (!textoPlan) {
  console.error('No se pudo obtener el plan');
  process.exit(1);
}

let plan = parsear(textoPlan, 'plan');
if (!Array.isArray(plan) || !plan.length) {
  console.error('El plan no es un array válido');
  process.exit(1);
}

// Quitar secciones llamadas Introducción y búsquedas prohibidas
const PROHIBIDAS = /subscri|thank|watching|intro|outro|end ?screen|youtube|like button|channel/i;
let ultimaBusqueda = 'city street';
plan = plan.map((t) => {
  const toma = {...t};
  if (toma.seccion && /introducci/i.test(toma.seccion)) delete toma.seccion;
  if (!toma.buscar || PROHIBIDAS.test(toma.buscar)) toma.buscar = ultimaBusqueda;
  else ultimaBusqueda = toma.buscar;
  return toma;
});

// ---------- Controles ----------

console.log(`TOMAS: ${plan.length} (aprox ${(palabras / 2.6 / plan.length).toFixed(1)}s por toma)`);
if (plan.length < 10) console.warn('AVISO: pocas tomas, el ritmo va a quedar lento.');

const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const guionNorm = normalizar(guion);
let fallos = 0;
plan.forEach((toma, i) => {
  if (i === 0 || !toma.desde) return;
  if (!guionNorm.includes(normalizar(toma.desde))) {
    console.warn(`AVISO toma ${i + 1}: "${toma.desde}" no aparece en el guion`);
    fallos++;
  }
});
if (fallos) console.warn(`${fallos} de ${plan.length} tomas se van a repartir por tiempo.`);

const frases = guion.split(/(?<=[.!?])\s+/);
console.log(`\nPRIMERA: ${frases[0]}`);
console.log(`ULTIMA:  ${frases[frases.length - 1]}\n`);

await fs.writeFile('public/guion.txt', guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(plan, null, 2), 'utf8');

console.log(`Guion: ${guion.length} caracteres`);
console.log(`Plan: ${plan.length} tomas`);
console.log('Listo.');
