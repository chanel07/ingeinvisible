import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const GROQ = (process.env.GROQ_KEY ?? '').trim();
const TEMA = process.env.TEMA ?? '';
const TIPO = process.env.TIPO === 'largo' ? 'largo' : 'short';

if (!KEY && !GROQ) {
  console.error('Falta GEMINI_KEY');
  process.exit(0);
}

let guion = '';
try {
  guion = await fs.readFile('public/guion.txt', 'utf8');
} catch {
  console.error('No encontré public/guion.txt');
  process.exit(0);
}

const temaCorto = TEMA.split('(')[0].split('OBLIGATORIO')[0].trim();
const maxTitulo = TIPO === 'short' ? 50 : 70;

const prompt = `Eres el editor del canal de YouTube "Ingeniería Invisible", que explica en español cómo funcionan, y cuándo son peligrosas, las cosas que la gente usa todos los días. El público es de todos los países hispanohablantes.

Te paso el tema y el guion de un ${TIPO === 'short' ? 'Short vertical de 20 a 30 segundos' : 'video largo horizontal'}. Escribe el título, la descripción, los hashtags y las etiquetas para publicarlo.

TEMA: ${temaCorto}

GUION:
${guion}

REGLAS DEL TÍTULO:
- Una pregunta que la gente se haría, con signos ¿ ? a los dos lados.
- Mayúscula inicial y ortografía perfecta, con todas las tildes (qué, por qué, cómo, dónde, está, también).
- Máximo ${maxTitulo} caracteres. Mientras más corto, mejor.
- Palabras que se entiendan en cualquier país hispanohablante.
- Sin emojis, sin hashtags, sin palabras en mayúscula sostenida y sin prometer algo que el video no cumpla.

REGLAS DE LA DESCRIPCIÓN:
- 2 o 3 frases cortas que resuman la respuesta y den ganas de ver el video.
- Solo lo que el guion explica, nada inventado.
- Ortografía perfecta, español neutro.
- Termina con esta frase exacta: Suscríbete para descubrir cada día cómo funcionan las cosas que usas.
- Sin hashtags dentro de la descripción.

REGLAS DE LOS HASHTAGS:
- Entre 3 y 5, en minúscula, sin espacios, con tilde si la palabra la lleva.
- Primero los más específicos del tema, después #cómofunciona${TIPO === 'short' ? ' y al final #shorts' : ''}.

REGLAS DE LAS ETIQUETAS:
- Entre 8 y 12 etiquetas, en minúscula, sin el símbolo #.
- Incluye: el objeto o tema principal, la pregunta como la escribiría alguien en el buscador, sinónimos que se usan en otros países (por ejemplo elevador y ascensor, lapicero y bolígrafo), la palabra técnica si existe, y al final: cómo funciona, ingeniería, ingeniería invisible.
- Ninguna etiqueta puede tener comas por dentro.

Responde SOLO con este JSON:
{"titulo": "...", "descripcion": "...", "hashtags": ["#...", "#..."], "etiquetas": ["...", "..."]}`;

// Primero los dos Gemini; si los dos se quedan sin cupo, Groq como respaldo
const MODELOS = KEY ? ['gemini-3.6-flash', 'gemini-2.5-flash'] : [];
if (GROQ) MODELOS.push('groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.6-27b', 'groq:openai/gpt-oss-20b');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const limpiar = (t) => t.replace(/```json|```/g, '').trim();

async function pedir(modelo) {
  if (modelo.startsWith('groq:')) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${GROQ}`},
      body: JSON.stringify({
        model: modelo.slice(5),
        messages: [{role: 'user', content: prompt}],
        temperature: 0.6,
        max_tokens: 8192,
        ...(modelo.includes('gpt-oss') ? {reasoning_effort: 'low'} : {}),
        response_format: {type: 'json_object'},
      }),
    });
  }
  const config = {temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json'};
  if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
  return fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: config}),
  });
}

async function pedirMetadatos() {
  for (const modelo of MODELOS) {
    const esGroq = modelo.startsWith('groq:');
    for (let intento = 1; intento <= 3; intento++) {
      console.log(`Intento ${intento}/3 con ${modelo}...`);
      try {
        const res = await pedir(modelo);
        if (res.status === 404 || (esGroq && res.status === 400)) {
          const det = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
          console.log(`  ${modelo} no disponible (${res.status}): ${det}`);
          break;
        }
        if (res.status === 429) {
          const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
          if (/exceeded your current quota/i.test(msg) || esGroq) {
            console.log(`  Se acabó el cupo de ${modelo}, paso al siguiente modelo.`);
            break;
          }
          console.log('  límite por minuto, esperando 20s...');
          await esperar(20000);
          continue;
        }
        if (!res.ok) {
          console.log(`  respuesta ${res.status}, esperando 20s...`);
          await esperar(20000);
          continue;
        }
        const data = await res.json();
        const texto = esGroq
          ? data?.choices?.[0]?.message?.content ?? ''
          : (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        const json = JSON.parse(limpiar(texto));
        if (json.titulo && json.descripcion && Array.isArray(json.hashtags)) {
          console.log(`  listo con ${modelo}`);
          return json;
        }
        console.log('  respuesta incompleta, reintento...');
      } catch (e) {
        console.log(`  fallo: ${e.message}, reintento...`);
        await esperar(5000);
      }
    }
  }
  return null;
}

const meta = await pedirMetadatos();
if (!meta) {
  console.error('No se pudieron generar título y descripción. El video no se afecta.');
  process.exit(0);
}

let titulo = String(meta.titulo).trim();
if (titulo.endsWith('?') && !titulo.startsWith('¿')) titulo = '¿' + titulo;
if (titulo.length > maxTitulo) console.log(`AVISO: el título tiene ${titulo.length} caracteres, revísalo`);

const hashtags = meta.hashtags
  .map((h) => '#' + String(h).replace(/^#+/, '').replace(/\s+/g, '').toLowerCase())
  .filter((h) => h.length > 1)
  .slice(0, 5)
  .join(' ');

// Etiquetas: sin comas internas, sin repetidas y dentro del límite de 500 caracteres de YouTube
const vistas = new Set();
const etiquetasLista = [];
let largoTotal = 0;
for (const e of Array.isArray(meta.etiquetas) ? meta.etiquetas : []) {
  const limpia = String(e).replace(/[#,]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!limpia || vistas.has(limpia)) continue;
  if (largoTotal + limpia.length + 2 > 480) break;
  vistas.add(limpia);
  etiquetasLista.push(limpia);
  largoTotal += limpia.length + 2;
}
const etiquetas = etiquetasLista.join(', ');

const salida = `TITULO:\n${titulo}\n\nDESCRIPCION:\n${String(meta.descripcion).trim()}\n\n${hashtags}\n\nETIQUETAS:\n${etiquetas}\n`;

await fs.mkdir('out', {recursive: true});
await fs.writeFile('out/metadatos.txt', salida);
console.log('\n========== PARA YOUTUBE ==========\n' + salida + '==================================');
