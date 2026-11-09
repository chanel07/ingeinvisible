import React from 'react';
import {AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

export type Caption = {start: number; end: number; text: string};
export type Etiqueta = {texto: string; cuando?: string};
export type ItemLista = string | {texto: string; cuando?: string};
export type Plantilla = {tipo: string; mito?: string; verdad?: string; titulo?: string; items?: ItemLista[]};
export type Toma = {desde: string; clip: string; buscar: string; seccion?: string; etiquetas?: unknown; plantilla?: Plantilla};
export type VideoProps = {captions: Caption[]; plan: Toma[]};

// Marca del canal. Se cambia con la variable REMOTION_MARCA en el workflow.
// El formato es "PARTE1|PARTE2": la primera va en blanco, la segunda en color.
const MARCA = (process.env.REMOTION_MARCA ?? 'INGENIERÍA|INVISIBLE').split('|');
const MARCA_1 = MARCA[0] ?? '';
const MARCA_2 = MARCA[1] ?? '';

// Boton final para invitar a suscribirse. Se cambia con REMOTION_CIERRE.
// Formato "BOTON|TEXTO DEBAJO" (el texto de debajo es opcional).
// Si el workflow pone otra marca y no define cierre, no se muestra nada.
const CIERRE = process.env.REMOTION_CIERRE ?? (process.env.REMOTION_MARCA ? '' : 'Suscríbete');

// Titulo grande de los primeros segundos (la pregunta del video).
// Lo pasa el workflow con REMOTION_TITULO. Si viene vacio, no se muestra.
const TITULO = (process.env.REMOTION_TITULO ?? '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
const SEGUNDOS_TITULO = 2.6;

// Subtitulos tipo karaoke: la palabra que se esta diciendo se pinta de amarillo.
// Se apaga poniendo REMOTION_KARAOKE=no en el workflow.
const KARAOKE = (process.env.REMOTION_KARAOKE ?? 'si').toLowerCase() !== 'no';

// Modo limpio para Facebook: sin barra de progreso, sin cuadricula, sin marca y
// sin el puntico de las etiquetas. Facebook baja el alcance cuando detecta cosas
// superpuestas que parecen marcas de agua. Se activa con REMOTION_LIMPIO=si.
const LIMPIO = (process.env.REMOTION_LIMPIO ?? 'no').toLowerCase() === 'si';
const PALABRAS_POR_GRUPO = 4;

// Efectos de sonido (archivos en public/sfx/). Suenan bajito para no tapar la voz.
// Se apagan con REMOTION_SFX=no en el workflow.
const SFX = (process.env.REMOTION_SFX ?? 'si').toLowerCase() !== 'no';
const Sfx = ({src, at = 0, vol}: {src: string; at?: number; vol: number}) => {
  const {fps} = useVideoConfig();
  if (!SFX) return null;
  return (
    <Sequence from={Math.max(0, Math.round(at))} durationInFrames={Math.round(1.5 * fps)} layout="none">
      <Audio src={staticFile(`sfx/${src}`)} volume={vol} />
    </Sequence>
  );
};

// Musica de fondo (archivo en public/musica/). La elige el workflow al azar con
// REMOTION_MUSICA. Si viene vacio, el video sale sin musica.
const MUSICA = (process.env.REMOTION_MUSICA ?? '').trim();
const MUSICA_PAUSA = 0.16; // volumen cuando la voz no habla
const MUSICA_VOZ = 0.08; // volumen mientras la voz habla

// Ritmo visual: barrido entre clips y golpe de zoom en las palabras clave.
// Se apagan con REMOTION_BARRIDO=no y REMOTION_GOLPES=no en el workflow.
const BARRIDO = (process.env.REMOTION_BARRIDO ?? 'si').toLowerCase() !== 'no';
const GOLPES = (process.env.REMOTION_GOLPES ?? 'si').toLowerCase() !== 'no';
const BARRIDO_FRAMES = 9;

const AMARILLO = '#f5c400';
const ROJO = '#ff0000';
const OSCURO = '#0a1217';
const FUNDIDO = 12;
const fijo = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const dosDigitos = (n: number) => (n < 10 ? `0${n}` : `${n}`);

// Gemini a veces manda las etiquetas como texto suelto o en otro formato.
// Esto las convierte siempre en una lista valida, o en lista vacia.
const listaEtiquetas = (et: unknown): Etiqueta[] => {
  if (Array.isArray(et)) {
    return et
      .map((e) => (typeof e === 'string' ? {texto: e} : e))
      .filter((e): e is Etiqueta => !!e && typeof e === 'object' && typeof (e as Etiqueta).texto === 'string' && (e as Etiqueta).texto.trim() !== '');
  }
  if (typeof et === 'string' && et.trim()) return [{texto: et.trim()}];
  if (et && typeof et === 'object' && typeof (et as Etiqueta).texto === 'string') return [et as Etiqueta];
  return [];
};

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
      {!LIMPIO && <div style={{width: 20, height: 20, borderRadius: 10, background: AMARILLO, transform: `scale(${pulso})`, boxShadow: `0 0 24px ${AMARILLO}`}} />}
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
  const zoom = interpolate(frame, [0, dur], indice % 2 === 0 ? [1.05, 1.18] : [1.18, 1.05], fijo);
  const mover = interpolate(frame, [0, dur], indice % 2 === 0 ? [-25, 25] : [25, -25], fijo);

  // Entrada: la primera toma aparece de una vez; las demas entran con un barrido
  // rapido desde un lado (o con fundido si se apago el barrido en el workflow).
  const entrada = indice === 0 ? 1 : interpolate(frame, [0, BARRIDO_FRAMES], [0, 1], {...fijo, easing: (x) => 1 - Math.pow(1 - x, 3)});
  const lado = indice % 2 === 0 ? 1 : -1;
  const estiloEntrada = BARRIDO && indice > 0
    ? {transform: `translateX(${(1 - entrada) * 100 * lado}%)`, filter: entrada < 1 ? `blur(${(1 - entrada) * 14}px)` : 'none'}
    : {opacity: indice === 0 ? 1 : interpolate(frame, [0, FUNDIDO], [0, 1], fijo)};

  return (
    <AbsoluteFill style={{...estiloEntrada, overflow: 'hidden'}}>
      {BARRIDO && indice > 0 && <Sfx src="whoosh.mp3" at={0} vol={0.09} />}
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
      {listaEtiquetas(toma.etiquetas).map((e, k) => {
        const s = buscarInicio(captions, e.cuando, inicio);
        const seg = Math.max(0, (s ?? inicio + 1) - inicio);
        const desdeFrame = Math.round(seg * fps);
        return (
          <React.Fragment key={k}>
            <EtiquetaBox texto={e.texto} desdeFrame={desdeFrame} posicion={k} />
            <Sfx src="pop.mp3" at={desdeFrame + k * 8} vol={0.16} />
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

// Plantilla animada "Mito o verdad": un dibujo propio en vez de un clip de stock.
// Aparece el mito, se tacha con un sello rojo y despues sube la verdad.
const VERDE = '#2ecc71';
const ROJO_MITO = '#ff4d4d';
const tamTexto = (t: string, base: number) => (t.length > 60 ? base * 0.72 : t.length > 40 ? base * 0.85 : base);

const PlantillaMito = ({mito, verdad, dur}: {mito: string; verdad: string; dur: number}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const vertical = height > width;
  const base = vertical ? width * 0.072 : height * 0.075;

  const tTachar = Math.max(Math.round(1.4 * fps), Math.round(dur * 0.36));
  const tVerdad = tTachar + Math.round(0.6 * fps);

  const fundido = interpolate(frame, [0, FUNDIDO], [0, 1], fijo);
  const entraMito = spring({frame, fps, config: {damping: 14, stiffness: 120}});
  const tacha = interpolate(frame, [tTachar, tTachar + Math.round(0.35 * fps)], [0, 1], fijo);
  const sello = spring({frame: frame - tTachar, fps, config: {damping: 9, stiffness: 180}});
  const entraVerdad = spring({frame: frame - tVerdad, fps, config: {damping: 14, stiffness: 110}});
  const apagaMito = interpolate(frame, [tVerdad, tVerdad + 12], [1, 0.55], fijo);
  const brillo = 0.5 + 0.5 * Math.sin(frame / 18);

  const tarjeta = {
    background: 'rgba(255,255,255,0.07)',
    borderRadius: 32,
    padding: vertical ? '44px 46px' : '30px 40px',
    width: vertical ? '84%' : '70%',
    position: 'relative' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  };
  const pastilla = (color: string) => ({
    display: 'inline-block',
    background: color,
    color: '#fff',
    fontWeight: 900,
    fontSize: base * 0.55,
    letterSpacing: 4,
    padding: '8px 26px',
    borderRadius: 999,
    marginBottom: 18,
  });
  const icono = (color: string, escala: number) => ({
    position: 'absolute' as const,
    right: -28,
    top: -38,
    width: base * 1.7,
    height: base * 1.7,
    borderRadius: '50%',
    background: color,
    color: '#fff',
    fontSize: base * 1.05,
    fontWeight: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: `scale(${escala}) rotate(${(1 - escala) * -40}deg)`,
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
    border: '6px solid #fff',
  });

  return (
    <AbsoluteFill style={{opacity: fundido, background: 'linear-gradient(160deg, #0d1b2a 0%, #1b3a4b 55%, #234e52 100%)'}}>
      <Sfx src="whoosh.mp3" at={0} vol={0.22} />
      <Sfx src="tachar.mp3" at={tTachar} vol={0.28} />
      <Sfx src="ding.mp3" at={tVerdad} vol={0.22} />
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 30%, rgba(245,196,0,${0.10 + 0.06 * brillo}) 0%, transparent 55%)`}} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: vertical ? 'flex-start' : 'center', paddingTop: vertical ? '16%' : 0, gap: vertical ? 70 : 34, flexDirection: vertical ? 'column' : 'row'}}>
        <div style={{...tarjeta, opacity: Math.min(1, entraMito) * apagaMito, transform: `translateY(${(1 - entraMito) * -80}px) scale(${0.9 + 0.1 * entraMito})`}}>
          <div style={pastilla(ROJO_MITO)}>MITO</div>
          <div style={{position: 'relative', color: '#fff', fontWeight: 900, fontSize: tamTexto(mito, base), lineHeight: 1.18}}>
            {mito}
            <div style={{position: 'absolute', left: -10, top: '48%', height: base * 0.16, width: `calc(${tacha * 100}% + 20px)`, background: ROJO_MITO, borderRadius: 8, transform: 'rotate(-4deg)', boxShadow: '0 4px 14px rgba(0,0,0,0.4)'}} />
          </div>
          <div style={icono(ROJO_MITO, Math.max(0, sello))}>✗</div>
        </div>
        <div style={{...tarjeta, opacity: Math.min(1, Math.max(0, entraVerdad)), transform: `translateY(${(1 - entraVerdad) * 140}px)`, background: 'rgba(46,204,113,0.12)'}}>
          <div style={pastilla(VERDE)}>VERDAD</div>
          <div style={{color: '#fff', fontWeight: 900, fontSize: tamTexto(verdad, base), lineHeight: 1.18}}>{verdad}</div>
          <div style={icono(VERDE, Math.max(0, entraVerdad))}>✓</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Plantilla animada "Lista": los puntos aparecen uno por uno, con su numero.
// Si cada punto trae "cuando", aparece justo cuando la voz lo dice; si no, se reparten en el tiempo.
const PlantillaLista = ({titulo, items, dur, inicio, captions}: {titulo?: string; items: ItemLista[]; dur: number; inicio: number; captions: Caption[]}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const vertical = height > width;
  const lista = items.map((it) => (typeof it === 'string' ? {texto: it} : it)).filter((it) => it && it.texto);
  const n = Math.max(1, lista.length);
  const base = (vertical ? width * 0.062 : height * 0.06) * (n > 6 ? 0.8 : 1);

  // Momento en que aparece cada punto
  const margen = Math.round(0.3 * fps);
  const paso = Math.max(1, Math.floor((dur - margen * 2) / n));
  const momentos = lista.map((it, k) => {
    const s = buscarInicio(captions, it.cuando, inicio);
    const f = s !== null ? Math.round((s - inicio) * fps) : margen + k * paso;
    return Math.max(0, Math.min(dur - 6, f));
  });
  let actual = -1;
  momentos.forEach((m, k) => {
    if (frame >= m) actual = k;
  });

  const fundido = interpolate(frame, [0, FUNDIDO], [0, 1], fijo);
  const entraTitulo = spring({frame, fps, config: {damping: 14, stiffness: 120}});
  const brillo = 0.5 + 0.5 * Math.sin(frame / 18);

  return (
    <AbsoluteFill style={{opacity: fundido, background: 'linear-gradient(160deg, #0d1b2a 0%, #1b2f4b 55%, #2a2350 100%)'}}>
      <Sfx src="whoosh.mp3" at={0} vol={0.2} />
      {momentos.map((m, k) => (
        <Sfx key={`pop${k}`} src="pop.mp3" at={m} vol={0.26} />
      ))}
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 25%, rgba(245,196,0,${0.09 + 0.05 * brillo}) 0%, transparent 55%)`}} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: vertical ? '12%' : '5%', flexDirection: 'column', gap: vertical ? 26 : 16}}>
        {titulo && (
          <div style={{color: AMARILLO, fontWeight: 900, fontSize: base * 1.05, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center', width: '86%', marginBottom: vertical ? 18 : 8, opacity: entraTitulo, transform: `translateY(${(1 - entraTitulo) * -40}px)`, textShadow: '0 6px 24px rgba(0,0,0,0.6)'}}>
            {titulo}
          </div>
        )}
        {lista.map((it, k) => {
          const sp = spring({frame: frame - momentos[k], fps, config: {damping: 13, stiffness: 140}});
          if (frame < momentos[k]) return null;
          const esActual = k === actual;
          return (
            <div
              key={k}
              style={{
                width: vertical ? '86%' : '62%',
                display: 'flex',
                alignItems: 'center',
                gap: 26,
                padding: vertical ? '20px 28px' : '12px 22px',
                borderRadius: 26,
                background: esActual ? 'rgba(245,196,0,0.16)' : 'rgba(255,255,255,0.07)',
                boxShadow: esActual ? '0 0 0 4px rgba(245,196,0,0.55), 0 16px 40px rgba(0,0,0,0.35)' : '0 10px 26px rgba(0,0,0,0.25)',
                opacity: Math.min(1, sp) * (esActual ? 1 : 0.78),
                transform: `translateX(${(1 - sp) * 160}px)`,
              }}
            >
              <div style={{flex: '0 0 auto', width: base * 1.35, height: base * 1.35, borderRadius: '50%', background: AMARILLO, color: '#111', fontWeight: 900, fontSize: base * 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.6 + 0.4 * Math.min(1, sp)})`}}>
                {k + 1}
              </div>
              <div style={{color: '#fff', fontWeight: 900, fontSize: it.texto.length > 28 ? base * 0.82 : base, lineHeight: 1.15}}>{it.texto}</div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TarjetaSeccion = ({numero, titulo}: {numero: number; titulo: string}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const entra = spring({frame, fps, config: {damping: 200}});
  const sale = interpolate(frame, [2.4 * fps, 3 * fps], [1, 0], fijo);
  const barra = interpolate(frame, [5, 25], [0, 1], fijo);

  // En videos verticales la tarjeta va centrada, mas pequena y sin salirse de la pantalla
  if (height > width) {
    return (
      <AbsoluteFill style={{background: `rgba(10,18,23,${0.6 * sale})`, justifyContent: 'center', alignItems: 'center', padding: '0 8%', opacity: sale}}>
        <div style={{textAlign: 'center', transform: `translateY(${(1 - entra) * 60}px)`, opacity: entra}}>
          <div style={{color: AMARILLO, fontSize: 110, fontWeight: 900, lineHeight: 1}}>{dosDigitos(numero)}</div>
          <div style={{width: 360 * barra, height: 10, background: AMARILLO, margin: '24px auto'}} />
          <div style={{color: '#fff', fontSize: titulo.length > 16 ? 70 : 84, fontWeight: 900, lineHeight: 1.1, textTransform: 'uppercase', textShadow: '0 6px 30px rgba(0,0,0,0.8)'}}>{titulo}</div>
        </div>
      </AbsoluteFill>
    );
  }

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

// Titulo grande del inicio: visible desde el fotograma 0 (sirve tambien de portada)
const TituloInicio = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sale = interpolate(frame, [(SEGUNDOS_TITULO - 0.4) * fps, SEGUNDOS_TITULO * fps], [1, 0], fijo);
  const crece = interpolate(frame, [0, SEGUNDOS_TITULO * fps], [1, 1.05], fijo);
  const palabras = TITULO.toUpperCase().split(' ');
  const ultima = palabras.length - 1;
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', padding: '0 7%', opacity: sale}}>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 65%, transparent 100%)'}} />
      <div
        style={{
          marginTop: '-18%',
          transform: `scale(${crece})`,
          textAlign: 'center',
          fontSize: palabras.join(' ').length > 34 ? 78 : 92,
          fontWeight: 900,
          lineHeight: 1.12,
          letterSpacing: 1,
          color: '#fff',
          textShadow: '0 0 18px rgba(0,0,0,0.95), 0 6px 0 #000, 0 -2px 0 #000, 3px 0 0 #000, -3px 0 0 #000',
        }}
      >
        {palabras.map((p, i) => (
          <span key={i} style={{color: i === ultima ? AMARILLO : '#fff'}}>
            {p}
            {i < ultima ? ' ' : ''}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// Palabras clave de colores e iconos en los subtitulos.
// Se apagan con REMOTION_ICONOS=no en el workflow.
const ICONOS_ON = (process.env.REMOTION_ICONOS ?? 'si').toLowerCase() !== 'no';
const normPal = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const setDe = (t: string) => new Set(t.split(' ').map(normPal));
const PAL_PELIGRO = setDe('nunca jamás peligro peligros peligroso peligrosa peligrosos peligrosas explota explotar explotan explosión fuego incendio incendios tóxico tóxica tóxicos tóxicas cuidado error errores mito falso riesgo daña dañar dañarlo quema quemar quemadura descarga cortocircuito veneno');
const PAL_SOLUCION = setDe('correcto correcta verdad seguro segura solución apaga apágala apagar espera recomendado recomendable protege protegerte tápalo tápala tapa desconecta desconectar ventila lávalo lávala congélalo');
const PAL_NUMERO = setDe('dos tres cuatro cinco seis siete ocho nueve diez once doce quince veinte treinta cincuenta sesenta cien cientos mil miles millón millones');
type TipoIcono = 'rayo' | 'fuego' | 'x' | 'check' | 'alerta';
const ICONO_DE: Record<string, TipoIcono> = {};
const asignar = (t: string, tipo: TipoIcono) => t.split(' ').forEach((w) => (ICONO_DE[normPal(w)] = tipo));
asignar('electricidad eléctrico eléctrica eléctricos corriente voltaje rayo rayos chispa chispas relámpago', 'rayo');
asignar('fuego incendio incendios llama llamas explota explotar explotan explosión quema quemar', 'fuego');
asignar('nunca jamás mito falso error prohibido', 'x');
asignar('correcto correcta verdad solución recomendado', 'check');
asignar('peligro peligroso peligrosa tóxico tóxica cuidado riesgo veneno', 'alerta');

const colorClave = (w: string): string | null => {
  const n = normPal(w);
  if (!n) return null;
  if (/\d/.test(n) || PAL_NUMERO.has(n)) return AMARILLO;
  if (PAL_PELIGRO.has(n)) return '#ff4d4d';
  if (PAL_SOLUCION.has(n)) return '#2ecc71';
  return null;
};

// Iconos dibujados con codigo (se ven igual en cualquier equipo, sin depender de emojis)
const IconoClave = ({tipo, size}: {tipo: TipoIcono; size: number}) => {
  const borde = {stroke: '#000', strokeWidth: 5, strokeLinejoin: 'round' as const};
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.6))'}}>
      {tipo === 'rayo' && <polygon points="58,4 18,56 46,56 36,96 82,38 54,38 66,4" fill="#ffd400" {...borde} />}
      {tipo === 'fuego' && (
        <>
          <path d="M50 4 C62 26 84 36 84 62 C84 84 68 96 50 96 C32 96 16 84 16 62 C16 46 26 38 32 28 C34 42 40 46 44 46 C42 30 44 18 50 4 Z" fill="#ff5a1f" {...borde} />
          <path d="M50 46 C58 58 68 64 68 76 C68 88 60 94 50 94 C40 94 32 88 32 76 C32 66 40 62 44 54 C46 62 48 64 50 64 Z" fill="#ffd400" />
        </>
      )}
      {tipo === 'x' && (
        <>
          <circle cx="50" cy="50" r="44" fill="#ff3b3b" {...borde} />
          <path d="M32 32 L68 68 M68 32 L32 68" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
        </>
      )}
      {tipo === 'check' && (
        <>
          <circle cx="50" cy="50" r="44" fill="#2ecc71" {...borde} />
          <path d="M28 52 L44 68 L74 34" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      )}
      {tipo === 'alerta' && (
        <>
          <polygon points="50,6 96,90 4,90" fill="#ffd400" {...borde} />
          <rect x="45" y="34" width="10" height="32" rx="4" fill="#000" />
          <circle cx="50" cy="77" r="6" fill="#000" />
        </>
      )}
    </svg>
  );
};

// Momento en que suena cada palabra dentro de un subtitulo (reparto segun su largo)
const tiemposPalabras = (cap: Caption) => {
  const palabras = cap.text.split(/\s+/).filter(Boolean);
  const pesos = palabras.map((p) => p.replace(/[^\p{L}\p{N}]/gu, '').length + 2);
  const totalPeso = pesos.reduce((a, b) => a + b, 0) || 1;
  const dur = Math.max(0.01, cap.end - cap.start);
  let acumulado = 0;
  return palabras.map((w, i) => {
    const start = cap.start + (dur * acumulado) / totalPeso;
    acumulado += pesos[i];
    return {w, start};
  });
};

// Instantes de los golpes de zoom: palabras rojas o verdes, con al menos 1,2 s entre golpes
const momentosGolpe = (captions: Caption[]) => {
  const salida: number[] = [];
  for (const cap of captions) {
    for (const {w, start} of tiemposPalabras(cap)) {
      const n = normPal(w);
      if (!PAL_PELIGRO.has(n) && !PAL_SOLUCION.has(n)) continue;
      if (salida.length && start - salida[salida.length - 1] < 1.2) continue;
      salida.push(start);
    }
  }
  return salida;
};

// Subtitulo karaoke: muestra grupos de pocas palabras y resalta la que suena.
// El tiempo de cada palabra se reparte dentro del subtitulo segun su largo,
// porque la voz habla a ritmo parejo.
const SubtituloKaraoke = ({cap, t}: {cap: Caption; t: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const palabras = cap.text.split(/\s+/).filter(Boolean);
  if (!palabras.length) return null;

  const pesos = palabras.map((p) => p.replace(/[^\p{L}\p{N}]/gu, '').length + 2);
  const totalPeso = pesos.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.01, cap.end - cap.start);
  const inicios: number[] = [];
  let acumulado = 0;
  for (const p of pesos) {
    inicios.push(cap.start + (dur * acumulado) / totalPeso);
    acumulado += p;
  }

  let actual = 0;
  for (let i = 0; i < inicios.length; i++) if (t >= inicios[i]) actual = i;

  const desde = Math.floor(actual / PALABRAS_POR_GRUPO) * PALABRAS_POR_GRUPO;
  const visibles = palabras.slice(desde, desde + PALABRAS_POR_GRUPO);
  const pop = spring({frame: frame - Math.round(inicios[actual] * fps), fps, config: {damping: 12, stiffness: 220}});

  // Icono de la palabra que suena (si tiene uno)
  const tipoIcono = ICONOS_ON ? ICONO_DE[normPal(palabras[actual])] : undefined;
  const popIcono = spring({frame: frame - Math.round(inicios[actual] * fps), fps, config: {damping: 9, stiffness: 200}});

  return (
    <div style={{position: 'absolute', bottom: '22%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8%'}}>
      {tipoIcono && (
        <div style={{marginBottom: 14, transform: `scale(${Math.max(0, popIcono)}) rotate(${(1 - Math.min(1, popIcono)) * -25}deg)`}}>
          <IconoClave tipo={tipoIcono} size={120} />
        </div>
      )}
      <div style={{textAlign: 'center', lineHeight: 1.25, fontSize: 68, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1}}>
        {visibles.map((p, k) => {
          const i = desde + k;
          const activa = i === actual;
          const clave = ICONOS_ON ? colorClave(p) : null;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                margin: '0 12px',
                color: clave ?? (activa ? AMARILLO : '#fff'),
                // Las palabras largas crecen menos, para que no se monten sobre las de al lado
                transform: activa ? `scale(${1 + Math.min(clave ? 0.24 : 0.14, 0.6 / Math.max(1, p.length)) * pop})` : 'none',
                textShadow: '0 0 14px rgba(0,0,0,0.95), 0 5px 0 #000, 0 -2px 0 #000, 3px 0 0 #000, -3px 0 0 #000',
              }}
            >
              {p}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// Boton rojo final estilo "suscribirse"
const CierreCanal = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entra = spring({frame, fps, config: {damping: 12, stiffness: 160}});
  const pulso = 1 + Math.max(0, Math.sin((frame - 10) / 5)) * 0.05;
  const [linea1, linea2] = CIERRE.split('|');
  return (
    <div style={{position: 'absolute', bottom: '40%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, entra), transform: `scale(${(0.6 + 0.4 * entra) * pulso})`}}>
      <div style={{background: ROJO, color: '#fff', fontSize: 52, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase', padding: '18px 48px', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,0.55)'}}>
        {linea1}
      </div>
      {linea2 && (
        <div style={{marginTop: 14, color: '#fff', fontSize: 36, fontWeight: 800, textShadow: '0 2px 12px rgba(0,0,0,0.9)'}}>{linea2}</div>
      )}
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

  // 4) Freno: si alguna toma queda muchisimo mas larga de lo normal (porque no se
  // encontraron las frases del guion), el clip se congela y las demas tomas se
  // amontonan al final. En ese caso se reparten todas las tomas de forma pareja.
  if (plan.length > 1) {
    const promedio = total / plan.length;
    const limite = Math.max(8, promedio * 2.5);
    const duraciones = inicios.map((v, i) => (i + 1 < inicios.length ? inicios[i + 1] : total) - v);
    if (Math.max(...duraciones) > limite) {
      for (let i = 0; i < inicios.length; i++) inicios[i] = (total * i) / plan.length;
    }
  }

  let contador = 0;
  const secciones = plan
    // La primera tarjeta nunca sale en el primer segundo: asi el inicio del video
    // (que Facebook y YouTube usan como portada) muestra el clip limpio
    .map((toma, i) => (toma.seccion ? {titulo: toma.seccion, frame: Math.max(Math.round(inicios[i] * fps), Math.round((TITULO ? SEGUNDOS_TITULO + 0.2 : 1.2) * fps)), numero: ++contador} : null))
    .filter((s): s is {titulo: string; frame: number; numero: number} => s !== null);

  const actual = captions.find((c) => t >= c.start && t < c.end);
  const pop = actual ? spring({frame: frame - Math.round(actual.start * fps), fps, config: {damping: 15, stiffness: 200}}) : 1;

  const inicioCierre = durationInFrames - Math.round(2.5 * fps);

  // Golpe de zoom con un pequeño temblor cuando suena una palabra clave
  let golpe = 0;
  let temblor = 0;
  if (GOLPES) {
    for (const g of momentosGolpe(captions)) {
      const d = frame - Math.round(g * fps);
      if (d < 0 || d > 12) continue;
      const k = Math.pow(1 - d / 12, 2);
      golpe = Math.max(golpe, 0.07 * k);
      temblor = Math.sin(d * 2.4) * 7 * k;
    }
  }

  return (
    <AbsoluteFill style={{backgroundColor: OSCURO, fontFamily: 'Arial, sans-serif'}}>
      <Audio src={staticFile('voz.mp3')} />
      {MUSICA && (
        <Audio
          src={staticFile(`musica/${MUSICA}`)}
          loop
          volume={(f) => {
            // Cuanto de la ventana cercana tiene voz: asi la musica baja y sube suave
            const tt = f / fps;
            let habla = 0;
            for (let k = -3; k <= 3; k++) {
              const x = tt + k * 0.1;
              if (captions.some((c) => x >= c.start && x < c.end)) habla++;
            }
            const base = MUSICA_PAUSA - (MUSICA_PAUSA - MUSICA_VOZ) * (habla / 7);
            const entra = interpolate(f, [0, fps], [0, 1], fijo);
            const sale = interpolate(f, [durationInFrames - 2 * fps, durationInFrames], [1, 0], fijo);
            return base * entra * sale;
          }}
        />
      )}

      <AbsoluteFill style={{transform: `scale(${1 + golpe}) translate(${temblor}px, ${-temblor * 0.6}px)`}}>
      {plan.map((toma, i) => {
        const desde = Math.round(inicios[i] * fps);
        const hasta = i + 1 < plan.length ? Math.round(inicios[i + 1] * fps) : durationInFrames;
        if (hasta <= desde) return null;
        return (
          <Sequence key={i} from={desde} durationInFrames={hasta - desde + FUNDIDO}>
            {toma.plantilla?.tipo === 'mito' && toma.plantilla.mito && toma.plantilla.verdad ? (
              <PlantillaMito mito={toma.plantilla.mito} verdad={toma.plantilla.verdad} dur={hasta - desde} />
            ) : toma.plantilla?.tipo === 'lista' && toma.plantilla.items?.length ? (
              <PlantillaLista titulo={toma.plantilla.titulo} items={toma.plantilla.items} dur={hasta - desde} inicio={inicios[i]} captions={captions} />
            ) : (
              <TomaVideo toma={toma} indice={i} inicio={inicios[i]} fin={hasta / fps} captions={captions} />
            )}
          </Sequence>
        );
      })}
      </AbsoluteFill>

      {/* En modo limpio no hay vineta: Facebook la detecta como un borde visible */}
      {!LIMPIO && <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)'}} />}
      <AbsoluteFill style={{background: LIMPIO ? 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 28%)' : 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 35%)'}} />
      {!LIMPIO && <AbsoluteFill style={{backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '80px 80px'}} />}

      {secciones.map((s) => (
        <Sequence key={s.numero} from={s.frame} durationInFrames={Math.round(3 * fps)}>
          <TarjetaSeccion numero={s.numero} titulo={s.titulo} />
          <Sfx src="whoosh.mp3" at={0} vol={0.2} />
        </Sequence>
      ))}

      {TITULO && (
        <Sequence from={0} durationInFrames={Math.round(SEGUNDOS_TITULO * fps)}>
          <TituloInicio />
          <Sfx src="impacto.mp3" at={0} vol={0.3} />
        </Sequence>
      )}

      {!LIMPIO && (
      <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'rgba(255,255,255,0.15)'}}>
        <div style={{width: `${(frame / durationInFrames) * 100}%`, height: '100%', background: AMARILLO}} />
        {secciones.map((s) => (
          <div key={s.numero} style={{position: 'absolute', top: 0, left: `${(s.frame / durationInFrames) * 100}%`, width: 4, height: 8, background: '#fff'}} />
        ))}
      </div>
      )}

      {!LIMPIO && (
        <div style={{position: 'absolute', top: 44, left: 60, color: '#fff', fontSize: 30, fontWeight: 900, letterSpacing: 3, textShadow: '0 2px 12px rgba(0,0,0,0.8)'}}>
          {MARCA_1} <span style={{color: AMARILLO}}>{MARCA_2}</span>
        </div>
      )}

      {actual && KARAOKE && <SubtituloKaraoke cap={actual} t={t} />}

      {actual && !KARAOKE && (
        <div style={{position: 'absolute', bottom: '22%', left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 12%'}}>
          <div style={{color: '#fff', fontSize: 58, fontWeight: 900, textAlign: 'center', lineHeight: 1.3, transform: `scale(${0.92 + 0.08 * pop})`, textShadow: '0 0 14px rgba(0,0,0,0.95), 0 4px 0 #000'}}>
            {actual.text}
          </div>
        </div>
      )}

      {CIERRE && inicioCierre > 4 * fps && (
        <Sequence from={inicioCierre}>
          <CierreCanal />
          <Sfx src="pop.mp3" at={0} vol={0.25} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
