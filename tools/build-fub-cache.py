"""Baixa as camadas vetoriais do WebGIS de Jezero da Freie Universität Berlin e converte para GeoJSON em graus.

Fonte: https://maps.planet.fu-berlin.de/jezero (MapServer WFS). O servidor só entrega em EPSG:49911
(Mars 2000, cilíndrica equidistante, esfera R = 3 396 190 m, lon_0 = 0), então x/R e y/R viram longitude e latitude.
Créditos exigidos: HRSC: ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO); CTX: NASA/JPL-Caltech/MSSS; HiRISE: NASA/JPL/Univ. of Arizona.

Rodar da raiz do repositório:  python tools/build-fub-cache.py
Grava em backend/data/fub/<camada>.geojson. Faz um pedido por camada, com pausa, para não pesar no servidor da universidade.
"""
import json, math, os, re, time, urllib.parse, urllib.request

BASE = 'https://maps.planet.fu-berlin.de/jez-bin/wms'
R = 3396190.0
LAYERS = ['lake', 'channel-lines', 'landingellipse', 'poi', 'panoramas']
OUT = os.path.join(os.path.dirname(__file__), '..', 'backend', 'data', 'fub')


def deg(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0] / R * 180 / math.pi, 6), round(c[1] / R * 180 / math.pi, 6)]
    return [deg(x) for x in c]


def _dp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = math.hypot(pts[i][0] - x1, pts[i][1] - y1) if L < 1e-12 else abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return _dp(pts[:idx + 1], eps)[:-1] + _dp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def simplify(coords, metres=5):
    """Douglas-Peucker de ~5 m: o relevo da rota tem 200 m, então nada visível muda e o arquivo cai ~80%.
    Anéis fechados são divididos em duas metades para não colapsarem."""
    eps = metres / R * 180 / math.pi
    if isinstance(coords[0][0], (int, float)):
        if len(coords) > 3 and coords[0] == coords[-1]:
            h = len(coords) // 2
            r = _dp(coords[:h + 1], eps)[:-1] + _dp(coords[h:], eps)
            return r if len(r) >= 4 else coords
        return _dp(coords, eps)
    return [simplify(c, metres) for c in coords]


def head_ok(url):
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'AresNav-Hackathon/1.0 (NASA Space Apps 2026)'})
        return urllib.request.urlopen(req, timeout=20).status == 200
    except Exception:
        return False


def tour_folders():
    """tour.xml do krpano: id da cena ('41' realce, '41N' cor natural) -> pasta e formato dos blocos do cubo.
    Escolhe o maior nível de detalhe com face de até 1280 px (o visor do app monta a face com blocos de 512 px)."""
    req = urllib.request.Request('https://maps.planet.fu-berlin.de/vtour/tour.xml', headers={'User-Agent': 'AresNav-Hackathon/1.0 (NASA Space Apps 2026)'})
    with urllib.request.urlopen(req, timeout=90) as r:
        xml = r.read().decode('utf-8', errors='replace')
    out = {}
    for block in xml.split('<scene ')[1:]:   # cena por cena: uma cena sem cubo não pode "roubar" o cubo da seguinte
        block = block.split('</scene>')[0]
        sid = re.search(r'id="([^"]+)"', block)
        m = re.search(r'<cube url="/vtour/panos/([^"/]+)\.tiles/([^"]+)" multires="([^"]+)"', block)
        sph = re.search(r'<sphere url="/vtour/panos/([^"/]+)\.tiles/[^"]+" multires="\d+,(\d+)x(\d+)', block)
        if sid and not m and sph:   # panorama esférico (equirretangular): nível 1, montado em cubo no navegador
            out[sid.group(1)] = {'folder': sph.group(1), 'sphere': True, 'lvl': 1, 'w': int(sph.group(2)), 'h': int(sph.group(3))}
            continue
        if not sid or not m:
            continue
        tile, *sizes = [int(x) for x in m.group(3).split(',')]   # krpano: multires="tamanho_do_bloco,nível1,nível2,..."
        lvl = max([i + 1 for i, v in enumerate(sizes) if v <= 1280] or [1])
        out[sid.group(1)] = {'folder': m.group(1), 'mono': not m.group(2).startswith('%t/'), 'lvl': lvl, 'size': sizes[lvl - 1], 'tile': tile}
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    folders = tour_folders()
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
            if name == 'panoramas':   # pasta e formato dos blocos para o visor 360° do próprio app
                pid = str(props.get('pano_id'))
                if pid in folders: props['cube'] = folders[pid]
                if pid + 'N' in folders: props['cube_natural'] = folders[pid + 'N']
                if 'cube' not in props and props.get('vtour'):   # cena fora do tour.xml: testa os dois formatos no nível de 512 px
                    folder = props['vtour'][6:] if props['vtour'].startswith('scene_') else props['vtour']
                    for mono, rel in ((False, '1/f/l1/01/l1_1/f_01_01.jpg'), (True, 'f/l1/1/l1_f_1_1.jpg')):
                        if head_ok(f'https://maps.planet.fu-berlin.de/vtour/panos/{folder}.tiles/{rel}'):
                            props['cube'] = {'folder': folder, 'mono': mono, 'lvl': 1, 'size': 512, 'tile': 512}
                            break
                        time.sleep(0.3)
            coords = deg(g['coordinates'])
            if name in ('lake', 'channel-lines'):
                coords = simplify(coords)
            feats.append({'type': 'Feature', 'geometry': {'type': g['type'], 'coordinates': coords}, 'properties': props})
        fc = {'type': 'FeatureCollection', 'name': name, 'source': 'Freie Universität Berlin, Planetary Sciences — Jezero WebGIS (maps.planet.fu-berlin.de/jezero)',
              'license_note': 'Base data: HRSC ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO); CTX NASA/JPL-Caltech/MSSS; HiRISE NASA/JPL/University of Arizona',
              'features': feats}
        with open(os.path.join(OUT, f'{name}.geojson'), 'w', encoding='utf-8') as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(',', ':'))
        print(name, len(feats))
        time.sleep(1.5)


if __name__ == '__main__':
    main()
