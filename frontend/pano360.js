/* Visor 360° dentro do AresNav, para os panoramas do WebGIS de Jezero da FU Berlin
   (fotos reais da Mastcam-Z e vistas sintéticas renderizadas do relevo).
   O panorama é um cubo (6 faces) montado com CSS 3D, sem biblioteca: primeiro a prévia de 256 px de cada face,
   depois os blocos de 512 px. Panoramas esféricos são reprojetados em cubo num canvas.
   O visor mostra o progresso, avisa quando faltam blocos (a área borrada é a prévia, não a cena completa),
   tem "Tentar de novo", funciona com o enlace fora (só o que estiver em cache) e cuida do foco do teclado.
   Arraste para olhar em volta, roda do mouse aproxima, setas giram, Esc fecha. */
(function () {
'use strict';
const A = App, $ = A.$, P = PanoTiles, tr = s => (window.T ? window.T(s) : s);
const FACES = P.FACES;
const PREVIEW_ROW = { l: 0, f: 1, r: 2, b: 3, u: 4, d: 5 };   // ordem das faces na tira de prévia do krpano
const Z = 'translateZ(-510.5px)';   // um pixel e meio para dentro: as faces se sobrepõem e a emenda some
const PLACE = { f: Z, r: 'rotateY(-90deg) ' + Z, b: 'rotateY(180deg) ' + Z, l: 'rotateY(90deg) ' + Z, u: 'rotateX(-90deg) ' + Z, d: 'rotateX(90deg) ' + Z };
const SLOW_MS = 12000;

const box = document.createElement('div');
box.className = 'pano360'; box.hidden = true; box.tabIndex = -1;
box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'p360Name');
box.innerHTML = `<div class="p360-stage" id="p360Stage" aria-hidden="true"><div class="p360-cube" id="p360Cube"></div></div>
  <header class="p360-bar"><div><span class="p360-kind" id="p360Kind"></span><b id="p360Name"></b><small id="p360Credit"></small></div>
    <div class="p360-actions"><button id="p360Natural" aria-pressed="false">Cor natural</button><button id="p360Enh" aria-pressed="true">Realce de minerais</button><button id="p360Close" aria-label="Fechar">✕</button></div></header>
  <div class="p360-status" id="p360Status" role="status" aria-live="polite"><span id="p360Msg"></span><button id="p360Retry" hidden>Tentar de novo</button></div>
  <p class="p360-hint">Arraste para olhar em volta · roda do mouse aproxima · Esc fecha · Panorama: <span id="p360Src"></span></p>`;
document.body.appendChild(box);
const stage = $('#p360Stage'), cubeEl = $('#p360Cube');
let view = { yaw: 0, pitch: 0, fov: 100 }, cur = null, variant = 'enh', opener = null, buildToken = 0, slowTimer = null, retries = 0;
let load = { total: 0, loaded: 0, failed: 0 };
const offline = () => !!A.state.forceOffline || A.state.linkState !== 'online';
const url = (folder, path) => P.tileUrl(A.API, folder, path, { offline: offline(), retry: retries });

function render() {
  const w = stage.clientWidth, h = stage.clientHeight, p = (w / 2) / Math.tan(view.fov * Math.PI / 360);
  stage.style.perspective = p + 'px';
  cubeEl.style.transform = `translate(${w / 2}px, ${h / 2}px) translateZ(${p}px) rotateX(${view.pitch}deg) rotateY(${view.yaw}deg)`;   // yaw positivo = virar para a direita (conferido face a face)
}

/* ---------- estado do carregamento ---------- */
function status(token) {
  if (token !== buildToken) return;   // troca rápida de panorama: ignora respostas do anterior
  const s = P.summarize(load), msg = $('#p360Msg'), bar = $('#p360Status');
  bar.dataset.state = s.state;
  $('#p360Retry').hidden = !(s.state === 'partial' || s.state === 'failed');
  if (s.state === 'loading') msg.textContent = `${tr('Carregando panorama')}… ${s.loaded}/${s.total} ${tr('blocos')}`;
  else if (s.state === 'complete' || s.state === 'preview') msg.textContent = s.state === 'preview' ? tr('Só a prévia em baixa resolução está disponível para este panorama.') : '';
  else if (s.state === 'partial') msg.textContent = `${s.failed} ${tr('de')} ${s.total} ${tr('blocos não carregaram: as áreas borradas são a prévia em baixa resolução, não a cena completa.')}`;
  else msg.textContent = offline() ? tr('Panorama indisponível offline: ele ainda não foi aberto, então não está no cache do habitat.') : tr('Os blocos não carregaram. O que aparece é só a prévia em baixa resolução (ou nada).');
  if (s.state !== 'loading') clearTimeout(slowTimer);
}
function startSlowTimer(token) {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { if (token === buildToken && P.summarize(load).state === 'loading') $('#p360Msg').textContent += ` · ${tr('conexão lenta: mostrando a prévia enquanto carrega')}`; }, SLOW_MS);
}

