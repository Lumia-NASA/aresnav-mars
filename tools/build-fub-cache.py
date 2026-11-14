"""Baixa as camadas vetoriais do WebGIS de Jezero da Freie Universität Berlin e converte para GeoJSON em graus.

Fonte: https://maps.planet.fu-berlin.de/jezero (MapServer WFS). O servidor só entrega em EPSG:49911
(Mars 2000, cilíndrica equidistante, esfera R = 3 396 190 m, lon_0 = 0), então x/R e y/R viram longitude e latitude.
Créditos exigidos: HRSC: ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO); CTX: NASA/JPL-Caltech/MSSS; HiRISE: NASA/JPL/Univ. of Arizona.

Rodar da raiz do repositório:  python tools/build-fub-cache.py
Grava em backend/data/fub/<camada>.geojson. Faz um pedido por camada, com pausa, para não pesar no servidor da universidade.
"""
import json, math, os, time, urllib.parse, urllib.request

BASE = 'https://maps.planet.fu-berlin.de/jez-bin/wms'
R = 3396190.0
LAYERS = ['lake', 'channel-lines', 'landingellipse', 'poi', 'panoramas']
OUT = os.path.join(os.path.dirname(__file__), '..', 'backend', 'data', 'fub')


def deg(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0] / R * 180 / math.pi, 6), round(c[1] / R * 180 / math.pi, 6)]
    return [deg(x) for x in c]


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in LAYERS:
        q = urllib.parse.urlencode({'SERVICE': 'WFS', 'VERSION': '1.1.0', 'REQUEST': 'GetFeature', 'TYPENAME': name, 'OUTPUTFORMAT': 'application/json'})
        req = urllib.request.Request(f'{BASE}?{q}', headers={'User-Agent': 'AresNav-Hackathon/1.0 (NASA Space Apps 2026)'})
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.load(r)
        feats = []
        for f in data['features']:
            g = f['geometry']
            props = {k: v for k, v in (f.get('properties') or {}).items() if v not in (None, '')}
            props = {k: (v.replace('�', '°') if isinstance(v, str) else v) for k, v in props.items()}  # o servidor manda o ° em Latin-1
            feats.append({'type': 'Feature', 'geometry': {'type': g['type'], 'coordinates': deg(g['coordinates'])}, 'properties': props})
        fc = {'type': 'FeatureCollection', 'name': name, 'source': 'Freie Universität Berlin, Planetary Sciences — Jezero WebGIS (maps.planet.fu-berlin.de/jezero)',
              'license_note': 'Base data: HRSC ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO); CTX NASA/JPL-Caltech/MSSS; HiRISE NASA/JPL/University of Arizona',
              'features': feats}
        with open(os.path.join(OUT, f'{name}.geojson'), 'w', encoding='utf-8') as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(',', ':'))
        print(name, len(feats))
        time.sleep(1.5)


if __name__ == '__main__':
    main()
