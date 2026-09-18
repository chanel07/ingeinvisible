import fs from 'node:fs/promises';

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node scripts/siguiente-tema.mjs temas.txt');
  process.exit(1);
}

const contenido = await fs.readFile(archivo, 'utf8');
const lineas = contenido.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));

const usados = lineas.filter(l => l.startsWith('[x] '));
const pendientes = lineas.filter(l => !l.startsWith('[x] '));

if (pendientes.length === 0) {
  console.error('No quedan temas pendientes');
  process.exit(1);
}

const tema = pendientes[0];
console.log(tema);

const nuevo = contenido.replace(tema, `[x] ${tema}`);
await fs.writeFile(archivo, nuevo, 'utf8');
