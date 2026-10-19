import fs from 'node:fs/promises';

const KEY = process.env.GEMINI_KEY;
const TEMA = process.env.TEMA;
const DURACION = (() => {
  const d = (process.env.DURACION || 'largo').toLowerCase();
  return ['corto', 'largo', 'extendido'].includes(d) ? d : 'largo';
})();

if (!KEY || !TEMA) {
  console.error('Faltan GEMINI_KEY o TEMA');
  process.exit(1);
}

// Configuracion segun la duracion elegida en el workflow.
const CONFIG = {
  largo: {
    segundos: '35 a 45',
    palabras: '90 y 110',
    minPalabras: 80,
    maxPalabras: 125,
    tomas: 'entre 14 y 16 tomas. NO menos de 14',
    minTomas: 12,
    etiquetas: 'en 4 o 5 tomas',
    maxGancho: 10,
    estructura: `1. LA PRIMERA FRASE (el gancho).
El espectador decide en 1 segundo si se queda.

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
Ultima frase: retoma la idea de la primera, ya con la respuesta. Corta y redonda.`,
    formatoGuion: '90-110 palabras. Frase 1 = gancho. Frase 2 = bucle abierto. Desarrollo. Penultima = revelacion. Ultima = cierre.',
    duracionToma: '2 o 3 segundos',
    maxSegToma: 3.5,
  },
  extendido: {
    segundos: '160 a 190',
    palabras: '400 y 460',
    minPalabras: 360,
    maxPalabras: 500,
    tomas: 'entre 34 y 40 tomas. NO menos de 32',
    minTomas: 30,
    etiquetas: 'en 8 a 10 tomas',
    maxGancho: 12,
    duracionToma: '4 a 6 segundos',
    maxSegToma: 7,
    estructura: `VIDEO EXTENDIDO DE UNOS 3 MINUTOS, dividido en PARTES.

1. EL GANCHO: la primera frase, que atrape en el primer segundo.

2. LA PROMESA: una frase que diga lo que el espectador va a saber al final, para que se quede.

3. LAS PARTES: si el TEMA trae partes, siguelas en ese mismo orden, sin saltarte ninguna. Cada parte empieza con una frase de transicion natural (por ejemplo "Y aqui viene lo mas importante") y explica UNA sola idea, con ejemplos cotidianos de la casa y la calle. Frases cortas, como si le hablaras a un amigo.

4. EL CIERRE: retoma la idea de la primera frase, ya con la respuesta, y termina con un mensaje claro y positivo.

NO hagas una parte de introduccion: arranca directo con el gancho.`,
    formatoGuion: '400-460 palabras. Gancho. Promesa. Las partes del tema en orden. Cierre.',
  },
  corto: {
    segundos: '10 a 13',
    palabras: '26 y 34',
    minPalabras: 22,
    maxPalabras: 34,
    tomas: 'entre 5 y 6 tomas. NO menos de 5',
    minTomas: 5,
    etiquetas: 'en 1 o 2 tomas',
    maxGancho: 8,
    estructura: `VIDEO CORTO: cada palabra cuenta. Sin introducciones, sin rodeos.

1. EL GANCHO: la primera frase, maximo 8 palabras.

2. EL DATO: 2 o 3 frases muy cortas con la respuesta concreta.
Si el TEMA trae muchos datos, usa SOLO el mas fuerte. No intentes decirlo todo.

3. EL REMATE: una frase corta que conecte con la primera, para que cuando el video se repita en bucle se sienta continuo.

NO uses bucle abierto ni "te lo digo al final": no hay tiempo para eso.
CUENTA LAS PALABRAS antes de responder. Si pasas de 34, recorta.`,
    formatoGuion: '26-34 palabras. Frase 1 = gancho. Luego el dato. Ultima = remate que conecta con la primera.',
    duracionToma: '2 o 3 segundos',
    maxSegToma: 3.5,
  },
}[DURACION];

