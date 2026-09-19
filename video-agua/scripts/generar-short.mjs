import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista del canal "Ingeniería Invisible". Creas Shorts de YouTube: videos verticales de 30 a 50 segundos.

TEMA: ${TEMA}

LO MAS IMPORTANTE DE TODO: la PRIMERA FRASE.
El espectador decide en 2 segundos si se queda o pasa el dedo. La primera frase tiene que detenerlo.

La primera frase debe cumplir TODO esto:
- Maximo 10 palabras
- Contener un numero concreto, una consecuencia grave, o algo que contradiga lo que la gente cree
- Hablarle al espectador de tu (tu casa, tu carro, tus pies)
- NUNCA empezar con: "Sabias que", "En este video", "La ingenieria", "Hoy vamos a", "Imagina que"

Ejemplos de primeras frases BUENAS:
- "Estas parado sobre 40 toneladas de concreto."
- "Ese cable de tu poste te mata en medio segundo."
- "El aire de tu cuarto pesa mas que tu perro."
- "Un ascensor en caida libre no te mata. Te mata otra cosa."

Ejemplos de primeras frases MALAS (nunca las uses):
- "Sabias que el concreto es muy resistente?"
- "La ingenieria esta en todas partes."
- "Hoy te explico como funciona un ascensor."

Responde SOLO con JSON, sin backticks:

{
  "guion": "Texto para la voz. 80-120 palabras MAXIMO. Primera frase = el gancho segun las reglas de arriba. Luego explica en 3-4 frases cortas. Cierra con un dato final que sorprenda. NO digas suscribete. Espanol neutro, frases muy cortas.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS DEL PLAN:
- plan: 4-6 tomas solamente
- Cada toma dura 5-10 segundos
- buscar: en INGLES, generico y visual
- etiquetas: maximo 1 por toma, maximo 3 palabras
- clip: nombre en espanol con guiones .mp4

REGLA CRITICA DEL CAMPO "desde":
- La primera toma lleva desde: ""
- CADA toma siguiente DEBE llevar en "desde" un fragmento EXACTO y literal del guion, copiado tal cual, de 4 a 7 palabras seguidas, que marque donde empieza esa toma.
- Ese fragmento tiene que aparecer TEXTUALMENTE en el guion. No lo reescribas, no lo resumas, no cambies ni una palabra.
- Los fragmentos deben ir en el mismo orden que aparecen en el guion, sin repetirse.

SOLO el JSON.`;

const MODELOS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamarGemini() {
  for (const modelo of MODELOS) {
    for (let intento = 1; intento <= 3; intento++) {
      console.log(`Intento ${intento}/3 con ${modelo}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{parts: [{text: prompt}]}],
          generationConfig: {temperature: 0.9, maxOutputTokens: 4000}
        })
      });
      if (res.ok) {
        const data = await res.json();
        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (texto) { console.log(`Respuesta de ${modelo}`); return texto; }
      }
      const status = res.status;
      if (status === 404) { console.log(`${modelo} no existe`); break; }
      if (status === 503 || status === 429) { console.log(`${modelo} saturado, esperando 30s...`); await esperar(30000); continue; }
      const err = await res.text();
      console.error(`Error ${status}:`, err.substring(0, 200));
      break;
    }
  }
  return null;
}

console.log(`Generando Short para: "${TEMA}"...`);
const texto = await llamarGemini();
if (!texto) { console.error('Sin respuesta'); process.exit(1); }

const limpio = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
let resultado;
try { resultado = JSON.parse(limpio); } catch (e) {
  console.error('JSON invalido:', e.message);
  console.error(limpio.substring(0, 300));
  process.exit(1);
}

if (!resultado.guion || !resultado.plan) { console.error('Falta guion o plan'); process.exit(1); }

// Aviso si Gemini invento fragmentos que no estan en el guion:
// esos son los que hacen que las tomas no se ubiquen bien.
const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const guionNorm = normalizar(resultado.guion);
let fallos = 0;
resultado.plan.forEach((toma, i) => {
  if (i === 0 || !toma.desde) return;
  if (!guionNorm.includes(normalizar(toma.desde))) {
    console.warn(`AVISO toma ${i + 1}: "${toma.desde}" no aparece en el guion`);
    fallos++;
  }
});
if (fallos) console.warn(`${fallos} de ${resultado.plan.length} tomas se van a repartir por tiempo.`);

console.log(`\nPRIMERA FRASE: ${resultado.guion.split(/[.!?]/)[0]}\n`);

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');
console.log(`Guion: ${resultado.guion.length} chars, Plan: ${resultado.plan.length} tomas`);
