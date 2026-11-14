/* Relevo HiRISE de 1 m de Jezero (USGS Astrogeology, mosaico do pouso do Perseverance), em blocos de 256 x 256 m
   servidos pelo backend (/api/v1/dem/hirise/:tx/:ty). Funções puras + um depósito de blocos, usadas pelo app
   (altitude no capacete e análise do corredor da rota) e testadas em tests/hirise-test.js.
   Projeção do arquivo: equiretangular na esfera de Marte (R = 3.396.190 m), 1 m por pixel.
   Bloco: Int16, decímetros acima de -2500 m (altura = v/10 - 2500); -32768 = sem dado. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.HiRise = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const G = Object.freeze({ x0: 4577366, y0: 1106618, width: 21400, height: 21488, R: 3396190, T: 256, NODATA: -32768 });
  const RAD = Math.PI / 180;
  const BOX = Object.freeze({ lon0: G.x0 / G.R / RAD, lat1: G.y0 / G.R / RAD, lon1: (G.x0 + G.width) / G.R / RAD, lat0: (G.y0 - G.height) / G.R / RAD });

  /* pixel (coluna, linha) contínuo de um ponto: centro do pixel (0,0) em (0.5, 0.5) */
  const pixelOf = (lat, lon) => ({ px: lon * RAD * G.R - G.x0, py: G.y0 - lat * RAD * G.R });
  const inside = (lat, lon) => { const p = pixelOf(lat, lon); return p.px >= 0 && p.py >= 0 && p.px < G.width && p.py < G.height; };
  const key = (tx, ty) => tx + '_' + ty;
  const tileOf = (lat, lon) => { const p = pixelOf(lat, lon); return { tx: Math.floor(p.px / G.T), ty: Math.floor(p.py / G.T) }; };
  const decode = v => (v === G.NODATA ? NaN : v / 10 - 2500);

  /* Blocos que cobrem uma linha (pontos [lat, lon]) com uma margem em metros dos dois lados */
  function tilesAlong(pts, marginM) {
    const out = new Map(), m = marginM || 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pixelOf(pts[k][0], pts[k][1]), b = k + 1 < pts.length ? pixelOf(pts[k + 1][0], pts[k + 1][1]) : a;
      const n = Math.max(1, Math.ceil(Math.hypot(b.px - a.px, b.py - a.py) / (G.T / 4)));
      for (let i = 0; i <= n; i++) {
        const x = a.px + (b.px - a.px) * i / n, y = a.py + (b.py - a.py) * i / n;
        for (let dx = -m; dx <= m; dx += Math.max(1, m)) for (let dy = -m; dy <= m; dy += Math.max(1, m)) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= G.width || Y >= G.height) continue;
          const tx = Math.floor(X / G.T), ty = Math.floor(Y / G.T); out.set(key(tx, ty), { tx, ty });
        }
      }
    }
    return [...out.values()];
  }

  /* Depósito de blocos: altura com interpolação bilinear; NaN fora dos blocos carregados ou sem dado */
  function Store() {
    const tiles = new Map();
    const raw = (x, y) => {   // x, y em pixels inteiros
      const t = tiles.get(key(Math.floor(x / G.T), Math.floor(y / G.T)));
      return t ? decode(t[(y % G.T) * G.T + (x % G.T)]) : NaN;
    };
    function heightPx(px, py) {
      const fx = px - 0.5, fy = py - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= G.width || y0 + 1 >= G.height) return NaN;
      const a = raw(x0, y0), b = raw(x0 + 1, y0), c = raw(x0, y0 + 1), d = raw(x0 + 1, y0 + 1);
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
    const height = (lat, lon) => { const p = pixelOf(lat, lon); return heightPx(p.px, p.py); };
    /* peso de 0 a 1 para misturar com o relevo de 200 m: cai a zero perto da borda dos blocos carregados (sem degrau) */
    function weight(lat, lon, featherM) {
      const p = pixelOf(lat, lon), tx = Math.floor(p.px / G.T), ty = Math.floor(p.py / G.T);
      if (!tiles.has(key(tx, ty))) return 0;
      const f = featherM || 24, lx = p.px - tx * G.T, ly = p.py - ty * G.T;
      let d = Infinity;
      if (!tiles.has(key(tx - 1, ty))) d = Math.min(d, lx); if (!tiles.has(key(tx + 1, ty))) d = Math.min(d, G.T - lx);
      if (!tiles.has(key(tx, ty - 1))) d = Math.min(d, ly); if (!tiles.has(key(tx, ty + 1))) d = Math.min(d, G.T - ly);
      const w = Math.max(0, Math.min(1, d / f)); return w * w * (3 - 2 * w);
    }
    return { tiles, has: (tx, ty) => tiles.has(key(tx, ty)), put: (tx, ty, arr) => tiles.set(key(tx, ty), arr), height, heightPx, weight, get size() { return tiles.size; } };
  }

  /* Corredor da rota a cada 1 m: declive medido em uma base de `baseM` metros (5 m: a escala de um passo largo
     de astronauta, sem o ruído pixel a pixel do modelo). Devolve declive máximo, metros acima do limite,
     cobertura e os trechos íngremes (início, fim, declive máximo e ponto mais íngreme). */
  function corridor(pts, heightFn, opts) {
    const o = Object.assign({ stepM: 1, baseM: 5, limitDeg: 12 }, opts || {});
    const s = [];   // amostras { d, lat, lon, h }
    let dist = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [la, lo] = pts[k], [lb, lob] = pts[k + 1];
      const a = pixelOf(la, lo), b = pixelOf(lb, lob), len = Math.hypot(b.px - a.px, b.py - a.py), n = Math.max(1, Math.round(len / o.stepM));
      for (let i = k ? 1 : 0; i <= n; i++) {
        const f = i / n, lat = la + (lb - la) * f, lon = lo + (lob - lo) * f;
        s.push({ d: dist + len * f, lat, lon, h: heightFn(lat, lon) });
      }
      dist += len;
    }
    const half = Math.max(1, Math.round(o.baseM / o.stepM / 2));
    let maxS = 0, steepM = 0, have = 0, at = null, cur = null;
    const runs = [];
    for (let i = 0; i < s.length; i++) {
      const i0 = Math.max(0, i - half), i1 = Math.min(s.length - 1, i + half), dd = s[i1].d - s[i0].d, dh = s[i1].h - s[i0].h;
      const ok = dd > 0 && isFinite(dh);
      s[i].s = ok ? Math.atan(Math.abs(dh) / dd) / RAD : NaN;
      if (!ok) { cur = null; continue; }
      const step = i ? s[i].d - s[i - 1].d : 0; have += step;
      if (s[i].s > maxS) { maxS = s[i].s; at = s[i]; }
      if (s[i].s > o.limitDeg) {
        steepM += step;
        if (!cur) { cur = { from: s[i].d, to: s[i].d, max: s[i].s, at: s[i] }; runs.push(cur); }
        cur.to = s[i].d; if (s[i].s > cur.max) { cur.max = s[i].s; cur.at = s[i]; }
      } else cur = null;
    }
    const steepRuns = runs.filter(r => r.to - r.from >= 2).sort((a, b) => b.max - a.max)
      .map(r => ({ fromM: r.from, toM: r.to, lengthM: r.to - r.from, maxDeg: r.max, lat: r.at.lat, lon: r.at.lon }));
    return { lengthM: dist, coverage: dist ? Math.min(1, have / dist) : 0, maxDeg: maxS, maxAt: at && { lat: at.lat, lon: at.lon, d: at.d }, steepM, steepRuns, limitDeg: o.limitDeg, samples: s };
  }

  return { G, BOX, pixelOf, inside, tileOf, tilesAlong, key, decode, Store, corridor };
});