/* ---------- esfera -> cubo ---------- */
const FACE_DIR = { f: (u, v) => [u, -v, 1], r: (u, v) => [1, -v, -u], b: (u, v) => [-u, -v, -1], l: (u, v) => [-1, -v, u], u: (u, v) => [u, 1, v], d: (u, v) => [u, -1, -v] };
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function sphereFaces(c, token) {
  const parts = P.sphereTiles(c), cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
  load = { total: parts.length, loaded: 0, failed: 0 }; status(token);
  const tiles = await Promise.all(parts.map(t => loadImg(url(c.folder, t.path)).then(img => { if (token === buildToken) { img ? load.loaded++ : load.failed++; status(token); } return img; })));
  if (token !== buildToken || tiles.some(t => !t)) return null;
  const g = cv.getContext('2d');
  tiles.forEach((t, k) => g.drawImage(t, (parts[k].col - 1) * P.TILE, (parts[k].row - 1) * P.TILE));
  const src = g.getImageData(0, 0, c.w, c.h).data, N = 512, out = {};
  for (const f of FACES) {
    const fc = document.createElement('canvas'); fc.width = fc.height = N;
    const fg = fc.getContext('2d'), img = fg.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [dx, dy, dz] = FACE_DIR[f]((2 * x + 1) / N - 1, (2 * y + 1) / N - 1);
      const lon = Math.atan2(dx, dz), lat = Math.atan2(dy, Math.hypot(dx, dz));
      const sx = Math.min(c.w - 1, Math.floor((lon / (2 * Math.PI) + 0.5) * c.w)), sy = Math.min(c.h - 1, Math.floor((0.5 - lat / Math.PI) * c.h));
      const si = (sy * c.w + sx) * 4, di = (y * N + x) * 4;
      d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2]; d[di + 3] = 255;
    }
    fg.putImageData(img, 0, 0); out[f] = fc.toDataURL('image/jpeg', 0.9);
  }
  return out;
}

/* ---------- monta o cubo ---------- */
function faces(cube, withTiles) {
  const t = withTiles ? P.cubeTiles(cube) : { n: 0, fractions: [], tiles: [] }, cols = t.fractions.map(x => x + '%').join(' ') || '100%';
  const byFace = {}; t.tiles.forEach(x => { (byFace[x.face] = byFace[x.face] || []).push(x); });
  cubeEl.innerHTML = FACES.map(f => `<div class="p360-face" style="transform:${PLACE[f]};background-image:url('${url(cube.folder, 'preview.jpg')}');background-position:0 ${PREVIEW_ROW[f] * 20}%;grid-template-columns:${cols};grid-template-rows:${cols}">` +
    (byFace[f] || []).map(x => `<img alt="" draggable="false" src="${url(cube.folder, x.path)}">`).join('') + '</div>').join('');
  return t;
}
function build(cube) {
  const token = ++buildToken; clearTimeout(slowTimer);
  if (cube.sphere) {   // prévia já, faces reprojetadas quando os blocos chegarem
    faces(cube, false); startSlowTimer(token);
    sphereFaces(cube, token).then(fs => {
      if (!fs || token !== buildToken) return;
      cubeEl.querySelectorAll('.p360-face').forEach((el, k) => { el.style.backgroundImage = `url('${fs[FACES[k]]}')`; el.style.backgroundSize = '100% 100%'; el.style.backgroundPosition = '0 0'; });
    });
    return;
  }
  const t = faces(cube, true);
  load = { total: t.tiles.length, loaded: 0, failed: 0 }; status(token); startSlowTimer(token);
  cubeEl.querySelectorAll('img').forEach(img => {
    const done = ok => { if (token !== buildToken) return; ok ? load.loaded++ : load.failed++; if (!ok) img.style.visibility = 'hidden'; status(token); };
    if (img.complete && img.naturalWidth) done(true); else { img.onload = () => done(true); img.onerror = () => done(false); }
  });
}
function show() {
  if (!cur) return;
  const pick = P.pickCube(cur, variant);
  $('#p360Natural').disabled = !pick.naturalAvailable;
  $('#p360Natural').title = pick.naturalAvailable ? '' : tr('Este panorama não tem versão em cor natural');
  $('#p360Natural').setAttribute('aria-pressed', pick.useNatural);
  $('#p360Enh').setAttribute('aria-pressed', !pick.useNatural);
  build(pick.cube); render();
}

