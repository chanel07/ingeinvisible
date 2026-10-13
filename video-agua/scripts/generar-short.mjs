import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = (process.env.TEMA ?? '').trim();

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const MODELOS = ['gemini-3.6-flash', 'gemini-2.5-flash'];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const quitarBackticks = (t) => t.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
const textoDe = (data) => (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();

// Frase de gancho obligatoria que viene dentro del tema (si la hay)
const GANCHO = (() => {
  const m = TEMA.match(/primera frase del guion debe ser exactamente:\s*(.+?)(?=\s+OBLIGATORIO|\s+Búsquedas de clips|$)/i);
  return m ? m[1].trim() : '';
})();

// El tema sin instrucciones, para la investigacion
const TEMA_CORTO = TEMA.split('OBLIGATORIO')[0].trim();

// Frase con la que empieza la escena cotidiana. Se elige al azar para que no todos
// los Shorts suenen igual. Si el productor ya pidio una en el tema, se respeta la suya.
const APERTURAS = ['Imagina que', 'Te ha pasado que', 'Seguro has visto', 'Piensa en la última vez que', 'Seguro te ha pasado que'];
const APERTURA_PEDIDA = /(imagina que|te ha pasado|seguro has visto|piensa en la [uú]ltima vez)/i.test(TEMA.split('OBLIGATORIO').slice(1).join(' '));
const APERTURA = APERTURAS[Math.floor(Math.random() * APERTURAS.length)];

async function llamar(modelo, cuerpo) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(cuerpo),
  });
  return res;
}

// ---------- PASO 1: investigacion con Google ----------
// 2.5-flash primero: suele tener mas cupo gratis para busquedas
const MODELOS_INVESTIGACION = ['gemini-2.5-flash', 'gemini-3.6-flash'];

