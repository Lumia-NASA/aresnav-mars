/* AresNav · Trilha Jezero — núcleo do app.
   Regra de ouro (skill 01): o navegador NUNCA chama a NASA direto. Imagens, relevo, trajeto,
   minerais, fotos e telemetria vêm do backend AresNav (/api/v1/...), que repassa e guarda em cache.
   Se o backend cair ou responder degraded: true, o app entra em redundância local (pasta data/)
   e mostra o aviso OFFLINE TELEMETRY (CACHED).
   Este arquivo calcula a rota a pé (A*), simula a caminhada e desenha o mapa 2D e o painel do plano.
   Os outros modos (globo 3D, capacete, telemetria) conversam com ele pelo objeto global App. */
const App = (function () {
'use strict';
const $ = s => document.querySelector(s);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Barramento de eventos simples ---------- */
const listeners = {};
const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
const emit = (ev, data) => (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(ev, e); } });
/* limita uma função a rodar no máximo uma vez a cada ms (o HUD atualiza a 1 Hz) */
function throttle(fn, ms) {
  let last = 0, timer = null;
  return function () { const now = Date.now(), wait = ms - (now - last); clearTimeout(timer); if (wait <= 0) { last = now; fn(); } else timer = setTimeout(() => { last = Date.now(); fn(); }, wait); };
}

/* ---------- Backend AresNav ---------- */
const API = (window.ARESNAV_API || 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const link = { online: false, degraded: false, mapsOnline: false };
async function fetchT(url, ms) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms || 8000);
  try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(timer); }
}

/* Camadas de imagem (identificadores aceitos pelo backend em /api/v1/tiles/:layer) */
const LAYERS = {
  viking: { ext: 'jpg', max: 7, local: [0, 2] },
  relief: { ext: 'jpg', max: 8 },
  ctx: { ext: 'png', max: 13, box: [77.1605, 18.211, 77.6992, 18.7212], local: [10, 11] },
  hirise: { ext: 'png', max: 17, box: [77.2229, 18.3068, 77.584, 18.6693] },
  mosaic: { ext: 'png', max: 16, box: [76.7913, 17.5792, 77.7314, 18.6926] },
  themis: { ext: 'png', max: 9, box: [-180, -65, 180, 65] }
};
/* Com backend: blocos via proxy. Sem backend: conjunto pequeno guardado em data/tiles (redundância local) */
const tileUrl = k => link.mapsOnline ? `${API}/tiles/${k}/{z}/{y}/{x}` : `data/tiles/${k}/{z}/{y}/{x}.${LAYERS[k].ext}`;
const tileRange = k => link.mapsOnline ? [0, LAYERS[k].max] : (LAYERS[k].local || null);
const NAVCAM_BASE = 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/';
/* Endereço de uma foto da Navcam passando pelo backend (aceita caminho relativo ou URL oficial da NASA) */
function photoUrl(u) {
  if (!u) return null;
  const rel = u.startsWith(NAVCAM_BASE) ? u.slice(NAVCAM_BASE.length) : /^https?:/.test(u) ? null : u;
  return rel && link.online ? `${API}/navcam/${rel}` : null;
}

/* Área com relevo detalhado (graus, longitude leste) e grade usada na rota */
const XMIN = 77.25, XMAX = 77.55, YMIN = 18.33, YMAX = 18.62, W = 150, H = 145;
const DX = (XMAX - XMIN) / W, DY = (YMAX - YMIN) / H;
const R_MARS = 3389500, LAT0 = (YMIN + YMAX) / 2;
const MX = DX * Math.PI / 180 * R_MARS * Math.cos(LAT0 * Math.PI / 180);
const MY = DY * Math.PI / 180 * R_MARS;

