import {Composition, CalculateMetadataFunction, staticFile} from 'remotion';
import {MyComposition, VideoProps, Caption} from './Composition';

const FPS = 30;

const aSegundos = (s: string) => {
  const [h, m, resto] = s.trim().split(':');
  const [seg, ms] = resto.split(',');
  return Number(h) * 3600 + Number(m) * 60 + Number(seg) + Number(ms) / 1000;
};

const leerSrt = (texto: string): Caption[] =>
  texto
    .replace(/\r/g, '')
    .trim()
    .split(/\n\n+/)
    .map((bloque) => {
      const lineas = bloque.split('\n');
      const i = lineas.findIndex((l) => l.includes('-->'));
      if (i < 0) return null;
      const [inicio, fin] = lineas[i].split('-->');
      return {start: aSegundos(inicio), end: aSegundos(fin), text: lineas.slice(i + 1).join(' ')};
    })
    .filter((c): c is Caption => c !== null);

const cargar = async (archivo: string): Promise<string> => {
  const res = await globalThis.fetch(staticFile(archivo));
  return res.text();
};

const calcular: CalculateMetadataFunction<VideoProps> = async ({props}) => {
  const [srt, planTexto] = await Promise.all([cargar('voz.srt'), cargar('plan.json')]);
  const captions = leerSrt(srt);
  const plan = JSON.parse(planTexto);
  const ultimo = captions.length ? captions[captions.length - 1].end : 5;
  return {durationInFrames: Math.ceil((ultimo + 1) * FPS), props: {...props, captions, plan}};
};

export const RemotionRoot = () => (
  <Composition
    id="AguaGrifo"
    component={MyComposition}
    durationInFrames={300}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{captions: [], plan: []}}
    calculateMetadata={calcular}
  />
);
