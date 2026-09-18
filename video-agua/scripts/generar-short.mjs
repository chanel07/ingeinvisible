import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista del canal "Ingeniería Invisible". Creas Shorts de YouTube: videos verticales de 30 a 50 segundos.

TEMA: ${TEMA}

Responde SOLO con JSON, sin backticks:

{
  "guion": "Texto para la voz. 80-120 palabras MAXIMO. Empieza con un dato sorprendente o pregunta. Explica en 3-4 frases. Cierra con un dato final impactante. NO digas suscribete. Espanol neutro, frases muy cortas.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS:
- plan: 4-6 tomas solamente
- Cada toma dura 5-10 segundos
- buscar: en INGLES, generico y visual
- etiquetas: maximo 1 por toma, maximo 3 palabras
- Primera toma desde: ""
- clip: nombre en espanol con guiones .mp4

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
          generationConfig: {temperature: 0.7, maxOutputTokens: 4000}
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

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');
console.log(`Guion: ${resultado.guion.length} chars, Plan: ${resultado.plan.length} tomas`);
