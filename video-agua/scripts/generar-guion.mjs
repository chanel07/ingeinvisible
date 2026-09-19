import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const MODELOS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamarGemini(prompt, etiqueta) {
  for (const modelo of MODELOS) {
    for (let intento = 1; intento <= 3; intento++) {
      console.log(`[${etiqueta}] Intento ${intento}/3 con ${modelo}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{parts: [{text: prompt}]}],
          generationConfig: {temperature: 0.9, maxOutputTokens: 32000}
        })
      });

      if (res.ok) {
        const data = await res.json();
        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const razon = data.candidates?.[0]?.finishReason;
        if (razon === 'MAX_TOKENS') {
          console.warn(`[${etiqueta}] La respuesta se corto por limite de tokens.`);
        }
        if (texto) {
          console.log(`[${etiqueta}] Respuesta de ${modelo}`);
          return texto;
        }
      }

      const status = res.status;
      if (status === 404) { console.log(`${modelo} no existe`); break; }
      if (status === 503 || status === 429) {
        console.log(`${modelo} saturado (${status}), esperando 30s...`);
        await esperar(30000);
        continue;
      }
      const err = await res.text();
      console.error(`Error ${status} con ${modelo}:`, err.substring(0, 200));
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
  if (ini > 0 || (fin > 0 && fin < limpio.length - 1)) {
    limpio = limpio.slice(ini, fin + 1);
  }
  try {
    return JSON.parse(limpio);
  } catch (e) {
    console.error(`[${etiqueta}] JSON invalido:`, e.message);
    console.error(limpio.substring(0, 400));
    return null;
  }
}

// ---------- PASO 1: el guion ----------

const promptGuion = `Eres el guionista del canal "Ingenieria Invisible". Explicas ingenieria cotidiana de forma clara y directa, en videos de unos 4 minutos.

TEMA: ${TEMA}

LO MAS IMPORTANTE: los PRIMEROS 15 SEGUNDOS.
En un video largo la gente abandona en el primer medio minuto. Las primeras tres frases deciden si se queda.

La PRIMERA FRASE debe cumplir TODO esto:
- Maximo 12 palabras
- Contener un numero concreto, una consecuencia grave, o algo que contradiga lo que la gente cree
- Hablarle al espectador de tu (tu casa, tu carro, tu enchufe)
- NUNCA empezar con: "Imagina", "Sabias que", "En este video", "Hoy vamos a", "La ingenieria", "Alguna vez te has preguntado"

Ejemplos de primeras frases BUENAS:
- "Ese enchufe de tu pared puede freir tu computador en medio segundo."
- "Estas parado sobre cuarenta toneladas de concreto."
- "Un ascensor en caida libre no te mata. Te mata otra cosa."

Ejemplos de primeras frases MALAS (nunca las uses):
- "Imagina enchufar tu licuadora favorita."
- "Alguna vez te has preguntado como funciona la electricidad?"
- "Hoy te explico que pasa cuando conectas mal un aparato."

Despues del gancho, promete lo que el espectador va a entender al final. Una frase. Sin rodeos.

LA ULTIMA FRASE debe cerrar el circulo: retoma la MISMA imagen o palabra de la primera frase, ya con la respuesta. No pongas un dato nuevo suelto al final.

ESTRUCTURA:
1. Gancho (3 frases: el golpe, la consecuencia, la promesa)
2. Cuatro o cinco secciones, cada una con una idea sola
3. Cierre que cierra el circulo
4. Al final, una linea invitando a suscribirse a Ingenieria Invisible

LARGO: entre 550 y 700 palabras. Español neutro, frases cortas, numeros escritos en letras.

Responde SOLO con el texto del guion. Sin JSON, sin titulos, sin comillas, sin marcas de seccion. Solo el texto corrido que va a leer la voz.`;

console.log(`Generando guion para: "${TEMA}"...`);
const textoGuion = await llamarGemini(promptGuion, 'guion');
if (!textoGuion) { console.error('No se pudo obtener el guion'); process.exit(1); }

const guion = textoGuion
  .replace(/```/g, '')
  .replace(/^\s*(guion|guión)\s*:?\s*/i, '')
  .trim();

const palabras = guion.split(/\s+/).length;
console.log(`\nPALABRAS: ${palabras} (aprox ${Math.round(palabras / 2.6)}s de video)`);
if (palabras < 400) console.warn('AVISO: el guion salio corto.');

// ---------- PASO 2: el plan de tomas ----------

const promptPlan = `Eres el director de fotografia del canal "Ingenieria Invisible". Te dan un guion ya escrito y armas el plan visual.

GUION:
"""
${guion}
"""

Arma el plan de tomas. Responde SOLO con un array JSON, sin backticks ni texto extra:

[
  {"desde":"","clip":"nombre-en-espanol.mp4","buscar":"english search query for Pexels","seccion":"Nombre de seccion","etiquetas":[{"texto":"TEXTO CORTO","cuando":"fragmento exacto del guion"}]}
]

REGLAS:
- 14 a 18 tomas. Cada una es un cambio visual de 12 a 18 segundos.
- clip: nombre descriptivo en espanol con guiones, terminado en .mp4
- Puedes REPETIR el mismo archivo de clip en tomas distintas. Usa entre 8 y 10 archivos distintos en total.
- buscar: en INGLES, generico y visual. Un archivo de clip siempre lleva la MISMA busqueda.
- seccion: solo en la primera toma de cada seccion (4 o 5 secciones en todo el video). En las demas tomas, omite el campo.
- etiquetas: maximo 1 por toma, maximo 4 palabras, y solo en 5 o 6 tomas de todo el video.
- La ultima toma lleva la etiqueta "Proximo video".

REGLA CRITICA DEL CAMPO "desde":
- La primera toma lleva desde: ""
- CADA toma siguiente DEBE llevar en "desde" un fragmento EXACTO y literal del guion de arriba, copiado tal cual, de 4 a 7 palabras seguidas.
- Ese fragmento tiene que aparecer TEXTUALMENTE en el guion. No lo reescribas, no lo resumas, no cambies ni una palabra, no le quites las tildes.
- Los fragmentos van en el mismo orden del guion, sin repetirse, repartidos de principio a fin.
- El campo "cuando" de las etiquetas sigue la misma regla: fragmento exacto del guion.

SOLO el array JSON.`;

const textoPlan = await llamarGemini(promptPlan, 'plan');
if (!textoPlan) { console.error('No se pudo obtener el plan'); process.exit(1); }

const plan = parsear(textoPlan, 'plan');
if (!Array.isArray(plan) || !plan.length) {
  console.error('El plan no es un array valido');
  process.exit(1);
}

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
