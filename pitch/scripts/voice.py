"""Gera a narração do vídeo com a voz neural gratuita do Microsoft Edge (pacote edge-tts).
Rodar da raiz do repositório:  python pitch/scripts/voice.py        (pip install edge-tts)

Lê pitch/src/voice-lines.json, grava um MP3 por frase em pitch/public/voice/ e imprime a duração de cada uma,
para conferir que cada fala termina antes da próxima começar. A voz é GERADA POR IA: o Space Apps exige dizer
isso (veja pitch/README.md).
"""
import asyncio
import json
import os
import subprocess
import sys

import edge_tts
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CFG = json.load(open(os.path.join(ROOT, "pitch/src/voice-lines.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "pitch/public/voice")
os.makedirs(OUT, exist_ok=True)


def duration(path):
    """Duração em segundos, lida pelo ffprobe do Remotion."""
    r = subprocess.run(
        ["npx", "--prefix", os.path.join(ROOT, "pitch"), "remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, shell=(os.name == "nt"), cwd=os.path.join(ROOT, "pitch"),
    )
    try:
        return float(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return float("nan")


def trim_silence(path):
    """Corta o silêncio do começo e do fim do MP3 (a voz do edge-tts vem com meio segundo de folga em cada ponta)."""
    tmp = path + ".trim.mp3"
    flt = ("silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,"
           "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.12,areverse")
    r = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", path, "-af", flt, "-ar", "44100", "-b:a", "128k", tmp])
    if r.returncode == 0 and os.path.getsize(tmp) > 1000:
        os.replace(tmp, path)


async def main():
    only = set(sys.argv[1:])
    for line in CFG["lines"]:
        if only and line["id"] not in only:
            continue
        path = os.path.join(OUT, line["id"] + ".mp3")
        await edge_tts.Communicate(line["text"], CFG["voice"], rate=line.get("rate", CFG.get("rate", "+0%")), volume="+0%").save(path)
        trim_silence(path)
        print(f'{line["id"]:<14} começa {line["start"]:>5.2f}s  {line["text"]}', flush=True)

    print("\nDuração de cada fala e folga até a próxima:")
    lines = CFG["lines"]
    for i, line in enumerate(lines):
        d = duration(os.path.join(OUT, line["id"] + ".mp3"))
        end = line["start"] + d
        nxt = lines[i + 1]["start"] if i + 1 < len(lines) else 29.0
        flag = "OK " if end <= nxt - 0.1 else "!! SOBREPÕE"
        print(f'  {flag} {line["id"]:<14} {line["start"]:>5.2f}s -> {end:>5.2f}s  (próxima em {nxt:.2f}s, folga {nxt - end:+.2f}s)')


asyncio.run(main())
