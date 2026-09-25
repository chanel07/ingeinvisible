import {AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

export type Caption = {start: number; end: number; text: string};
export type Etiqueta = {texto: string; cuando?: string};
export type Toma = {desde: string; clip: string; buscar: string; seccion?: string; etiquetas?: Etiqueta[]};
export type VideoProps = {captions: Caption[]; plan: Toma[]};

// Marca del canal. Se cambia con la variable REMOTION_MARCA en el workflow.
// El formato es "PARTE1|PARTE2": la primera va en blanco, la segunda en color.
const MARCA = (process.env.REMOTION_MARCA ?? 'INGENIERÍA|INVISIBLE').split('|');
const MARCA_1 = MARCA[0] ?? '';
const MARCA_2 = MARCA[1] ?? '';

// Texto final para invitar a seguir el canal. Se cambia con REMOTION_CIERRE.
// Formato "LINEA1|LINEA2": la primera en blanco, la segunda en amarillo.
// Si el workflow pone otra marca y no define cierre, no se muestra nada.
const CIERRE = process.env.REMOTION_CIERRE ?? (process.env.REMOTION_MARCA ? '' : 'Sígueme|Cada día algo que usas sin saber cómo funciona');

const AMARILLO = '#f5c400';
const OSCURO = '#0a1217';
const FUNDIDO = 12;
const fijo = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const dosDigitos = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const buscarInicio = (captions: Caption[], frase: string | undefined, desde: number) => {
  if (!frase) return null;
  const f = norm(frase);
  if (!f) return null;

  const directo = captions.find((x) => x.start >= desde - 0.01 && norm(x.text).includes(f));
  if (directo) return directo.start;

  const posibles = captions.filter((x) => x.start >= desde - 0.01);
  let acumulado = '';
  const marcas: number[] = [];
  for (const c of posibles) {
    acumulado += (acumulado ? ' ' : '') + norm(c.text);
    marcas.push(acumulado.length);
  }

  const ubicar = (pos: number) => {
    const i = marcas.findIndex((fin) => fin > pos);
    return i >= 0 ? posibles[i].start : null;
  };

  const pos = acumulado.indexOf(f);
  if (pos >= 0) return ubicar(pos);

  const palabras = f.split(' ');
  for (let corte = palabras.length - 1; corte >= 2; corte--) {
    const p = acumulado.indexOf(palabras.slice(0, corte).join(' '));
    if (p >= 0) return ubicar(p);
  }
  return null;
};

const EtiquetaBox = ({texto, desdeFrame, posicion}: {texto: string; desdeFrame: number; posicion: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const inicio = desdeFrame + posicion * 8;
  if (frame < inicio) return null;
  const s = spring({frame: frame - inicio, fps, config: {damping: 14, stiffness: 120}});
  const pulso = 1 + Math.sin((frame - inicio) / 6) * 0.25;
  return (
    <div style={{position: 'absolute', right: 80, top: 190 + posicion * 140, display: 'flex', alignItems: 'center', gap: 18, opacity: Math.min(1, s), transform: `translateX(${(1 - s) * 140}px)`}}>
      <div style={{width: 20, height: 20, borderRadius: 10, background: AMARILLO, transform: `scale(${pulso})`, boxShadow: `0 0 24px ${AMARILLO}`}} />
      <div style={{background: 'rgba(10,18,23,0.85)', borderLeft: `8px solid ${AMARILLO}`, color: '#fff', fontSize: 46, fontWeight: 800, padding: '14px 30px', letterSpacing: 1, textTransform: 'uppercase', boxShadow: '0 10px 30px rgba(0,0,0,0.5)'}}>
        {texto}
      </div>
    </div>
  );
};

const TomaVideo = ({toma, indice, inicio, fin, captions}: {toma: Toma; indice: number; inicio: number; fin: number; captions: Caption[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dur = Math.max(1, (fin - inicio) * fps + FUNDIDO);
  // La PRIMERA toma entra sin fundido: si no, el fotograma cero sale negro
  // y ese es el que Facebook y YouTube usan como portada del video.
  const opacidad = indice === 0 ? 1 : interpolate(frame, [0, FUNDIDO], [0, 1], fijo);
  const zoom = interpolate(frame, [0, dur], indice % 2 === 0 ? [1.05, 1.18] : [1.18, 1.05], fijo);
  const mover = interpolate(frame, [0, dur], indice % 2 === 0 ? [-25, 25] : [25, -25], fijo);

  return (
    <AbsoluteFill style={{opacity: opacidad, overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: `scale(${zoom}) translateX(${mover}px)`}}>
        {/* Imagen de respaldo debajo del primer clip: el video tarda casi un
            segundo en decodificar y mientras tanto se veia negro. */}
        {indice === 0 && (
          <Img
            src={staticFile('portada.jpg')}
            style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover'}}
          />
        )}
        <OffthreadVideo src={staticFile(`clips/${toma.clip}`)} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </AbsoluteFill>
      {(toma.etiquetas ?? []).map((e, k) => {
        const s = buscarInicio(captions, e.cuando, inicio);
        const seg = Math.max(0, (s ?? inicio + 1) - inicio);
        return <EtiquetaBox key={k} texto={e.texto} desdeFrame={Math.round(seg * fps)} posicion={k} />;
      })}
    </AbsoluteFill>
  );
};

const TarjetaSeccion = ({numero, titulo}: {numero: number; titulo: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entra = spring({frame, fps, config: {damping: 200}});
  const sale = interpolate(frame, [2.4 * fps, 3 * fps], [1, 0], fijo);
  const barra = interpolate(frame, [5, 25], [0, 1], fijo);
  return (
    <AbsoluteFill style={{background: `rgba(10,18,23,${0.6 * sale})`, justifyContent: 'center', paddingLeft: 140, opacity: sale}}>
      <div style={{transform: `translateX(${(1 - entra) * -220}px)`}}>
        <div style={{color: AMARILLO, fontSize: 120, fontWeight: 900, lineHeight: 1}}>{dosDigitos(numero)}</div>
        <div style={{width: 520 * barra, height: 10, background: AMARILLO, margin: '20px 0'}} />
        <div style={{color: '#fff', fontSize: 100, fontWeight: 900, textTransform: 'uppercase', textShadow: '0 6px 30px rgba(0,0,0,0.7)'}}>{titulo}</div>
      </div>
    </AbsoluteFill>
  );
};

// Tarjeta final que invita a seguir el canal
const CierreCanal = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entra = spring({frame, fps, config: {damping: 14, stiffness: 140}});
  const [linea1, linea2] = CIERRE.split('|');
  return (
    <div style={{position: 'absolute', top: '13%', left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 8%', opacity: Math.min(1, entra), transform: `translateY(${(1 - entra) * -60}px) scale(${0.9 + 0.1 * entra})`}}>
      <div style={{background: 'rgba(10,18,23,0.88)', border: `4px solid ${AMARILLO}`, borderRadius: 24, padding: '26px 40px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.6)'}}>
        <div style={{color: '#fff', fontSize: 56, fontWeight: 900, lineHeight: 1.2, textTransform: 'uppercase', letterSpacing: 2}}>{linea1}</div>
        {linea2 && <div style={{color: AMARILLO, fontSize: 46, fontWeight: 800, lineHeight: 1.25, marginTop: 8}}>{linea2}</div>}
      </div>
    </div>
  );
};

export const MyComposition = ({captions, plan}: VideoProps) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const total = durationInFrames / fps;

  // 1) Buscar el instante de cada toma. null = no se encontro la frase.
  const anclas: (number | null)[] = [];
  let ultimoHallado = 0;
  plan.forEach((toma, i) => {
    if (i === 0) {
      anclas.push(0);
      return;
    }
    const s = buscarInicio(captions, toma.desde, ultimoHallado + 0.5);
    if (s !== null) ultimoHallado = s;
    anclas.push(s);
  });

  // 2) Rellenar los huecos repartiendo el tiempo en partes iguales.
  const inicios: number[] = anclas.map((v) => v ?? 0);
  for (let i = 1; i < anclas.length; i++) {
    if (anclas[i] !== null) continue;
    const antes = inicios[i - 1];
    let j = i;
    while (j < anclas.length && anclas[j] === null) j++;
    const despues = j < anclas.length ? (anclas[j] as number) : total;
    const partes = j - i + 1;
    for (let k = i; k < j; k++) {
      inicios[k] = antes + ((despues - antes) * (k - i + 1)) / partes;
    }
    i = j - 1;
  }

  // 3) Seguridad: nunca retroceder, solaparse ni pasarse del final.
  for (let i = 1; i < inicios.length; i++) {
    if (inicios[i] <= inicios[i - 1]) inicios[i] = inicios[i - 1] + 0.5;
    if (inicios[i] > total - 0.5) inicios[i] = Math.max(inicios[i - 1] + 0.2, total - 0.5);
  }

  let contador = 0;
  const secciones = plan
    .map((toma, i) => (toma.seccion ? {titulo: toma.seccion, frame: Math.round(inicios[i] * fps), numero: ++contador} : null))
    .filter((s): s is {titulo: string; frame: number; numero: number} => s !== null);

  const actual = captions.find((c) => t >= c.start && t < c.end);
  const pop = actual ? spring({frame: frame - Math.round(actual.start * fps), fps, config: {damping: 15, stiffness: 200}}) : 1;

  const inicioCierre = durationInFrames - Math.round(2.5 * fps);

  return (
    <AbsoluteFill style={{backgroundColor: OSCURO, fontFamily: 'Arial, sans-serif'}}>
      <Audio src={staticFile('voz.mp3')} />

      {plan.map((toma, i) => {
        const desde = Math.round(inicios[i] * fps);
        const hasta = i + 1 < plan.length ? Math.round(inicios[i + 1] * fps) : durationInFrames;
        if (hasta <= desde) return null;
        return (
          <Sequence key={i} from={desde} durationInFrames={hasta - desde + FUNDIDO}>
            <TomaVideo toma={toma} indice={i} inicio={inicios[i]} fin={hasta / fps} captions={captions} />
          </Sequence>
        );
      })}

      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)'}} />
      <AbsoluteFill style={{background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 35%)'}} />
      <AbsoluteFill style={{backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '80px 80px'}} />

      {secciones.map((s) => (
        <Sequence key={s.numero} from={s.frame} durationInFrames={Math.round(3 * fps)}>
          <TarjetaSeccion numero={s.numero} titulo={s.titulo} />
        </Sequence>
      ))}

      <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'rgba(255,255,255,0.15)'}}>
        <div style={{width: `${(frame / durationInFrames) * 100}%`, height: '100%', background: AMARILLO}} />
        {secciones.map((s) => (
          <div key={s.numero} style={{position: 'absolute', top: 0, left: `${(s.frame / durationInFrames) * 100}%`, width: 4, height: 8, background: '#fff'}} />
        ))}
      </div>

      <div style={{position: 'absolute', top: 44, left: 60, color: '#fff', fontSize: 30, fontWeight: 900, letterSpacing: 3, textShadow: '0 2px 12px rgba(0,0,0,0.8)'}}>
        {MARCA_1} <span style={{color: AMARILLO}}>{MARCA_2}</span>
      </div>

      {actual && (
        <div style={{position: 'absolute', bottom: '22%', left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 12%'}}>
          <div style={{color: '#fff', fontSize: 58, fontWeight: 900, textAlign: 'center', lineHeight: 1.3, transform: `scale(${0.92 + 0.08 * pop})`, textShadow: '0 0 14px rgba(0,0,0,0.95), 0 4px 0 #000'}}>
            {actual.text}
          </div>
        </div>
      )}

      {CIERRE && inicioCierre > 4 * fps && (
        <Sequence from={inicioCierre}>
          <CierreCanal />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