console.log(`DURACION: ${DURACION} (${CONFIG.segundos} segundos)`);

// Primera toma: siempre un perro tierno, elegido al azar para que cada
// video arranque distinto. De aqui sale tambien la portada del video.
const PRIMERAS = [
  'happy puppy playing',
  'cute puppy sitting grass',
  'puppy running towards camera',
  'happy dog wagging tail',
  'golden retriever puppy happy',
  'small dog playing with toy',
  'puppy tilting head',
  'happy dog running beach',
  'cute dog lying on sofa',
  'puppy playing with owner',
];

const prompt = `Eres el guionista de una pagina de rescate de mascotas en Santa Marta, Colombia. Creas ${DURACION === 'extendido' ? 'videos verticales de unos 3 minutos' : `Reels verticales de ${CONFIG.segundos} segundos`} sobre perros.

TEMA: ${TEMA}

OBJETIVO: que la gente vea el video HASTA EL FINAL. Todo el guion esta pensado para retener.

REGLAS DEL GANCHO (primera frase):
- Maximo ${CONFIG.maxGancho} palabras
- Hablar de "tu perro", no de "los perros" en general
- Decir algo que el dueno ha visto mil veces y nunca entendio, o algo que lo asuste un poco
- NUNCA empezar con: "Sabias que", "En este video", "Hoy vamos a", "Los perros son", "Hola"
- Si el TEMA dice que la primera frase debe ser exactamente una frase, usa ESA frase.

Ejemplos BUENOS:
- "Tu perro sabe a que hora llegas. Sin reloj."
- "Tu perro te sigue al bano por una razon."
- "Esta fruta de tu cocina puede danar a tu perro."

Ejemplos MALOS (nunca):
- "Sabias que los perros son muy inteligentes?"
- "Los perros son los mejores amigos del hombre."

ESTRUCTURA:
${CONFIG.estructura}

RIGOR: esta pagina es de rescate de mascotas. Un dato falso le quita credibilidad con veterinarios y rescatistas.
- Si NO estas seguro de un dato, NO lo digas. Explica lo que si se sabe.
- NO exageres: no digas que algo "siempre" mata o que "una sola vez" es fatal si no es cierto.
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
- Al final di, en pocas palabras, que si pasa hay que ir al veterinario.
- Tono de advertencia pero sin exagerar ni asustar de mas.

Si el tema NO es de peligro: NO des consejos veterinarios, de alimentacion ni de medicamentos, y no menciones veterinarios salvo que el TEMA lo pida.

TONO: calido y cercano, como alguien que ama a los perros y sabe de ellos. No academico, no infantil.

LARGO: entre ${CONFIG.palabras} palabras. Ni menos ni mas.
Frases MUY cortas. Espanol neutro latinoamericano: "carro" no "coche", "perro" no "can".
NO uses punto y coma. NO digas suscribete, sigueme ni dale like.

Responde SOLO con JSON, sin backticks:

{
  "guion": "${CONFIG.formatoGuion}",
  "plan": [
    {"desde":"","clip":"nombre.mp4","buscar":"english Pexels query","etiquetas":[{"texto":"TEXTO CORTO"}]}
  ]
}

REGLAS DEL PLAN:
- plan: ${CONFIG.tomas}.
- Cada toma dura ${CONFIG.duracionToma}. Cortes rapidos, nunca una toma larga.${DURACION === 'extendido' ? '\n- seccion: en la PRIMERA toma de cada parte del guion, agrega el campo "seccion" con el nombre de la parte en 2 o 3 palabras, con ortografia perfecta y tildes (por ejemplo "Lo que siente", "Señales de pánico"). En las demas tomas, omite el campo. NUNCA una seccion llamada Introduccion.' : ''}
- Cada toma usa un archivo de clip DISTINTO y una busqueda DISTINTA. No repitas.
- buscar: en INGLES, generico y visual, siempre con perros. Planos medios o completos donde se vea el perro entero o medio cuerpo.
- PROHIBIDO usar "close up", "closeup", "macro" o "extreme" en las busquedas. Al recortar a vertical quedan ojos o narices gigantes que se ven feos.
- Ejemplos de busquedas buenas: "dog running park", "puppy sleeping", "dog owner petting", "dog waiting door", "dog eating bowl", "dog tilting head", "dog sniffing grass", "dog walking street", "dog barking", "sad dog window", "scared dog hiding".
- Alterna: perro solo, perro con persona, interior, exterior. Que no se vean todas iguales.
- etiquetas: maximo 1 por toma, maximo 3 palabras, ${CONFIG.etiquetas}.
- clip: nombre en espanol con guiones .mp4, SIN tildes y SIN la letra ñ (usa n).

REGLA CRITICA DEL CAMPO "desde":
- La primera toma lleva desde: ""
- CADA toma siguiente lleva en "desde" un fragmento EXACTO y literal del guion, de 3 a 6 palabras seguidas.
- Tiene que aparecer TEXTUALMENTE en el guion. No lo reescribas ni cambies una palabra.
- En el mismo orden del guion, sin repetirse, repartidos de principio a fin.

SOLO el JSON.`;

