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

// Plantillas animadas automaticas (mito, lista, si/no, pasos, calculo): la IA las pone
// sola en los momentos clave del guion, una por seccion. Se apagan con PLANTILLAS_AUTO=no.
// Si el productor pide una plantilla en el tema, esa se respeta igual.
const PLANTILLAS_AUTO = (process.env.PLANTILLAS_AUTO ?? 'si').toLowerCase() !== 'no';
const PIDE_PLANTILLA = /plantilla/i.test(TEMA);
const MAX_PLANTILLAS = Math.max(3, Math.min(6, Math.round(MINUTOS * 0.6)));
console.log(PLANTILLAS_AUTO ? `Plantillas animadas automáticas: encendidas (hasta ${MAX_PLANTILLAS})` : 'Plantillas animadas automáticas: apagadas');

// Imagenes del video (IMAGENES): alternado = clips reales en las escenas generales y
// dibujos en las explicaciones (por defecto); dibujado = todo dibujado; clips = solo clips.
const IMAGENES = ['alternado', 'dibujado', 'clips'].includes((process.env.IMAGENES ?? '').trim().toLowerCase()) ? process.env.IMAGENES.trim().toLowerCase() : 'alternado';
const COMO_DIBUJAR = 'Después de "DIBUJAR: " describe en inglés la escena EXACTA que dice la voz: los objetos concretos, la acción, de quién son las manos y el ángulo de cámara (por ejemplo: close up of a hand pulling an adjustable wrench toward its fixed jaw on a nut, a glowing arrow showing the direction). No pidas letras, números, marcas ni logos: el sistema ya dibuja sin letras.';
const REGLA_IMAGENES = IMAGENES === 'dibujado'
  ? `- TODO DIBUJADO: en TODAS las tomas, "buscar" empieza con "DIBUJAR: ". ${COMO_DIBUJAR} Mantén los mismos objetos, colores y lugar de una toma a otra para que se vea como una sola historia.`
  : IMAGENES === 'alternado'
    ? `- IMÁGENES ALTERNADAS: decide toma por toma. Si la voz describe una escena general que seguro existe en video real (una persona usando un objeto común, una mano abriendo algo, un lugar de la casa, la calle), usa una búsqueda normal en inglés. Si la voz explica un detalle específico, un mecanismo, lo que pasa por dentro de un aparato, una dirección, una medida o una comparación que difícilmente existe en un video real, usa "DIBUJAR: ". ${COMO_DIBUJAR} Más o menos la mitad de las tomas van con DIBUJAR.`
    : '- Usa solo búsquedas normales de video, sin DIBUJAR, salvo las que dio el productor.';
