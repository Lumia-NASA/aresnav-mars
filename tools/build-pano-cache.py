"""Gera frontend/data/pano/index.json: um panorama de 360° para cada parada do Perseverance.

Fontes (NASA, públicas):
- Paradas do rover (posição, direção, site/drive): mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
  (usa a cópia do backend em backend/data/cache/m20_waypoints.cached.json)
- Fotos: API de imagens brutas da Mars 2020 (mars.nasa.gov/rss/api), câmera Navcam esquerda.

Ao fim de cada deslocamento o rover tira 5 faixas de 96° x 26° na altura do horizonte.
O script casa cada conjunto de faixas com a parada do mesmo "site" e "drive" e guarda só
os metadados (as fotos continuam hospedadas na NASA).

Uso: python tools/build-pano-cache.py
(defina PANO_CACHE=pasta para guardar as respostas da API e retomar depois)
"""
import json, os, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
WAYPOINTS = os.path.join(ROOT, 'backend', 'data', 'cache', 'm20_waypoints.cached.json')
OUT = os.path.join(ROOT, 'frontend', 'data', 'pano', 'index.json')
API = ('https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json'
       '&num=100&page={page}&order=sol+desc&search=NAVCAM_LEFT&sol={sol}')
PREFIX = 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/'


def nums(s):
    return [float(x) for x in re.findall(r'-?\d+\.?\d*(?:[eE]-?\d+)?', s or '')]


CACHE = os.environ.get('PANO_CACHE')  # pasta opcional para guardar as respostas e poder retomar
UA = {'User-Agent': 'AresNav-SpaceApps/1.0 (panorama index builder)'}


def get(url):
    for attempt in range(5):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
        except Exception:  # noqa: BLE001
            time.sleep(4 * (attempt + 1))  # a API bloqueia rajadas: espera e tenta de novo
    return None


def fetch(sol):
    path = CACHE and os.path.join(CACHE, f'{sol}.json')
    if path and os.path.exists(path):
        return sol, json.load(open(path, encoding='utf-8'))
    images, ok = [], True
    for page in range(3):
        d = get(API.format(sol=sol, page=page))
        time.sleep(0.4)
        if d is None:
            ok = False
            break
        images += [{k: i.get(k) for k in ('extended', 'image_files', 'imageid', 'caption', 'site', 'drive')} for i in d.get('images', [])]
        if len(d.get('images', [])) < 100:
            break
    if path and ok:
        json.dump(images, open(path, 'w', encoding='utf-8'))
    return sol, images


def strip_groups(images):
    """{(site, drive): [faixas]} só com as faixas de horizonte."""
    groups = {}
    for i in images:
        e = i.get('extended', {})
        try:
            az, el = float(e['mastAz']), float(e['mastEl'])
        except (KeyError, ValueError):
            continue
        rect = nums(e.get('subframeRect'))
        if len(rect) != 4 or rect[2] < 5000 or not (1000 < rect[3] < 2000) or abs(el) > 8:
            continue
        url = i['image_files']['large']
        if not url.startswith(PREFIX):
            continue
        m = re.search(r'local mean solar time of ([\d:]+)', i.get('caption', ''))
        try:
            key = (int(i.get('site')), int(i.get('drive')))
        except (TypeError, ValueError):
            continue
        g = groups.setdefault(key, {})
        slot = round(az / 10)
        color = i['imageid'][2] == 'F'
        if slot not in g or (color and not g[slot]['c']):
            g[slot] = {'az': round(az, 1), 'el': round(el, 1), 'y': rect[1], 'h': rect[3], 'u': url[len(PREFIX):],
                       'c': color, 't': m.group(1)[:5] if m else None}
    return groups


def coverage(strips):
    covered = set()
    for r in strips:
        for a in range(int(r['az'] - 48), int(r['az'] + 48)):
            covered.add(a % 360)
    return len(covered)


wps = [f['properties'] for f in json.load(open(WAYPOINTS, encoding='utf-8'))['features']]
sols = sorted({w['sol'] for w in wps})
print(f'{len(wps)} paradas em {len(sols)} sóis; consultando a API...')
with ThreadPoolExecutor(3) as ex:
    by_sol = dict(ex.map(fetch, sols))

# Cada conjunto de faixas é ligado à parada do mesmo site/drive; se não houver parada exata,
# à parada do mesmo site com o número de drive mais próximo. Aceita panoramas parciais (>= 190°).
MIN_COVER = 190
best = {}  # índice da parada -> (cobertura, sol, faixas)
for sol in sols:
    for (site, drive), g in strip_groups(by_sol.get(sol, [])).items():
        cover = coverage(g.values())
        if cover < MIN_COVER:
            continue
        same = [i for i, w in enumerate(wps) if int(w['site']) == site]
        if not same:
            continue
        i = min(same, key=lambda j: (abs(int(wps[j]['drive']) - drive), abs(wps[j]['sol'] - sol)))
        if abs(int(wps[i]['drive']) - drive) > 60:
            continue
        if i not in best or cover > best[i][0]:
            best[i] = (cover, sol, sorted(g.values(), key=lambda r: r['az']))

out = []
for i in sorted(best):
    w, (cover, sol, strips) = wps[i], best[i]
    out.append({'sol': sol, 'lat': round(w['lat'], 6), 'lon': round(w['lon'], 6), 'yaw': round(w['yaw'], 2),
                'km': round(w['dist_total_m'] / 1000, 3), 't': strips[0]['t'], 'cov': cover,
                's': [[r['az'], r['el'], r['y'], r['h'], r['u'], 1 if r['c'] else 0] for r in strips]})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump({'prefix': PREFIX, 'panos': out}, f, separators=(',', ':'))
print(f'{len(out)} panoramas gravados ({sum(1 for o in out if o["cov"] >= 330)} de 360° completos) em {os.path.relpath(OUT, ROOT)} '
      f'(sóis {out[0]["sol"]} a {out[-1]["sol"]}, {os.path.getsize(OUT) // 1024} KB)')