/* ---------- Tabela de fontes ---------- */
const SOURCES = [
  ['telemetry', 'Telemetria unificada (contrato)', 'MOLA + MEDA + Mars 2020', 'CONTRATO_API.json', '/api/v1/telemetry'],
  ['viking', 'Mosaico global colorido', 'Viking Orbiter', 'VIS (232 m)', '/api/v1/tiles/viking'],
  ['hirise', 'Imagem HiRISE 25 cm', 'Mars Reconnaissance Orbiter', 'HiRISE', '/api/v1/tiles/hirise'],
  ['ctx', 'Imagem CTX 6 m', 'Mars Reconnaissance Orbiter', 'CTX', '/api/v1/tiles/ctx'],
  ['mosaic', 'Mosaico de pouso', 'MRO + Mars Express', 'HiRISE, CTX, HRSC', '/api/v1/tiles/mosaic'],
  ['relief', 'Relevo colorido', 'Mars Global Surveyor + Mars Express', 'MOLA, HRSC', '/api/v1/tiles/relief'],
  ['gdem', 'Relevo global (globo 3D)', 'Mars Global Surveyor', 'MOLA', 'camada local'],
  ['dem', 'Altitude e declive (rota)', 'Mars Global Surveyor + Mars Express', 'MOLA, HRSC (200 m)', '/api/v1/dem/jezero'],
  ['themis', 'Infravermelho diurno', '2001 Mars Odyssey', 'THEMIS', '/api/v1/tiles/themis'],
  ['crism', 'Minerais hidratados', 'Mars Reconnaissance Orbiter', 'CRISM', '/api/v1/crism'],
  ['traverse', 'Trajeto do Perseverance', 'Mars 2020', 'Navegação do rover', '/api/v1/traverse'],
  ['navcam', 'Fotos de solo (Capacete e pop-up)', 'Mars 2020', 'Navcam (imagens brutas)', '/api/v1/navcam']
];
const srcStatus = {};
const ST_LABEL = { ok: 'Backend · NASA ao vivo', fb: 'Cache / cópia local', off: 'Desligada', wait: 'Aguardando' };
function setStatus(id, s) {
  if (srcStatus[id] === s) return;
  srcStatus[id] = s;
  $('#srcTable').innerHTML = SOURCES.map(([k, a, b, c, d]) => {
    const st = srcStatus[k] || 'wait';
    return `<tr><td>${a}</td><td>${b}</td><td>${c}</td><td class="mono">${d}</td><td class="${st === 'off' ? 'wait' : st}">${ST_LABEL[st]}</td></tr>`;
  }).join('');
}

/* ---------- Pontos de interesse (posições reais do Perseverance nos sóis indicados) ---------- */
const KIND = { base: '#E8ECF8', sci: '#FFB800', samp: '#FFB800', crism: '#6EA8FF', target: '#FFB800' };
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
/* Altitude em qualquer ponto de Marte: relevo detalhado em Jezero, regional em volta, MOLA global no resto */
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
const slopeAt = (lat, lon) => { const i = cellOf(lat, lon); return i < 0 || !SL ? -1 : SL[i]; };

async function loadDem() {
  let buf = null, live = false;
  if (link.online) try {
    const r = await fetchT(`${API}/dem/jezero`, 12000);
    if (r.ok) { buf = await r.arrayBuffer(); live = r.headers.get('X-AresNav-Degraded') !== 'true'; if (buf.byteLength < W * H * 4) buf = null; }
  } catch (e) { buf = null; }
  if (!buf) { live = false; buf = await (await fetch('data/dem-jezero-200m.f32')).arrayBuffer(); }
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
    im.data.set(s < 4 ? [0, 0, 0, 0] : s < 8 ? [255, 184, 0, 110] : s < 12 ? [255, 120, 40, 160] : [255, 51, 68, 190], i * 4);
  }
  g.putImageData(im, 0, 0);
  api.slopeURL = cv.toDataURL();
  L.imageOverlay(api.slopeURL, [[YMIN, XMIN], [YMAX, XMAX]], { opacity: 0.7 }).addTo(groups.slope);
  return live;
}
async function loadLocalGrids() {
  try { GDEM = new Int16Array((await (await fetch('data/mars-mola-global-1024x512.i16')).arrayBuffer()).slice(0, GW * GH * 2)); setStatus('gdem', 'fb'); }
  catch (e) { console.warn('Relevo global indisponível', e); }
  try { RDEM = new Int16Array((await (await fetch('data/dem-jezero-region-560.i16')).arrayBuffer()).slice(0, REG.n * REG.n * 2)); }
  catch (e) { console.warn('Relevo regional indisponível', e); }
}
/* GeoJSON pelo backend ({ degraded, data }); se falhar, cópia local */
async function loadGeo(key, route, fallback) {
  if (link.online) try {
    const r = await fetchT(`${API}/${route}`, 12000), j = r.ok ? await r.json() : null;
    if (j && j.data && Array.isArray(j.data.features)) { setStatus(key, j.degraded ? 'fb' : 'ok'); return { data: j.data, live: !j.degraded }; }
  } catch (e) { /* cai para a cópia local */ }
  setStatus(key, 'fb');
  return { data: typeof fallback === 'string' ? await (await fetch(fallback)).json() : fallback, live: false };
}