// Primero los dos Gemini; si los dos se quedan sin cupo, Groq como respaldo.
// gemini-2.5-flash primero: el 3.6 sale saturado casi siempre y hace perder tiempo.
const GROQ = (process.env.GROQ_KEY ?? '').trim();
const MODELOS = ['gemini-2.5-flash', 'gemini-3.6-flash'];
if (GROQ) MODELOS.push('groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.6-27b', 'groq:openai/gpt-oss-20b');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(modelo) {
  if (modelo.startsWith('groq:')) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${GROQ}`},
      body: JSON.stringify({
        model: modelo.slice(5),
        messages: [{role: 'user', content: prompt}],
        temperature: 0.8,
        max_tokens: 8192,
        ...(modelo.includes('gpt-oss') ? {reasoning_effort: 'low'} : {}),
        response_format: {type: 'json_object'},
      }),
    });
  }
  const config = {temperature: 0.9, maxOutputTokens: 16000};
  if (modelo.startsWith('gemini-2.5')) config.thinkingConfig = {thinkingBudget: 0};
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`;
  return fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: config}),
  });
}

async function llamarGemini() {
  for (const modelo of MODELOS) {
    const esGroq = modelo.startsWith('groq:');
    for (let intento = 1; intento <= 3; intento++) {
      console.log(`Intento ${intento}/3 con ${modelo}...`);
      let res;
      try {
        res = await pedir(modelo);
      } catch (e) {
        console.log(`  fallo de conexión: ${e.message}`);
        await esperar(5000);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        const texto = esGroq
          ? data?.choices?.[0]?.message?.content
          : (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (texto && texto.trim()) { console.log(`Respuesta de ${modelo}`); return texto; }
        console.log('  respuesta vacía, reintento...');
        continue;
      }
      const status = res.status;
      const msg = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
      if (status === 404 || (esGroq && status === 400)) { console.log(`${modelo} no disponible (${status}): ${msg}`); break; }
      if (status === 429 && (/exceeded your current quota/i.test(msg) || esGroq)) { console.log(`Se acabó el cupo de ${modelo}, paso al siguiente modelo.`); break; }
      if (status === 503 || status === 429) { console.log(`${modelo} saturado, esperando 30s...`); await esperar(30000); continue; }
      console.error(`Error ${status}:`, msg);
      break;
    }
  }
  return null;
}

// Si el JSON llega cortado o el guion se pasa de largo, vuelve a pedirlo.
console.log(`Generando Reel de perros para: "${TEMA}"...`);
let resultado = null;
let respaldo = null;
for (let vuelta = 1; vuelta <= 4 && !resultado; vuelta++) {
  const texto = await llamarGemini();
  if (!texto) { console.error('Sin respuesta'); process.exit(1); }
  const limpio = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const r = JSON.parse(limpio);
    if (!(r.guion && Array.isArray(r.plan) && r.plan.length)) {
      console.warn(`Vuelta ${vuelta}: falta guion o plan, reintentando...`);
      continue;
    }
    const n = r.guion.trim().split(/\s+/).length;
    if (n > CONFIG.maxPalabras) {
      console.warn(`Vuelta ${vuelta}: guion de ${n} palabras, el maximo es ${CONFIG.maxPalabras}. Reintentando...`);
      if (!respaldo || n < respaldo.n) respaldo = {r, n};
      continue;
    }
    resultado = r;
  } catch (e) {
    console.warn(`Vuelta ${vuelta}: JSON cortado o invalido (${e.message}), reintentando...`);
  }
}
if (!resultado && respaldo) {
  console.warn(`Ninguno cumplio el largo. Uso el mas corto: ${respaldo.n} palabras.`);
  resultado = respaldo.r;
}
if (!resultado) { console.error('No se obtuvo un guion valido despues de 4 vueltas'); process.exit(1); }