async function investigar() {
  const prompt = `Investiga este tema para un video corto de divulgación en español: ${TEMA_CORTO}

Busca información confiable y entrega NOTAS en viñetas, en español, con:
- El mecanismo explicado paso a paso: qué pasa, por qué pasa y qué lo causa.
- De 3 a 5 datos concretos y verificables: números, nombres técnicos, fechas o hechos históricos.
- Los mitos o errores comunes sobre el tema, si existen.
- La consecuencia práctica o el peligro para una persona común, y qué hacer.
- Cómo se llama el objeto principal en distintos países de Latinoamérica, si cambia.
Distingue la explicación científica de las explicaciones populares que circulan en internet: si una explicación muy repetida es falsa o inexacta, escríbela con la etiqueta MITO.
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
          const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
          console.log(`  ${modelo} no acepta búsqueda (${res.status}): ${msg}`);
          break;
        }
        if (res.status === 429) {
          const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
          console.log(`  429 (cupo o límite de velocidad): ${msg}`);
          console.log('  esperando 60s...');
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

// ---------- PASO 2: guion y plan ----------
function promptGuion(notas) {
  return `Eres el guionista del canal de YouTube "Ingeniería Invisible". Explicas en Shorts verticales cómo funcionan, y cuándo son peligrosas, las cosas que la gente usa o ve todos los días. El público es adulto, de toda Latinoamérica (sobre todo México, Argentina, Colombia, Perú y Chile).

TEMA E INSTRUCCIONES DEL PRODUCTOR:
${TEMA}

NOTAS DE INVESTIGACIÓN (úsalas como fuente; no inventes datos que no estén aquí o que no sean de conocimiento seguro):
${notas || '(sin notas: usa solo conocimiento seguro y evita números dudosos)'}

PRIORIDAD DE LAS FUENTES:
- La explicación y las prohibiciones del productor mandan. Si las notas contradicen al productor, sigue al productor.
- Lo que las notas marquen como MITO nunca se dice como cierto; solo puede mencionarse para desmentirlo.
- No repitas explicaciones populares de internet como si fueran ciertas. Si no estás seguro de un dato, omítelo: es mejor un dato menos que un dato falso.

REGLAS DEL GUION:
- Entre 55 y 68 palabras (unos 22 a 26 segundos). Es solo el texto que el narrador dice en voz alta. Cada palabra debe ganarse su lugar.
- TONO: es una conversación con un amigo, no una clase ni una enciclopedia. Háblale de tú, con palabras de todos los días. Se vale una pregunta corta al espectador.
- Estructura obligatoria, en este orden:
  1. Gancho de máximo 12 palabras, hablándole al espectador de tú.${GANCHO ? ` Debe ser exactamente: ${GANCHO}` : ''}
  2. Escena cotidiana: UNA sola frase corta, de máximo 14 palabras, que ponga al espectador en una situación que seguramente ha vivido.${APERTURA_PEDIDA ? ' Usa la forma de empezar que pidió el productor.' : ` Debe empezar con: ${APERTURA}`}
  3. El mecanismo paso a paso: causa y efecto, contado con una comparación de la vida diaria.
  4. Al menos UN dato concreto de las notas: un número, un nombre técnico o un hecho histórico.
  5. La consecuencia práctica para el espectador: qué hacer o qué evitar.
  6. Cierre: una frase COMPLETA, de al menos 10 palabras, que conecte con el gancho y deje una idea clara para recordar. Puede empezar con La próxima vez que, pero solo si queda natural; en ese caso debe decir qué va a pasar o qué va a recordar el espectador (por ejemplo: La próxima vez que veas X, recuerda que Y). Nunca dejes la frase a medias.
- Frases cortas, máximo 18 palabras cada una. La escena y el cierre no pueden quitarle espacio a la explicación: si falta espacio, acorta la escena, nunca el mecanismo ni el dato.
- Español neutro de Latinoamérica. Si el objeto tiene nombres distintos por país, menciona dos (por ejemplo: foco o bombillo, llave o grifo).
- Escribe los números en letras (cincuenta grados, no 50 grados).
- PROHIBIDO: frases de relleno como "es fascinante", "increíble", "la ingeniería es asombrosa", "¿sabías que...?", "en el mundo moderno", "hoy te voy a contar", "en este video", "no lo vas a creer", "suscríbete".
- PROHIBIDO dentro del guion: títulos, números de sección, notas de clips, de tomas, de escenas o de imágenes, emojis, hashtags y corchetes. Solo narración.
- No exageres el peligro. Si algo es raro, dilo como raro.

REGLAS DEL PLAN DE TOMAS:
- Entre 4 y 7 tomas, en el orden del guion.
- "desde": frase EXACTA de 3 a 6 palabras copiada del guion donde empieza esa toma. La primera toma lleva "desde": "".
- "clip": nombre único en español con guiones, terminado en .mp4 (por ejemplo cable-caliente.mp4).
- "buscar": búsqueda en INGLÉS para video de stock, concreta y visual, del objeto exacto que se nombra en esa parte (por ejemplo "gas stove flame", no "danger"). Si el productor dio búsquedas, úsalas. NUNCA uses subscribe, thank you, intro, outro, youtube ni texto.
- "etiquetas": lista con 0 o 1 etiqueta por toma: {"texto": "máximo 3 palabras", "cuando": "frase exacta del guion"}.

Responde SOLO con este JSON:
{"guion": "...", "plan": [{"desde": "", "clip": "nombre.mp4", "buscar": "english query", "etiquetas": [{"texto": "TEXTO", "cuando": "frase"}]}]}`;
}

// Modelos para escribir el guion; el ultimo es el mas liviano, como respaldo
const MODELOS_GUION = ['gemini-3.6-flash', 'gemini-2.5-flash'];

// Limite de palabras: si el guion se pasa, se le pide a Gemini que lo acorte
const MAX_PALABRAS = 70;
const contarPalabras = (g) => g.replace(/[#*_\[\]]/g, ' ').split(/\s+/).filter(Boolean).length;

async function generarGuion(notas) {
  const base = promptGuion(notas);
  let correccion = '';
  for (const modelo of MODELOS_GUION) {
    for (let intento = 1; intento <= 4; intento++) {
      try {
        console.log(`Escribiendo guion con ${modelo} (intento ${intento}/4)...`);
        const config = {temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json'};
        // Los modelos 2.5 gastan espacio "pensando" y cortan el JSON: se les apaga
        if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
        const res = await llamar(modelo, {
          contents: [{parts: [{text: base + correccion}]}],
          generationConfig: config,
        });
        if (res.status === 404) {
          console.log(`  ${modelo} no disponible, paso al siguiente`);
          break;
        }
        if (res.status === 429) {
          const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 220);
          console.log(`  429 (límite de solicitudes): ${msg}`);
          if (/exceeded your current quota/i.test(msg)) {
            console.log(`  Se acabó el cupo de ${modelo}, paso al siguiente modelo.`);
            break;
          }
          console.log('  esperando 60s...');
          await esperar(60000);
          continue;
        }
        if (!res.ok) {
          console.log(`  respuesta ${res.status}, esperando 40s...`);
          await esperar(40000);
          continue;
        }
        const texto = quitarBackticks(textoDe(await res.json()));
        const json = JSON.parse(texto);
        if (!(typeof json.guion === 'string' && json.guion.trim() && Array.isArray(json.plan) && json.plan.length >= 2)) {
          console.log('  respuesta incompleta, reintento...');
          continue;
        }
        const n = contarPalabras(json.guion);
        if (n > MAX_PALABRAS && intento < 4) {
          console.log(`  el guion tiene ${n} palabras, es demasiado largo; pido uno más corto...`);
          correccion = `

CORRECCIÓN OBLIGATORIA: tu guion anterior tenía ${n} palabras y el máximo es ${MAX_PALABRAS - 5}. Reescríbelo más corto: conserva el gancho exacto, el mecanismo principal y un solo dato concreto; quita ejemplos de más, listas y repeticiones. Una sola idea.`;
          continue;
        }
        console.log(`  guion escrito con ${modelo} (${n} palabras)`);
        return json;
      } catch (e) {
        console.log(`  JSON inválido o cortado (${e.message}), reintento...`);
        await esperar(5000);
      }
    }
  }
  return null;
}

// ---------- Limpieza y validacion ----------
const PAL = /^\s*[(\[]?\s*\d*[.)]?\s*(clip|toma|escena|visual|imagen|b-roll|secci[oó]n|section|parte|cap[ií]tulo|t[ií]tulo|nota)\s*\d*\s*:.*$/gim;
const MARCA_EN_LINEA = /[(\[]\s*(clip|toma|escena|visual|imagen|secci[oó]n|nota)\s*\d*\s*:[^)\]]*[)\]]/gi;
const PROHIBIDAS_BUSQUEDA = /subscri|thank|watching|intro|outro|end ?screen|youtube|like button|channel/i;

function limpiarGuion(g) {
  return g
    .replace(PAL, '')
    .replace(MARCA_EN_LINEA, '')
    .replace(/[#*_\[\]]/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function forzarGancho(g) {
  if (!GANCHO) return g;
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  if (norm(g).startsWith(norm(GANCHO).slice(0, 25))) return g;
  console.log('AVISO: Gemini no respetó el gancho, lo pongo yo');
  const resto = g.replace(/^[^.?!]*[.?!]\s*/, '');
  const gancho = /[.?!]$/.test(GANCHO) ? GANCHO : GANCHO + '.';
  return `${gancho} ${resto}`.trim();
}

function normalizarPlan(plan) {
  const usados = new Set();
  let ultimaBusqueda = '';
  return plan
    .filter((t) => t && typeof t === 'object')
    .map((t, i) => {
      let clip = String(t.clip ?? `toma-${i + 1}`)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\.mp4$/, '')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || `toma-${i + 1}`;
      while (usados.has(clip)) clip += `-${i + 1}`;
      usados.add(clip);

      let buscar = String(t.buscar ?? '').trim();
      if (!buscar || PROHIBIDAS_BUSQUEDA.test(buscar)) buscar = ultimaBusqueda || TEMA_CORTO.split(' ').slice(0, 4).join(' ');
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

// ---------- Ejecucion ----------
console.log(`Generando Short para: "${TEMA_CORTO}"`);
console.log(APERTURA_PEDIDA ? 'Escena: la pidió el productor en el tema' : `Escena: empieza con "${APERTURA}"`);

const notas = await investigar();
if (notas) {
  console.log('\n----- NOTAS DE INVESTIGACIÓN -----\n' + notas + '\n----------------------------------\n');
} else {
  console.log('AVISO: sin investigación, sigo solo con el tema');
}

// Pausa corta para no chocar con el limite de solicitudes por minuto
if (notas) {
  console.log('Pausa de 20s antes de escribir el guion...');
  await esperar(20000);
}

const resultado = await generarGuion(notas);
if (!resultado) {
  console.error('No se pudo generar el guion después de varios intentos');
  process.exit(1);
}

let guion = forzarGancho(limpiarGuion(resultado.guion));
const plan = normalizarPlan(resultado.plan);

const palabras = guion.split(/\s+/).filter(Boolean).length;
const frases = guion.match(/[^.?!]+[.?!]+/g) ?? [guion];
console.log(`PRIMERA: ${frases[0].trim()}`);
console.log(`ULTIMA: ${frases[frases.length - 1].trim()}`);
console.log(`PALABRAS: ${palabras}${palabras > 75 ? ' (AVISO: largo)' : ''}${palabras < 45 ? ' (AVISO: corto)' : ''}`);
const ultima = frases[frases.length - 1].trim();
if (ultima.split(/\s+/).length < 8) console.log('AVISO: la última frase es muy corta, revisa que el cierre no haya quedado a medias');

await fs.writeFile('public/guion.txt', guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(plan, null, 2), 'utf8');
console.log(`Plan: ${plan.length} tomas`);
plan.forEach((t, i) => console.log(`  ${i + 1}. ${t.clip} <- "${t.buscar}"${t.desde ? ` desde "${t.desde}"` : ''}`));
console.log('Listo.');
