# Revisa cada pedazo de la voz de Gemini con Whisper, ANTES de pegarlos.
# A veces Gemini lee en voz alta las instrucciones ("habla con acento colombiano...")
# o se salta frases. Este script escucha cada pedazo, lo compara con el texto que
# debia decir y devuelve cuales salieron mal, para que voz-gemini.mjs los repita.
#
# Uso: python scripts/revisar-voz.py public/voz-pedazos/lista.json
# lista.json = [{"audio": "public/voz-pedazos/1.wav", "texto": "..."}, ...]
# Escribe public/voz-pedazos/malos.json = [indices de los pedazos malos]
import json
import re
import subprocess
import sys
import unicodedata
from difflib import SequenceMatcher

import numpy as np

# Palabras de las instrucciones: si Whisper las oye y no estan en el texto, Gemini las leyo
INSTRUCCIONES = ['acento', 'latinoamerica', 'colombiano', 'colombia', 'espanol natural', 'espanol de',
                 'lee exactamente', 'lee en voz', 'lee solo', 'no leas', 'sin agregar', 'quitar palabras',
                 'en voz alta', 'voz natural', 'tono natural', 'narrador', 'pequena pausa', 'buen ritmo',
                 'con energia', 'esta instruccion', 'transcripcion', 'texto']
EXTRA_SEGUIDAS = 8    # palabras de mas seguidas que no estan en el texto = leyo algo que no debia
MIN_COBERTURA = 0.75  # debe decir al menos el 75% de las palabras del texto


def normalizar(w):
    w = unicodedata.normalize('NFD', w.lower())
    w = ''.join(c for c in w if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]', '', w)


def palabras(t):
    return [p for p in (normalizar(w) for w in t.split()) if p]


def revisar(texto, oido):
    """Devuelve '' si el pedazo esta bien, o la razon por la que esta mal."""
    esperadas = palabras(texto)
    oidas = palabras(oido)
    if not oidas:
        return 'no se oye nada'
    t_texto = ' '.join(esperadas)
    t_oido = ' '.join(oidas)
    for frase in INSTRUCCIONES:
        if f' {frase} ' in f' {t_oido} ' and f' {frase} ' not in f' {t_texto} ':
            return f'leyó las instrucciones ("{frase}")'
    sm = SequenceMatcher(None, esperadas, oidas, autojunk=False)
    iguales = 0
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == 'equal':
            iguales += a1 - a0
        extra = (b1 - b0) - (a1 - a0) if op == 'replace' else (b1 - b0 if op == 'insert' else 0)
        if extra >= EXTRA_SEGUIDAS:
            return f'dijo {extra} palabras que no están en el guion: "{" ".join(oidas[b0:b1][:12])}"'
    cobertura = iguales / max(1, len(esperadas))
    if cobertura < MIN_COBERTURA:
        return f'se saltó parte del texto (solo {cobertura:.0%} coincide)'
    return ''


def leer_audio(ruta):
    crudo = subprocess.run(
        ['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', ruta, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(crudo, dtype=np.float32).copy()


def main():
    lista_ruta = sys.argv[1]
    lista = json.load(open(lista_ruta, encoding='utf-8'))
    from faster_whisper import WhisperModel
    modelo = WhisperModel('small', device='cpu', compute_type='int8')
    malos = []
    for i, p in enumerate(lista):
        # Sin initial_prompt: asi Whisper no "adivina" el guion y oye lo que de verdad se dijo
        segs, _ = modelo.transcribe(leer_audio(p['audio']), language='es', vad_filter=True)
        oido = ' '.join(s.text for s in segs)
        razon = revisar(p['texto'], oido)
        if razon:
            print(f'  Pedazo {i + 1}: MAL, {razon}')
            malos.append(i)
        else:
            print(f'  Pedazo {i + 1}: bien')
    json.dump(malos, open(lista_ruta.replace('lista.json', 'malos.json'), 'w'))


if __name__ == '__main__':
    main()
