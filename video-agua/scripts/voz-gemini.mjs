// Voz natural con Gemini (modelo de texto a voz). Lee public/guion.txt y crea public/voz.mp3.
// Los subtitulos (public/voz.srt) se sacan despues con scripts/transcribir-voz.py.
// Si falla o no hay cupo, termina con error y el workflow usa la voz de Gonzalo.
import fs from 'node:fs/promises';
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
const ESTILO = (process.env.GEMINI_ESTILO ?? 'Habla en español de Latinoamérica, con acento colombiano neutro, como un amigo que le cuenta a otro algo que lo sorprendió: natural, cercano y con energía, a buen ritmo pero claro. Haz una pequeña pausa entre frases. Lee exactamente este texto, sin agregar ni quitar palabras:').trim();

const guion = (await fs.readFile('public/guion.txt', 'utf8')).replace(/\s+/g, ' ').trim();
if (!guion) {
  console.error('El guion está vacío');
  process.exit(1);
}
console.log(`Voz de Gemini: ${VOZ} (${guion.split(' ').length} palabras)`);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

for (const modelo of MODELOS) {
  for (let intento = 1; intento <= 3; intento++) {
    console.log(`Generando voz con ${modelo} (intento ${intento}/3)...`);
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${KEY}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{parts: [{text: `${ESTILO}\n\n${guion}`}]}],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: VOZ}}},
          },
        }),
      });
    } catch (e) {
      console.log(`  fallo de conexión: ${e.message}`);
      await esperar(5000);
      continue;
    }
    if (res.status === 404 || res.status === 400) {
      console.log(`  ${modelo} no disponible (${res.status}): ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
      break;
    }
    if (res.status === 429) {
      const msg = (await res.text()).replace(/\s+/g, ' ');
      if (/exceeded your current quota|per day/i.test(msg)) {
        console.log(`  ${modelo} sin cupo, pruebo otro`);
        break;
      }
      console.log('  límite por minuto, espero 30s...');
      await esperar(30000);
      continue;
    }
    if (!res.ok) {
      console.log(`  error ${res.status}, reintento en 10s`);
      await esperar(10000);
      continue;
    }
    const data = await res.json();
    const parte = (data?.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data || p.inline_data?.data);
    const audio = parte?.inlineData ?? parte?.inline_data;
    if (!audio?.data) {
      console.log('  la respuesta no trajo audio, reintento');
      continue;
    }
    // Gemini entrega audio PCM de 16 bits; la frecuencia viene en el tipo (normalmente 24000)
    const tipo = audio.mimeType ?? audio.mime_type ?? '';
    const rate = Number((tipo.match(/rate=(\d+)/) ?? [])[1]) || 24000;
    await fs.writeFile('public/voz-gemini.pcm', Buffer.from(audio.data, 'base64'));
    execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'public/voz-gemini.pcm', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '192k', 'public/voz.mp3']);
    await fs.rm('public/voz-gemini.pcm', {force: true});
    const seg = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'public/voz.mp3']).toString().trim());
    if (!(seg > 3)) {
      console.log(`  el audio salió muy corto (${seg}s), reintento`);
      continue;
    }
    console.log(`Voz lista con ${modelo}: ${seg.toFixed(1)} segundos`);
    process.exit(0);
  }
}
console.error('No se pudo generar la voz con Gemini');
process.exit(1);
