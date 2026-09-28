import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

const prompt = `Eres el guionista de una pagina de rescate de mascotas en Santa Marta, Colombia. Creas Reels verticales de 35 a 45 segundos sobre perros.

TEMA: ${TEMA}

OBJETIVO: que la gente vea el video HASTA EL FINAL. Todo el guion esta pensado para retener.

1. LA PRIMERA FRASE (el gancho).
El espectador decide en 1 segundo si se queda. La primera frase tiene que hablarle de SU perro.
- Maximo 10 palabras
- Hablar de "tu perro", no de "los perros" en general
- Decir algo que el dueno ha visto mil veces y nunca entendio, o algo que lo asuste un poco
- NUNCA empezar con: "Sabias que", "En este video", "Hoy vamos a", "Los perros son", "Hola"

Ejemplos BUENOS:
- "Tu perro sabe a que hora llegas. Sin reloj."
- "Tu perro te sigue al bano por una razon."
- "Cuando tu perro inclina la cabeza no esta confundido."
- "Esta fruta de tu cocina puede danar a tu perro."

Ejemplos MALOS (nunca):
- "Sabias que los perros son muy inteligentes?"
- "Los perros son los mejores amigos del hombre."
- "Hoy te explico el comportamiento canino."

2. LA SEGUNDA FRASE (el bucle abierto). OBLIGATORIA.
Promete algo que solo se revela al FINAL, para que la gente se quede esperando.
Ejemplos:
- "Y la razon real no es la que crees."
- "Pero lo mas sorprendente viene al final."
- "Hay una senal que casi nadie nota. Te la digo al final."
Y CUMPLE la promesa: el dato mas fuerte va en las ultimas 2 frases, nunca antes.

3. EL DESARROLLO.
Explica UN mecanismo concreto, paso a paso, en 5 a 7 frases muy cortas.
Cada frase agrega algo nuevo. Cero relleno, cero frases que repiten lo anterior.
Usa ejemplos cotidianos: la puerta, el sofa, el plato de comida, la correa, la moto, la calle.
Cada 2 o 3 frases mete una mini sorpresa o un "pero" que cambie la direccion.

4. LA REVELACION Y EL CIERRE.
Penultima frase: el dato mas fuerte, el que prometiste en la segunda frase.
Ultima frase: retoma la idea de la primera, ya con la respuesta. Corta y redonda.

RIGOR: esta pagina es de rescate de mascotas. Un dato falso le quita credibilidad con veterinarios y rescatistas.
- Si NO estas seguro de un dato, NO lo digas. Explica lo que si se sabe.
- PROHIBIDO repetir estos mitos falsos:
  * Que un ano de perro equivale a siete anos humanos (depende de la raza y el tamano)
  * Que los perros ven en blanco y negro (ven azules y amarillos)
  * Que el perro que mueve la cola siempre esta feliz (tambien la mueve por tension)
  * Que el perro se siente culpable cuando baja la cabeza (es sumision, no culpa)
  * Que hay que dominar al perro o "ser el alfa" (la teoria de la manada esta desacreditada)
- NO atribuyas emociones humanas complejas (culpa, venganza, celos calculados).

TEMAS DE PELIGRO (solo si el TEMA habla de un peligro):
- Puedes advertir sobre peligros BIEN ESTABLECIDOS para perros: uvas y pasas, chocolate, xilitol (endulzante de chicles y dulces sin azucar), cebolla y ajo, polvora y ruido fuerte, carro cerrado al sol, calor en el pavimento, puertas abiertas y perdida.
- Di QUE es peligroso y POR QUE, de forma simple.
- NUNCA des cantidades, dosis, medicamentos, remedios caseros ni tratamientos.
- NUNCA digas "provoca el vomito" ni nada parecido.
- La ultima o penultima frase SIEMPRE dice que si pasa, hay que ir al veterinario de inmediato.
- Tono de advertencia pero sin exagerar ni asustar de mas.

Si el tema NO es de peligro: NO des consejos veterinarios, de alimentacion ni de medicamentos. Si toca salud, di que eso lo responde un veterinario.

TONO: calido y cercano, como alguien que ama a los perros y sabe de ellos. No academico, no infantil.

LARGO: entre 90 y 110 palabras. Ni menos ni mas.
Frases MUY cortas, de 5 a 12 palabras. Espanol neutro latinoamericano: "carro" no "coche", "perro" no "can".
NO digas suscribete, sigueme ni dale like.

Responde SOLO con JSON, sin backticks:

{
  "guion": "90-110 palabras. Frase 1 = gancho. Frase 2 = bucle abierto. Desarrollo. Penultima = revelacion. Ultima = cierre.",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS DEL PLAN:
- plan: entre 14 y 16 tomas. NO menos de 14.
- Cada toma dura 2 o 3 segundos. Cortes rapidos, nunca una toma larga.
- La PRIMERA toma SIEMPRE es un perro de cerca mirando a camara. buscar: "dog looking at camera close up" o parecido.
- Cada toma usa un archivo de clip DISTINTO y una busqueda DISTINTA. No repitas.
- buscar: en INGLES, generico y visual, siempre con perros. Ejemplos: "dog looking at camera", "dog running park", "puppy sleeping", "dog owner petting", "dog waiting door", "dog eating bowl", "dog tilting head", "dog sniffing grass", "dog street", "dog barking", "sad dog window".
- Alterna planos: cerca, lejos, perro solo, perro con persona. Que no se vean todas iguales.
- etiquetas: maximo 1 por toma, maximo 3 palabras, en 4 o 5 tomas. Pon etiqueta en la toma de la revelacion.
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

const quitarTildes = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Duracion
const palabras = resultado.guion.trim().split(/\s+/).length;
const segundos = Math.round(palabras / 2.6);
console.log(`\nPALABRAS: ${palabras} (aprox ${segundos}s de video)`);
if (palabras < 80) console.warn('AVISO: el guion salio corto. Menos de 30s baja el tiempo promedio.');
if (palabras > 125) console.warn('AVISO: el guion salio largo.');

// Ritmo
const tomas = resultado.plan.length;
console.log(`TOMAS: ${tomas} (aprox ${(segundos / tomas).toFixed(1)}s por toma)`);
if (tomas < 12) console.warn('AVISO: pocas tomas, el ritmo va a ser lento.');
if (segundos / tomas > 3.5) console.warn('AVISO: tomas muy largas, la gente se aburre con stock.');

const clips = resultado.plan.map((t) => t.clip);
const unicos = new Set(clips).size;
console.log(`CLIPS DISTINTOS: ${unicos} de ${tomas}`);
if (unicos < tomas) console.warn('AVISO: hay clips repetidos.');

const busquedas = resultado.plan.map((t) => (t.buscar || '').toLowerCase().trim());
if (new Set(busquedas).size < busquedas.length) console.warn('AVISO: hay busquedas repetidas, pueden salir clips iguales.');

// Gancho
const frases = resultado.guion.trim().split(/(?<=[.!?])\s+/);
const gancho = quitarTildes(frases[0]);
const PROHIBIDOS = ['sabias que', 'en este video', 'hoy vamos', 'los perros son', 'hola'];
const malGancho = PROHIBIDOS.filter((p) => gancho.startsWith(p));
if (malGancho.length) console.warn(`AVISO GANCHO: empieza con "${malGancho[0]}". Vuelve a correrlo.`);
if (frases[0].split(/\s+/).length > 12) console.warn('AVISO GANCHO: la primera frase es muy larga.');

// Mitos
const bajo = quitarTildes(resultado.guion);
const MITOS = [
  'siete anos', '7 anos humanos', 'blanco y negro', 'ser el alfa',
  'alfa de la manada', 'dominar a tu perro', 'se siente culpable',
  'por venganza', 'lo hace por celos',
];
const detectado = MITOS.filter((m) => bajo.includes(m));
if (detectado.length) console.warn(`AVISO MITO: aparece "${detectado.join('", "')}". REVISA antes de publicar.`);

// Consejo veterinario (prohibido siempre: dosis, remedios, tratamientos)
const VETERINARIO = ['dosis', 'medicamento', 'miligramos', 'provoca el vomito', 'hazlo vomitar', 'agua oxigenada', 'remedio casero', 'trata la', 'debes darle'];
const vet = VETERINARIO.filter((v) => bajo.includes(v));
if (vet.length) console.warn(`AVISO VETERINARIO: aparece "${vet.join('", "')}". NO publiques sin revisar.`);

// Si es tema de peligro, tiene que mandar al veterinario
const ES_PELIGRO = /peligro|toxic|veneno|dana|mata|polvora|chocolate|uva|xilitol|cebolla/.test(quitarTildes(TEMA));
if (ES_PELIGRO && !bajo.includes('veterinario')) console.warn('AVISO PELIGRO: el guion no manda al veterinario. Vuelve a correrlo.');

// Sincronia de tomas con el guion
const normalizar = (s) => quitarTildes(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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

console.log(`\nPRIMERA: ${frases[0]}`);
console.log(`SEGUNDA: ${frases[1] || ''}`);
console.log(`ULTIMA:  ${frases[frases.length - 1]}\n`);

await fs.writeFile('public/guion.txt', resultado.guion, 'utf8');
await fs.writeFile('public/plan.json', JSON.stringify(resultado.plan, null, 2), 'utf8');
console.log(`Guion: ${resultado.guion.length} chars, Plan: ${tomas} tomas`);