/* ---------- Telemetria do contrato (CONTRATO_API.json) ---------- */
const NO_LOAD_SLOPE = 15; // limite de declive sem a carga do traje; o contrato reduz para max_safe_slope_deg
async function pollTelemetry() {
  let t = null;
  try { const r = await fetchT(`${API}/telemetry`, 2500); if (r.ok) t = await r.json(); } catch (e) { t = null; }
  if (t && t.layers && t.eva_mobility) {
    link.online = true; link.degraded = !!t.degraded;
    try { localStorage.setItem('aresnav.telemetry', JSON.stringify(t)); } catch (e) { /* sem armazenamento local */ }
  } else {
    link.online = false; link.degraded = false;
    t = state.tele;
    if (!t) try { t = JSON.parse(localStorage.getItem('aresnav.telemetry')); } catch (e) { t = null; }
    if (!t || !t.layers) try { t = await (await fetch('data/telemetry-fallback.json')).json(); } catch (e) { t = null; }
  }
  const before = state.linkState, limBefore = LIM.safe;
  state.tele = t;
  state.linkState = !link.online ? 'offline' : link.degraded ? 'degraded' : 'online';
  setStatus('telemetry', state.linkState === 'online' ? 'ok' : 'fb');
  const lim = t && t.layers && t.layers.topography && Number(t.layers.topography.max_safe_slope_deg);
  if (lim > 0) LIM.safe = lim;
  renderLink();
  if (state.ready && LIM.safe !== limBefore && state.goalLL) setGoalLL(state.goalLL[0], state.goalLL[1], state.goalPoi);
  else if (state.ready && before !== state.linkState) renderPanel();
  drawTargets();
  emit('telemetry', state);
}
function renderLink() {
  const off = state.linkState !== 'online', chip = $('#dataChip');
  chip.textContent = state.linkState === 'online' ? 'Backend AresNav · NASA ao vivo' : 'OFFLINE TELEMETRY (CACHED)';
  chip.classList.toggle('warn', off);
  document.body.classList.toggle('offline', off);
}

/* ---------- Mapa 2D (Leaflet) ---------- */
let map, T = {}, groups = {}, activeBase = [];
const SLOPE_COL = () => [cssv('--route'), cssv('--warn'), cssv('--crit')];
const slopeClass = s => s > 8 ? 2 : s > 4 ? 1 : 0;
function initMap() {
  map = L.map('map', { crs: L.CRS.EPSG4326, minZoom: 1, maxZoom: 18, zoomSnap: 0.5, maxBounds: [[-90, -200], [90, 200]], maxBoundsViscosity: 0.8, worldCopyJump: false })
    .setView([18.462, 77.42], link.mapsOnline ? 12.5 : 11.5);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Dados: NASA/JPL/Caltech/MSSS/ESA/ASU/USGS · via backend AresNav');
  const tiles = (key, opts) => {
    const d = LAYERS[key], range = tileRange(key);
    if (!range) return L.layerGroup(); // camada sem cópia local: fica vazia em modo offline
    const lyr = L.tileLayer(tileUrl(key), Object.assign({ maxZoom: 18, minNativeZoom: range[0], maxNativeZoom: range[1], noWrap: true, bounds: d.box ? [[d.box[1], d.box[0]], [d.box[3], d.box[2]]] : [[-90, -180], [90, 180]] }, opts));
    lyr.on('tileload', () => setStatus(key, link.mapsOnline ? 'ok' : 'fb'));
    return lyr;
  };
  T = { viking: tiles('viking'), ctx: tiles('ctx'), hirise: tiles('hirise'), mosaic: tiles('mosaic'), relief: tiles('relief'), themis: tiles('themis', { opacity: 0.6 }) };
  map.createPane('routes').style.zIndex = 450;
  groups = { slope: L.layerGroup(), crism: L.layerGroup(), rover: L.layerGroup(), poi: L.layerGroup(), targets: L.layerGroup(), route: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map) };
  POIS.forEach(p => {
    if (p.k === 'base') return;
    L.circleMarker([p.lat, p.lon], { radius: 6, color: KIND[p.k], weight: 2, fillColor: '#0A0D14', fillOpacity: 0.85 })
      .bindTooltip(`${p.n} · ${p.src}`, { className: 'tag', direction: 'top', offset: [0, -6] })
      .on('click', e => { L.DomEvent.stopPropagation(e); openTruth(poiTruth(p)); }).addTo(groups.poi);
  });
  L.rectangle([[YMIN, XMIN], [YMAX, XMAX]], { color: '#e8ecf8', weight: 1, opacity: 0.35, fill: false, dashArray: '4 6', interactive: false }).addTo(map);
  map.on('mousemove', e => readout(e.latlng.lat, e.latlng.lng));
  map.on('click', e => pick(e.latlng.lat, e.latlng.lng));
  $('#m-jezero').onclick = () => map.flyTo([18.462, 77.42], link.mapsOnline ? 12.5 : 11.5);
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
  [...activeBase].reverse().forEach(l => l.bringToBack && l.bringToBack());
  [['slope', groups.slope], ['crism', groups.crism], ['rover', groups.rover], ['poi', groups.poi], ['poi', groups.targets], ['themis', T.themis]].forEach(([k, l]) => s[k] ? l.addTo(map) : map.removeLayer(l));
  ['hirise', 'ctx', 'mosaic', 'relief', 'themis'].forEach(k => { if (!srcStatus[k] || srcStatus[k] === 'off' || srcStatus[k] === 'wait') setStatus(k, (k === 'themis' ? s.themis : BASES[s.base].includes(k)) ? 'wait' : 'off'); });
  emit('layers', s);
}
/* Alvos científicos vindos do contrato (layers.science_targets) */
function drawTargets() {
  if (!map) return;
  groups.targets.clearLayers();
  const list = (state.tele && state.tele.layers && state.tele.layers.science_targets) || [];
  list.forEach(t => {
    if (typeof t.lat !== 'number' || typeof t.lng !== 'number') return;
    L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="targetmark"></div>' }) })
      .bindTooltip(`${t.id || 'Alvo'} · ${t.name || ''}`, { className: 'tag', direction: 'top', offset: [0, -8] })
      .on('click', e => { L.DomEvent.stopPropagation(e); openTruth(targetTruth(t)); }).addTo(groups.targets);
  });
}

