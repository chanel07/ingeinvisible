import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista de una pagina de rescate de mascotas en Santa Marta, Colombia. Creas Reels verticales de 20 a 25 segundos con datos curiosos sobre perros.

TEMA: ${TEMA}

LO MAS IMPORTANTE: la PRIMERA FRASE.
El espectador decide en 2 segundos si se queda. La primera frase tiene que hablarle de SU perro.

La primera frase debe cumplir TODO esto:
- Maximo 10 palabras
- Hablar de "tu perro", no de "los perros" en general
- Decir algo que el dueno ha visto mil veces y nunca entendio
- NUNCA empezar con: "Sabias que", "En este video", "Hoy vamos a", "Los perros son"

Ejemplos de primeras frases BUENAS:
- "Tu perro sabe a que hora llegas. Sin reloj."
- "Tu perro te sigue al bano por una razon."
- "Cuando tu perro inclina la cabeza no esta confundido."

Ejemplos de primeras frases MALAS (nunca las uses):
- "Sabias que los perros son muy inteligentes?"
- "Los perros son los mejores amigos del hombre."
- "Hoy te explico el comportamiento canino."

RIGOR: esto es lo mas importante despues del gancho.
Esta pagina es de rescate de mascotas. Si publicas un dato falso, pierde credibilidad con veterinarios y rescatistas.
- Si NO estas seguro de un dato, NO lo digas. Explica lo que si se sabe.
- PROHIBIDO repetir estos mitos falsos:
  * Que un ano de perro equivale a siete anos humanos (es falso, depende de la raza y el tamano)
  * Que los perros ven en blanco y negro (falso, ven azules y amarillos)
  * Que el perro que mueve la cola siempre esta feliz (tambien la mueve por tension)
  * Que el perro se siente culpable cuando baja la cabeza (es sumision, no culpa)
  * Que hay que dominar al perro o "ser el alfa" (la teoria de la manada esta desacreditada)
- NO atribuyas emociones humanas complejas a los perros (culpa, venganza, celos calculados).
- NO des consejos veterinarios, de alimentacion ni de medicamentos. Nunca.
- Si el tema toca salud, di que eso lo responde un veterinario.

TONO: calido y cercano, como alguien que ama a los perros y sabe de ellos. No academico, no infantil.
Explica UN mecanismo concreto. Ejemplos cotidianos: la puerta, el sofa, el plato de comida, la correa.

LA ULTIMA FRASE cierra el circulo: retoma la idea de la primera, ya con la respuesta.

LARGO: entre 50 y 70 palabras. Ni una mas.
Frases muy cortas. Espanol neutro latinoamericano: "carro" no "coche", "perro" no "can".

Estructura:
1. El gancho (1 frase)
2. La explicacion concreta (2 o 3 frases)
3. El cierre que cierra el circulo (1 frase)

Responde SOLO con JSON, sin backticks:

{
  "guion": "50-70 palabras. Primera frase = gancho sobre su perro. Luego la explicacion. Ultima frase = cierre. NO digas suscribete.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS DEL PLAN:
- plan: 7 u 8 tomas. NO menos de 7.
- Cada toma dura 2 o 3 segundos. Son cortes rapidos.
- Cada toma usa un archivo de clip DISTINTO. No repitas.
- buscar: en INGLES, generico y visual. Pexels tiene mucho material de perros: "dog looking at camera", "dog running park", "puppy sleeping", "dog owner petting", "dog waiting door", "dog eating bowl", "dog tilting head". Usa busquedas de ese estilo.
- etiquetas: maximo 1 por toma, maximo 3 palabras, solo en 2 o 3 tomas
- clip: nombre en espanol con guiones .mp4

REGLA CRITICA DEL CAMPO "desde":
- La primera toma lleva desde: ""
- CADA toma siguiente lleva en "desde" un fragmento EXACTO y literal del guion, de 3 a 6 palabras seguidas.
- Tiene que aparecer TEXTUALMENTE en el guion. No lo reescribas ni cambies una palabra.
- En el mismo orden del guion, sin repetirse, repartidos de principio a fin.

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
          generationConfig: {temperature: 0.9, maxOutputTokens: 16000}
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

console.log(`Generando Reel de perros para: "${TEMA}"...`);
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

const palabras = resultado.guion.trim().split(/\s+/).length;
const segundos = Math.round(palabras / 2.6);
console.log(`\nPALABRAS: ${palabras} (aprox ${segundos}s de video)`);
if (palabras > 85) console.warn('AVISO: el guion salio largo.');

const tomas = resultado.plan.length;
console.log(`TOMAS: ${tomas} (aprox ${(segundos / tomas).toFixed(1)}s por toma)`);
if (tomas < 6) console.warn('AVISO: pocas tomas, ritmo lento.');

const clips = resultado.plan.map((t) => t.clip);
const unicos = new Set(clips).size;
console.log(`CLIPS DISTINTOS: ${unicos} de ${tomas}`);
if (unicos < tomas) console.warn('AVISO: hay clips repetidos.');

// Filtro de mitos: avisa si se colo un dato desacreditado.
const MITOS = [
  'siete anos', 'siete años', '7 anos humanos', '7 años humanos',
  'blanco y negro', 'ser el alfa', 'alfa de la manada', 'dominar a tu perro',
  'se siente culpable', 'por venganza', 'lo hace por celos',
];
const bajo = resultado.guion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const detectado = MITOS.filter((m) => bajo.includes(m.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
if (detectado.length) console.warn(`AVISO MITO: aparece "${detectado.join('", "')}" — REVISA antes de publicar.`);

// Filtro de consejo veterinario: esta pagina no debe darlos.
const VETERINARIO = ['debes darle', 'dale de comer', 'medicamento', 'dosis', 'sintoma de', 'enfermedad de', 'trata la'];
const vet = VETERINARIO.filter((v) => bajo.includes(v));
if (vet.length) console.warn(`AVISO VETERINARIO: aparece "${vet.join('", "')}" — no des consejos de salud.`);

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
if (fallos) console.warn(`${fallos} de ${tomas} tomas se van a repartir por tiempo.`);

const frases = resultado.guion.trim().split(/(?<=[.!?])\s+/);
console.log(`\nPRIMERA: ${frases[0]}`);
console.log(`ULTIMA:  ${frases[frases.length - 1]}\n`);

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');
console.log(`Guion: ${resultado.guion.length} chars, Plan: ${tomas} tomas`);