console.log(`IMÁGENES: ${IMAGENES}`);

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
  // "Capitulo 1, La nube gigante:" se le pasa solo como "La nube gigante:", para que no lo lea
  .replace(/Cap[ií]tulo\s*\d+\s*,?\s*/gi, '')
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
    // "Capitulo uno, la nube gigante." leido en voz alta: se quita (la tarjeta de seccion ya lo muestra)
    .replace(/\b(cap[ií]tulo|secci[oó]n)\s+(\d+|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|primero|segundo|tercero|cuarto|quinto|sexto|s[eé]ptimo)\b[^.:!?]{0,60}[.:]\s*/gi, '')
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
- PROHIBIDO decir en voz alta "capítulo uno", "capítulo dos", "sección", "parte uno" ni numerar las partes: el paso de una parte a otra se hace con una frase natural de transición (por ejemplo: Pero eso es solo el comienzo). Los nombres de las partes aparecen en pantalla, no se leen.

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
if (/plantilla|"tipo"|\{|\}|buscar exactamente|la toma |cap[ií]tulo (uno|dos|tres|\d)/i.test(guion)) console.warn('AVISO: quedó texto técnico en el guion, revísalo.');

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
- buscar: en INGLÉS, concreto y visual, de lo que se VE en ese momento: el objeto exacto que la voz nombra en esa toma (por ejemplo si la voz dice "la puerta del microondas", buscar "microwave door close up"; nunca algo abstracto como "safety" o "technology"). Si el productor dio búsquedas, úsalas. Evita palabras con doble sentido que traen clips de otra cosa (por ejemplo motor o compressor traen motores de carro; fan trae ventiladores): describe el objeto completo, como "wall mounted air conditioner" o "split air conditioner outdoor unit". Un archivo de clip siempre lleva la MISMA búsqueda. Nunca uses subscribe, thank you, end screen ni youtube.
${REGLA_IMAGENES}${IMAGENES !== 'clips' ? ' Un mismo dibujo puede repetirse en dos tomas seguidas si la voz sigue hablando de lo mismo (mismo archivo de clip y misma búsqueda).' : ''}
- seccion: solo en la primera toma de cada parte del guion; tantas secciones como partes tenga (normalmente de 4 a 6), con 2 o 3 palabras y ortografía perfecta. NUNCA una sección llamada Introducción. En las demás tomas, omite el campo.
- etiquetas: máximo 1 por toma, máximo 4 palabras, y solo en 5 o 6 tomas de todo el video.
- La última toma lleva la etiqueta "Próximo video".
${PLANTILLAS_AUTO ? `- plantilla: ${PIDE_PLANTILLA ? 'primero, si el productor pidió una plantilla en el tema, cópiala EXACTA en la toma que él indicó. Además, ' : ''}pon tú pantallas animadas en los momentos clave, para que el video no se sienta largo:
  * Hasta ${MAX_PLANTILLAS} en todo el video, MÁXIMO UNA por sección (lo ideal es una en casi cada sección). Nunca en la primera toma ni en la última. Entre una y otra, deja varias tomas de video normal.
  * Ponla en la toma donde la voz dice exactamente ese contenido, y esa toma va sin etiquetas.
  * Elige el tipo según lo que dice la voz en esa toma:
    - "mito": la voz desmiente una creencia común. {"tipo":"mito","mito":"la creencia falsa, máximo 8 palabras","verdad":"lo cierto, máximo 8 palabras"}
    - "lista": la voz nombra 3 o 4 datos, señales o ejemplos seguidos. {"tipo":"lista","titulo":"2 a 4 palabras","items":[{"texto":"máximo 5 palabras","cuando":"fragmento exacto del guion donde la voz lo dice"}]}
    - "sino": la voz da consejos de qué hacer y qué no. {"tipo":"sino","titulo":"2 a 4 palabras","si":[{"texto":"máximo 5 palabras","cuando":"fragmento exacto"}],"no":[{"texto":"máximo 5 palabras","cuando":"fragmento exacto"}]}
    - "pasos": la voz explica un proceso en orden, de 3 o 4 pasos. {"tipo":"pasos","titulo":"2 a 4 palabras","items":[{"texto":"máximo 4 palabras","nota":"detalle de máximo 6 palabras","cuando":"fragmento exacto"}]}
    - "calculo": la voz hace una cuenta con números. {"tipo":"calculo","titulo":"2 a 4 palabras","items":[{"texto":"el valor con su unidad, por ejemplo 1.085 W","nota":"qué es, máximo 3 palabras","op":"signo que va antes (×, ÷, +, −), vacío en el primero","cuando":"fragmento exacto"}],"resultado":"el total con su unidad","cuandoResultado":"fragmento exacto"}
  * TODO el contenido sale de lo que dice el guion: los mismos datos y los mismos números, nada inventado. Si en una sección no hay un mito, una lista, consejos, pasos o una cuenta clara, esa sección va sin plantilla.
  * "cuando" y "cuandoResultado": fragmento EXACTO del guion, de 3 a 6 palabras seguidas, dentro de lo que dice la voz en esa toma, en orden.
  * Ortografía perfecta, con tildes. Textos cortos: en pantalla se leen en un segundo.
` : `- plantilla: SOLO si el productor lo pide en el tema. Copia el campo "plantilla" EXACTAMENTE como lo escribió el productor, en la toma que él indicó, y esa toma va sin etiquetas. Si no lo pide, no pongas este campo.
`}
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
console.log(`DIBUJOS EN EL PLAN: ${new Set(plan.filter((t) => /^DIBUJAR:/i.test(String(t.buscar))).map((t) => t.clip)).size} dibujos distintos en ${plan.length} tomas`);
console.log(`ANCLAJE: ${ancladas} tomas ancladas a una frase exacta del guion, ${sinAncla} sin anclar (se reparten por tiempo).`);

