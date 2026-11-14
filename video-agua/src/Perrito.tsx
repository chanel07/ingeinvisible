// El perrito de Perros Perdidos Santa Marta: un beagle cachorro con collar rojo
// y placa de ubicacion, dibujado con codigo (SVG). No hace falta subir imagenes.
const N = '#3a2414';

const ojos = (t: string) => {
  if (t === 'feliz')
    return `<path d='M300 330 Q325 300 350 330' stroke='${N}' stroke-width='13' fill='none' stroke-linecap='round'/><path d='M450 330 Q475 300 500 330' stroke='${N}' stroke-width='13' fill='none' stroke-linecap='round'/>`;
  if (t === 'sorpresa')
    return `<circle cx='325' cy='320' r='36' fill='#fff' stroke='${N}' stroke-width='6'/><circle cx='475' cy='320' r='36' fill='#fff' stroke='${N}' stroke-width='6'/><circle cx='325' cy='324' r='20' fill='${N}'/><circle cx='475' cy='324' r='20' fill='${N}'/><circle cx='333' cy='314' r='7' fill='#fff'/><circle cx='483' cy='314' r='7' fill='#fff'/>`;
  if (t === 'guino')
    return `<circle cx='325' cy='322' r='26' fill='${N}'/><circle cx='334' cy='312' r='8' fill='#fff'/><path d='M450 326 Q475 300 500 326' stroke='${N}' stroke-width='13' fill='none' stroke-linecap='round'/>`;
  return `<circle cx='325' cy='322' r='26' fill='${N}'/><circle cx='475' cy='322' r='26' fill='${N}'/><circle cx='334' cy='312' r='8' fill='#fff'/><circle cx='484' cy='312' r='8' fill='#fff'/>`;
};

const boca = (t: string) =>
  t === 'sorpresa'
    ? `<ellipse cx='400' cy='440' rx='24' ry='28' fill='${N}'/>`
    : `<path d='M360 420 Q380 445 400 422 Q420 445 440 420' stroke='${N}' stroke-width='9' fill='none' stroke-linecap='round'/><path d='M382 432 Q400 500 418 432 Z' fill='#ff6b8a' stroke='${N}' stroke-width='6'/>`;

const pata = (x: number, y: number, rot: number) =>
  `<g transform='translate(${x},${y}) rotate(${rot})'><ellipse cx='0' cy='0' rx='48' ry='56' fill='#fff' stroke='${N}' stroke-width='8'/><ellipse cx='0' cy='16' rx='18' ry='14' fill='#ffb3c1'/><circle cx='-22' cy='-20' r='9' fill='#ffb3c1'/><circle cx='0' cy='-30' r='9' fill='#ffb3c1'/><circle cx='22' cy='-20' r='9' fill='#ffb3c1'/></g>`;

const corazones = () =>
  [[150, 220, 1], [650, 190, 0.8], [640, 470, 0.7]]
    .map(([x, y, k]) => `<path transform='translate(${x},${y}) scale(${k})' d='M0 18 C-26 -2 -30 -22 -14 -30 C-6 -34 0 -28 0 -22 C0 -28 6 -34 14 -30 C30 -22 26 -2 0 18 Z' fill='#ff5a8a' stroke='${N}' stroke-width='4'/>`)
    .join('');

const dibujar = (pose: string) => {
  const cara = ({saludo: 'feliz', senala: 'normal', sorpresa: 'sorpresa', pulgar: 'guino'} as Record<string, string>)[pose];
  // Sorprendido: orejas paradas. Las demas poses: orejas caidas de beagle
  const orejas =
    pose === 'sorpresa'
      ? `<path d='M215 250 Q150 120 250 150 Q290 170 280 250 Z' fill='#8b4a1f' stroke='${N}' stroke-width='9'/><path d='M585 250 Q650 120 550 150 Q510 170 520 250 Z' fill='#8b4a1f' stroke='${N}' stroke-width='9'/>`
      : `<path d='M230 220 Q150 230 160 400 Q170 470 230 440 Q270 330 270 240 Z' fill='#8b4a1f' stroke='${N}' stroke-width='9'/><path d='M570 220 Q650 230 640 400 Q630 470 570 440 Q530 330 530 240 Z' fill='#8b4a1f' stroke='${N}' stroke-width='9'/>`;
  const patas =
    pose === 'saludo' ? pata(610, 330, 25) + pata(330, 720, 0)
    : pose === 'senala' ? pata(640, 420, 70) + pata(330, 720, 0)
    : pose === 'sorpresa' ? pata(220, 520, -15) + pata(580, 520, 15)
    : pata(330, 720, 0) + pata(470, 720, 0) + corazones();
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800' viewBox='0 0 800 800'>` +
    // cuerpo y pecho blanco
    `<path d='M250 800 Q240 560 400 540 Q560 560 550 800 Z' fill='#f4e2c8' stroke='${N}' stroke-width='9'/>` +
    `<path d='M330 800 Q330 620 400 610 Q470 620 470 800 Z' fill='#ffffff'/>` +
    // collar rojo con placa de ubicacion
    `<path d='M265 545 Q400 600 535 545 L540 585 Q400 640 260 585 Z' fill='#e8262f' stroke='${N}' stroke-width='8'/>` +
    `<g transform='translate(400,640)'><path d='M0 -38 C-26 -38 -34 -16 -26 2 L0 40 L26 2 C34 -16 26 -38 0 -38 Z' fill='#ffd400' stroke='${N}' stroke-width='7'/><circle cx='0' cy='-14' r='11' fill='${N}'/></g>` +
    orejas +
    // cabeza
    `<ellipse cx='400' cy='330' rx='190' ry='175' fill='#d98a3d' stroke='${N}' stroke-width='10'/>` +
    `<path d='M400 175 Q360 260 330 360 Q340 470 400 480 Q460 470 470 360 Q440 260 400 175 Z' fill='#ffffff'/>` +
    `<ellipse cx='400' cy='420' rx='95' ry='72' fill='#ffffff' stroke='${N}' stroke-width='6'/>` +
    ojos(cara) +
    // nariz
    `<ellipse cx='400' cy='388' rx='34' ry='24' fill='${N}'/><ellipse cx='390' cy='380' rx='10' ry='6' fill='#fff' opacity='0.8'/>` +
    boca(cara) +
    // cachetes
    `<circle cx='285' cy='395' r='18' fill='#ff9db0' opacity='0.6'/><circle cx='515' cy='395' r='18' fill='#ff9db0' opacity='0.6'/>` +
    patas +
    `</svg>`
  );
};

export const PERRITO: Record<string, string> = {
  saludo: dibujar('saludo'),
  senala: dibujar('senala'),
  sorpresa: dibujar('sorpresa'),
  pulgar: dibujar('pulgar'),
};
