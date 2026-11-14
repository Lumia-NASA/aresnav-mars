/* Trilha Jezero — planejador de caminhada marciana com dados reais do NASA Mars Trek.
   Tudo roda no navegador: as imagens vêm em blocos (WMTS) do Mars Trek, o relevo vem do
   serviço ArcGIS do Mars Trek e o trajeto do Perseverance e o CRISM vêm como GeoJSON. */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Endereços oficiais (NASA Mars Trek) ---------- */
const TILE = (id, ext) => `https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
const AGS = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';
const LAYERS = {
  hirise: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
  ctx: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
  mosaic: 'NES_JEZ_MID_Visible_Mosaic_HiRISE_CTX_HRSC_GCS_MARS_07-10-2018',
  relief: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw',
  themis: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018'
};

/* Área analisada (graus, longitude leste) e grade do relevo */
const XMIN = 77.25, XMAX = 77.55, YMIN = 18.33, YMAX = 18.62, W = 150, H = 145;
const DX = (XMAX - XMIN) / W, DY = (YMAX - YMIN) / H;
const R_MARS = 3389500, LAT0 = (YMIN + YMAX) / 2;
const MX = DX * Math.PI / 180 * R_MARS * Math.cos(LAT0 * Math.PI / 180); // metros por célula (leste-oeste)
const MY = DY * Math.PI / 180 * R_MARS;                                   // metros por célula (norte-sul)
const GEO = `geometry=${XMIN},${YMIN},${XMAX},${YMAX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson`;
const URLS = {
  dem: `${AGS}/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage?bbox=${XMIN},${YMIN},${XMAX},${YMAX}&bboxSR=104905&imageSR=104905&size=${W},${H}&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`,
  traverse: `${AGS}/Perseverance_Traverse_Path/MapServer/0/query?where=1%3D1&outFields=sol,length&${GEO}`,
  crism: `${AGS}/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0/query?where=1%3D1&outFields=Type,Instrument&${GEO}`
};

/* ---------- Tabela de fontes ---------- */
const SOURCES = [
  ['hirise', 'Imagem HiRISE 25 cm', 'Mars Reconnaissance Orbiter', 'HiRISE', 'Mars Trek WMTS'],
  ['ctx', 'Imagem CTX 6 m', 'Mars Reconnaissance Orbiter', 'CTX', 'Mars Trek WMTS'],
  ['mosaic', 'Mosaico de pouso', 'MRO + Mars Express', 'HiRISE, CTX, HRSC', 'Mars Trek WMTS'],
  ['relief', 'Relevo colorido', 'Mars Global Surveyor + Mars Express', 'MOLA, HRSC', 'Mars Trek WMTS'],
  ['dem', 'Altitude e declive (rota)', 'Mars Global Surveyor + Mars Express', 'MOLA, HRSC (200 m)', 'Mars Trek ImageServer'],
  ['themis', 'Infravermelho diurno', '2001 Mars Odyssey', 'THEMIS', 'Mars Trek WMTS'],
  ['crism', 'Minerais hidratados', 'Mars Reconnaissance Orbiter', 'CRISM', 'Mars Trek FeatureServer'],
  ['traverse', 'Trajeto do Perseverance', 'Mars 2020', 'Navegação do rover', 'Mars Trek FeatureServer']
];
const srcStatus = {};
function setStatus(id, s) {
  if (srcStatus[id] === 'ok' && s !== 'ok') return;
  srcStatus[id] = s;
  $('#srcTable').innerHTML = SOURCES.map(([k, a, b, c, d]) => {
    const st = srcStatus[k] || 'wait';
    const label = st === 'ok' ? 'Ao vivo' : st === 'fb' ? 'Cópia local' : st === 'off' ? 'Desligada' : 'Aguardando';
    return `<tr><td>${a}</td><td>${b}</td><td>${c}</td><td class="mono">${d}</td><td class="${st === 'off' ? 'wait' : st}">${label}</td></tr>`;
  }).join('');
}
SOURCES.forEach(([k]) => setStatus(k, 'wait'));

/* ---------- Mapa ---------- */
const map = L.map('map', {
  crs: L.CRS.EPSG4326, minZoom: 10, maxZoom: 18, zoomSnap: 0.5,
  maxBounds: [[18.2, 77.15], [18.72, 77.65]], maxBoundsViscosity: 0.8
}).setView([18.462, 77.42], 12.5);
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('Dados: NASA/JPL/Caltech/MSSS/ESA/ASU · <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a>');
L.control.scale({ imperial: false, maxWidth: 140 }).addTo(map); // escala aproximada (Leaflet usa o raio da Terra)

function tiles(key, opts) {
  const lyr = L.tileLayer(TILE(LAYERS[key], key === 'relief' ? 'jpg' : 'png'), Object.assign({ maxZoom: 18 }, opts));
  lyr.on('tileload', () => setStatus(key, 'ok'));
  return lyr;
}
const T = {
  ctx: tiles('ctx', { maxNativeZoom: 13, bounds: [[18.211, 77.1605], [18.7212, 77.6992]] }),
  hirise: tiles('hirise', { maxNativeZoom: 17, bounds: [[18.3068, 77.2229], [18.6693, 77.584]] }),
  mosaic: tiles('mosaic', { maxNativeZoom: 16, bounds: [[17.5792, 76.7913], [18.6926, 77.7314]] }),
  relief: tiles('relief', { maxNativeZoom: 8 }),
  themis: tiles('themis', { maxNativeZoom: 9, opacity: 0.6, bounds: [[-65, -180], [65, 180]] })
};
const BASES = { hirise: [T.ctx, T.hirise], mosaic: [T.mosaic], relief: [T.relief] };
let activeBase = [];
function setBase(name) {
  activeBase.forEach(l => map.removeLayer(l));
  activeBase = BASES[name];
  activeBase.forEach(l => l.addTo(map).bringToBack());
  if (name !== 'hirise') ['hirise', 'ctx'].forEach(k => srcStatus[k] !== 'ok' && setStatus(k, 'off'));
}
document.querySelectorAll('input[name="base"]').forEach(r => r.addEventListener('change', () => setBase(r.value)));
setBase('hirise');

const routePane = map.createPane('routes'); routePane.style.zIndex = 450;
const groups = {
  slope: L.layerGroup(), crism: L.layerGroup(), rover: L.layerGroup(), poi: L.layerGroup(),
  route: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map)
};
function bindToggle(id, layer) {
  const box = $('#' + id);
  const apply = () => box.checked ? layer.addTo(map) : map.removeLayer(layer);
  box.addEventListener('change', apply); apply();
}

/* ---------- Pontos de interesse (posições reais do Perseverance nos sóis indicados) ---------- */
const KIND = { base: '#f0e5db', sci: '#5fd6ca', samp: '#e3905a', crism: '#7aa6ff' };
const POIS = [
  { n: 'Base Ares-1 (hipotética)', lat: 18.4405, lon: 77.4625, k: 'base', src: 'Ponto de partida', why: 'Habitat da tripulação em terreno plano, perto do local de pouso do Perseverance.' },
  { n: 'Local de pouso Octavia E. Butler', lat: 18.44463, lon: 77.45089, k: 'sci', src: 'Mars 2020 · sol 14', why: 'Onde o Perseverance começou a rodar. Referência histórica da missão.' },
  { n: 'Região da 1ª amostra (Rochette)', lat: 18.43074, lon: 77.44437, k: 'samp', src: 'Mars 2020 · sol 199', why: 'Rocha vulcânica do fundo da cratera. A primeira amostra guardada pelo rover saiu desta área.' },
  { n: 'Frente do delta', lat: 18.45194, lon: 77.40605, k: 'sci', src: 'Mars 2020 · sol 415', why: 'Camadas de sedimento deixadas pelo rio antigo. Contam a história do lago.' },
  { n: 'Wildcat Ridge (aprox.)', lat: 18.45889, lon: 77.40617, k: 'sci', src: 'Mars 2020 · sol 501', why: 'Rocha sedimentar onde o rover detectou moléculas orgânicas.' },
  { n: 'Depósito de amostras Three Forks', lat: 18.45133, lon: 77.40126, k: 'samp', src: 'Mars 2020 · sol 606', why: 'Tubos de amostras deixados no chão para uma missão futura recolher.' },
  { n: 'Topo do delta', lat: 18.49549, lon: 77.34688, k: 'sci', src: 'Mars 2020 · sol 1000', why: 'Sedimentos da parte alta do delta, trazidos de fora da cratera pelo rio.' },
  { n: 'Rumo a Neretva Vallis', lat: 18.49521, lon: 77.30391, k: 'sci', src: 'Mars 2020 · sol 1176', why: 'Antigo canal do rio. Nessa região o rover achou a rocha Cheyava Falls, com possíveis sinais de vida antiga.' },
  { n: 'Minerais hidratados (CRISM)', lat: 18.56, lon: 77.35, k: 'crism', src: 'CRISM', why: 'Detecção orbital de minerais que só se formam na presença de água.' }
];
POIS.forEach(p => {
  if (p.k === 'base') return;
  L.circleMarker([p.lat, p.lon], { radius: 6, color: KIND[p.k], weight: 2, fillColor: '#130f0d', fillOpacity: 0.85 })
    .bindTooltip(`${p.n} · ${p.src}`, { className: 'tag', direction: 'top', offset: [0, -6] })
    .on('click', e => { L.DomEvent.stopPropagation(e); setGoalPoi(p); })
    .addTo(groups.poi);
});
const BASE = POIS[0];

/* ---------- Relevo ---------- */
let HGT = null, SL = null;
const idx = (c, r) => r * W + c;
function cellOf(lat, lon) {
  const c = Math.floor((lon - XMIN) / DX), r = Math.floor((YMAX - lat) / DY);
  return (c < 0 || r < 0 || c >= W || r >= H) ? -1 : idx(c, r);
}
const cellLL = i => [YMAX - (Math.floor(i / W) + 0.5) * DY, XMIN + (i % W + 0.5) * DX];

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
  // camada de declive desenhada a partir do relevo real
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), im = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const s = SL[i], col = s < 4 ? [0, 0, 0, 0] : s < 8 ? [232, 200, 74, 120] : s < 12 ? [239, 138, 60, 165] : [226, 70, 58, 190];
    im.data.set(col, i * 4);
  }
  g.putImageData(im, 0, 0);
  L.imageOverlay(cv.toDataURL(), [[YMIN, XMIN], [YMAX, XMAX]], { opacity: 0.75 }).addTo(groups.slope);
  return live;
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
function solColor(sol, max) {
  const t = Math.min(1, sol / max), a = [240, 229, 219], b = [227, 144, 90];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`;
}

