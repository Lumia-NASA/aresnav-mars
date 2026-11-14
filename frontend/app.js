/* AresNav · Trilha Jezero — núcleo do app.
   Carrega os dados reais do NASA Mars Trek, calcula a rota a pé (A*), simula a caminhada
   e desenha o mapa 2D e o painel do plano. Os outros modos (globo 3D, capacete, telemetria)
   ficam em arquivos próprios e conversam com este pelo objeto global App. */
const App = (function () {
'use strict';
const $ = s => document.querySelector(s);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Barramento de eventos simples ---------- */
const listeners = {};
const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
const emit = (ev, data) => (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(ev, e); } });

/* ---------- Endereços oficiais (NASA Mars Trek) ---------- */
const TILE = (id, ext) => `https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
const AGS = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';
const LAYERS = {
  viking: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', max: 7 },
  relief: { id: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', ext: 'jpg', max: 8 },
  ctx: { id: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', ext: 'png', max: 13, box: [77.1605, 18.211, 77.6992, 18.7212] },
  hirise: { id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', ext: 'png', max: 17, box: [77.2229, 18.3068, 77.584, 18.6693] },
  mosaic: { id: 'NES_JEZ_MID_Visible_Mosaic_HiRISE_CTX_HRSC_GCS_MARS_07-10-2018', ext: 'png', max: 16, box: [76.7913, 17.5792, 77.7314, 18.6926] },
  themis: { id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', max: 9, box: [-180, -65, 180, 65] }
};
const tileUrl = k => TILE(LAYERS[k].id, LAYERS[k].ext);

/* Área com relevo detalhado (graus, longitude leste) e grade usada na rota */
const XMIN = 77.25, XMAX = 77.55, YMIN = 18.33, YMAX = 18.62, W = 150, H = 145;
const DX = (XMAX - XMIN) / W, DY = (YMAX - YMIN) / H;
const R_MARS = 3389500, LAT0 = (YMIN + YMAX) / 2;
const MX = DX * Math.PI / 180 * R_MARS * Math.cos(LAT0 * Math.PI / 180);
const MY = DY * Math.PI / 180 * R_MARS;
const GEO = `geometry=${XMIN},${YMIN},${XMAX},${YMAX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson`;
const URLS = {
  dem: `${AGS}/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage?bbox=${XMIN},${YMIN},${XMAX},${YMAX}&bboxSR=104905&imageSR=104905&size=${W},${H}&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`,
  traverse: `${AGS}/Perseverance_Traverse_Path/MapServer/0/query?where=1%3D1&outFields=sol,length&${GEO}`,
  crism: `${AGS}/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0/query?where=1%3D1&outFields=Type,Instrument&${GEO}`
};

/* ---------- Tabela de fontes ---------- */
const SOURCES = [
  ['viking', 'Mosaico global colorido', 'Viking Orbiter', 'VIS (232 m)', 'Mars Trek WMTS'],
  ['hirise', 'Imagem HiRISE 25 cm', 'Mars Reconnaissance Orbiter', 'HiRISE', 'Mars Trek WMTS'],
  ['ctx', 'Imagem CTX 6 m', 'Mars Reconnaissance Orbiter', 'CTX', 'Mars Trek WMTS'],
  ['mosaic', 'Mosaico de pouso', 'MRO + Mars Express', 'HiRISE, CTX, HRSC', 'Mars Trek WMTS'],
  ['relief', 'Relevo colorido', 'Mars Global Surveyor + Mars Express', 'MOLA, HRSC', 'Mars Trek WMTS'],
  ['gdem', 'Relevo global (globo 3D)', 'Mars Global Surveyor', 'MOLA', 'Mars Trek ImageServer'],
  ['dem', 'Altitude e declive (rota)', 'Mars Global Surveyor + Mars Express', 'MOLA, HRSC (200 m)', 'Mars Trek ImageServer'],
  ['themis', 'Infravermelho diurno', '2001 Mars Odyssey', 'THEMIS', 'Mars Trek WMTS'],
  ['crism', 'Minerais hidratados', 'Mars Reconnaissance Orbiter', 'CRISM', 'Mars Trek FeatureServer'],
  ['traverse', 'Trajeto do Perseverance', 'Mars 2020', 'Navegação do rover', 'Mars Trek FeatureServer'],
  ['navcam', 'Fotos do modo Capacete', 'Mars 2020', 'Navcam (imagens brutas)', 'mars.nasa.gov/rss/api']
];
const srcStatus = {};
const ST_LABEL = { ok: 'Ao vivo', fb: 'Cópia local', off: 'Desligada', wait: 'Aguardando' };
function setStatus(id, s) {
  if (srcStatus[id] === 'ok' && s !== 'ok') return;
  srcStatus[id] = s;
  $('#srcTable').innerHTML = SOURCES.map(([k, a, b, c, d]) => {
    const st = srcStatus[k] || 'wait';
    return `<tr><td>${a}</td><td>${b}</td><td>${c}</td><td class="mono">${d}</td><td class="${st === 'off' ? 'wait' : st}">${ST_LABEL[st]}</td></tr>`;
  }).join('');
}

/* ---------- Pontos de interesse (posições reais do Perseverance nos sóis indicados) ---------- */
const KIND = { base: '#e8ecf8', sci: '#4fd8c4', samp: '#ff8a4c', crism: '#6ea8ff' };
const POIS = [
  { n: 'Base Ares-1 (hipotética)', lat: 18.4405, lon: 77.4625, k: 'base', src: 'Ponto de partida', why: 'Habitat da tripulação em terreno plano, perto do local de pouso do Perseverance.' },
  { n: 'Local de pouso Octavia E. Butler', lat: 18.44463, lon: 77.45089, k: 'sci', sol: 14, src: 'Mars 2020 · sol 14', why: 'Onde o Perseverance começou a rodar. Referência histórica da missão.' },
  { n: 'Região da 1ª amostra (Rochette)', lat: 18.43074, lon: 77.44437, k: 'samp', sol: 199, src: 'Mars 2020 · sol 199', why: 'Rocha vulcânica do fundo da cratera. A primeira amostra guardada pelo rover saiu desta área.' },
  { n: 'Frente do delta', lat: 18.45194, lon: 77.40605, k: 'sci', sol: 415, src: 'Mars 2020 · sol 415', why: 'Camadas de sedimento deixadas pelo rio antigo. Contam a história do lago.' },
  { n: 'Wildcat Ridge (aprox.)', lat: 18.45889, lon: 77.40617, k: 'sci', sol: 501, src: 'Mars 2020 · sol 501', why: 'Rocha sedimentar onde o rover detectou moléculas orgânicas.' },
  { n: 'Depósito de amostras Three Forks', lat: 18.45133, lon: 77.40126, k: 'samp', sol: 606, src: 'Mars 2020 · sol 606', why: 'Tubos de amostras deixados no chão para uma missão futura recolher.' },
  { n: 'Topo do delta', lat: 18.49549, lon: 77.34688, k: 'sci', sol: 1000, src: 'Mars 2020 · sol 1000', why: 'Sedimentos da parte alta do delta, trazidos de fora da cratera pelo rio.' },
  { n: 'Rumo a Neretva Vallis', lat: 18.49521, lon: 77.30391, k: 'sci', sol: 1176, src: 'Mars 2020 · sol 1176', why: 'Antigo canal do rio. Nessa região o rover achou a rocha Cheyava Falls, com possíveis sinais de vida antiga.' },
  { n: 'Minerais hidratados (CRISM)', lat: 18.56, lon: 77.35, k: 'crism', src: 'CRISM', why: 'Detecção orbital de minerais que só se formam na presença de água.' }
];
const BASE = POIS[0];
const DEFAULT_GOAL = POIS.find(p => p.sol === 606);

/* ---------- Relevo ---------- */
let HGT = null, SL = null, GDEM = null, RDEM = null;
const GW = 1024, GH = 512;
const REG = { x0: 73.9, x1: 80.9, y0: 14.9, y1: 21.9, n: 560 }; // relevo regional em volta de Jezero (HRSC + MOLA, ~740 m)
const idx = (c, r) => r * W + c;
function cellOf(lat, lon) {
  const c = Math.floor((lon - XMIN) / DX), r = Math.floor((YMAX - lat) / DY);
  return (c < 0 || r < 0 || c >= W || r >= H) ? -1 : idx(c, r);
}
const cellLL = i => [YMAX - (Math.floor(i / W) + 0.5) * DY, XMIN + (i % W + 0.5) * DX];
function bilinear(arr, w, h, fx, fy) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
  const a = arr[y0 * w + x0], b = arr[y0 * w + x1], c = arr[y1 * w + x0], d = arr[y1 * w + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
/* Altitude em qualquer ponto de Marte: relevo detalhado em Jezero, MOLA global no resto */
function heightAt(lat, lon) {
  let g = 0;
  if (GDEM) g = bilinear(GDEM, GW, GH, ((lon + 180) / 360 * GW - 0.5 + GW) % GW, (90 - lat) / 180 * GH - 0.5);
  const ramp = (x0, x1, y0, y1, k) => { // 0 na borda da área, 1 no miolo
    const e = Math.min((lon - x0) / (x1 - x0), (x1 - lon) / (x1 - x0), (lat - y0) / (y1 - y0), (y1 - lat) / (y1 - y0)), w = Math.max(0, Math.min(1, e / k));
    return w * w * (3 - 2 * w);
  };
  if (RDEM && lon > REG.x0 && lon < REG.x1 && lat > REG.y0 && lat < REG.y1) {
    const r = bilinear(RDEM, REG.n, REG.n, (lon - REG.x0) / (REG.x1 - REG.x0) * REG.n - 0.5, (REG.y1 - lat) / (REG.y1 - REG.y0) * REG.n - 0.5);
    g += (r - g) * ramp(REG.x0, REG.x1, REG.y0, REG.y1, 0.2);
  }
  if (!HGT || lon < XMIN || lon > XMAX || lat < YMIN || lat > YMAX) return g;
  const j = bilinear(HGT, W, H, (lon - XMIN) / DX - 0.5, (YMAX - lat) / DY - 0.5);
  return g + (j - g) * ramp(XMIN, XMAX, YMIN, YMAX, 0.1);
}

async function loadDem() {
  let buf = null, live = true;
  try {
    const r = await fetch(URLS.dem); if (!r.ok) throw new Error(r.status);
    buf = await r.arrayBuffer(); if (buf.byteLength < W * H * 4) throw new Error('tamanho');
  } catch (e) {
    live = false;
    buf = await (await fetch('data/dem-jezero-200m.f32')).arrayBuffer();
  }
  HGT = new Float32Array(buf.slice(0, W * H * 4));
  for (let i = 0; i < HGT.length; i++) if (!(HGT[i] > -9000 && HGT[i] < 30000)) HGT[i] = HGT[i - 1] || -2600;
  SL = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const cl = Math.max(0, c - 1), cr = Math.min(W - 1, c + 1), ru = Math.max(0, r - 1), rd = Math.min(H - 1, r + 1);
    const gx = (HGT[idx(cr, r)] - HGT[idx(cl, r)]) / ((cr - cl) * MX), gy = (HGT[idx(c, rd)] - HGT[idx(c, ru)]) / ((rd - ru) * MY);
    SL[idx(c, r)] = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
  }
  setStatus('dem', live ? 'ok' : 'fb');
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), im = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const s = SL[i];
    im.data.set(s < 4 ? [0, 0, 0, 0] : s < 8 ? [232, 200, 74, 120] : s < 12 ? [239, 138, 60, 165] : [226, 70, 58, 190], i * 4);
  }
  g.putImageData(im, 0, 0);
  api.slopeURL = cv.toDataURL();
  L.imageOverlay(api.slopeURL, [[YMIN, XMIN], [YMAX, XMAX]], { opacity: 0.75 }).addTo(groups.slope);
  return live;
}
async function loadGlobalDem() {
  try {
    const buf = await (await fetch('data/mars-mola-global-1024x512.i16')).arrayBuffer();
    GDEM = new Int16Array(buf.slice(0, GW * GH * 2)); setStatus('gdem', 'fb');
  } catch (e) { console.warn('Relevo global indisponível', e); }
  try {
    const buf = await (await fetch('data/dem-jezero-region-560.i16')).arrayBuffer();
    RDEM = new Int16Array(buf.slice(0, REG.n * REG.n * 2));
  } catch (e) { console.warn('Relevo regional indisponível', e); }
}
async function loadGeo(key, fallback) {
  try {
    const r = await fetch(URLS[key]); if (!r.ok) throw new Error(r.status);
    const j = await r.json(); if (!j.features) throw new Error('sem dados');
    setStatus(key, 'ok'); return { data: j, live: true };
  } catch (e) {
    setStatus(key, 'fb');
    return { data: typeof fallback === 'string' ? await (await fetch(fallback)).json() : fallback, live: false };
  }
}

/* ---------- Mapa 2D (Leaflet), agora com Marte inteiro ---------- */
let map, T = {}, groups = {}, activeBase = [];
const marks = {};
function initMap() {
  map = L.map('map', { crs: L.CRS.EPSG4326, minZoom: 1, maxZoom: 18, zoomSnap: 0.5, maxBounds: [[-90, -200], [90, 200]], maxBoundsViscosity: 0.8, worldCopyJump: false })
    .setView([18.462, 77.42], 12.5);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Dados: NASA/JPL/Caltech/MSSS/ESA/ASU/USGS · <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a>');
  const tiles = (key, opts) => {
    const d = LAYERS[key];
    const lyr = L.tileLayer(tileUrl(key), Object.assign({ maxZoom: 18, maxNativeZoom: d.max, noWrap: true, bounds: d.box ? [[d.box[1], d.box[0]], [d.box[3], d.box[2]]] : [[-90, -180], [90, 180]] }, opts));
    lyr.on('tileload', () => setStatus(key, 'ok'));
    return lyr;
  };
  T = { viking: tiles('viking'), ctx: tiles('ctx'), hirise: tiles('hirise'), mosaic: tiles('mosaic'), relief: tiles('relief'), themis: tiles('themis', { opacity: 0.6 }) };
  map.createPane('routes').style.zIndex = 450;
  groups = { slope: L.layerGroup(), crism: L.layerGroup(), rover: L.layerGroup(), poi: L.layerGroup(), route: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map) };
  POIS.forEach(p => {
    if (p.k === 'base') return;
    L.circleMarker([p.lat, p.lon], { radius: 6, color: KIND[p.k], weight: 2, fillColor: '#0b1020', fillOpacity: 0.85 })
      .bindTooltip(`${p.n} · ${p.src}`, { className: 'tag', direction: 'top', offset: [0, -6] })
      .on('click', e => { L.DomEvent.stopPropagation(e); setGoalPoi(p); }).addTo(groups.poi);
  });
  L.rectangle([[YMIN, XMIN], [YMAX, XMAX]], { color: '#e8ecf8', weight: 1, opacity: 0.35, fill: false, dashArray: '4 6', interactive: false }).addTo(map);
  map.on('mousemove', e => readout(e.latlng.lat, e.latlng.lng));
  map.on('click', e => pick(e.latlng.lat, e.latlng.lng));
  $('#m-jezero').onclick = () => map.flyTo([18.462, 77.42], 12.5);
}
const BASES = { hirise: ['viking', 'ctx', 'hirise'], mosaic: ['viking', 'mosaic'], relief: ['relief'] };
function layerState() {
  return { base: document.querySelector('input[name="base"]:checked').value, slope: $('#ov-slope').checked, themis: $('#ov-themis').checked, crism: $('#ov-crism').checked, rover: $('#ov-rover').checked, poi: $('#ov-poi').checked };
}
function applyLayers() {
  const s = layerState();
  activeBase.forEach(l => map.removeLayer(l));
  activeBase = BASES[s.base].map(k => T[k]);
  activeBase.forEach(l => l.addTo(map));
  [...activeBase].reverse().forEach(l => l.bringToBack());
  [['slope', groups.slope], ['crism', groups.crism], ['rover', groups.rover], ['poi', groups.poi], ['themis', T.themis]].forEach(([k, l]) => s[k] ? l.addTo(map) : map.removeLayer(l));
  ['mosaic', 'relief', 'themis'].forEach(k => { if (srcStatus[k] !== 'ok') setStatus(k, (k === 'themis' ? s.themis : s.base === k) ? 'wait' : 'off'); });
  emit('layers', s);
}

/* ---------- Rotas (A* sobre a grade de relevo) ---------- */
const LIM = { safe: 12, short: 20, time: 16 };
function speedKmh(grade) { return 2.7 * Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-0.175); }
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const hIdx = new Int32Array(W * H * 8), hF = new Float64Array(W * H * 8);
const stepLen = (dc, dr) => Math.hypot(dc * MX, dr * MY);
const cellDist = (a, b) => stepLen(b % W - a % W, ((b / W) | 0) - ((a / W) | 0));
function route(si, gi, mode) {
  const lim = LIM[mode];
  if (si < 0 || gi < 0 || SL[gi] > lim) return null;
  const g = new Float64Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const gc = gi % W, gr = (gi / W) | 0, vmax = 3.3 / 3.6;
  const hf = (c, r) => { const d = stepLen(c - gc, r - gr); return mode === 'time' ? d / vmax : d; };
  let size = 0;
  const push = (id, f) => { let k = size++; while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hF[k] = hF[p]; hIdx[k] = hIdx[p]; k = p; } hF[k] = f; hIdx[k] = id; };
  const pop = () => { const top = hIdx[0]; size--; if (size > 0) { const f = hF[size], id = hIdx[size]; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= size) break; if (c + 1 < size && hF[c + 1] < hF[c]) c++; if (hF[c] >= f) break; hF[k] = hF[c]; hIdx[k] = hIdx[c]; k = c; } hF[k] = f; hIdx[k] = id; } return top; };
  g[si] = 0; push(si, hf(si % W, (si / W) | 0));
  while (size) {
    const i = pop(); if (closed[i]) continue; closed[i] = 1; if (i === gi) break;
    const c = i % W, r = (i / W) | 0;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const j = idx(nc, nr); if (closed[j] || SL[j] > lim) continue;
      const d = stepLen(dc, dr), s = Math.max(SL[i], SL[j]);
      const cost = mode === 'safe' ? d * (1 + (s / 4) ** 2) : mode === 'short' ? d * (1 + s / 30) : d / (speedKmh((HGT[j] - HGT[i]) / d) / 3.6);
      const ng = g[i] + cost; if (ng < g[j]) { g[j] = ng; came[j] = i; push(j, ng + hf(nc, nr)); }
    }
  }
  if (si !== gi && came[gi] < 0) return null;
  const path = [gi]; let c = gi; while (c !== si) { c = came[c]; path.push(c); }
  return path.reverse();
}
function analyse(path) {
  let dist = 0, climb = 0, desc = 0, maxS = 0, tOut = 0, tBack = 0, steep = 0;
  const prof = [{ d: 0, h: HGT[path[0]], s: SL[path[0]] }];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], d = cellDist(a, b), dh = HGT[b] - HGT[a];
    dist += d; if (dh > 0) climb += dh; else desc -= dh;
    const s = Math.max(SL[a], SL[b]); maxS = Math.max(maxS, s); if (s > 8) steep += d;
    tOut += d / (speedKmh(dh / d) / 3.6); tBack += d / (speedKmh(-dh / d) / 3.6);
    prof.push({ d: dist, h: HGT[b], s });
  }
  return { dist, climb, desc, maxS, tOut: tOut / 60, tBack: tBack / 60, steep, prof };
}
function metersBetween(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180, dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MARS * Math.asin(Math.sqrt(a));
}
function bearing(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180, y = Math.sin((lon2 - lon1) * toR) * Math.cos(lat2 * toR);
  const x = Math.cos(lat1 * toR) * Math.sin(lat2 * toR) - Math.sin(lat1 * toR) * Math.cos(lat2 * toR) * Math.cos((lon2 - lon1) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}
function stopsOn(path, goalPoi) {
  const pts = path.map(cellLL), cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + cellDist(path[k - 1], path[k]));
  const res = [];
  for (const p of POIS) {
    if (p.k === 'base') continue;
    let best = Infinity, bk = 0;
    pts.forEach((q, k) => { const d = metersBetween(q[0], q[1], p.lat, p.lon); if (d < best) { best = d; bk = k; } });
    if (best < 300 || p === goalPoi) res.push({ p, km: cum[bk] / 1000, k: p === goalPoi ? path.length - 1 : bk, isGoal: p === goalPoi });
  }
  return res.sort((a, b) => a.km - b.km);
}

/* ---------- Simulação da caminhada (ida, paradas, volta) ---------- */
const T0 = 9 * 60, EVA_MAX = 480;
function buildSim(path, stops, hasPoiGoal) {
  const S = []; let t = 0, dist = 0;
  const last = path.length - 1, pause = {};
  stops.forEach(s => { pause[s.k] = (pause[s.k] || 0) + (s.isGoal ? 40 : 15); });
  if (!hasPoiGoal) pause[last] = (pause[last] || 0) + 30;
  const add = (k, phase, v, label) => S.push({ t, k, phase, v, dist, label });
  add(0, 'Na base', 0);
  const names = {}; stops.forEach(s => { names[s.k] = s.p.n; });
  for (let k = 1; k <= last; k++) {
    const d = cellDist(path[k - 1], path[k]), v = speedKmh((HGT[path[k]] - HGT[path[k - 1]]) / d);
    t += d / (v / 3.6) / 60; dist += d; add(k, 'Ida', v);
    if (pause[k]) { t += pause[k]; add(k, k === last ? 'Trabalho no destino' : 'Parada científica', 0, names[k] || 'Destino'); }
  }
  for (let k = last - 1; k >= 0; k--) {
    const d = cellDist(path[k + 1], path[k]), v = speedKmh((HGT[path[k]] - HGT[path[k + 1]]) / d);
    t += d / (v / 3.6) / 60; dist += d; add(k, 'Volta', v);
  }
  return { S, total: t, tArrive: S.find(s => s.k === last).t };
}
const wob = (t, a, b) => Math.sin(t * a) * b + Math.sin(t * a * 2.7 + 1.3) * b * 0.5;
function simAt(t) {
  const sim = state.sim; if (!sim) return null;
  t = Math.max(0, Math.min(sim.total, t));
  const S = sim.S; let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m; }
  const a = S[lo], b = S[hi], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const pa = cellLL(state.path[a.k]), pb = cellLL(state.path[b.k]);
  const lat = pa[0] + (pb[0] - pa[0]) * f, lon = pa[1] + (pb[1] - pa[1]) * f;
  const moving = a.k !== b.k, speed = moving ? b.v : 0, cell = state.path[f < 0.5 ? a.k : b.k];
  const slope = SL[cell], h = HGT[state.path[a.k]] + (HGT[state.path[b.k]] - HGT[state.path[a.k]]) * f;
  const climbing = moving && HGT[state.path[b.k]] > HGT[state.path[a.k]];
  const hr = (moving ? 104 + slope * 4 + (climbing ? 8 : 0) : t === 0 ? 76 : 88) + wob(t, 0.9, 3);
  return {
    t, lat, lon, cell, k: f < 0.5 ? a.k : b.k, h, slope, speed, hr,
    phase: t >= sim.total ? 'De volta à base' : t <= 0 ? 'Na base' : b.phase, label: moving ? null : b.label,
    heading: moving ? bearing(pa[0], pa[1], pb[0], pb[1]) : null,
    dist: a.dist + (b.dist - a.dist) * f,
    o2: Math.max(0, 100 - t / EVA_MAX * 100), batt: Math.max(0, 100 - t / 600 * 100),
    co2: 2.1 + (hr - 76) * 0.035 + wob(t, 0.5, 0.1), suitTemp: 20.5 + (hr - 76) * 0.05 + wob(t, 0.3, 0.3),
    suitKpa: 29.6 + wob(t, 0.7, 0.08), baseDist: metersBetween(lat, lon, BASE.lat, BASE.lon)
  };
}

/* ---------- Estado ---------- */
const state = { mode: 'safe', goal: -1, goalLL: null, goalPoi: DEFAULT_GOAL, path: null, info: null, stops: [], plan: null, sim: null, simT: 0, now: null, playing: false, emerg: false, emPath: null, emInfo: null, msg: '', view: 'globe', ready: false, cam: null };

function recompute(keepTime) {
  if (!HGT) return;
  const si = cellOf(BASE.lat, BASE.lon);
  state.path = state.goal >= 0 ? route(si, state.goal, state.mode) : null;
  state.info = state.path ? analyse(state.path) : null;
  state.stops = state.path ? stopsOn(state.path, state.goalPoi) : [];
  state.sim = state.path ? buildSim(state.path, state.stops, !!state.goalPoi) : null;
  state.plan = null;
  if (state.info) {
    const I = state.info, total = state.sim.total, o2 = 100 - total / EVA_MAX * 100;
    state.plan = { total, work: total - I.tOut - I.tBack, o2, arrive: T0 + I.tOut, back: T0 + total };
  }
  if (!keepTime) state.simT = state.sim ? state.sim.tArrive * 0.45 : 0;
  if (state.sim) state.simT = Math.min(state.simT, state.sim.total);
  tick(true);
  renderPanel(); drawProfile();
  emit('route', state);
}
function tick(silent) {
  state.now = simAt(state.simT);
  state.emPath = state.emInfo = null;
  if (state.emerg && state.now) {
    state.emPath = route(state.now.cell, cellOf(BASE.lat, BASE.lon), 'time');
    state.emInfo = state.emPath ? analyse(state.emPath) : null;
  }
  drawRoute(); renderEmergency(); renderTransport();
  if (!silent) emit('tick', state);
}
function setGoalLL(lat, lon, poi) {
  state.goalPoi = poi && poi.k !== 'base' ? poi : null;
  state.goalLL = [lat, lon];
  state.goal = HGT ? cellOf(lat, lon) : -1;
  state.msg = '';
  if (state.goal < 0) state.msg = 'Esse ponto está fora da área com relevo detalhado (o retângulo pontilhado em Jezero). Escolha um local dentro dele.';
  else if (SL[state.goal] > LIM[state.mode]) state.msg = `Esse ponto tem declive de ${Math.round(SL[state.goal])}°, acima do limite de ${LIM[state.mode]}°. Escolha um local mais plano.`;
  recompute();
}
const setGoalPoi = p => setGoalLL(p.lat, p.lon, p);
function nearPoi(lat, lon, maxM) { let best = null, bd = maxM; for (const p of POIS) { const d = metersBetween(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } } return best; }
function pick(lat, lon) { const p = nearPoi(lat, lon, 250); p ? setGoalPoi(p) : setGoalLL(lat, lon, null); }
function readout(lat, lon) {
  const i = HGT ? cellOf(lat, lon) : -1, p = nearPoi(lat, lon, 250), pos = `${lat.toFixed(4)}° N  ${lon.toFixed(4)}° L`;
  $('#readout').textContent = i < 0
    ? `${pos} · altitude ${Math.round(heightAt(lat, lon)).toLocaleString('pt-BR')} m (MOLA global)`
    : `${pos} · altitude ${Math.round(HGT[i]).toLocaleString('pt-BR')} m · declive ${SL[i].toFixed(1).replace('.', ',')}°${p ? ' · ' + p.n : ''}`;
}

/* ---------- Desenho da rota no mapa 2D ---------- */
const flagIcon = c => L.divIcon({ className: '', iconSize: [18, 26], iconAnchor: [2, 26], html: `<svg width="18" height="26" viewBox="0 0 18 26"><path d="M2 26V2" stroke="#0b1020" stroke-width="3"/><path d="M2 26V2" stroke="#e8ecf8" stroke-width="1.5"/><path d="M3 2h13l-4 5 4 5H3z" fill="${c}" stroke="#0b1020" stroke-width="1.5"/></svg>` });
function drawRoute() {
  if (!map) return;
  groups.route.clearLayers(); groups.marks.clearLayers();
  const rc = cssv('--route'), cc = cssv('--crit');
  const line = (path, color, dash) => {
    const ll = path.map(cellLL);
    L.polyline(ll, { pane: 'routes', color: '#000', opacity: 0.55, weight: 8, lineJoin: 'round', interactive: false, smoothFactor: 0.5 }).addTo(groups.route);
    L.polyline(ll, { pane: 'routes', color, weight: 4, dashArray: dash, lineJoin: 'round', interactive: false, smoothFactor: 0.5 }).addTo(groups.route);
  };
  if (state.path) line(state.path, rc);
  if (state.emPath) line(state.emPath, cc, '10 8');
  L.marker([BASE.lat, BASE.lon], { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="basemark"></div>' }), interactive: false })
    .bindTooltip('BASE', { permanent: true, direction: 'right', className: 'tag', offset: [8, 0] }).addTo(groups.marks);
  if (state.goalLL) L.marker(state.goalLL, { icon: flagIcon(state.path ? rc : cc), interactive: false }).addTo(groups.marks);
  if (state.now) L.circleMarker([state.now.lat, state.now.lon], { pane: 'routes', radius: 7, color: '#0b1020', weight: 2, fillColor: state.emerg ? cc : '#fff', fillOpacity: 1, interactive: false })
    .bindTooltip('VOCÊ', { permanent: true, direction: 'right', className: 'tag', offset: [10, 0] }).addTo(groups.marks);
  if (state.cam) L.circleMarker([state.cam.lat, state.cam.lon], { pane: 'routes', radius: 6, color: '#0b1020', weight: 2, fillColor: cssv('--blue'), fillOpacity: 1, interactive: false })
    .bindTooltip('VISTA DO CAPACETE', { permanent: true, direction: 'left', className: 'tag', offset: [-10, 0] }).addTo(groups.marks);
}

/* ---------- Perfil de altitude ---------- */
function drawProfile() {
  const c = $('#profile'), w = Math.round(c.getBoundingClientRect().width), h = 140, d = Math.min(2, window.devicePixelRatio || 1);
  if (!w) return;
  c.width = w * d; c.height = h * d;
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const muted = cssv('--muted'), line = cssv('--line'); x.font = `11px ${cssv('--mono')}`;
  if (!state.info) { x.fillStyle = muted; x.fillText(HGT ? 'Sem rota possível até esse ponto.' : 'Carregando relevo…', 8, 24); return; }
  const pr = state.info.prof, L0 = 52, R0 = 10, T1 = 10, B0 = 22, tot = pr[pr.length - 1].d || 1;
  let mn = Infinity, mx = -Infinity; pr.forEach(p => { mn = Math.min(mn, p.h); mx = Math.max(mx, p.h); });
  mn = Math.floor(mn / 10) * 10 - 10; mx = Math.ceil(mx / 10) * 10 + 10;
  const X = v => L0 + (w - L0 - R0) * v / tot, Y = v => T1 + (h - T1 - B0) * (1 - (v - mn) / (mx - mn));
  x.strokeStyle = line; x.lineWidth = 1;
  [mn, (mn + mx) / 2, mx].forEach(v => { x.beginPath(); x.moveTo(L0, Y(v)); x.lineTo(w - R0, Y(v)); x.stroke(); x.fillStyle = muted; x.fillText(Math.round(v).toLocaleString('pt-BR'), 4, Y(v) + 4); });
  x.beginPath(); x.moveTo(X(0), Y(mn)); pr.forEach(p => x.lineTo(X(p.d), Y(p.h))); x.lineTo(X(tot), Y(mn)); x.closePath();
  x.fillStyle = 'rgba(79,216,196,.12)'; x.fill();
  const col = s => s > 8 ? cssv('--crit') : s > 4 ? cssv('--warn') : cssv('--route');
  x.lineWidth = 2.2;
  for (let k = 1; k < pr.length; k++) { x.strokeStyle = col(pr[k].s); x.beginPath(); x.moveTo(X(pr[k - 1].d), Y(pr[k - 1].h)); x.lineTo(X(pr[k].d), Y(pr[k].h)); x.stroke(); }
  x.fillStyle = muted; const kmT = tot / 1000, step = kmT > 8 ? 2 : kmT > 4 ? 1 : kmT > 2 ? 0.5 : 0.25;
  for (let k = 0; k <= kmT + 1e-6; k += step) { const px = X(k * 1000); x.fillText(k.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' km', Math.min(Math.max(px - 10, L0 - 10), w - R0 - 44), h - 6); }
}

/* ---------- Painel do plano e checklist ---------- */
const fmtKm = m => (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
const fmtMin = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${String(r).padStart(2, '0')}` : `${r} min`; };
const clock = m => { m = Math.round(m); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function renderChecklist() {
  const I = state.info, P = state.plan, live = Object.values(srcStatus).filter(s => s === 'ok').length;
  const items = [
    [state.ready ? (allLive ? 'ok' : 'warn') : 'wait', 'Dados da NASA', state.ready ? `${live} fontes ao vivo${allLive ? '' : ', parte em cópia local'}` : 'Carregando…'],
    [I ? 'ok' : state.ready ? 'crit' : 'wait', 'Rota traçada', I ? fmtKm(I.dist) + ' de ida' : state.ready ? 'Sem caminho possível' : 'Aguardando relevo'],
    [!I ? 'wait' : I.maxS <= LIM.safe ? 'ok' : 'crit', 'Declive dentro do limite', I ? `Máximo ${I.maxS.toFixed(1).replace('.', ',')}° de ${LIM.safe}°` : '—'],
    [!P ? 'wait' : P.o2 >= 30 ? 'ok' : P.o2 >= 15 ? 'warn' : 'crit', 'Reserva de oxigênio', P ? `${Math.max(0, Math.round(P.o2))}% na volta (mín. 30%)` : '—'],
    [!P ? 'wait' : P.back <= 14.5 * 60 ? 'ok' : 'warn', 'Volta antes do vento', P ? `Retorno ${clock(P.back)} · vento sobe 14:30` : '—'],
    [!P ? 'wait' : P.back <= 17 * 60 ? 'ok' : 'crit', 'Volta com luz do dia', P ? 'Pôr do sol 17:52' : '—'],
    ['info', 'Comunicação com a Terra', 'Atraso de 11 min. Ciente']
  ];
  $('#checklist').innerHTML = items.map(([s, a, b]) => `<li class="${s}"><i></i><div><b>${a}</b><small>${b}</small></div></li>`).join('');
  const crit = items.some(i => i[0] === 'crit'), warn = items.some(i => i[0] === 'warn'), wait = items.some(i => i[0] === 'wait');
  const g = $('#gonogo');
  g.className = 'gonogo ' + (wait ? 'wait' : crit ? 'crit' : warn ? 'warn' : 'ok');
  g.textContent = wait ? 'Aguardando dados' : crit ? 'NO-GO · não sair' : warn ? 'GO com ressalvas' : 'GO · liberado para sair';
}
let allLive = false;
function renderPanel() {
  renderChecklist();
  const st = $('#status'), stats = $('#stats'), tl = $('#timeline'), al = $('#alerts'), sp = $('#stops');
  const name = state.goalPoi ? state.goalPoi.n : 'Ponto escolhido no mapa';
  if (!state.info) {
    st.innerHTML = `<span class="pill" style="--c:var(--crit)">Sem rota</span><h3>${name}</h3><p>${state.msg || 'Nenhum caminho dentro do limite de declive. Tente outro ponto ou a opção "Mais curta".'}</p>`;
    stats.innerHTML = tl.innerHTML = al.innerHTML = sp.innerHTML = ''; return;
  }
  const I = state.info, P = state.plan, stops = state.stops, o2 = P.o2;
  const [pc, pt] = o2 >= 30 ? ['var(--ok)', 'Dentro da margem'] : o2 >= 15 ? ['var(--warn)', 'Margem apertada'] : ['var(--crit)', 'Não recomendado'];
  st.innerHTML = `<span class="pill" style="--c:${pc}">${pt}</span><h3>${name}</h3><p>${state.mode === 'safe' ? `Rota segura: evita declives acima de ${LIM.safe}° e prefere terreno plano.` : `Rota mais curta: aceita declives até ${LIM.short}°.`}</p>`;
  stats.innerHTML = [
    ['Distância (ida)', fmtKm(I.dist), ''], ['Tempo de ida', fmtMin(I.tOut), 'volta ' + fmtMin(I.tBack)],
    ['Duração total', fmtMin(P.total), `${stops.length} parada${stops.length === 1 ? '' : 's'}`], ['Oxigênio na volta', Math.max(0, Math.round(o2)) + '%', 'mín. 30%'],
    ['Subida acumulada', Math.round(I.climb) + ' m', 'descida ' + Math.round(I.desc) + ' m'], ['Declive máximo', I.maxS.toFixed(1).replace('.', ',') + '°', 'limite ' + LIM[state.mode] + '°']
  ].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}</b> <em>${c}</em></div>`).join('');
  tl.innerHTML = `<span class="mono">${clock(T0)}</span><span>Saída da base</span><span class="mono">${clock(P.arrive)}</span><span>Chegada ao destino</span><span class="mono">${clock(P.back - I.tBack)}</span><span>Início do retorno</span><span class="mono">${clock(P.back)}</span><span>De volta à base</span><span class="mono">17:52</span><span>Pôr do sol</span>`;
  const alerts = [];
  if (I.steep > 0) alerts.push(['var(--warn)', `${Math.round(I.steep)} m de trecho com declive acima de 8°. Use bastões e passos curtos.`]);
  if (P.back > 14.5 * 60) alerts.push(['var(--crit)', 'O retorno passa das 14:30, quando o vento sobe para 14 m/s com poeira. Antecipe a volta.']);
  if (P.back > 17 * 60) alerts.push(['var(--crit)', 'A volta termina perto do pôr do sol. Encurte a caminhada ou divida em dois dias.']);
  if (o2 < 30) alerts.push(['var(--crit)', `Reserva de oxigênio de ${Math.max(0, Math.round(o2))}% na chegada, abaixo dos 30% exigidos.`]);
  if (state.mode === 'short' && I.maxS > LIM.safe) alerts.push(['var(--crit)', `A rota curta passa por declive de ${Math.round(I.maxS)}°. A rota segura é recomendada.`]);
  alerts.push(['var(--route)', 'Relevo com resolução de 200 m: confirme os trechos marcados na imagem HiRISE antes de sair.']);
  state.alerts = alerts;
  al.innerHTML = alerts.map(([c, t]) => `<li class="alert" style="--c:${c}">${t}</li>`).join('');
  sp.innerHTML = stops.length ? stops.map(s => `<div class="stop"><span class="dot" style="--c:${KIND[s.p.k]}"></span><b>${s.p.n}${s.isGoal ? ' · destino' : ''}</b><span class="km">km ${s.km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span><small>${s.p.why} <span class="mono">${s.p.src}</span></small></div>`).join('') : '<p class="note">Nenhum alvo científico a menos de 300 m da rota.</p>';
}
function renderEmergency() {
  const em = $('#emcard');
  if (!state.emerg) { em.hidden = true; return; }
  em.hidden = false;
  em.innerHTML = state.emInfo
    ? `<h3>Retorno de emergência</h3><p>Da sua posição atual até a base pela rota mais rápida: <b class="mono">${fmtKm(state.emInfo.dist)}</b> em <b class="mono">${fmtMin(state.emInfo.tOut)}</b>. Declive máximo ${Math.round(state.emInfo.maxS)}°.</p>`
    : '<h3>Retorno de emergência</h3><p>Você já está na base ou não há rota rápida.</p>';
}

/* ---------- Linha do tempo da simulação ---------- */
let playTimer = null;
function renderTransport() {
  const sim = state.sim, n = state.now;
  $('#simSlider').disabled = !sim;
  if (sim && document.activeElement !== $('#simSlider')) $('#simSlider').value = Math.round(state.simT / sim.total * 1000);
  $('#simClock').textContent = clock(T0 + state.simT);
  $('#simPhase').textContent = n ? (n.label ? `${n.phase}: ${n.label}` : n.phase) : 'Sem rota';
  $('#simPlay').textContent = state.playing ? '❚❚' : '▶';
}
function setPlaying(p) {
  state.playing = p && !!state.sim;
  clearInterval(playTimer);
  if (state.playing) {
    if (state.simT >= state.sim.total - 0.01) state.simT = 0;
    playTimer = setInterval(() => {
      state.simT = Math.min(state.sim.total, state.simT + 0.6);
      if (state.simT >= state.sim.total) setPlaying(false);
      tick();
    }, 100);
  }
  renderTransport();
}

/* ---------- Modos de visualização ---------- */
function setView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
  if (v === 'map' && map) setTimeout(() => map.invalidateSize(), 0);
  emit('view', v);
}

/* ---------- Inicialização ---------- */
async function start() {
  SOURCES.forEach(([k]) => setStatus(k, 'wait'));
  initMap();
  $('#destList').innerHTML = POIS.map((p, k) => p.k === 'base' ? '' : `<li><button data-k="${k}"><span class="dot" style="--c:${KIND[p.k]}"></span><span>${p.n}</span><span class="tag">${p.src.replace('Mars 2020 · ', '')}</span></button></li>`).join('');
  $('#destList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setGoalPoi(POIS[+b.dataset.k]); });
  document.querySelectorAll('input[name="base"], .layer input[type="checkbox"]').forEach(i => i.addEventListener('change', applyLayers));
  const setMode = m => { state.mode = m; $('#m-safe').setAttribute('aria-pressed', m === 'safe'); $('#m-short').setAttribute('aria-pressed', m === 'short'); if (state.goalLL) setGoalLL(state.goalLL[0], state.goalLL[1], state.goalPoi); };
  $('#m-safe').onclick = () => setMode('safe');
  $('#m-short').onclick = () => setMode('short');
  $('#emerg').onclick = () => { state.emerg = !state.emerg; $('#emerg').setAttribute('aria-pressed', state.emerg); tick(); };
  $('#simPlay').onclick = () => setPlaying(!state.playing);
  $('#simSlider').addEventListener('input', e => { if (!state.sim) return; setPlaying(false); state.simT = e.target.value / 1000 * state.sim.total; tick(); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  window.addEventListener('resize', drawProfile);
  applyLayers(); renderPanel(); drawProfile(); renderTransport();
  setView('globe');

  const [demLive, , trav, crism] = await Promise.all([
    loadDem(), loadGlobalDem(),
    loadGeo('traverse', 'data/perseverance-traverse.geojson'),
    loadGeo('crism', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { Type: 'Hydrous Mineral Detection', Instrument: 'CRISM' }, geometry: { type: 'Point', coordinates: [77.35, 18.56] } }] })
  ]);
  api.traverse = trav.data; api.crism = crism.data;
  L.geoJSON(trav.data, { style: { color: cssv('--mars'), weight: 2.5, opacity: 0.95 }, onEachFeature: (f, l) => l.bindTooltip(`Perseverance · sol ${f.properties.sol}`, { className: 'tag', sticky: true }) }).addTo(groups.rover);
  L.geoJSON(crism.data, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 9, color: KIND.crism, weight: 2, fillColor: KIND.crism, fillOpacity: 0.35 }), onEachFeature: (f, l) => l.bindTooltip('CRISM · minerais hidratados', { className: 'tag' }) }).addTo(groups.crism);
  allLive = demLive && trav.live && crism.live;
  const chip = $('#dataChip');
  chip.textContent = allLive ? 'Dados NASA ao vivo · Mars Trek' : 'Parte dos dados em cópia local';
  chip.classList.toggle('warn', !allLive);
  state.ready = true;
  emit('ready', state);
  setGoalPoi(DEFAULT_GOAL);
}

const api = {
  $, cssv, on, emit, start, state, POIS, BASE, KIND, LIM, LAYERS, tileUrl, T0, EVA_MAX,
  BOX: { XMIN, XMAX, YMIN, YMAX }, R_MARS,
  setStatus, setView, drawRoute, setGoalPoi, setGoalLL, pick, readout, nearPoi, layerState,
  heightAt, cellLL, cellOf, metersBetween, bearing, simAt, fmtKm, fmtMin, clock,
  slopeAt: (lat, lon) => { const i = cellOf(lat, lon); return i < 0 || !SL ? 0 : SL[i]; },
  traverse: null, crism: null, slopeURL: null
};
return api;
})();