const quitarTildes = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Nombres de clip seguros: sin tildes, sin ñ, sin espacios raros.
const nombreSeguro = (s, i) => {
  const base = quitarTildes(String(s || `toma-${i + 1}`)).replace(/\.mp4$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base || `toma-${i + 1}`}.mp4`;
};
const usados = new Set();
resultado.plan.forEach((t, i) => {
  let n = nombreSeguro(t.clip, i);
  if (usados.has(n)) n = n.replace(/\.mp4$/, `-${i + 1}.mp4`);
  usados.add(n);
  t.clip = n;
});

// Primera toma: perro tierno al azar, nunca la decide Gemini.
const primera = PRIMERAS[Math.floor(Math.random() * PRIMERAS.length)];
resultado.plan[0].buscar = primera;
resultado.plan[0].clip = 'perro-inicio.mp4';
console.log(`PRIMERA TOMA: "${primera}"`);

// Quitar "close up" si Gemini lo puso igual, y obligar a que todas las
// busquedas tengan un perro. Sin esto, busquedas como "pay attention"
// traen videos de billetes, porque en ingles "pay" tambien es pagar.
resultado.plan.forEach((t, i) => {
  const b = String(t.buscar || '');
  let limpia = b.replace(/\b(extreme\s+)?close[\s-]?up\b|\bcloseup\b|\bmacro\b/gi, '').replace(/\s+/g, ' ').trim();
  if (limpia !== b) console.log(`Toma ${i + 1}: quite "close up" de "${b}"`);
  if (!limpia) limpia = 'dog playing';
  if (!/\b(dog|dogs|puppy|puppies|pet)\b/i.test(limpia)) {
    console.log(`Toma ${i + 1}: la busqueda "${limpia}" no tenia perro, la cambio a "dog ${limpia}"`);
    limpia = `dog ${limpia}`;
  }
  t.buscar = limpia;
});

// Duracion
const palabras = resultado.guion.trim().split(/\s+/).length;
const segundos = Math.round(palabras / 2.5);
console.log(`\nPALABRAS: ${palabras} (aprox ${segundos}s de video)`);
if (palabras < CONFIG.minPalabras) console.warn('AVISO: el guion salio corto.');
if (palabras > CONFIG.maxPalabras) console.warn('AVISO: el guion salio largo.');

// Ritmo
const tomas = resultado.plan.length;
console.log(`TOMAS: ${tomas} (aprox ${(segundos / tomas).toFixed(1)}s por toma)`);
if (tomas < CONFIG.minTomas) console.warn('AVISO: pocas tomas, el ritmo va a ser lento.');
if (segundos / tomas > CONFIG.maxSegToma) console.warn('AVISO: tomas muy largas, la gente se aburre con stock.');

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
if (frases[0].split(/\s+/).length > CONFIG.maxGancho + 2) console.warn('AVISO GANCHO: la primera frase es muy larga.');

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
