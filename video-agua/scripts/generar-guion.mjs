import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista del canal de YouTube "Ingeniería Invisible", que explica cómo funciona la ingeniería cotidiana con un estilo claro, directo y sin tecnicismos innecesarios.

TEMA: ${TEMA}

Genera DOS cosas en formato JSON, sin texto adicional, sin backticks, solo el JSON:

{
  "guion": "El texto completo que leerá la voz. Unas 800 a 1200 palabras. Empieza con un gancho de 3 frases que genere curiosidad. Divide en secciones claras. Termina con un adelanto del próximo video y una llamada a suscribirse a Ingeniería Invisible.",
  "plan": [
    {
      "desde": "",
      "clip": "nombre-del-clip.mp4",
      "buscar": "search query in English for Pexels",
      "seccion": "Nombre de sección (solo si es inicio de sección nueva, si no omitir este campo)",
      "etiquetas": [
        {"texto": "TEXTO CORTO EN MAYÚSCULA", "cuando": "frase del guion donde aparece (en minúscula sin tildes)"}
      ]
    }
  ]
}

REGLAS PARA EL PLAN:
- Cada entrada del plan corresponde a un cambio de toma visual (cada 5-15 segundos de narración)
- "desde" es una frase corta del guion (sin tildes, en minúscula) que marca dónde empieza esa toma. La primera entrada siempre tiene "desde": ""
- "clip" es un nombre de archivo descriptivo en español con guiones, terminado en .mp4
- "buscar" es una búsqueda en INGLÉS para encontrar video de stock en Pexels. Debe ser genérica y visual (ej: "water treatment plant aerial", "bridge cables close up")
- "seccion" solo se pone en la primera toma de cada sección nueva (4 a 6 secciones en total)
- "etiquetas" son textos cortos (máximo 4 palabras) que aparecen como overlay. Máximo 3 por toma. "cuando" es la frase del guion donde debe aparecer
- Genera entre 15 y 25 tomas en total
- Los clips pueden repetirse si la misma imagen sirve para dos momentos
- La última toma debe tener una etiqueta "Próximo video"

REGLAS PARA EL GUION:
- Español neutro latinoamericano
- Frases cortas (máximo 20 palabras)
- Usa analogías cotidianas para explicar conceptos
- No uses "en este video vamos a ver" ni frases genéricas de YouTuber
- Los números grandes se escriben en letras (veintisiete mil, no 27.000)
- Duración objetivo: 5 a 8 minutos de lectura

Responde SOLO con el JSON, nada más.`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${KEY}`;

console.log(`Generando guion para: "${TEMA}"...`);

const res = await fetch(url, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    contents: [{parts: [{text: prompt}]}],
    generationConfig: {temperature: 0.7, maxOutputTokens: 8000}
  })
});

if (!res.ok) {
  const err = await res.text();
  console.error(`Error de Gemini (${res.status}):`, err);
  process.exit(1);
}

const data = await res.json();
let texto = data.candidates?.[0]?.content?.parts?.[0]?.text;

if (!texto) {
  console.error('Gemini no devolvió texto');
  process.exit(1);
}

// Limpiar backticks si los pone
texto = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

let resultado;
try {
  resultado = JSON.parse(texto);
} catch (e) {
  console.error('No se pudo parsear el JSON de Gemini:', e.message);
  console.error('Texto recibido:', texto.substring(0, 500));
  process.exit(1);
}

if (!resultado.guion || !resultado.plan) {
  console.error('El JSON no tiene "guion" o "plan"');
  process.exit(1);
}

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');

console.log(`✓ Guion: ${resultado.guion.length} caracteres`);
console.log(`✓ Plan: ${resultado.plan.length} tomas`);
console.log('Listo.');
