// Invi, el ingeniero invisible: el personaje del canal, dibujado con codigo (SVG).
// Va dentro del proyecto, asi no hace falta subir imagenes.
const N = '#10233a';
const B = `stroke='${N}' stroke-width='7'`;

const ojos = (t: string) => {
  if (t === 'sorpresa')
    return `<circle cx='318' cy='335' r='34' fill='#fff'/><circle cx='482' cy='335' r='34' fill='#fff'/><circle cx='318' cy='338' r='17' fill='${N}'/><circle cx='482' cy='338' r='17' fill='${N}'/><circle cx='325' cy='330' r='6' fill='#fff'/><circle cx='489' cy='330' r='6' fill='#fff'/>`;
  if (t === 'guino')
    return `<circle cx='318' cy='335' r='30' fill='#fff'/><circle cx='322' cy='339' r='16' fill='${N}'/><circle cx='328' cy='332' r='6' fill='#fff'/><path d='M455 340 Q482 314 509 340' stroke='${N}' stroke-width='11' fill='none' stroke-linecap='round'/>`;
  if (t === 'feliz')
    return `<path d='M291 343 Q318 314 345 343' stroke='${N}' stroke-width='11' fill='none' stroke-linecap='round'/><path d='M455 343 Q482 314 509 343' stroke='${N}' stroke-width='11' fill='none' stroke-linecap='round'/>`;
  return `<circle cx='318' cy='335' r='30' fill='#fff'/><circle cx='482' cy='335' r='30' fill='#fff'/><circle cx='324' cy='339' r='16' fill='${N}'/><circle cx='488' cy='339' r='16' fill='${N}'/><circle cx='330' cy='332' r='6' fill='#fff'/><circle cx='494' cy='332' r='6' fill='#fff'/>`;
};

const boca = (t: string) =>
  t === 'sorpresa'
    ? `<ellipse cx='400' cy='452' rx='26' ry='32' fill='${N}'/><ellipse cx='400' cy='466' rx='14' ry='10' fill='#ff6b8a'/>`
    : `<path d='M340 425 Q400 495 460 425 Z' fill='${N}'/><path d='M365 455 Q400 478 435 455 Q400 470 365 455Z' fill='#ff6b8a'/>`;

const manoAbierta = (x: number, y: number, rot: number) =>
  `<g transform='translate(${x},${y}) rotate(${rot})'>` +
  `<rect x='-48' y='-30' width='96' height='78' rx='30' fill='#fff' ${B}/>` +
  `<rect x='-44' y='-88' width='22' height='66' rx='11' fill='#fff' ${B}/>` +
  `<rect x='-19' y='-100' width='22' height='76' rx='11' fill='#fff' ${B}/>` +
  `<rect x='6' y='-96' width='22' height='72' rx='11' fill='#fff' ${B}/>` +
  `<rect x='30' y='-80' width='20' height='58' rx='10' fill='#fff' ${B}/>` +
  `<rect x='-80' y='-14' width='44' height='22' rx='11' fill='#fff' ${B} transform='rotate(-25 -58 -3)'/>` +
  `<rect x='-50' y='44' width='100' height='30' rx='10' fill='#ff7a1a' ${B}/></g>`;

const puno = (x: number, y: number, rot: number, dedo?: 'indice' | 'pulgar') =>
  `<g transform='translate(${x},${y}) rotate(${rot})'>` +
  (dedo === 'indice' ? `<rect x='-8' y='-110' width='26' height='86' rx='13' fill='#fff' ${B}/>` : '') +
  (dedo === 'pulgar' ? `<rect x='-46' y='-104' width='30' height='80' rx='15' fill='#fff' ${B}/>` : '') +
  `<rect x='-50' y='-36' width='100' height='84' rx='32' fill='#fff' ${B}/>` +
  `<path d='M-26 -30 L-26 0 M2 -32 L2 0 M28 -30 L28 0' stroke='${N}' stroke-width='5' stroke-linecap='round'/>` +
  `<rect x='-52' y='44' width='104' height='30' rx='10' fill='#ff7a1a' ${B}/></g>`;

const lupaEnMano = (x: number, y: number, rot: number) =>
  `<g transform='translate(${x},${y}) rotate(${rot})'>` +
  `<rect x='-15' y='-150' width='30' height='130' rx='13' fill='#ff7a1a' ${B}/>` +
  `<circle cx='0' cy='-215' r='72' fill='#c9fbff' fill-opacity='0.45' stroke='${N}' stroke-width='16'/>` +
  `<circle cx='0' cy='-215' r='72' fill='none' stroke='#ffd400' stroke-width='8'/>` +
  `<path d='M-36 -240 Q-22 -262 6 -268' stroke='#fff' stroke-width='11' fill='none' stroke-linecap='round'/>` +
  `<circle cx='30' cy='-190' r='7' fill='#fff' opacity='0.9'/></g>` +
  puno(x, y, rot);

