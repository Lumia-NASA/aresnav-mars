/* Casca da interface: mapa em tela cheia com painéis flutuantes.
   Cuida do que é só de layout: recolher painéis, busca de lugares, controles do mapa
   (capacete, 2D/3D, norte, zoom), troca rápida da imagem de fundo, gaveta de dados e barra de estado. */
(function () {
'use strict';
const A = App, $ = A.$;
const body = document.body;

/* ---------- painéis laterais ---------- */
function setSide(side, open) {
  body.classList.toggle(side + '-collapsed', !open);
  const b = $('#' + side + 'Toggle');
  b.setAttribute('aria-expanded', open);
  b.textContent = (side === 'left') === open ? '‹' : '›';
  setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
}
['left', 'right'].forEach(side => { $('#' + side + 'Toggle').onclick = () => setSide(side, body.classList.contains(side + '-collapsed')); });
if (window.innerWidth < 1100) { setSide('left', false); if (window.innerWidth < 800) setSide('right', false); }

/* ---------- modo atual no <body>, para o CSS esconder o que não faz sentido em cada tela ---------- */
A.on('view', v => {
  body.dataset.view = v;
  $('#btnTele').setAttribute('aria-pressed', v === 'telemetry');
  const three = A.state.plannerView !== 'map';
  $('#ctl3d').textContent = three ? '3D' : '2D'; $('#ctl3d').setAttribute('aria-pressed', three);
});
let mapView = 'globe';
$('#ctl3d').onclick = () => { mapView = A.state.view === 'globe' ? 'map' : 'globe'; A.setView(mapView); };
$('#btnTele').onclick = () => A.setView(A.state.view === 'telemetry' ? mapView : 'telemetry');
/* Bonequinho: 1º clique arma o "soltar"; aí é só clicar em qualquer ponto de Marte.
   Clicar de novo no bonequinho entra no capacete onde o astronauta da missão está. */
$('#ctlHelmet').onclick = () => {
  if (A.state.dropMode) { A.setDropMode(false); A.setView('helmet'); return; }
  if (A.state.view !== 'globe' && A.state.view !== 'map') A.setView(mapView);
  A.setDropMode(true);
};
A.on('drop', on => { $('#dropHint').hidden = !on; $('#ctlHelmet').setAttribute('aria-pressed', on); });
A.on('view', v => { if (v !== 'globe' && v !== 'map' && A.state.dropMode) A.setDropMode(false); });
/* Exagero vertical do relevo: 1× é a escala real */
$('#ctlEx').onclick = () => { const v = A.globe.setExaggeration(A.globe.exaggeration === 1 ? 2.5 : 1); $('#ctlEx').textContent = v === 1 ? '1×' : A.num(v, 1) + '×'; $('#ctlEx').setAttribute('aria-pressed', v !== 1); };
A.on('view', v => { if (v === 'globe' || v === 'map') mapView = v; });

/* ---------- zoom e norte ---------- */
const onMap = () => A.state.view === 'map';
$('#ctlIn').onclick = () => onMap() ? A.map.zoomIn(1) : A.globe.zoom(0.5);
$('#ctlOut').onclick = () => onMap() ? A.map.zoomOut(1) : A.globe.zoom(2);
$('#ctlNorth').onclick = () => { if (!onMap()) A.globe.north(); };

/* ---------- troca rápida da imagem de fundo ---------- */
const BASE_LABEL = { fub: 'Cor natural', hirise: 'HiRISE', mosaic: 'Mosaico', relief: 'Relevo' };
function syncBase() {
  const v = document.querySelector('input[name="base"]:checked').value;
  $('#basePickLabel').textContent = BASE_LABEL[v]; $('#basePick').dataset.base = v;
}
$('#basePick').onclick = () => {
  const radios = [...document.querySelectorAll('input[name="base"]')], i = radios.findIndex(r => r.checked);
  const next = radios[(i + 1) % radios.length]; next.checked = true; next.dispatchEvent(new Event('change', { bubbles: true }));
};
A.on('layers', syncBase);

/* ---------- idioma ---------- */
$('#langBtn').textContent = window.LANG === 'en' ? 'Português' : 'English';
$('#langBtn').onclick = () => window.setLang(window.LANG === 'en' ? 'pt' : 'en');
document.title = 'AresNav · ' + T('Trilha Jezero');

/* ---------- gaveta de dados ---------- */
const drawer = $('#dataDrawer');
function setDrawer(open) { drawer.hidden = !open; $('#btnData').setAttribute('aria-pressed', open); }
$('#btnData').onclick = () => setDrawer(drawer.hidden);
$('#dataClose').onclick = () => setDrawer(false);

/* ---------- busca de lugares em Marte ---------- */
const PLACES = [
  ['Cratera Jezero', 18.44, 77.45, 60, 'Local de pouso do Perseverance'],
  ['Olympus Mons', 18.65, -133.8, 900, 'Maior vulcão do Sistema Solar'],
  ['Valles Marineris', -13.9, -59.2, 1500, 'Sistema de cânions'],
  ['Cratera Gale', -4.59, 137.44, 200, 'Local de pouso do Curiosity'],
  ['Cratera Gusev', -14.57, 175.47, 220, 'Local de pouso do Spirit'],
  ['Meridiani Planum', -1.95, -5.53, 300, 'Local de pouso do Opportunity'],
  ['Elysium Planitia', 4.5, 135.62, 400, 'Local de pouso do InSight'],
  ['Chryse Planitia', 22.27, -47.95, 500, 'Local de pouso da Viking 1'],
  ['Utopia Planitia', 47.64, -134.29, 600, 'Local de pouso da Viking 2'],
  ['Hellas Planitia', -42.4, 70.5, 2500, 'Maior bacia de impacto visível'],
  ['Tharsis Montes', 1.57, -112.58, 1800, 'Cadeia de vulcões'],
  ['Elysium Mons', 25.02, 147.21, 700, 'Vulcão'],
  ['Syrtis Major', 8.4, 69.5, 1500, 'Planalto escuro ao lado de Jezero'],
  ['Calota polar norte', 86, 0, 2200, 'Planum Boreum'],
  ['Calota polar sul', -86, 0, 2200, 'Planum Australe']
];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const input = $('#search'), list = $('#searchResults');
let hits = [];
function runSearch() {
  const q = norm(input.value.trim());
  hits = [];
  if (q) {
    A.POIS.forEach(p => { if (norm(T(p.n)).includes(q) || norm(p.n).includes(q)) hits.push({ n: T(p.n), sub: p.src, lat: p.lat, lon: p.lon, range: 4, poi: p }); });
    PLACES.forEach(([n, lat, lon, range, sub]) => { if (norm(T(n)).includes(q) || norm(n).includes(q)) hits.push({ n: T(n), sub, lat, lon, range }); });
    const m = /^\s*(-?\d+(?:[.,]\d+)?)[\s,;]+(-?\d+(?:[.,]\d+)?)\s*$/.exec(input.value);   // "lat, lon"
    if (m) { const lat = parseFloat(m[1].replace(',', '.')), lon = parseFloat(m[2].replace(',', '.')); if (Math.abs(lat) <= 90 && Math.abs(lon) <= 360) hits.unshift({ n: `${lat}° N, ${lon}° L`, sub: 'Coordenadas', lat, lon: lon > 180 ? lon - 360 : lon, range: 40 }); }
  }
  list.hidden = !q;
  list.innerHTML = hits.length ? hits.slice(0, 8).map((h, i) => `<li><button data-i="${i}"><b></b><small></small></button></li>`).join('') : '<li class="none">Nada encontrado. Tente "Olympus", "Gale" ou "18.45, 77.40".</li>';
  list.querySelectorAll('button').forEach((b, i) => { b.querySelector('b').textContent = hits[i].n; b.querySelector('small').textContent = hits[i].sub; });
}
function go(h) {
  list.hidden = true; input.value = h.n; input.blur();
  if (A.state.view !== 'globe' && A.state.view !== 'map') A.setView(mapView);
  if (onMap()) A.map.flyTo([h.lat, h.lon], h.range <= 10 ? 15 : h.range <= 100 ? 11 : h.range <= 700 ? 7 : 5);
  else A.globe.flyTo(h.lat, h.lon, h.range);
  if (h.poi && h.poi.k !== 'base') setTimeout(() => A.openTruth(A.poiTruth(h.poi)), 900);
}
input.addEventListener('input', runSearch);
input.addEventListener('focus', runSearch);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && hits[0]) go(hits[0]); if (e.key === 'Escape') { list.hidden = true; input.blur(); } });
list.addEventListener('mousedown', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); go(hits[+b.dataset.i]); } });
document.addEventListener('mousedown', e => { if (!e.target.closest('.search')) list.hidden = true; });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { setDrawer(false); if (A.state.dropMode) A.setDropMode(false); }
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); input.focus(); }
});

/* ---------- barra de estado: altitude da câmera e agulha do norte ---------- */
const fmtAlt = km => km >= 100 ? Math.round(km).toLocaleString(LOC) + ' km' : km >= 1 ? km.toLocaleString(LOC, { maximumFractionDigits: 1 }) + ' km' : Math.round(km * 1000) + ' m';
setInterval(() => {
  const el = $('#camInfo');
  if (A.state.view === 'globe') { const c = A.globe.cam(); if (c) { el.textContent = 'Câmera: ' + fmtAlt(c.km); $('#ctlNeedle').style.transform = `rotate(${-c.heading}deg)`; } }
  else if (A.state.view === 'map' && A.map) { el.textContent = 'Zoom ' + A.map.getZoom().toLocaleString(LOC); $('#ctlNeedle').style.transform = ''; }
  else el.textContent = '';
}, 500);
})();
