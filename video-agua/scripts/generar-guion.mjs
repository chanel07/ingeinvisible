import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const GROQ = (process.env.GROQ_KEY ?? '').trim();
const TEMA = (process.env.TEMA ?? '').trim();

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

// Duracion del video en minutos (la manda el workflow). 4 = video normal; 8 o 10 = documental.
const MINUTOS = Math.min(15, Math.max(3, Number(process.env.MINUTOS) || 4));
const DOCUMENTAL = MINUTOS >= 7;
const MIN_PALABRAS = Math.round(MINUTOS * 125);
const MAX_PALABRAS = Math.round(MINUTOS * 140);
const TOMAS_MIN = Math.round((MINUTOS * 60) / 15);
const TOMAS_MAX = Math.round((MINUTOS * 60) / 11);
const CLIPS_DISTINTOS = `${Math.round(TOMAS_MIN * 0.5)} y ${Math.round(TOMAS_MAX * 0.6)}`;
console.log(`DURACION: unos ${MINUTOS} minutos (${MIN_PALABRAS} a ${MAX_PALABRAS} palabras)${DOCUMENTAL ? ', estilo documental' : ''}`);

// Primero los dos Gemini; si los dos se quedan sin cupo, Groq como respaldo
const MODELOS = ['gemini-3.6-flash', 'gemini-2.5-flash'];
if (GROQ) MODELOS.push('groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.6-27b', 'groq:openai/gpt-oss-20b');
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
      body: JSON.stringify({model: modelo.slice(5), messages: [{role: 'user', content: prompt}], temperature: 0.8, max_tokens: 8192, ...(modelo.includes('gpt-oss') ? {reasoning_effort: 'low'} : {})}),
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
        console.log(`  ${modelo} no disponible (${status}): ${msg}`);
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

// El guionista NO debe ver las instrucciones de las plantillas animadas: si las ve,
// a veces copia ese texto tecnico dentro de la narracion. Solo las usa el plan.
// Tampoco ve las instrucciones de las tomas ni las busquedas de clips: si las ve,
// a veces las lee en voz alta ("la toma uno debe buscar exactamente...").
const TECNICO = /plantilla|\btomas?\b|\bbuscar\b|b[uú]squedas? de clips|\bclips?\b|\bplan\b|secciones/i;
const TEMA_GUION = TEMA
  .replace(/B[uú]squedas? de clips[\s\S]*$/i, '')
  .split(/(?=OBLIGATORIO:)/)
  // La descripcion del tema (la primera parte) siempre se queda; solo se quitan
  // las reglas OBLIGATORIO que hablan de tomas, clips, plantillas o secciones.
  .filter((parte, i) => i === 0 || !TECNICO.test(parte))
  .join('')
  .replace(/[^.]*(plantilla|la toma (uno|dos|tres|cuatro|cinco|\d+)|buscar exactamente)[^.]*\./gi, '')
  .trim();

