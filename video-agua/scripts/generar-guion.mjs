import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista del canal "Ingeniería Invisible". Explicas ingeniería cotidiana de forma clara y directa.

TEMA: ${TEMA}

Responde SOLO con JSON, sin backticks ni texto extra:

{
  "guion": "Texto para la voz. 600-800 palabras. Gancho de 3 frases, 4-5 secciones, cierre con adelanto del próximo video y suscripción a Ingeniería Invisible. Español neutro, frases cortas, números en letras.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english search query for Pexels","seccion":"Nombre (solo al inicio de sección)","etiquetas":[{"texto":"TEXTO CORTO","cuando":"frase del guion en minuscula sin tildes"}]}
  ]
}

REGLAS:
- plan: 12-18 tomas, cada una es un cambio visual
- desde: frase corta del guion en minúscula sin tildes. Primera toma: ""
- clip: nombre descriptivo en español con guiones .mp4
- buscar: búsqueda en INGLÉS para Pexels, genérica y visual
- seccion: solo en la primera toma de cada sección (4-5 secciones)
- etiquetas: máximo 2 por toma, máximo 4 palabras cada una
- Última toma con etiqueta "Próximo video"

SOLO el JSON.`;

const MODELOS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash'
];

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
          generationConfig: {temperature: 0.7, maxOutputTokens: 16000}
        })
      });

      if (res.ok) {
        const data = await res.json();
        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (texto) {
          console.log(`Respuesta de ${modelo}`);
          return texto;
        }
      }

      const status = res.status;
      if (status === 404) {
        console.log(`Modelo ${modelo} no existe, probando el siguiente...`);
        break;
      }
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

console.log(`Generando guion para: "${TEMA}"...`);

const texto = await llamarGemini();
if (!texto) {
  console.error('No se pudo obtener respuesta de ningun modelo');
  process.exit(1);
}

const limpio = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

let resultado;
try {
  resultado = JSON.parse(limpio);
} catch (e) {
  console.error('No se pudo parsear el JSON:', e.message);
  console.error('Primeros 300 chars:', limpio.substring(0, 300));
  process.exit(1);
}

if (!resultado.guion || !resultado.plan) {
  console.error('El JSON no tiene "guion" o "plan"');
  process.exit(1);
}

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');

console.log(`Guion: ${resultado.guion.length} caracteres`);
console.log(`Plan: ${resultado.plan.length} tomas`);
console.log('Listo.');
