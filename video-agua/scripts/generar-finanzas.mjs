import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista de un canal de finanzas personales en espanol. Creas Shorts verticales de 20 a 25 segundos.

TEMA: ${TEMA}

LO MAS IMPORTANTE: la PRIMERA FRASE.
El espectador decide en 2 segundos si se queda. La primera frase tiene que incomodarlo o sorprenderlo.

La primera frase debe cumplir TODO esto:
- Maximo 10 palabras
- Decir algo que el espectador hace mal, o que contradiga lo que cree
- Hablarle de tu (tu sueldo, tu carro, tu cuenta)
- NUNCA empezar con: "Sabias que", "En este video", "Hoy vamos a", "Imagina que", "La mentalidad"

Ejemplos de primeras frases BUENAS:
- "Compras barato y por eso gastas mas."
- "Tu amigo gana menos que tu y tiene mas plata."
- "Subir de sueldo no te va a cambiar la vida."
- "El pobre le pide permiso a su sueldo."

Ejemplos de primeras frases MALAS (nunca las uses):
- "La mentalidad es la clave del exito."
- "Sabias que los ricos piensan diferente?"
- "Hoy te voy a explicar como ser millonario."

PROHIBIDO ABSOLUTAMENTE (esto es lo que hace que la gente desconfie):
- Frases motivacionales vacias: "cambia tu mentalidad", "el limite esta en tu mente", "todo es posible"
- Prometer riqueza, libertad financiera o resultados rapidos
- Hablar de criptomonedas, trading, forex o inversiones especificas
- Mencionar cursos, asesorias o "escribeme al DM"
- Decir cifras de dinero inventadas. Si no estas seguro de un numero, NO lo pongas.
- Tratar al espectador de tonto o culparlo

TONO: directo y concreto, como un amigo que sabe de plata y te dice la verdad sin sermonearte.
Explica UN mecanismo concreto, no una actitud. Si el tema es "el pobre compra barato y gasta mas",
explica que comprar zapatos de treinta mil cada seis meses cuesta mas que unos de cien mil que duran cinco anos.
Ejemplos cotidianos de Latinoamerica: la tienda del barrio, el arriendo, las cuotas, el sueldo quincenal.

LA ULTIMA FRASE cierra el circulo: retoma la misma idea de la primera, ya con la respuesta.
No cierres con una frase motivacional. Cierra con la conclusion practica.

LARGO: entre 50 y 70 palabras. Ni una mas.
Frases muy cortas. Espanol neutro latinoamericano: "carro" no "coche", "plata" o "dinero", "celular" no "movil".
Si mencionas moneda, usa dolares o habla en porcentajes. Nunca euros.

Estructura:
1. El gancho (1 frase)
2. El mecanismo concreto (2 o 3 frases)
3. El cierre practico (1 frase)

Responde SOLO con JSON, sin backticks:

{
  "guion": "50-70 palabras. Primera frase = gancho. Luego el mecanismo. Ultima frase = cierre que cierra el circulo. NO digas suscribete.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS DEL PLAN:
- plan: 7 u 8 tomas. NO menos de 7.
- Cada toma dura 2 o 3 segundos. Son cortes rapidos.
- Cada toma usa un archivo de clip DISTINTO. No repitas.
- buscar: en INGLES, generico y visual. Para finanzas funcionan: personas contando dinero, manos con billetes, supermercado, calculadora, recibos, tienda, ciudad, oficina, persona pensando. Evita terminos abstractos que Pexels no tenga.
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

console.log(`Generando Short de finanzas para: "${TEMA}"...`);
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

// Filtro anti-humo: avisa si se colo lenguaje de estafador.
const HUMO = ['libertad financiera', 'cambia tu mentalidad', 'millonario', 'exito financiero', 'inversion segura', 'dinero facil', 'escribeme', 'link en la bio', 'curso'];
const bajo = resultado.guion.toLowerCase();
const detectado = HUMO.filter((h) => bajo.includes(h));
if (detectado.length) console.warn(`AVISO HUMO: aparece "${detectado.join('", "')}" — revisa antes de publicar.`);

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
