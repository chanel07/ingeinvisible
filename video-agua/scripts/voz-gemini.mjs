// Voz natural con Gemini (modelo de texto a voz). Lee public/guion.txt y crea public/voz.mp3.
// Los subtitulos (public/voz.srt) se sacan despues con scripts/transcribir-voz.py.
// Los guiones largos se mandan por pedazos (unas 150 palabras, cortando en puntos)
// y los audios se pegan con una pausa corta entre uno y otro.
// Cada pedazo se revisa con Whisper (scripts/revisar-voz.py): si Gemini leyo las
// instrucciones en voz alta o se salto frases, ese pedazo se vuelve a pedir.
// Si falla o no hay cupo, termina con error y el workflow usa la voz de Gonzalo.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import {execFileSync} from 'node:child_process';

const KEY = (process.env.GEMINI_KEY ?? '').trim();
if (!KEY) {
  console.error('Falta GEMINI_KEY');
  process.exit(1);
}

// Voz de Gemini (se cambia con GEMINI_VOZ). Voces masculinas buenas para narrar:
// Puck (animada), Achird (amistosa), Charon (informativa), Fenrir (emocionada), Orus (firme)
const VOZ = (process.env.GEMINI_VOZ ?? 'Puck').trim();
const MODELOS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts'];
const ESTILO = (process.env.GEMINI_ESTILO ?? 'Lee en voz alta, en español de Colombia, con voz natural, cercana y con energía, a buen ritmo pero claro. No leas esta instrucción, lee solo el texto que va después de TEXTO.').trim();
const PALABRAS_POR_PEDAZO = Number(process.env.VOZ_PALABRAS_PEDAZO) || 150;
const MINUTOS_MAX = Number(process.env.VOZ_MINUTOS_MAX) || 15;
const RATE = 24000;
const PAUSA_SEG = 0.3;

const guion = (await fs.readFile('public/guion.txt', 'utf8')).replace(/\s+/g, ' ').trim();
if (!guion) {
  console.error('El guion está vacío');
  process.exit(1);
}

