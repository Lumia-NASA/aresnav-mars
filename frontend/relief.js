/* Vista de cima com volume: sombreado do relevo (hillshade) calculado do mesmo relevo real usado na rota,
   e a camada de radares de Marte (instrumentos reais, no solo e em órbita).
   Nada aqui pede dados novos à rede: o sombreado sai de App.heightAt(), em três níveis de detalhe. */
(function () {
'use strict';
const A = App, $ = A.$, tr = s => (window.T ? window.T(s) : s);
const on = id => { const el = $('#' + id); return !!el && el.checked; };
const walking = () => !!(A.globe && A.globe.walk && A.globe.walk.on);
const viewer = () => (A.globe && A.globe.viewer) || null;

/* ---------- caixas de seleção, junto das outras camadas de "Marte inteiro" ---------- */
const anchor = $('#ov-sites') ? $('#ov-sites').closest('label') : document.querySelector('#ov-poi').closest('label');
const box = document.createElement('div');
box.innerHTML = `
  <label class="layer"><input type="checkbox" id="ov-shade" checked><b>Sombras do relevo</b><small>Luz rasante de noroeste sobre o relevo real (MOLA + HRSC)</small></label>
  <label class="layer"><input type="checkbox" id="ov-radar" checked><b>Radares</b><small>1 no solo e 4 detecções de radares em órbita (posições aprox.)</small></label>`;
anchor.before(...box.children);
['ov-shade', 'ov-radar'].forEach(id => $('#' + id).addEventListener('change', () => draw()));

/* ---------- radares reais de Marte ---------- */
/* [sigla, missão, o que mediu, lat, lon, tipo, raio da área em km] — órbita: centro aproximado da região estudada */
const RADARS = [
  { n: 'RIMFAX', src: 'Perseverance · no solo', why: 'Radar de penetração no solo do rover: enxerga camadas até cerca de 10 m abaixo do chão ao longo do trajeto em Jezero.', lat: 18.4446, lon: 77.4509, kind: 'ground' },
  { n: 'MARSIS · Ultimi Scopuli', src: 'Mars Express · órbita', why: 'Reflexo forte sob 1,5 km de gelo perto do polo sul (2018), interpretado como possível água líquida salgada. Posição aproximada.', lat: -81, lon: -167, kind: 'orbit', km: 100 },
  { n: 'SHARAD · Utopia Planitia', src: 'MRO · órbita', why: 'Depósito de gelo enterrado do tamanho de um grande lago, a poucos metros da superfície (2016). Posição aproximada.', lat: 45, lon: 85, kind: 'orbit', km: 300 },
  { n: 'SHARAD · Arcadia Planitia', src: 'MRO · órbita', why: 'Camada extensa de gelo raso sob a planície (2015), candidata a fonte de água para tripulações. Posição aproximada.', lat: 45, lon: -160, kind: 'orbit', km: 300 },
  { n: 'SHARAD · Planum Boreum', src: 'MRO · órbita', why: 'O radar atravessa a calota polar norte e revela as camadas de gelo e poeira que guardam o clima antigo.', lat: 87, lon: 0, kind: 'orbit', km: 250 }
];
const RADAR_COL = '#8EC3CB';
A.RADARS = RADARS;
/* o RIMFAX viaja com o rover: usa o último ponto conhecido do trajeto */
function placeRimfax() {
  const runs = A.roverRuns, last = runs && runs.length && runs[runs.length - 1].ll;
  const p = last && last[last.length - 1];
  if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) { RADARS[0].lat = p[0]; RADARS[0].lon = p[1]; }
}

/* ---------- sombreado do relevo ---------- */
/* Cada nível cobre uma área com mais detalhe; z é o exagero só da sombra (o relevo global é suave demais sem ele). */
function tiers() {
  const B = A.BOX, G = A.GRID, k = Math.max(1, Math.min(4, Math.floor(1024 / Math.max(G.W, G.H))));
  return [
    { id: 'global', west: -180, south: -90, east: 180, north: 90, w: 720, h: 360, z: 9, blur: 5 },
    { id: 'region', west: 75.9, south: 16.9, east: 78.9, north: 19.9, w: 640, h: 640, z: 3.2, blur: 6 },
    { id: 'jezero', west: B.XMIN, south: B.YMIN, east: B.XMAX, north: B.YMAX, w: G.W * k, h: G.H * k, z: 1.8, blur: 7 }
  ];
}
function hillshade(t) {
  const { w, h } = t, hgt = new Float32Array(w * h), R = A.R_MARS, rad = Math.PI / 180;
  const dLon = (t.east - t.west) / w, dLat = (t.north - t.south) / h;
  for (let j = 0; j < h; j++) { const lat = t.north - (j + 0.5) * dLat; for (let i = 0; i < w; i++) hgt[j * w + i] = A.heightAt(lat, t.west + (i + 0.5) * dLon); }
  // média local (borrão em caixa, dois passes) para a "profundidade": vales e crateras ficam mais escuros que o entorno
  const blur = new Float32Array(w * h), tmp = new Float32Array(w * h), r = t.blur;
  for (let j = 0; j < h; j++) { let s = 0, n = 0; for (let i = -r; i < w; i++) { if (i + r < w) { s += hgt[j * w + i + r]; n++; } if (i - r - 1 >= 0) { s -= hgt[j * w + i - r - 1]; n--; } if (i >= 0) tmp[j * w + i] = s / n; } }
  for (let i = 0; i < w; i++) { let s = 0, n = 0; for (let j = -r; j < h; j++) { if (j + r < h) { s += tmp[(j + r) * w + i]; n++; } if (j - r - 1 >= 0) { s -= tmp[(j - r - 1) * w + i]; n--; } if (j >= 0) blur[j * w + i] = s / n; } }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const az = 315 * rad, alt = 42 * rad, lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  const my = R * dLat * rad;
  for (let j = 0; j < h; j++) {
    const lat = t.north - (j + 0.5) * dLat, mx = Math.max(1, R * Math.cos(lat * rad) * dLon * rad);
    const j0 = Math.max(0, j - 1), j1 = Math.min(h - 1, j + 1);
    for (let i = 0; i < w; i++) {
      const i0 = t.id === 'global' ? (i - 1 + w) % w : Math.max(0, i - 1), i1 = t.id === 'global' ? (i + 1) % w : Math.min(w - 1, i + 1);
      const gx = (hgt[j * w + i1] - hgt[j * w + i0]) / ((i1 - i0 || 2) * mx) * t.z;      // inclinação para leste
      const gy = (hgt[j0 * w + i] - hgt[j1 * w + i]) / ((j1 - j0 || 1) * my) * t.z;      // inclinação para norte
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const s = Math.max(0, (-gx * lx - gy * ly + lz) * inv);                             // normal · luz
      const depth = Math.max(0, Math.min(1, (blur[j * w + i] - hgt[j * w + i]) * t.z / (my * 2.2)));   // quão abaixo do entorno
      const k = (j * w + i) * 4;
      if (s < lz) { const a = (lz - s) / lz * 0.85 + depth * 0.16; d[k] = 12; d[k + 1] = 6; d[k + 2] = 4; d[k + 3] = Math.min(215, a * 255); }
      else { const a = (s - lz) / (1 - lz) * 0.5 - depth * 0.16; if (a > 0) { d[k] = 255; d[k + 1] = 238; d[k + 2] = 214; d[k + 3] = Math.min(120, a * 255); } else { d[k] = 12; d[k + 1] = 6; d[k + 2] = 4; d[k + 3] = Math.min(90, -a * 255); } }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}
/* um nível por vez, cedendo a vez ao navegador entre eles (o global tem ~1 milhão de pontos) */
const shade = {};        // id -> { t, url }
let building = false;
function buildShade() {
  if (building || !A.state.ready) return;
  building = true;
  const list = tiers(); let i = 0;
  const next = () => {
    if (i >= list.length) { building = false; return; }
    const t = list[i++];
    try { shade[t.id] = { t, url: hillshade(t) }; draw(); } catch (e) { console.warn('Sombreado do relevo indisponível:', t.id, e); }
    setTimeout(next, 30);
  };
  setTimeout(next, 400);
}

/* ---------- desenho ---------- */
const lf = { shade: {}, radar: null }, ge = { shade: {}, radar: [] };
const fmt = r => `${r.n} · ${tr(r.src)}`;
function draw() {
  const map = A.map, v = viewer(), showShade = on('ov-shade'), showRadar = on('ov-radar');
  if (map && window.L) {
    Object.keys(shade).forEach(id => {
      const s = shade[id];
      if (!lf.shade[id]) lf.shade[id] = L.imageOverlay(s.url, [[s.t.south, s.t.west], [s.t.north, s.t.east]], { opacity: 0.85, interactive: false, className: 'relief-shade' });
      showShade ? lf.shade[id].addTo(map) : map.removeLayer(lf.shade[id]);
    });
    if (!lf.radar) {
      lf.radar = L.layerGroup();
      RADARS.forEach(r => {
        if (r.km) L.circle([r.lat, r.lon], { radius: r.km * 1000, color: RADAR_COL, weight: 1, dashArray: '4 5', fillOpacity: 0.07, interactive: false }).addTo(lf.radar);
        L.circleMarker([r.lat, r.lon], { radius: 6, color: '#12120F', weight: 1.5, fillColor: RADAR_COL, fillOpacity: 1 }).bindTooltip(fmt(r), { className: 'tag' }).addTo(lf.radar);
      });
    }
    showRadar ? lf.radar.addTo(map) : map.removeLayer(lf.radar);
  }
  if (v && window.Cesium) {
    const C = Cesium;
    Object.keys(shade).forEach(id => {
      const s = shade[id]; let lyr = ge.shade[id];
      if (lyr && !v.imageryLayers.contains(lyr)) lyr = ge.shade[id] = null;      // o globo refaz as camadas quando o enlace muda
      if (!lyr) lyr = ge.shade[id] = v.imageryLayers.addImageryProvider(new C.SingleTileImageryProvider({ url: s.url, rectangle: C.Rectangle.fromDegrees(s.t.west, s.t.south, s.t.east, s.t.north), tileWidth: s.t.w, tileHeight: s.t.h }));
      lyr.show = showShade && !walking();        // no chão o filtro do capacete já dá o volume
    });
    if (!ge.radar.length) {
      const col = C.Color.fromCssColorString(RADAR_COL);
      RADARS.forEach(r => {
        if (r.km) ge.radar.push(v.entities.add({ position: C.Cartesian3.fromDegrees(r.lon, r.lat),
          ellipse: { semiMajorAxis: r.km * 1000, semiMinorAxis: r.km * 1000, material: col.withAlpha(0.1), outline: false } }));
        ge.radar.push(v.entities.add({ position: C.Cartesian3.fromDegrees(r.lon, r.lat),
          point: { pixelSize: 9, color: col, outlineColor: C.Color.fromCssColorString('#12120F'), outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 4e5 },
          label: { text: r.n, font: '12px Roboto, sans-serif', fillColor: col, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(10, 0), horizontalOrigin: C.HorizontalOrigin.LEFT,
            heightReference: C.HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: new C.DistanceDisplayCondition(r.kind === 'ground' ? 3000 : 0, 2.5e7), disableDepthTestDistance: 4e5 } }));
      });
    }
    ge.radar.forEach(e => { e.show = showRadar && !walking(); });
  }
}

A.on('layers', draw);
A.on('view', () => setTimeout(draw, 60));
A.on('ready', () => { placeRimfax(); buildShade(); draw(); });
if (A.state.ready) { placeRimfax(); buildShade(); }
})();
