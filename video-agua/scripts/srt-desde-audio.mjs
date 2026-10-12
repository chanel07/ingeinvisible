// Crea public/voz.srt a partir de public/guion.txt y la duracion de public/voz.mp3.
// Se usa cuando la voz se genera con Piper (la voz de respaldo), que no entrega
// subtitulos. Reparte el tiempo entre las frases segun su largo.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const PAUSA = 0.25; // segundos de silencio que Piper deja entre frases
const MAX_PALABRAS = 10; // largo maximo de cada subtitulo

const guion = (await fs.readFile('public/guion.txt', 'utf8')).replace(/\s+/g, ' ').trim();
const duracion = parseFloat(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', 'public/voz.mp3']).toString(),
);
if (!guion || !duracion) {
  console.error('Falta el guion o el audio para crear los subtitulos');
  process.exit(1);
}

// Frases completas, y las muy largas se parten en trozos de pocas palabras
const frases = guion.match(/[^.?!¿¡]*[.?!]+|[^.?!]+$/g)?.map((f) => f.trim()).filter(Boolean) ?? [guion];
const bloques = [];
for (const [i, frase] of frases.entries()) {
  const palabras = frase.split(' ');
  for (let k = 0; k < palabras.length; k += MAX_PALABRAS) {
    bloques.push({texto: palabras.slice(k, k + MAX_PALABRAS).join(' '), finDeFrase: k + MAX_PALABRAS >= palabras.length && i < frases.length - 1});
  }
}

const pausas = bloques.filter((b) => b.finDeFrase).length * PAUSA;
const tiempoHablado = Math.max(0.5, duracion - pausas);
const pesoTotal = bloques.reduce((s, b) => s + b.texto.length, 0);

const fmt = (s) => {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const se = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const mi = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${se},${mi}`;
};

let t = 0;
const salida = bloques.map((b, i) => {
  const dur = (tiempoHablado * b.texto.length) / pesoTotal;
  const inicio = t;
  const fin = Math.min(duracion, t + dur);
  t = fin + (b.finDeFrase ? PAUSA : 0);
  return `${i + 1}\n${fmt(inicio)} --> ${fmt(fin)}\n${b.texto}\n`;
});

await fs.writeFile('public/voz.srt', salida.join('\n'), 'utf8');
console.log(`Subtitulos creados: ${bloques.length} bloques para ${duracion.toFixed(1)} segundos de audio`);
