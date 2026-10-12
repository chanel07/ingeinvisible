// Genera public/voz.mp3 con la voz de Gonzalo usando la API oficial de Azure.
// Necesita los secretos AZURE_SPEECH_KEY y AZURE_SPEECH_REGION.
import fs from 'node:fs/promises';

const KEY = (process.env.AZURE_SPEECH_KEY ?? '').trim();
const REGION = (process.env.AZURE_SPEECH_REGION ?? '').trim().toLowerCase();
const VOZ = process.env.VOZ ?? 'es-CO-GonzaloNeural';

if (!KEY || !REGION) {
  console.error('Faltan AZURE_SPEECH_KEY o AZURE_SPEECH_REGION');
  process.exit(1);
}

const guion = (await fs.readFile('public/guion.txt', 'utf8')).replace(/\s+/g, ' ').trim();
if (!guion) {
  console.error('El guion esta vacio');
  process.exit(1);
}

// El texto va dentro de SSML, asi que hay que escapar los caracteres especiales
const escapar = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-CO"><voice name="${VOZ}">${escapar(guion)}</voice></speak>`;

const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
for (let intento = 1; intento <= 3; intento++) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ingenieria-invisible',
      },
      body: ssml,
    });
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer());
      await fs.writeFile('public/voz.mp3', audio);
      console.log(`Voz de Azure generada (${VOZ}, ${Math.round(audio.length / 1024)} KB)`);
      process.exit(0);
    }
    const msg = (await res.text()).slice(0, 200);
    console.log(`Azure respondió ${res.status} (intento ${intento}/3) ${msg}`);
    if (res.status === 401) {
      console.error('La clave o la región de Azure no son correctas. Revisa los secretos en GitHub.');
      process.exit(1);
    }
  } catch (e) {
    console.log(`Fallo al conectar con Azure (intento ${intento}/3): ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 10000));
}
console.error('No se pudo generar la voz con Azure');
process.exit(1);