/* ---------- abrir, fechar e foco ---------- */
function open(p) {
  opener = document.activeElement;
  cur = p; variant = p.cube_natural ? 'nat' : 'enh'; view = { yaw: 0, pitch: 0, fov: 100 }; retries = 0;
  const syn = P.isSynthetic(p);
  $('#p360Kind').textContent = syn ? tr('VISTA SINTÉTICA · renderizada do relevo, não é foto') : tr('FOTO REAL · Perseverance Mastcam-Z');
  $('#p360Kind').dataset.kind = syn ? 'syn' : 'real';
  $('#p360Name').textContent = p.name || 'Panorama';
  $('#p360Credit').textContent = syn ? `${tr('Modelo de relevo')} ${p.credits || 'HiRISE/CTX/HRSC'} · ${tr('renderização')}: FU Berlin` : `${p.credits || 'NASA/JPL-Caltech/ASU/MSSS'} · ${tr('montagem')}: FU Berlin`;
  const a = document.createElement('a'); a.href = `https://maps.planet.fu-berlin.de/jezero/360/${encodeURIComponent(p.pano_id)}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `FU Berlin #${p.pano_id}`;
  $('#p360Src').replaceChildren(a);
  box.hidden = false; show();
  $('#p360Close').focus();
  A.setStatus(syn ? 'panosyn' : 'pano360', offline() ? 'fb' : 'ok');
}
function close() {
  if (box.hidden) return;
  box.hidden = true; buildToken++; clearTimeout(slowTimer); cubeEl.innerHTML = ''; cur = null;
  if (opener && document.contains(opener) && opener.focus) opener.focus();   // devolve o foco para quem abriu
  opener = null;
}
$('#p360Close').onclick = close;
$('#p360Natural').onclick = () => { variant = 'nat'; retries = 0; show(); };
$('#p360Enh').onclick = () => { variant = 'enh'; retries = 0; show(); };
$('#p360Retry').onclick = () => { retries++; show(); };

/* olhar em volta: arrastar, roda do mouse, teclado */
let drag = null;
stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', e => {
  if (!drag) return;
  const k = view.fov / stage.clientWidth;
  view.yaw = drag.yaw - (e.clientX - drag.x) * k; view.pitch = Math.max(-89, Math.min(89, drag.pitch + (e.clientY - drag.y) * k)); render();
});
stage.addEventListener('pointerup', () => { drag = null; });
stage.addEventListener('wheel', e => { e.preventDefault(); view.fov = Math.max(35, Math.min(120, view.fov * Math.exp(e.deltaY * 0.001))); render(); }, { passive: false });
window.addEventListener('keydown', e => {
  if (box.hidden) return;
  if (e.key === 'Escape') { close(); return; }
  if (e.key === 'Tab') {   // o foco fica dentro do visor enquanto ele está aberto
    const items = [...box.querySelectorAll('button:not([disabled]):not([hidden]), a[href]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement), next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    items[next].focus(); e.preventDefault(); return;
  }
  if (/BUTTON|A/.test(document.activeElement && document.activeElement.tagName) && (e.key === 'Enter' || e.key === ' ')) return;
  const step = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
  if (step) { view.yaw += step[0]; view.pitch = Math.max(-89, Math.min(89, view.pitch + step[1])); render(); e.preventDefault(); }
});
window.addEventListener('resize', () => { if (!box.hidden) render(); });
A.pano360 = { open, close, get view() { return view; }, get load() { return P.summarize(load); } };
})();