const chispas = () =>
  [[170, 240], [640, 200], [150, 470], [670, 520], [600, 120]]
    .map(([x, y]) => `<path d='M${x} ${y - 18} L${x + 5} ${y - 5} L${x + 18} ${y} L${x + 5} ${y + 5} L${x} ${y + 18} L${x - 5} ${y + 5} L${x - 18} ${y} L${x - 5} ${y - 5} Z' fill='#9ff8ff'/>`)
    .join('');

const dibujar = (pose: string) => {
  const cara = ({saludo: 'feliz', senala: 'normal', sorpresa: 'sorpresa', pulgar: 'guino'} as Record<string, string>)[pose];
  const manos =
    pose === 'saludo' ? lupaEnMano(215, 690, -12) + manoAbierta(625, 350, 18)
    : pose === 'senala' ? lupaEnMano(215, 690, -12) + puno(640, 360, 70, 'indice')
    : pose === 'sorpresa' ? manoAbierta(190, 360, -22) + manoAbierta(610, 360, 22) + lupaEnMano(600, 720, 14)
    : lupaEnMano(215, 690, -12) + puno(610, 520, 0, 'pulgar');
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800' viewBox='0 0 800 800'>` +
    `<defs><radialGradient id='cuerpo' cx='50%' cy='35%' r='65%'><stop offset='0%' stop-color='#bffcff' stop-opacity='0.30'/><stop offset='100%' stop-color='#38e8ff' stop-opacity='0.08'/></radialGradient>` +
    `<filter id='brillo' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='10'/></filter></defs>` +
    chispas() +
    // cuerpo invisible: solo un contorno de luz
    `<g filter='url(#brillo)'><circle cx='400' cy='350' r='158' fill='none' stroke='#38e8ff' stroke-width='20'/><path d='M245 800 Q255 545 400 535 Q545 545 555 800' fill='none' stroke='#38e8ff' stroke-width='20'/></g>` +
    `<circle cx='400' cy='350' r='155' fill='url(#cuerpo)' stroke='#d9feff' stroke-width='6' stroke-dasharray='18 14'/>` +
    `<path d='M248 800 Q258 550 400 540 Q542 550 552 800 Z' fill='url(#cuerpo)' stroke='#d9feff' stroke-width='6' stroke-dasharray='18 14'/>` +
    // chaleco reflectivo
    `<path d='M292 575 L345 552 L372 800 L292 800 Z' fill='#ff7a1a' ${B}/><path d='M508 575 L455 552 L428 800 L508 800 Z' fill='#ff7a1a' ${B}/>` +
    `<rect x='296' y='660' width='66' height='20' fill='#f2fbff' stroke='${N}' stroke-width='4'/><rect x='438' y='660' width='66' height='20' fill='#f2fbff' stroke='${N}' stroke-width='4'/>` +
    ojos(cara) + boca(cara) +
    // gafas
    `<circle cx='318' cy='335' r='60' fill='#c9fbff' fill-opacity='0.18' stroke='${N}' stroke-width='15'/><circle cx='482' cy='335' r='60' fill='#c9fbff' fill-opacity='0.18' stroke='${N}' stroke-width='15'/>` +
    `<path d='M290 300 L305 285' stroke='#fff' stroke-width='8' stroke-linecap='round'/><path d='M454 300 L469 285' stroke='#fff' stroke-width='8' stroke-linecap='round'/>` +
    `<path d='M378 330 Q400 312 422 330' stroke='${N}' stroke-width='13' fill='none'/>` +
    // casco con engranaje
    `<path d='M228 250 Q233 112 400 107 Q567 112 572 250 Z' fill='#ffd400' stroke='${N}' stroke-width='11' stroke-linejoin='round'/>` +
    `<rect x='196' y='238' width='408' height='42' rx='21' fill='#ffd400' stroke='${N}' stroke-width='11'/>` +
    `<path d='M383 110 L383 238 M417 110 L417 238' stroke='${N}' stroke-width='8' opacity='0.5'/>` +
    `<path d='M280 175 Q292 146 326 133' stroke='#fff6b0' stroke-width='14' fill='none' stroke-linecap='round'/>` +
    `<g transform='translate(482,186)'><circle r='28' fill='${N}'/><circle r='12' fill='#ffd400'/><rect x='-8' y='-40' width='16' height='16' fill='${N}'/><rect x='-8' y='24' width='16' height='16' fill='${N}'/><rect x='-40' y='-8' width='16' height='16' fill='${N}'/><rect x='24' y='-8' width='16' height='16' fill='${N}'/></g>` +
    manos +
    `</svg>`
  );
};

export const INVI: Record<string, string> = {
  saludo: dibujar('saludo'),
  senala: dibujar('senala'),
  sorpresa: dibujar('sorpresa'),
  pulgar: dibujar('pulgar'),
};
