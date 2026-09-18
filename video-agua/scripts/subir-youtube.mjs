/**
 * Sube un video a YouTube usando las llaves guardadas en los secrets.
 *
 * Uso:
 *   node scripts/subir-youtube.mjs <ruta-del-video> "<titulo>" <short|largo>
 *
 * Variables de entorno necesarias:
 *   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
 */

import fs from 'fs';
import path from 'path';

const [, , rutaVideo, tituloCrudo, tipo = 'short'] = process.argv;

if (!rutaVideo || !tituloCrudo) {
  console.error('Faltan argumentos: <ruta-video> "<titulo>" <short|largo>');
  process.exit(1);
}

if (!fs.existsSync(rutaVideo)) {
  console.error(`No existe el video: ${rutaVideo}`);
  process.exit(1);
}

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Faltan los secrets YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN');
  process.exit(1);
}

/** Cambia el refresh token permanente por un access token de una hora. */
async function obtenerAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `No se pudo renovar el token (${res.status}): ${JSON.stringify(data)}\n` +
        'Si dice invalid_grant, hay que volver a correr sacar-llave.py.',
    );
  }
  return data.access_token;
}

function construirMetadatos() {
  // YouTube corta los titulos en 100 caracteres
  let titulo = tituloCrudo.trim().slice(0, 95);
  if (tipo === 'short' && !/#shorts/i.test(titulo)) {
    titulo = `${titulo} #Shorts`.slice(0, 100);
  }

  const descripcion = [
    tituloCrudo.trim(),
    '',
    'Ingeniería Invisible: cómo funcionan las cosas que usas todos los días.',
    '',
    'Suscríbete para un dato nuevo cada día.',
    '',
    '#ingenieria #comofunciona #datos',
  ].join('\n');

  return {
    snippet: {
      title: titulo,
      description: descripcion,
      tags: ['ingenieria', 'como funciona', 'curiosidades', 'ciencia', 'datos'],
      categoryId: '27', // Educación
      defaultLanguage: 'es',
      defaultAudioLanguage: 'es',
    },
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
      // Declaramos que el audio es generado con IA. Es obligatorio y ayuda
      // cuando pidamos la auditoria de la API.
      containsSyntheticMedia: true,
    },
  };
}

async function subir(accessToken) {
  const tamano = fs.statSync(rutaVideo).size;
  const metadatos = construirMetadatos();

  // Paso 1: abrir la sesion de subida
  const inicio = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(tamano),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadatos),
    },
  );

  if (!inicio.ok) {
    const err = await inicio.text();
    throw new Error(`Error al iniciar la subida (${inicio.status}): ${err}`);
  }

  const urlSubida = inicio.headers.get('location');
  if (!urlSubida) throw new Error('Google no devolvio la URL de subida');

  console.log(`Subiendo ${(tamano / 1024 / 1024).toFixed(1)} MB...`);

  // Paso 2: mandar el archivo
  const res = await fetch(urlSubida, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(tamano),
    },
    body: fs.createReadStream(rutaVideo),
    duplex: 'half',
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Error al subir (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

try {
  const accessToken = await obtenerAccessToken();
  const video = await subir(accessToken);

  console.log('\n=============================================');
  console.log('  VIDEO SUBIDO');
  console.log('=============================================');
  console.log(`Titulo:     ${video.snippet.title}`);
  console.log(`Privacidad: ${video.status.privacyStatus}`);
  console.log(`Enlace:     https://youtu.be/${video.id}`);
  console.log('=============================================\n');

  if (video.status.privacyStatus === 'private') {
    console.log(
      'OJO: quedo en privado. Es normal mientras el proyecto de API\n' +
        'no tenga la auditoria de YouTube aprobada. El video esta subido,\n' +
        'pero no se puede pasar a publico hasta que llegue la aprobacion.\n',
    );
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `video_id=${video.id}\nvideo_url=https://youtu.be/${video.id}\n`,
    );
  }
} catch (e) {
  console.error('\nFALLO LA SUBIDA:\n' + e.message);
  process.exit(1);
}
