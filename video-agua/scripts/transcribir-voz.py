# Crea los subtitulos (public/voz.srt) a partir de TU voz grabada (public/voz.mp3).
# Usa Whisper para saber en que segundo dices cada palabra, y pone el texto exacto
# del guion (public/guion.txt), asi los subtitulos no salen con errores de dictado.
import re
import sys
import unicodedata
from difflib import SequenceMatcher

AUDIO = 'public/voz.mp3'
GUION = 'public/guion.txt'
SALIDA = 'public/voz.srt'
MAX_PALABRAS = 6      # palabras por subtitulo
PAUSA_CORTE = 0.45    # una pausa mas larga que esto empieza un subtitulo nuevo


def normalizar(w):
    w = unicodedata.normalize('NFD', w.lower())
    w = ''.join(c for c in w if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9ñ]', '', w)


def alinear(palabras_guion, palabras_voz):
    """palabras_voz: lista de (texto, inicio, fin). Devuelve el guion con tiempos."""
    gn = [normalizar(w) for w in palabras_guion]
    vn = [normalizar(w) for w, _, _ in palabras_voz]
    tiempos = [None] * len(palabras_guion)
    sm = SequenceMatcher(None, gn, vn, autojunk=False)
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == 'equal':
            for k in range(a1 - a0):
                tiempos[a0 + k] = (palabras_voz[b0 + k][1], palabras_voz[b0 + k][2])
        elif op == 'replace':
            # Palabras que Whisper oyo distinto ("Matius" por "Matthews"): se reparten
            # dentro del mismo tramo de tiempo en que las dijiste
            t0, t1 = palabras_voz[b0][1], palabras_voz[b1 - 1][2]
            n = a1 - a0
            for k in range(n):
                tiempos[a0 + k] = (t0 + (t1 - t0) * k / n, t0 + (t1 - t0) * (k + 1) / n)
    # Las palabras que Whisper no reconocio se reparten entre las vecinas
    conocidos = [i for i, t in enumerate(tiempos) if t]
    if not conocidos:
        return None
    for i in range(len(tiempos)):
        if tiempos[i]:
            continue
        antes = max([j for j in conocidos if j < i], default=None)
        despues = min([j for j in conocidos if j > i], default=None)
        if antes is None:
            t = tiempos[despues][0]
            tiempos[i] = (max(0, t - 0.3 * (despues - i)), t)
        elif despues is None:
            t = tiempos[antes][1]
            tiempos[i] = (t + 0.3 * (i - antes - 1), t + 0.3 * (i - antes))
        else:
            t0, t1 = tiempos[antes][1], tiempos[despues][0]
            paso = (t1 - t0) / (despues - antes)
            tiempos[i] = (t0 + paso * (i - antes - 1), t0 + paso * (i - antes))
    return [(w, ini, fin) for w, (ini, fin) in zip(palabras_guion, tiempos)]


def agrupar(palabras):
    grupos, actual = [], []
    for i, (w, ini, fin) in enumerate(palabras):
        if actual and (len(actual) >= MAX_PALABRAS or ini - actual[-1][2] > PAUSA_CORTE):
            grupos.append(actual)
            actual = []
        actual.append((w, ini, fin))
        if re.search(r'[.!?]$', w):
            grupos.append(actual)
            actual = []
    if actual:
        grupos.append(actual)
    return grupos


def formato(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def escribir_srt(grupos):
    lineas = []
    for n, g in enumerate(grupos, 1):
        ini, fin = g[0][1], max(g[-1][2], g[0][1] + 0.3)
        lineas += [str(n), f'{formato(ini)} --> {formato(fin)}', ' '.join(w for w, _, _ in g), '']
    with open(SALIDA, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lineas))


def main():
    try:
        guion = open(GUION, encoding='utf-8').read().strip()
    except FileNotFoundError:
        guion = ''
    from faster_whisper import WhisperModel
    print('Transcribiendo tu voz con Whisper...')
    modelo = WhisperModel('small', device='cpu', compute_type='int8')
    segmentos, _ = modelo.transcribe(AUDIO, language='es', word_timestamps=True, vad_filter=True, initial_prompt=guion[:800] or None)
    voz = [(w.word.strip(), w.start, w.end) for s in segmentos for w in (s.words or []) if w.word.strip()]
    if not voz:
        print('ERROR: Whisper no reconoció palabras en tu grabación')
        sys.exit(1)
    palabras_guion = guion.split()
    resultado = alinear(palabras_guion, voz) if palabras_guion else None
    if resultado:
        iguales = sum(1 for a, b in zip([normalizar(w) for w in palabras_guion], [normalizar(w) for w, _, _ in voz]) if a == b)
        print(f'Subtítulos con el texto del guion ({len(palabras_guion)} palabras; Whisper oyó {len(voz)}).')
    else:
        print('AVISO: no pude alinear con el guion, uso el texto que oyó Whisper')
        resultado = voz
    escribir_srt(agrupar(resultado))
    print(f'Listo: {SALIDA}')


if __name__ == '__main__':
    main()