// ---------- Plantillas animadas: revision ----------
// Se quita toda plantilla mal armada (queda el clip normal), y se respetan los limites:
// ninguna en la primera ni en la ultima toma, maximo una por seccion, con espacio entre ellas.
{
  const corto = (t, n) => typeof t === 'string' && t.trim() && t.trim().split(/\s+/).length <= n;
  const enGuion = (f) => !!f && guionNorm2.includes(norm2(f));
  const norm2 = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const guionNorm2 = norm2(guion);
  const limpiarItems = (lista, max) => (Array.isArray(lista) ? lista : [])
    .map((it) => (typeof it === 'string' ? {texto: it} : it))
    .filter((it) => it && corto(it.texto, max))
    .map((it) => {
      const o = {texto: String(it.texto).trim()};
      if (it.nota && corto(it.nota, 8)) o.nota = String(it.nota).trim();
      if (typeof it.op === 'string') o.op = it.op.trim();
      if (enGuion(it.cuando)) o.cuando = String(it.cuando).trim();
      return o;
    });
  const revisar = (p) => {
    if (!p || typeof p !== 'object') return null;
    const titulo = corto(p.titulo, 5) ? String(p.titulo).trim() : undefined;
    if (p.tipo === 'mito') return corto(p.mito, 12) && corto(p.verdad, 12) ? {tipo: 'mito', mito: p.mito.trim(), verdad: p.verdad.trim()} : null;
    if (p.tipo === 'lista') {
      const items = limpiarItems(p.items, 7).slice(0, 5);
      return items.length >= 2 ? {tipo: 'lista', ...(titulo ? {titulo} : {}), items} : null;
    }
    if (p.tipo === 'pasos') {
      const items = limpiarItems(p.items, 6).slice(0, 5);
      return items.length >= 2 ? {tipo: 'pasos', ...(titulo ? {titulo} : {}), items} : null;
    }
    if (p.tipo === 'sino') {
      const si = limpiarItems(p.si, 7).slice(0, 3);
      const no = limpiarItems(p.no, 7).slice(0, 3);
      return si.length + no.length >= 2 ? {tipo: 'sino', ...(titulo ? {titulo} : {}), si, no} : null;
    }
    if (p.tipo === 'calculo') {
      const items = limpiarItems(p.items, 6).filter((it) => /\d/.test(it.texto)).slice(0, 4);
      if (items.length < 2 || !(typeof p.resultado === 'string' && /\d/.test(p.resultado))) return null;
      return {tipo: 'calculo', ...(titulo ? {titulo} : {}), items, resultado: p.resultado.trim(), ...(enGuion(p.cuandoResultado) ? {cuandoResultado: String(p.cuandoResultado).trim()} : {})};
    }
    if (['reto', 'clase'].includes(p.tipo) && PIDE_PLANTILLA) return p; // las pide el productor: van tal cual
    return null;
  };
  let seccion = 0;
  const usadaEnSeccion = new Set();
  let ultimaPos = -99;
  const separacion = Math.max(2, Math.round(plan.length / 12)); // tomas minimas entre una plantilla y otra
  const puestas = [];
  plan.forEach((toma, i) => {
    if (toma.seccion) seccion++;
    if (!toma.plantilla) return;
    const original = toma.plantilla;
    const p = revisar(original);
    let motivo = '';
    if (!p) motivo = 'mal armada';
    else if (i === 0 || i === plan.length - 1) motivo = 'en la primera o la última toma';
    else if (usadaEnSeccion.has(seccion)) motivo = 'ya hay una en esa sección';
    else if (i - ultimaPos < separacion) motivo = 'muy pegada a la anterior';
    else if (puestas.length >= MAX_PLANTILLAS) motivo = 'ya hay suficientes';
    if (motivo) {
      console.log(`  plantilla quitada en la toma ${i + 1} (${original?.tipo ?? '?'}): ${motivo}`);
      delete toma.plantilla;
      return;
    }
    toma.plantilla = p;
    toma.etiquetas = [];
    usadaEnSeccion.add(seccion);
    ultimaPos = i;
    puestas.push(`${i + 1}:${p.tipo}`);
  });
  console.log(`PLANTILLAS ANIMADAS: ${puestas.length}${puestas.length ? ` (${puestas.join(', ')})` : ''}`);
  plan.forEach((toma, i) => {
    if (toma.plantilla) console.log(`  toma ${i + 1} [${toma.plantilla.tipo}]: ${JSON.stringify(toma.plantilla).slice(0, 220)}`);
  });
  if (PLANTILLAS_AUTO && puestas.length < 2) console.log('AVISO: el video quedó con pocas plantillas animadas.');
}

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