// Limpieza del guion: quita cualquier resto de JSON que se haya colado en la narracion
const limpiarGuion = (t) =>
  t
    .replace(/```/g, '')
    .replace(/^\s*(guion|guión)\s*:?\s*/i, '')
    .replace(/^\s*(introducci[oó]n|parte\s*\d+|secci[oó]n\s*\d+|cap[ií]tulo\s*\d+)\s*:?.*$/gim, '')
    .replace(/["“”]?plantilla["“”]?\s*:\s*\{[^}]*\}?/gi, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/["“”]?(tipo|mito|verdad|items|titulo)["“”]\s*:\s*["“”][^"“”]*["“”],?/gi, '')
    .replace(/[{}"“”]/g, '')
    // Frases tecnicas que se colaron: se borra la frase completa
    .replace(/[^.!?]*(buscar exactamente|la toma (uno|dos|tres|cuatro|cinco|\d+)|b[uú]squedas? de clips|el plan debe)[^.!?]*[.!?]/gi, '')
    .replace(/[#*_]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const promptGuion = `Eres el guionista del canal "Ingeniería Invisible". Explicas ingeniería cotidiana de forma clara y directa, en videos largos de unos ${MINUTOS} minutos, para un público adulto de toda Latinoamérica.${DOCUMENTAL ? '\n\nESTILO DOCUMENTAL: este es un video largo tipo documental. Narra como un buen documental de televisión: con ritmo, curiosidad y pequeños momentos de sorpresa, pero siempre claro y cercano. Divide el contenido en capítulos (los que indique el productor, o de 6 a 8). Cada capítulo empieza con una frase de transición que enganche (por ejemplo: Pero aquí viene lo más sorprendente), explica UNA idea con ejemplos de la vida diaria, y termina dejando una pregunta o una curiosidad que lleve al siguiente. Mezcla la explicación de cómo funciona con historias, datos curiosos y consecuencias prácticas.' : ''}

TEMA E INSTRUCCIONES DEL PRODUCTOR:
${TEMA_GUION}

PRIORIDAD: las instrucciones del productor mandan. Si el tema trae partes, orden, inicio, cierre, frases exactas o reglas OBLIGATORIO, síguelas al pie de la letra, por encima de las reglas generales de abajo.

LO MÁS IMPORTANTE: los PRIMEROS 15 SEGUNDOS.
En un video largo la gente abandona en el primer medio minuto. Las primeras tres frases deciden si se queda.
${GANCHO ? `La PRIMERA FRASE debe ser exactamente: ${GANCHO}` : `La PRIMERA FRASE debe tener máximo 12 palabras, hablarle al espectador de tú y contener una consecuencia, un contraste o algo que contradiga lo que la gente cree.`}
NUNCA empieces con: "Imagina", "Sabías que", "En este video", "Hoy vamos a", "La ingeniería", "Alguna vez te has preguntado".

Después del gancho, promete en una frase lo que el espectador va a entender al final.

LA ÚLTIMA FRASE antes de la invitación a suscribirse debe cerrar el círculo: retoma la MISMA imagen de la primera frase, ya con la respuesta.

REGLAS GENERALES:
- Entre ${MIN_PALABRAS} y ${MAX_PALABRAS} palabras. CUENTA LAS PALABRAS: un guion más corto deja el video incompleto. Español neutro de Latinoamérica, frases cortas, números escritos en letras.
- Tono de conversación con un amigo, no de clase.
- PROHIBIDO inventar porcentajes, estadísticas, fechas o cifras que no vengan en el tema. Si no estás seguro de un dato, no lo pongas.
- PROHIBIDO una parte de introducción: se arranca directo con el gancho.
- Al final, una sola línea invitando a suscribirse a Ingeniería Invisible.
- PROHIBIDO escribir código, JSON, llaves, comillas de campos o instrucciones técnicas: todo lo que escribas lo va a leer la voz en voz alta.

Responde SOLO con el texto del guion. Sin JSON, sin títulos, sin comillas, sin marcas de sección ni números de parte. Solo el texto corrido que va a leer la voz.`;

console.log(`Generando guion para: "${TEMA.slice(0, 120)}"...`);
const textoGuion = await llamarIA(promptGuion, 'guion');
if (!textoGuion) {
  console.error('No se pudo obtener el guion');
  process.exit(1);
}

let guion = limpiarGuion(textoGuion);

// Si el modelo no respetó el gancho obligatorio, se pone a mano
if (GANCHO) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  if (!norm(guion).startsWith(norm(GANCHO).slice(0, 25))) {
    console.log('AVISO: el modelo no respetó la primera frase, la pongo yo');
    const resto = guion.replace(/^[^.?!]*[.?!]\s*/, '');
    guion = `${/[.?!]$/.test(GANCHO) ? GANCHO : GANCHO + '.'} ${resto}`.trim();
  }
}

// Si el guion salio muy corto, se pide de nuevo con una correccion (hasta 2 veces)
for (let intento = 1; intento <= 2; intento++) {
  const n = guion.split(/\s+/).length;
  if (n >= MIN_PALABRAS * 0.9) break;
  console.log(`AVISO: el guion tiene ${n} palabras y el mínimo es ${MIN_PALABRAS}. Pido uno más completo (${intento}/2)...`);
  await esperar(15000);
  const otro = await llamarIA(promptGuion + `\n\nCORRECCIÓN OBLIGATORIA: tu guion anterior tenía solo ${n} palabras y es demasiado corto. Debe tener entre ${MIN_PALABRAS} y ${MAX_PALABRAS} palabras. Desarrolla cada parte con más detalle, ejemplos de la vida diaria y datos del tema, sin relleno ni repeticiones.`, 'guion');
  if (otro) {
    const limpio2 = limpiarGuion(otro);
    if (limpio2.split(/\s+/).length > n) guion = limpio2;
  }
}

const palabras = guion.split(/\s+/).length;
console.log(`\nPALABRAS: ${palabras} (aprox ${Math.round(palabras / 2.1)}s de video)`);
if (palabras < MIN_PALABRAS * 0.9) console.warn('AVISO: el guion salió corto.');
if (/plantilla|"tipo"|\{|\}|buscar exactamente|la toma /i.test(guion)) console.warn('AVISO: quedó texto técnico en el guion, revísalo.');

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
- ${TOMAS_MIN} a ${TOMAS_MAX} tomas. Cada una es un cambio visual de 11 a 15 segundos.
- clip: nombre descriptivo en español con guiones, terminado en .mp4
- Puedes REPETIR el mismo archivo de clip en tomas distintas, pero no seguidas. Usa entre ${CLIPS_DISTINTOS} archivos distintos en total.
- buscar: en INGLÉS, concreto y visual, de lo que se VE en ese momento: el objeto exacto que la voz nombra en esa toma (por ejemplo si la voz dice "la puerta del microondas", buscar "microwave door close up"; nunca algo abstracto como "safety" o "technology"). Si el productor dio búsquedas, úsalas. Un archivo de clip siempre lleva la MISMA búsqueda. Nunca uses subscribe, thank you, end screen ni youtube.
- seccion: solo en la primera toma de cada parte del guion; tantas secciones como partes tenga (normalmente de 4 a 6), con 2 o 3 palabras y ortografía perfecta. NUNCA una sección llamada Introducción. En las demás tomas, omite el campo.
- etiquetas: máximo 1 por toma, máximo 4 palabras, y solo en 5 o 6 tomas de todo el video.
- La última toma lleva la etiqueta "Próximo video".
- plantilla: SOLO si el productor lo pide en el tema. Copia el campo "plantilla" EXACTAMENTE como lo escribió el productor, en la toma que él indicó, y esa toma va sin etiquetas. Si no lo pide, no pongas este campo.

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

// ---------- Anclar cada toma a una frase REAL del guion ----------
// La IA a veces copia mal el fragmento "desde" (cambia una palabra, quita una tilde).
// Si no se encuentra, las imagenes se desfasan de la voz. Aqui se busca en el guion
// la frase mas parecida, en orden, y se reemplaza por el texto exacto.
const normPalabra = (w) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const COMUNES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'que', 'en', 'a', 'al', 'es', 'se', 'su', 'por', 'con', 'para', 'lo', 'le', 'no', 'tu', 'te', 'mas', 'pero', 'como']);
const palabrasGuion = guion.split(/\s+/).filter(Boolean);
const ng = palabrasGuion.map(normPalabra);
let posicion = 0;
let ancladas = 0;
let sinAncla = 0;
const buscarSecuencia = (seq, desde) => {
  for (let j = desde; j <= ng.length - seq.length; j++) {
    let ok = true;
    for (let k = 0; k < seq.length; k++) if (ng[j + k] !== seq[k]) { ok = false; break; }
    if (ok) return j;
  }
  return -1;
};
plan.forEach((toma, i) => {
  if (i === 0) {
    toma.desde = '';
    return;
  }
  const nd = String(toma.desde ?? '').split(/\s+/).map(normPalabra).filter(Boolean);
  let encontrado = -1;
  // Primero la frase completa; si no aparece, pedazos de 5, 4 y 3 palabras seguidas de la frase
  for (let largo = Math.min(nd.length, 7); largo >= 3 && encontrado < 0; largo--) {
    for (let ini = 0; ini + largo <= nd.length && encontrado < 0; ini++) {
      const seq = nd.slice(ini, ini + largo);
      if (seq.every((w) => COMUNES.has(w))) continue;
      const j = buscarSecuencia(seq, posicion);
      if (j >= 0) encontrado = Math.max(posicion, j - ini);
    }
  }
  if (encontrado >= 0) {
    toma.desde = palabrasGuion.slice(encontrado, encontrado + 5).join(' ').replace(/[.,;:!?¡¿"]+/g, ' ').replace(/\s+/g, ' ').trim();
    posicion = encontrado + 1;
    ancladas++;
  } else {
    sinAncla++;
  }
});
console.log(`ANCLAJE: ${ancladas} tomas ancladas a una frase exacta del guion, ${sinAncla} sin anclar (se reparten por tiempo).`);

// ---------- Controles ----------

console.log(`TOMAS: ${plan.length} (aprox ${(palabras / 2.1 / plan.length).toFixed(1)}s por toma)`);
if (plan.length < TOMAS_MIN * 0.7) console.warn('AVISO: pocas tomas, el ritmo va a quedar lento.');

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