/* ---------- Rotas (A* sobre a grade de relevo) ---------- */
const LIM = { safe: 12, short: 20, time: 16 };
function speedKmh(grade) { return 2.7 * Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-0.175); }
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const hIdx = new Int32Array(W * H * 8), hF = new Float64Array(W * H * 8);
function stepLen(dc, dr) { return Math.hypot(dc * MX, dr * MY); }
function route(si, gi, mode) {
  const lim = LIM[mode];
  if (SL[gi] > lim) return null;
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
      let cost;
      if (mode === 'safe') cost = d * (1 + (s / 4) ** 2);
      else if (mode === 'short') cost = d * (1 + s / 30);
      else cost = d / (speedKmh((HGT[j] - HGT[i]) / d) / 3.6);
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
    const a = path[k - 1], b = path[k];
    const d = stepLen(b % W - a % W, ((b / W) | 0) - ((a / W) | 0)), dh = HGT[b] - HGT[a];
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
function stopsOn(path, goalPoi) {
  const pts = path.map(cellLL), cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + metersBetween(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
  const res = [];
  for (const p of POIS) {
    if (p.k === 'base') continue;
    let best = Infinity, bk = 0;
    pts.forEach((q, k) => { const d = metersBetween(q[0], q[1], p.lat, p.lon); if (d < best) { best = d; bk = k; } });
    if (best < 300 || p === goalPoi) res.push({ p, km: cum[bk] / 1000, isGoal: p === goalPoi });
  }
  return res.sort((a, b) => a.km - b.km);
}

/* ---------- Estado ---------- */
const DEFAULT_GOAL = POIS.find(p => p.n.startsWith('Depósito'));
const state = { mode: 'safe', goal: null, goalLL: null, goalPoi: DEFAULT_GOAL, path: null, info: null, emerg: false, emPath: null, emInfo: null, astro: null, msg: '' };

function recompute() {
  if (!HGT) return;
  const si = cellOf(BASE.lat, BASE.lon);
  state.path = state.goal >= 0 ? route(si, state.goal, state.mode) : null;
  state.info = state.path ? analyse(state.path) : null;
  state.emPath = state.emInfo = state.astro = null;
  if (state.emerg && state.path) {
    state.astro = state.path[Math.floor(state.path.length * 0.62)];
    state.emPath = route(state.astro, si, 'time');
    state.emInfo = state.emPath ? analyse(state.emPath) : null;
  }
  drawRoute(); renderPanel(); drawProfile();
}
function setGoalLL(lat, lon, poi) {
  state.goalPoi = poi && poi.k !== 'base' ? poi : null;
  state.goalLL = [lat, lon];
  state.goal = cellOf(lat, lon);
  state.msg = '';
  if (state.goal < 0) state.msg = 'Esse ponto está fora da área com dados de relevo. Escolha um local dentro do retângulo analisado.';
  else if (SL[state.goal] > LIM[state.mode]) state.msg = `Esse ponto tem declive de ${Math.round(SL[state.goal])}°, acima do limite de ${LIM[state.mode]}°. Escolha um local mais plano.`;
  recompute();
}
const setGoalPoi = p => setGoalLL(p.lat, p.lon, p);

/* ---------- Desenho da rota ---------- */
const flagIcon = c => L.divIcon({ className: '', iconSize: [18, 26], iconAnchor: [2, 26], html: `<svg width="18" height="26" viewBox="0 0 18 26"><path d="M2 26V2" stroke="#130f0d" stroke-width="3"/><path d="M2 26V2" stroke="#f0e5db" stroke-width="1.5"/><path d="M3 2h13l-4 5 4 5H3z" fill="${c}" stroke="#130f0d" stroke-width="1.5"/></svg>` });
const baseIcon = L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div style="width:16px;height:16px;background:#f0e5db;border:2px solid #130f0d"></div>' });
function drawRoute() {
  groups.route.clearLayers(); groups.marks.clearLayers();
  const rc = cssv('--route'), cc = cssv('--crit');
  const line = (path, color, dash) => {
    const ll = path.map(cellLL);
    L.polyline(ll, { pane: 'routes', color: '#000', opacity: 0.55, weight: 8, lineJoin: 'round', interactive: false, smoothFactor: 0.5 }).addTo(groups.route);
    L.polyline(ll, { pane: 'routes', color, weight: 4, dashArray: dash, lineJoin: 'round', interactive: false, smoothFactor: 0.5 }).addTo(groups.route);
  };
  if (state.path) line(state.path, rc);
  if (state.emPath) line(state.emPath, cc, '10 8');
  L.marker([BASE.lat, BASE.lon], { icon: baseIcon, interactive: false }).bindTooltip('BASE', { permanent: true, direction: 'right', className: 'tag', offset: [8, 0] }).addTo(groups.marks);
  if (state.goalLL) L.marker(state.goalLL, { icon: flagIcon(state.path ? rc : cc), interactive: false }).addTo(groups.marks);
  if (state.astro != null) L.circleMarker(cellLL(state.astro), { pane: 'routes', radius: 8, color: '#130f0d', weight: 2, fillColor: cc, fillOpacity: 1 })
    .bindTooltip('VOCÊ', { permanent: true, direction: 'right', className: 'tag', offset: [10, 0] }).addTo(groups.marks);
}

/* ---------- Perfil de altitude ---------- */
function drawProfile() {
  const c = $('#profile'), w = Math.round(c.getBoundingClientRect().width), h = 150, d = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * d; c.height = h * d;
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const muted = cssv('--muted'), line = cssv('--line'); x.font = `11px ${cssv('--mono')}`;
  if (!state.info) { x.fillStyle = muted; x.fillText(HGT ? 'Sem rota possível até esse ponto.' : 'Carregando relevo…', 8, 24); return; }
  const pr = state.info.prof, L0 = 52, R0 = 10, T0 = 10, B0 = 22, tot = pr[pr.length - 1].d || 1;
  let mn = Infinity, mx = -Infinity; pr.forEach(p => { mn = Math.min(mn, p.h); mx = Math.max(mx, p.h); });
  mn = Math.floor(mn / 10) * 10 - 10; mx = Math.ceil(mx / 10) * 10 + 10;
  const X = v => L0 + (w - L0 - R0) * v / tot, Y = v => T0 + (h - T0 - B0) * (1 - (v - mn) / (mx - mn));
  x.strokeStyle = line; x.lineWidth = 1;
  [mn, (mn + mx) / 2, mx].forEach(v => { x.beginPath(); x.moveTo(L0, Y(v)); x.lineTo(w - R0, Y(v)); x.stroke(); x.fillStyle = muted; x.fillText(Math.round(v).toLocaleString('pt-BR'), 4, Y(v) + 4); });
  x.beginPath(); x.moveTo(X(0), Y(mn)); pr.forEach(p => x.lineTo(X(p.d), Y(p.h))); x.lineTo(X(tot), Y(mn)); x.closePath();
  x.fillStyle = 'rgba(95,214,202,.12)'; x.fill();
  const col = s => s > 8 ? cssv('--crit') : s > 4 ? cssv('--warn') : cssv('--route');
  x.lineWidth = 2.2;
  for (let k = 1; k < pr.length; k++) { x.strokeStyle = col(pr[k].s); x.beginPath(); x.moveTo(X(pr[k - 1].d), Y(pr[k - 1].h)); x.lineTo(X(pr[k].d), Y(pr[k].h)); x.stroke(); }
  x.fillStyle = muted; const kmT = tot / 1000, step = kmT > 8 ? 2 : kmT > 4 ? 1 : kmT > 2 ? 0.5 : 0.25;
  for (let k = 0; k <= kmT + 1e-6; k += step) { const px = X(k * 1000); x.fillText(k.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' km', Math.min(Math.max(px - 10, L0 - 10), w - R0 - 44), h - 6); }
}

/* ---------- Painel do plano ---------- */
const fmtKm = m => (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
const fmtMin = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${String(r).padStart(2, '0')}` : `${r} min`; };
const clock = m => { m = Math.round(m); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function renderPanel() {
  const st = $('#status'), stats = $('#stats'), tl = $('#timeline'), al = $('#alerts'), sp = $('#stops'), em = $('#emcard');
  const name = state.goalPoi ? state.goalPoi.n : 'Ponto escolhido no mapa';
  if (!state.info) {
    st.innerHTML = `<span class="pill" style="--c:var(--crit)">Sem rota</span><h3>${name}</h3><p>${state.msg || 'Nenhum caminho dentro do limite de declive. Tente outro ponto ou a opção "Mais curta".'}</p>`;
    stats.innerHTML = tl.innerHTML = al.innerHTML = sp.innerHTML = ''; em.hidden = true; return;
  }
  const I = state.info, stops = stopsOn(state.path, state.goalPoi);
  const work = stops.reduce((a, s) => a + (s.isGoal ? 40 : 15), 0) + (state.goalPoi ? 0 : 30);
  const total = I.tOut + work + I.tBack, o2 = 100 - total / 480 * 100;
  const [pc, pt] = o2 >= 30 ? ['var(--ok)', 'Dentro da margem'] : o2 >= 15 ? ['var(--warn)', 'Margem apertada'] : ['var(--crit)', 'Não recomendado'];
  st.innerHTML = `<span class="pill" style="--c:${pc}">${pt}</span><h3>${name}</h3><p>${state.mode === 'safe' ? `Rota segura: evita declives acima de ${LIM.safe}° e prefere terreno plano.` : `Rota mais curta: aceita declives até ${LIM.short}°.`}</p>`;
  stats.innerHTML = [
    ['Distância (ida)', fmtKm(I.dist), ''], ['Tempo de ida', fmtMin(I.tOut), 'volta ' + fmtMin(I.tBack)],
    ['Duração da EVA', fmtMin(total), `${stops.length} parada${stops.length === 1 ? '' : 's'}`], ['Oxigênio na volta', Math.max(0, Math.round(o2)) + '%', 'mín. 30%'],
    ['Subida acumulada', Math.round(I.climb) + ' m', 'descida ' + Math.round(I.desc) + ' m'], ['Declive máximo', I.maxS.toFixed(1).replace('.', ',') + '°', 'limite ' + LIM[state.mode] + '°']
  ].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}</b> <em>${c}</em></div>`).join('');
  const t0 = 9 * 60, arr = t0 + I.tOut, leave = arr + work, back = leave + I.tBack;
  tl.innerHTML = `<span class="mono">${clock(t0)}</span><span>Saída da base</span><span class="mono">${clock(arr)}</span><span>Chegada ao destino</span><span class="mono">${clock(leave)}</span><span>Início do retorno</span><span class="mono">${clock(back)}</span><span>De volta à base</span><span class="mono">17:52</span><span>Pôr do sol</span>`;
  const alerts = [];
  if (I.steep > 0) alerts.push(['var(--warn)', `${Math.round(I.steep)} m de trecho com declive acima de 8°. Use bastões e passos curtos.`]);
  if (back > 14.5 * 60) alerts.push(['var(--crit)', 'O retorno passa das 14:30, quando o vento sobe para 14 m/s com poeira. Antecipe a volta.']);
  if (back > 17 * 60) alerts.push(['var(--crit)', 'A volta termina perto do pôr do sol. Encurte a EVA ou divida em dois dias.']);
  if (o2 < 30) alerts.push(['var(--crit)', `Reserva de oxigênio de ${Math.max(0, Math.round(o2))}% na chegada, abaixo dos 30% exigidos.`]);
  if (state.mode === 'short' && I.maxS > LIM.safe) alerts.push(['var(--crit)', `A rota curta passa por declive de ${Math.round(I.maxS)}°. A rota segura é recomendada.`]);
  alerts.push(['var(--route)', 'Relevo com resolução de 200 m: confirme os trechos marcados na imagem HiRISE antes de sair.']);
  alerts.push(['var(--route)', 'Comunicação com a Terra: atraso de 11 min hoje. Decisões em campo ficam com a tripulação.']);
  al.innerHTML = alerts.map(([c, t]) => `<li class="alert" style="--c:${c}">${t}</li>`).join('');
  sp.innerHTML = stops.length ? stops.map(s => `<div class="stop"><span class="dot" style="--c:${KIND[s.p.k]}"></span><b>${s.p.n}${s.isGoal ? ' · destino' : ''}</b><span class="km">km ${s.km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span><small>${s.p.why} <span class="mono">${s.p.src}</span></small></div>`).join('') : '<p class="note">Nenhum alvo científico a menos de 300 m da rota.</p>';
  if (state.emerg) {
    em.hidden = false;
    em.innerHTML = state.emInfo
      ? `<h3>Retorno de emergência</h3><p class="note" style="color:var(--fg);margin:0">Da sua posição atual até a base pela rota mais rápida: <b class="mono">${fmtKm(state.emInfo.dist)}</b> em <b class="mono">${fmtMin(state.emInfo.tOut)}</b>. Declive máximo ${Math.round(state.emInfo.maxS)}°.</p>`
      : '<h3>Retorno de emergência</h3><p class="note">Sem rota rápida encontrada.</p>';
  } else em.hidden = true;
}

/* ---------- Interação ---------- */
function nearPoi(lat, lon, maxM) { let best = null, bd = maxM; for (const p of POIS) { const d = metersBetween(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } } return best; }
map.on('mousemove', e => {
  const { lat, lng } = e.latlng, i = HGT ? cellOf(lat, lng) : -1, p = nearPoi(lat, lng, 250);
  const pos = `${lat.toFixed(4)}° N  ${lng.toFixed(4)}° L`;
  $('#readout').textContent = i < 0 ? `${pos} · fora da área com relevo` : `${pos} · altitude ${Math.round(HGT[i]).toLocaleString('pt-BR')} m · declive ${SL[i].toFixed(1).replace('.', ',')}°${p ? ' · ' + p.n : ''}`;
});
map.on('click', e => { const p = nearPoi(e.latlng.lat, e.latlng.lng, 250); p ? setGoalPoi(p) : setGoalLL(e.latlng.lat, e.latlng.lng, null); });
function setMode(m) { state.mode = m; $('#m-safe').setAttribute('aria-pressed', m === 'safe'); $('#m-short').setAttribute('aria-pressed', m === 'short'); if (state.goalLL) setGoalLL(state.goalLL[0], state.goalLL[1], state.goalPoi); }
$('#m-safe').onclick = () => setMode('safe');
$('#m-short').onclick = () => setMode('short');
$('#emerg').onclick = () => { state.emerg = !state.emerg; $('#emerg').setAttribute('aria-pressed', state.emerg); recompute(); };
$('#destList').innerHTML = POIS.map((p, k) => p.k === 'base' ? '' : `<li><button data-k="${k}"><span class="dot" style="--c:${KIND[p.k]}"></span><span>${p.n}</span><span class="tag">${p.src.replace('Mars 2020 · ', '')}</span></button></li>`).join('');
$('#destList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setGoalPoi(POIS[+b.dataset.k]); });
window.addEventListener('resize', drawProfile);
bindToggle('ov-slope', groups.slope); bindToggle('ov-crism', groups.crism); bindToggle('ov-rover', groups.rover); bindToggle('ov-poi', groups.poi);
bindToggle('ov-themis', T.themis);
if (!$('#ov-themis').checked) setStatus('themis', 'off');
$('#ov-themis').addEventListener('change', () => $('#ov-themis').checked || srcStatus.themis === 'ok' || setStatus('themis', 'off'));
['mosaic', 'relief'].forEach(k => setStatus(k, 'off'));

// área analisada
L.rectangle([[YMIN, XMIN], [YMAX, XMAX]], { color: '#f0e5db', weight: 1, opacity: 0.35, fill: false, dashArray: '4 6', interactive: false }).addTo(map);

/* ---------- Inicialização ---------- */
drawProfile();
(async () => {
  const [demLive, trav, crism] = await Promise.all([
    loadDem(),
    loadGeo('traverse', 'data/perseverance-traverse.geojson'),
    loadGeo('crism', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { Type: 'Hydrous Mineral Detection', Instrument: 'CRISM' }, geometry: { type: 'Point', coordinates: [77.35, 18.56] } }] })
  ]);
  const maxSol = Math.max(...trav.data.features.map(f => f.properties.sol || 0), 1);
  L.geoJSON(trav.data, {
    style: f => ({ color: solColor(f.properties.sol || 0, maxSol), weight: 2.5, opacity: 0.95 }),
    onEachFeature: (f, l) => l.bindTooltip(`Perseverance · sol ${f.properties.sol}`, { className: 'tag', sticky: true })
  }).addTo(groups.rover);
  L.geoJSON(crism.data, {
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 9, color: KIND.crism, weight: 2, fillColor: KIND.crism, fillOpacity: 0.35 }),
    onEachFeature: (f, l) => l.bindTooltip(`${f.properties.Instrument || 'CRISM'} · minerais hidratados`, { className: 'tag' })
  }).addTo(groups.crism);
  const allLive = demLive && trav.live && crism.live, chip = $('#dataChip');
  chip.textContent = allLive ? 'Dados NASA ao vivo · Mars Trek' : 'Parte dos dados em cópia local';
  chip.classList.toggle('warn', !allLive);
  setGoalPoi(DEFAULT_GOAL);
})();
})();