/* ---------- Pop-up "1st Person Ground Truth" (4ª camada óptica) ---------- */
const poiTruth = p => ({ title: p.n, sub: p.src, lat: p.lat, lon: p.lon, context: p.why, poi: p });
const targetTruth = t => ({ title: t.name || t.id, sub: `${t.id || 'Alvo científico'} · contrato da API`, lat: t.lat, lon: t.lng, context: t.geology_context, mineral: t.mineral, safe: t.safe_route, photo: t.optical_first_person_url });
let truthNow = null;
function openTruth(t) {
  truthNow = t;
  const near = api.pano ? api.pano.nearest(t.lat, t.lon) : null, img = $('#truthImg'), cap = $('#truthCap');
  const fallback = () => {
    const u = near && photoUrl(near.url);
    if (u) { img.onerror = () => { img.hidden = true; cap.textContent = 'Foto indisponível agora (backend ou NASA fora do ar).'; }; img.src = u; img.hidden = false; cap.textContent = `Foto real da Navcam do Perseverance · sol ${near.sol} · tirada a ${near.dist >= 1000 ? fmtKm(near.dist) : Math.round(near.dist) + ' m'} deste ponto`; }
    else { img.hidden = true; cap.textContent = link.online ? 'Nenhuma foto de solo perto deste ponto.' : 'OFFLINE: fotos de solo precisam do backend AresNav.'; }
  };
  const first = photoUrl(t.photo);
  if (first) { img.onerror = fallback; img.onload = () => { cap.textContent = 'Foto de solo indicada pelo contrato (optical_first_person_url) · Perseverance'; }; img.src = first; img.hidden = false; cap.textContent = 'Carregando foto…'; }
  else fallback();
  $('#truthTitle').textContent = t.title; $('#truthSub').textContent = t.sub || '';
  const s = slopeAt(t.lat, t.lon);
  $('#truthFacts').innerHTML = [
    ['Posição', `${t.lat.toFixed(4)}° N  ${t.lon.toFixed(4)}° L`], ['Altitude', Math.round(heightAt(t.lat, t.lon)).toLocaleString('pt-BR') + ' m'],
    ['Declive local', s < 0 ? 'fora da área detalhada' : s.toFixed(1).replace('.', ',') + '°'],
    t.mineral ? ['Mineral', t.mineral] : null, t.safe != null ? ['Rota segura', t.safe ? 'sim' : 'não'] : null
  ].filter(Boolean).map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  $('#truthCtx').textContent = t.context || '';
  $('#truth').hidden = false;
}
function closeTruth() { $('#truth').hidden = true; truthNow = null; }

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
/* Parte um caminho em trechos de mesma classe de declive: [{ cls, ll: [[lat, lon], ...] }] */
function slopeRuns(path) {
  const runs = []; let cur = null;
  for (let k = 0; k < path.length; k++) {
    const cls = slopeClass(k ? Math.max(SL[path[k - 1]], SL[path[k]]) : SL[path[0]]), p = cellLL(path[k]);
    if (!cur || cur.cls !== cls) { const prev = cur && cur.ll[cur.ll.length - 1]; cur = { cls, ll: prev ? [prev] : [] }; runs.push(cur); }
    cur.ll.push(p);
  }
  return runs.filter(r => r.ll.length > 1);
}
/* Trajeto do rover em trechos por perigo de declive (classe -1 = fora da área com relevo detalhado) */
function buildRoverRuns(fc) {
  const runs = []; let cur = null;
  (fc.features || []).filter(f => f.geometry).sort((a, b) => ((a.properties.sol || a.properties.Sol || 0) - (b.properties.sol || b.properties.Sol || 0))).forEach(f => {
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates, sol = f.properties.sol || f.properties.Sol || 0;
    parts.forEach(pts => {
      let last = null;
      pts.forEach((p, i) => {
        if (i % 3 && i !== pts.length - 1) return; // decima: 1 a cada 3 vértices
        const s = slopeAt(p[1], p[0]), cls = s < 0 ? -1 : slopeClass(s), ll = [p[1], p[0]];
        const end = cur && cur.ll[cur.ll.length - 1], joined = end && Math.abs(end[0] - ll[0]) < 3e-4 && Math.abs(end[1] - ll[1]) < 3e-4;
        if (!cur || cur.cls !== cls || (!joined && !last)) { cur = { cls, sol, ll: joined ? [end] : [] }; runs.push(cur); }
        cur.ll.push(ll); last = ll;
      });
    });
  });
  return runs.filter(r => r.ll.length > 1);
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
const state = { mode: 'safe', goal: -1, goalLL: null, goalPoi: DEFAULT_GOAL, path: null, info: null, stops: [], plan: null, sim: null, simT: 0, now: null, playing: false, emerg: false, emPath: null, emInfo: null, msg: '', op: 'planner', view: 'globe', plannerView: 'globe', ready: false, cam: null, tele: null, linkState: 'offline', alerts: [] };

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
/* Clique no mapa ou no globo: em cima de um ponto abre a foto de solo; em terreno livre define o destino */
function pick(lat, lon) {
  const targets = (state.tele && state.tele.layers && state.tele.layers.science_targets) || [];
  const t = targets.find(q => metersBetween(lat, lon, q.lat, q.lng) < 250);
  if (t) return openTruth(targetTruth(t));
  const p = nearPoi(lat, lon, 250);
  if (p && p.k !== 'base') return openTruth(poiTruth(p));
  setGoalLL(lat, lon, null);
}
function readout(lat, lon) {
  const i = HGT ? cellOf(lat, lon) : -1, p = nearPoi(lat, lon, 250), pos = `${lat.toFixed(4)}° N  ${lon.toFixed(4)}° L`;
  $('#readout').textContent = i < 0
    ? `${pos} · altitude ${Math.round(heightAt(lat, lon)).toLocaleString('pt-BR')} m (MOLA global)`
    : `${pos} · altitude ${Math.round(HGT[i]).toLocaleString('pt-BR')} m · declive ${SL[i].toFixed(1).replace('.', ',')}°${p ? ' · ' + p.n : ''}`;
}

/* ---------- Desenho da rota no mapa 2D ---------- */
const flagIcon = c => L.divIcon({ className: '', iconSize: [18, 26], iconAnchor: [2, 26], html: `<svg width="18" height="26" viewBox="0 0 18 26"><path d="M2 26V2" stroke="#0A0D14" stroke-width="3"/><path d="M2 26V2" stroke="#e8ecf8" stroke-width="1.5"/><path d="M3 2h13l-4 5 4 5H3z" fill="${c}" stroke="#0A0D14" stroke-width="1.5"/></svg>` });
function drawRoute() {
  if (!map) return;
  groups.route.clearLayers(); groups.marks.clearLayers();
  const col = SLOPE_COL(), cc = cssv('--crit');
  if (state.path) {
    L.polyline(state.path.map(cellLL), { pane: 'routes', color: '#000', opacity: 0.6, weight: 9, lineJoin: 'round', interactive: false, smoothFactor: 0.5 }).addTo(groups.route);
    slopeRuns(state.path).forEach(r => L.polyline(r.ll, { pane: 'routes', color: col[r.cls], weight: 4.5, lineJoin: 'round', lineCap: 'round', interactive: false, smoothFactor: 0.5 }).addTo(groups.route));
  }
  if (state.emPath) {
    const ll = state.emPath.map(cellLL);
    L.polyline(ll, { pane: 'routes', color: '#000', opacity: 0.55, weight: 8, interactive: false }).addTo(groups.route);
    L.polyline(ll, { pane: 'routes', color: cc, weight: 4, dashArray: '10 8', interactive: false }).addTo(groups.route);
  }
  L.marker([BASE.lat, BASE.lon], { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="basemark"></div>' }), interactive: false })
    .bindTooltip('BASE', { permanent: true, direction: 'right', className: 'tag', offset: [8, 0] }).addTo(groups.marks);
  if (state.goalLL) L.marker(state.goalLL, { icon: flagIcon(state.path ? col[0] : cc), interactive: false }).addTo(groups.marks);
  if (state.now) L.circleMarker([state.now.lat, state.now.lon], { pane: 'routes', radius: 7, color: '#0A0D14', weight: 2, fillColor: state.emerg ? cc : '#fff', fillOpacity: 1, interactive: false })
    .bindTooltip('VOCÊ', { permanent: true, direction: 'right', className: 'tag', offset: [10, 0] }).addTo(groups.marks);
  if (state.cam) L.circleMarker([state.cam.lat, state.cam.lon], { pane: 'routes', radius: 6, color: '#0A0D14', weight: 2, fillColor: cssv('--blue'), fillOpacity: 1, interactive: false })
    .bindTooltip('VISTA DO CAPACETE', { permanent: true, direction: 'left', className: 'tag', offset: [-10, 0] }).addTo(groups.marks);
}
function drawRover() {
  groups.rover.clearLayers();
  const col = SLOPE_COL(), renderer = L.canvas({ padding: 0.3 });
  (api.roverRuns || []).forEach(r => L.polyline(r.ll, { renderer, color: r.cls < 0 ? cssv('--mars') : col[r.cls], weight: 2.5, opacity: 0.95, smoothFactor: 0.8 })
    .bindTooltip(`Perseverance · sol ${r.sol}${r.cls < 0 ? '' : ' · declive ' + ['até 4°', '4° a 8°', 'acima de 8°'][r.cls]}`, { className: 'tag', sticky: true }).addTo(groups.rover));
}

/* ---------- Perfil de altitude ---------- */
function drawProfile() {
  const c = $('#profile'), w = Math.round(c.getBoundingClientRect().width), h = 140, d = Math.min(2, window.devicePixelRatio || 1);
  if (!w) return;
  c.width = w * d; c.height = h * d;
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const muted = cssv('--muted'), line = cssv('--line'), col = SLOPE_COL(); x.font = `11px ${cssv('--mono')}`;
  if (!state.info) { x.fillStyle = muted; x.fillText(HGT ? 'Sem rota possível até esse ponto.' : 'Carregando relevo…', 8, 24); return; }
  const pr = state.info.prof, L0 = 56, R0 = 10, T1 = 10, B0 = 22, tot = pr[pr.length - 1].d || 1;
  let mn = Infinity, mx = -Infinity; pr.forEach(p => { mn = Math.min(mn, p.h); mx = Math.max(mx, p.h); });
  mn = Math.floor(mn / 10) * 10 - 10; mx = Math.ceil(mx / 10) * 10 + 10;
  const X = v => L0 + (w - L0 - R0) * v / tot, Y = v => T1 + (h - T1 - B0) * (1 - (v - mn) / (mx - mn));
  x.strokeStyle = line; x.lineWidth = 1;
  [mn, (mn + mx) / 2, mx].forEach(v => { x.beginPath(); x.moveTo(L0, Y(v)); x.lineTo(w - R0, Y(v)); x.stroke(); x.fillStyle = muted; x.fillText(Math.round(v).toLocaleString('pt-BR'), 4, Y(v) + 4); });
  x.beginPath(); x.moveTo(X(0), Y(mn)); pr.forEach(p => x.lineTo(X(p.d), Y(p.h))); x.lineTo(X(tot), Y(mn)); x.closePath();
  x.fillStyle = 'rgba(0,255,170,.08)'; x.fill();
  x.lineWidth = 2.2;
  for (let k = 1; k < pr.length; k++) { x.strokeStyle = col[slopeClass(pr[k].s)]; x.beginPath(); x.moveTo(X(pr[k - 1].d), Y(pr[k - 1].h)); x.lineTo(X(pr[k].d), Y(pr[k].h)); x.stroke(); }
  x.fillStyle = muted; const kmT = tot / 1000, step = kmT > 8 ? 2 : kmT > 4 ? 1 : kmT > 2 ? 0.5 : 0.25;
  for (let k = 0; k <= kmT + 1e-6; k += step) { const px = X(k * 1000); x.fillText(k.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' km', Math.min(Math.max(px - 10, L0 - 10), w - R0 - 50), h - 6); }
}

/* ---------- Painel do plano e checklist ---------- */
const fmtKm = m => (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
const fmtMin = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${String(r).padStart(2, '0')}` : `${r} min`; };
const clock = m => { m = Math.round(m); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const num = (v, d) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
function renderChecklist() {
  const I = state.info, P = state.plan, t = state.tele, ls = state.linkState;
  const meda = t && t.layers && t.layers.atmosphere_meda, payload = t && t.eva_mobility && t.eva_mobility.suit_payload_kg;
  const items = [
    [!state.ready ? 'wait' : ls === 'online' ? 'ok' : 'warn', 'Enlace com o backend', !state.ready ? 'Conectando…' : ls === 'online' ? 'Telemetria ao vivo' : 'OFFLINE TELEMETRY (CACHED)'],
    [I ? 'ok' : state.ready ? 'crit' : 'wait', 'Rota traçada', I ? fmtKm(I.dist) + ' de ida' : state.ready ? 'Sem caminho possível' : 'Aguardando relevo'],
    [!I ? 'wait' : I.maxS <= LIM.safe ? 'ok' : 'crit', 'Declive dentro do limite', I ? `Máximo ${num(I.maxS, 1)}° de ${num(LIM.safe, 0)}°${payload ? ` (${NO_LOAD_SLOPE}° sem a carga de ${num(payload, 1)} kg)` : ''}` : '—'],
    [!P ? 'wait' : P.o2 >= 30 ? 'ok' : P.o2 >= 15 ? 'warn' : 'crit', 'Reserva de oxigênio', P ? `${Math.max(0, Math.round(P.o2))}% previstos na volta (mín. 30%)` : '—'],
    [!meda ? 'wait' : meda.dust_storm_alert ? 'warn' : 'ok', 'Tempo em Jezero (MEDA)', meda ? `${meda.dust_storm_alert ? 'Alerta de poeira' : 'Sem alerta'} · vento ${num(meda.wind_speed_ms, 1)} m/s` : '—'],
    [!P ? 'wait' : P.back <= 17 * 60 ? 'ok' : 'crit', 'Volta com luz do dia', P ? `Retorno ${clock(P.back)} · pôr do sol 17:52` : '—'],
    ['info', 'Comunicação com a Terra', 'Atraso de 11 min. Ciente']
  ];
  $('#checklist').innerHTML = items.map(([s, a, b]) => `<li class="${s}"><i></i><div><b>${a}</b><small>${b}</small></div></li>`).join('');
  const crit = items.some(i => i[0] === 'crit'), warn = items.some(i => i[0] === 'warn'), wait = items.some(i => i[0] === 'wait');
  const g = $('#gonogo');
  g.className = 'gonogo ' + (wait ? 'wait' : crit ? 'crit' : warn ? 'warn' : 'ok');
  g.textContent = wait ? 'Aguardando dados' : crit ? 'NO-GO · não sair' : warn ? 'GO com ressalvas' : 'GO · liberado para sair';
}
function renderPanel() {
  renderChecklist();
  const st = $('#status'), stats = $('#stats'), tl = $('#timeline'), al = $('#alerts'), sp = $('#stops');
  const name = state.goalPoi ? state.goalPoi.n : 'Ponto escolhido no mapa';
  const alerts = [];
  ((state.tele && state.tele.hud_alerts) || []).forEach(a => alerts.push([a.level === 'CRITICAL' ? 'var(--crit)' : 'var(--warn)', `${a.code || 'ALERTA'}: ${a.action || ''}`, true]));
  if (state.linkState !== 'online') alerts.push(['var(--warn)', 'OFFLINE TELEMETRY (CACHED): sem enlace com o backend, usando a última telemetria guardada.']);
  if (!state.info) {
    st.innerHTML = `<span class="pill" style="--c:var(--crit)">Sem rota</span><h3>${name}</h3><p>${state.msg || 'Nenhum caminho dentro do limite de declive. Tente outro ponto ou a opção "Mais curta".'}</p>`;
    stats.innerHTML = tl.innerHTML = sp.innerHTML = '';
  } else {
    const I = state.info, P = state.plan, stops = state.stops, o2 = P.o2;
    const [pc, pt] = o2 >= 30 ? ['var(--ok)', 'Dentro da margem'] : o2 >= 15 ? ['var(--warn)', 'Margem apertada'] : ['var(--crit)', 'Não recomendado'];
    st.innerHTML = `<span class="pill" style="--c:${pc}">${pt}</span><h3>${name}</h3><p>${state.mode === 'safe' ? `Rota segura: evita declives acima de ${num(LIM.safe, 0)}° e prefere terreno plano.` : `Rota mais curta: aceita declives até ${LIM.short}°.`}</p>`;
    stats.innerHTML = [
      ['Distância (ida)', fmtKm(I.dist), ''], ['Tempo de ida', fmtMin(I.tOut), 'volta ' + fmtMin(I.tBack)],
      ['Duração total', fmtMin(P.total), `${stops.length} parada${stops.length === 1 ? '' : 's'}`], ['Oxigênio na volta', Math.max(0, Math.round(o2)) + '%', 'mín. 30%'],
      ['Subida acumulada', Math.round(I.climb) + ' m', 'descida ' + Math.round(I.desc) + ' m'], ['Declive máximo', num(I.maxS, 1) + '°', 'limite ' + num(LIM[state.mode], 0) + '°']
    ].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}</b> <em>${c}</em></div>`).join('');
    tl.innerHTML = `<span class="mono">${clock(T0)}</span><span>Saída da base</span><span class="mono">${clock(P.arrive)}</span><span>Chegada ao destino</span><span class="mono">${clock(P.back - I.tBack)}</span><span>Início do retorno</span><span class="mono">${clock(P.back)}</span><span>De volta à base</span><span class="mono">17:52</span><span>Pôr do sol</span>`;
    if (I.steep > 0) alerts.push(['var(--warn)', `${Math.round(I.steep)} m de trecho com declive acima de 8°. Use bastões e passos curtos.`]);
    if (P.back > 14.5 * 60) alerts.push(['var(--crit)', 'O retorno passa das 14:30, quando o vento costuma subir. Antecipe a volta.']);
    if (P.back > 17 * 60) alerts.push(['var(--crit)', 'A volta termina perto do pôr do sol. Encurte a caminhada ou divida em dois dias.']);
    if (o2 < 30) alerts.push(['var(--crit)', `Reserva de oxigênio prevista de ${Math.max(0, Math.round(o2))}% na chegada, abaixo dos 30% exigidos.`]);
    if (state.mode === 'short' && I.maxS > LIM.safe) alerts.push(['var(--crit)', `A rota curta passa por declive de ${Math.round(I.maxS)}°. A rota segura é recomendada.`]);
    alerts.push(['var(--route)', 'Relevo com resolução de 200 m: confirme os trechos marcados na imagem HiRISE antes de sair.']);
    sp.innerHTML = stops.length ? stops.map(s => `<div class="stop"><span class="dot" style="--c:${KIND[s.p.k]}"></span><b>${s.p.n}${s.isGoal ? ' · destino' : ''}</b><span class="km">km ${num(s.km, 1)}</span><small>${s.p.why} <span class="mono">${s.p.src}</span></small></div>`).join('') : '<p class="note">Nenhum alvo científico a menos de 300 m da rota.</p>';
  }
  state.alerts = alerts;
  al.innerHTML = alerts.map(([c, t]) => `<li class="alert" style="--c:${c}">${t}</li>`).join('');
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
      state.simT = Math.min(state.sim.total, state.simT + 1.5);
      if (state.simT >= state.sim.total) setPlaying(false);
      tick();
    }, 250);
  }
  renderTransport();
}