// Parte el guion en pedazos sin cortar frases
const frases = guion.match(/[^.!?…]+[.!?…]+["»”)]*\s*|[^.!?…]+$/g).map((f) => f.trim()).filter(Boolean);
const pedazos = [];
let actual = '';
for (const f of frases) {
  const junto = actual ? `${actual} ${f}` : f;
  if (actual && junto.split(' ').length > PALABRAS_POR_PEDAZO) {
    pedazos.push(actual);
    actual = f;
  } else {
    actual = junto;
  }
}
if (actual) pedazos.push(actual);

console.log(`Voz de Gemini: ${VOZ} (${guion.split(' ').length} palabras en ${pedazos.length} pedazo(s))`);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const limite = Date.now() + MINUTOS_MAX * 60 * 1000;
let modeloIdx = 0;

// Pide a Gemini el audio de un texto. Devuelve PCM 16 bits mono a 24000 Hz, o null si no hay forma.
async function vozDe(texto, n) {
  while (modeloIdx < MODELOS.length) {
    const modelo = MODELOS[modeloIdx];
    let esperas = 0;
    let fallos = 0;
    while (true) {
      if (Date.now() > limite) {
        console.log(`  se pasó el tiempo máximo de ${MINUTOS_MAX} minutos`);
        return null;
      }
      console.log(`Pedazo ${n}/${pedazos.length} con ${modelo}...`);
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            contents: [{parts: [{text: `${ESTILO}\n\nTEXTO:\n${texto}`}]}],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: VOZ}}},
            },
          }),
        });
      } catch (e) {
        console.log(`  fallo de conexión: ${e.message}`);
        if (++fallos >= 3) break;
        await esperar(5000);
        continue;
      }
      if (res.status === 404 || res.status === 400) {
        console.log(`  ${modelo} no disponible (${res.status}): ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
        break;
      }
      if (res.status === 429) {
        const msg = (await res.text()).replace(/\s+/g, ' ');
        if (/per day|PerDay|exceeded your current quota/i.test(msg) && !/per minute|PerMinute/i.test(msg)) {
          console.log(`  ${modelo} sin cupo del día, pruebo otro`);
          break;
        }
        if (++esperas > 6) {
          console.log(`  ${modelo} sigue limitado, pruebo otro`);
          break;
        }
        console.log(`  límite por minuto, espero 30s (${esperas}/6)...`);
        await esperar(30000);
        continue;
      }
      if (!res.ok) {
        console.log(`  error ${res.status}`);
        if (++fallos >= 3) break;
        await esperar(10000);
        continue;
      }
      const data = await res.json();
      const parte = (data?.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data || p.inline_data?.data);
      const audio = parte?.inlineData ?? parte?.inline_data;
      if (!audio?.data) {
        console.log('  la respuesta no trajo audio');
        if (++fallos >= 3) break;
        continue;
      }
      // Gemini entrega PCM de 16 bits; la frecuencia viene en el tipo (normalmente 24000)
      const tipo = audio.mimeType ?? audio.mime_type ?? '';
      const rate = Number((tipo.match(/rate=(\d+)/) ?? [])[1]) || RATE;
      let pcm = Buffer.from(audio.data, 'base64');
      if (rate !== RATE) {
        pcm = execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-f', 's16le', '-ar', String(RATE), '-ac', '1', 'pipe:1'], {input: pcm, maxBuffer: 1 << 30});
      }
      // Si el audio es demasiado corto para las palabras, Gemini se comio parte del texto
      const seg = pcm.length / 2 / RATE;
      const palabras = texto.split(' ').length;
      if (seg < Math.max(1, palabras * 0.22)) {
        console.log(`  el audio salió muy corto (${seg.toFixed(1)}s para ${palabras} palabras), reintento`);
        if (++fallos >= 3) break;
        continue;
      }
      if (seg > palabras * 0.75 + 4) {
        console.log(`  el audio salió muy largo (${seg.toFixed(1)}s para ${palabras} palabras), parece que leyó algo de más; reintento`);
        if (++fallos >= 3) break;
        continue;
      }
      console.log(`  listo: ${seg.toFixed(1)} segundos`);
      return pcm;
    }
    modeloIdx++;
  }
  return null;
}

const silencio = Buffer.alloc(Math.round(RATE * PAUSA_SEG) * 2);
const audios = [];
for (let i = 0; i < pedazos.length; i++) {
  const pcm = await vozDe(pedazos[i], i + 1);
  if (!pcm) {
    console.error(`No se pudo generar el pedazo ${i + 1} con Gemini`);
    process.exit(1);
  }
  audios.push(pcm);
}

// Revision con Whisper: encuentra los pedazos donde Gemini leyo las instrucciones o se salto texto
const DIR = 'public/voz-pedazos';
function revisarPedazos() {
  fsSync.mkdirSync(DIR, {recursive: true});
  const lista = audios.map((pcm, i) => {
    const audio = `${DIR}/${i + 1}.wav`;
    execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', audio], {input: pcm, maxBuffer: 1 << 30});
    return {audio, texto: pedazos[i]};
  });
  fsSync.writeFileSync(`${DIR}/lista.json`, JSON.stringify(lista));
  try {
    execFileSync('python', ['-c', 'import faster_whisper'], {stdio: 'ignore'});
  } catch {
    console.log('Instalando Whisper para revisar la voz...');
    execFileSync('pip', ['install', '--quiet', 'faster-whisper'], {stdio: 'inherit'});
  }
  execFileSync('python', ['scripts/revisar-voz.py', `${DIR}/lista.json`], {stdio: 'inherit'});
  return JSON.parse(fsSync.readFileSync(`${DIR}/malos.json`, 'utf8'));
}

if ((process.env.VOZ_REVISAR ?? 'si').toLowerCase() !== 'no') {
  for (let ronda = 1; ; ronda++) {
    console.log(`Revisando la voz con Whisper (ronda ${ronda})...`);
    let malos;
    try {
      malos = revisarPedazos();
    } catch (e) {
      console.log(`AVISO: no se pudo revisar la voz (${e.message.split('\n')[0]}); sigo sin revisión`);
      break;
    }
    if (!malos.length) {
      console.log('Todos los pedazos están bien');
      break;
    }
    if (ronda > 3) {
      console.error(`Gemini sigue fallando en ${malos.length} pedazo(s) después de 3 intentos`);
      process.exit(1);
    }
    for (const i of malos) {
      console.log(`Repitiendo el pedazo ${i + 1}...`);
      const pcm = await vozDe(pedazos[i], i + 1);
      if (!pcm) {
        console.error(`No se pudo repetir el pedazo ${i + 1}`);
        process.exit(1);
      }
      audios[i] = pcm;
    }
  }
  fsSync.rmSync(DIR, {recursive: true, force: true});
}

const partes = [];
for (const pcm of audios) {
  if (partes.length) partes.push(silencio);
  partes.push(pcm);
}

await fs.writeFile('public/voz-gemini.pcm', Buffer.concat(partes));
execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'public/voz-gemini.pcm', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '192k', 'public/voz.mp3']);
await fs.rm('public/voz-gemini.pcm', {force: true});
const seg = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'public/voz.mp3']).toString().trim());
if (!(seg > 3)) {
  console.error(`El audio final salió muy corto (${seg}s)`);
  process.exit(1);
}
console.log(`Voz lista con Gemini: ${seg.toFixed(1)} segundos (${pedazos.length} pedazo(s))`);