/* ---------- Modos de operação: [HABITAT PLANNER] ⇄ [HELMET HUD] ---------- */
function setView(v) {
  state.view = v;
  if (v !== 'helmet') state.plannerView = v;
  state.op = v === 'helmet' ? 'helmet' : 'planner';
  document.body.classList.toggle('helmet-mode', state.op === 'helmet');
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
  document.querySelectorAll('.opmode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.op === state.op));
  if (v === 'map' && map) setTimeout(() => map.invalidateSize(), 0);
  emit('view', v);
  setTimeout(() => { drawProfile(); window.dispatchEvent(new Event('resize')); }, 0);
}
const setOp = op => setView(op === 'helmet' ? 'helmet' : state.plannerView);

/* ---------- Inicialização ---------- */
async function start() {
  SOURCES.forEach(([k]) => setStatus(k, 'wait'));
  await pollTelemetry();               // decide online/offline antes de montar os mapas
  link.mapsOnline = link.online;
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
  document.querySelectorAll('.opmode button').forEach(b => b.addEventListener('click', () => setOp(b.dataset.op)));
  $('#truthClose').onclick = closeTruth;
  $('#truth').addEventListener('click', e => { if (e.target.id === 'truth') closeTruth(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeTruth(); });
  $('#truthGoal').onclick = () => { const t = truthNow; closeTruth(); if (t) setGoalLL(t.lat, t.lon, t.poi || null); };
  $('#truthHelmet').onclick = () => { const t = truthNow; closeTruth(); if (t) { setView('helmet'); if (api.pano) api.pano.goTo(t.lat, t.lon); } };
  window.addEventListener('resize', throttle(drawProfile, 200));
  applyLayers(); renderPanel(); drawProfile(); renderTransport(); drawTargets();
  setView('globe');

  const [demLive, , trav, crism] = await Promise.all([
    loadDem(), loadLocalGrids(),
    loadGeo('traverse', 'traverse', 'data/perseverance-traverse.geojson'),
    loadGeo('crism', 'crism', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { Type: 'Hydrous Mineral Detection', Instrument: 'CRISM' }, geometry: { type: 'Point', coordinates: [77.35, 18.56] } }] })
  ]);
  api.traverse = trav.data; api.crism = crism.data;
  api.roverRuns = buildRoverRuns(trav.data);
  drawRover();
  L.geoJSON(crism.data, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 9, color: KIND.crism, weight: 2, fillColor: KIND.crism, fillOpacity: 0.35 }), onEachFeature: (f, l) => l.bindTooltip('CRISM · minerais hidratados', { className: 'tag' }) }).addTo(groups.crism);
  state.allLive = demLive && trav.live && crism.live;
  state.ready = true;
  emit('ready', state);
  setGoalPoi(DEFAULT_GOAL);
  setInterval(pollTelemetry, 5000);
}

const api = {
  $, cssv, on, emit, throttle, start, state, POIS, BASE, KIND, LIM, LAYERS, tileUrl, tileRange, T0, EVA_MAX, NO_LOAD_SLOPE,
  API, link, photoUrl, BOX: { XMIN, XMAX, YMIN, YMAX }, R_MARS,
  setStatus, setView, drawRoute, setGoalPoi, setGoalLL, pick, readout, nearPoi, layerState, openTruth, poiTruth, targetTruth,
  heightAt, slopeAt, cellLL, cellOf, metersBetween, bearing, simAt, slopeRuns, SLOPE_COL, fmtKm, fmtMin, clock, num,
  traverse: null, crism: null, roverRuns: null, slopeURL: null, pano: null
};
return api;
})();
