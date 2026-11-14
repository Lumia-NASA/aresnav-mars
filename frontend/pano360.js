/* Visor 360° dentro do AresNav, para os panoramas Mastcam-Z do WebGIS de Jezero da FU Berlin.
   O panorama é um cubo (6 faces). O visor monta o cubo com CSS 3D (sem biblioteca e sem WebGL extra):
   primeiro a prévia de 256 px de cada face, depois as faces em 1024 px (2 x 2 blocos), tudo pelo backend.
   Arraste para olhar em volta, roda do mouse para aproximar, setas também giram. */
(function () {
'use strict';
const A = App, $ = A.$, tr = s => (window.T ? window.T(s) : s);
const FACES = ['f', 'r', 'b', 'l', 'u', 'd'];
const PREVIEW_ROW = { l: 0, f: 1, r: 2, b: 3, u: 4, d: 5 };   // ordem das faces na tira de prévia do krpano
const Z = 'translateZ(-510.5px)';   // um pixel e meio para dentro: as faces se sobrepõem e a emenda some
const PLACE = { f: Z, r: 'rotateY(-90deg) ' + Z, b: 'rotateY(180deg) ' + Z, l: 'rotateY(90deg) ' + Z, u: 'rotateX(-90deg) ' + Z, d: 'rotateX(90deg) ' + Z };

const box = document.createElement('div');
box.className = 'pano360'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Panorama 360°');
box.innerHTML = `<div class="p360-stage" id="p360Stage"><div class="p360-cube" id="p360Cube"></div></div>
  <header class="p360-bar"><div><b id="p360Name"></b><small id="p360Credit"></small></div>
    <div class="p360-actions"><button id="p360Natural" aria-pressed="false">Cor natural</button><button id="p360Enh" aria-pressed="true">Realce de minerais</button><button id="p360Close" aria-label="Fechar">✕</button></div></header>
  <p class="p360-hint">Arraste para olhar em volta · roda do mouse aproxima · Esc fecha · Panorama: <span id="p360Src"></span></p>`;
document.body.appendChild(box);
const stage = $('#p360Stage'), cubeEl = $('#p360Cube');
let view = { yaw: 0, pitch: 0, fov: 100 }, cur = null, variant = 'enh';

function render() {
  const w = stage.clientWidth, h = stage.clientHeight, p = (w / 2) / Math.tan(view.fov * Math.PI / 360);
  stage.style.perspective = p + 'px';
  cubeEl.style.transform = `translate(${w / 2}px, ${h / 2}px) translateZ(${p}px) rotateX(${view.pitch}deg) rotateY(${view.yaw}deg)`;   // yaw positivo = virar para a direita (conferido face a face)
}
/* cube: { folder, mono, lvl, size }. A face tem `size` px no nível escolhido, em blocos de 512 px (o último pode ser menor).
   O visor desenha a face em 1024 px; cada bloco ocupa a fração certa. */
/* Panorama esférico (equirretangular): junta os blocos num canvas e reprojeta nas 6 faces do cubo (512 px cada).
   Direção de cada pixel da face -> longitude/latitude -> pixel da imagem esférica. */
const FACE_DIR = { f: (u, v) => [u, -v, 1], r: (u, v) => [1, -v, -u], b: (u, v) => [-u, -v, -1], l: (u, v) => [-1, -v, u], u: (u, v) => [u, 1, v], d: (u, v) => [u, -1, -v] };
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function sphereFaces(base, c, token) {
  const cols = Math.ceil(c.w / 512), rows = Math.ceil(c.h / 512), cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
  const g = cv.getContext('2d'), pad = n => String(n).padStart(3, '0');
  const tiles = await Promise.all(Array.from({ length: rows * cols }, (_, k) => loadImg(`${base}l1/${pad(Math.floor(k / cols) + 1)}/l1_${pad(Math.floor(k / cols) + 1)}_${pad(k % cols + 1)}.jpg`)));
  if (token !== buildToken || tiles.some(t => !t)) return null;
  tiles.forEach((t, k) => g.drawImage(t, (k % cols) * 512, Math.floor(k / cols) * 512));
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
let buildToken = 0;
function build(cube) {
  const token = ++buildToken;
  if (cube.sphere) {   // mostra a prévia já, e troca pelas faces reprojetadas quando ficarem prontas
    build(Object.assign({}, cube, { sphere: false, lvl: 0 })); buildToken = token;
    sphereFaces(`${A.API}/fub/pano/${encodeURIComponent(cube.folder)}/`, cube, token).then(faces => {
      if (!faces || token !== buildToken) return;
      cubeEl.querySelectorAll('.p360-face').forEach((el, k) => { el.style.backgroundImage = `url('${faces[FACES[k]]}')`; el.style.backgroundSize = '100% 100%'; el.style.backgroundPosition = '0 0'; });
    });
    return;
  }
  const base = `${A.API}/fub/pano/${encodeURIComponent(cube.folder)}/`, pad = n => (cube.mono ? String(n) : '0' + n);
  const n = Math.ceil(cube.size / 512), part = k => (k < n ? 512 : cube.size - 512 * (n - 1)) / cube.size * 100;
  const tile = (f, v, h) => cube.mono ? `${f}/l${cube.lvl}/${v}/l${cube.lvl}_${f}_${v}_${h}.jpg` : `1/${f}/l${cube.lvl}/${pad(v)}/l${cube.lvl}_1/${f}_${pad(v)}_${pad(h)}.jpg`;
  const cols = Array.from({ length: n }, (_, k) => part(k + 1) + '%').join(' ');
  cubeEl.innerHTML = FACES.map(f => `<div class="p360-face" style="transform:${PLACE[f]};background-image:url('${base}preview.jpg');background-position:0 ${PREVIEW_ROW[f] * 20}%;grid-template-columns:${cols};grid-template-rows:${cols}">` +
    (cube.lvl ? Array.from({ length: n }, (_, v) => Array.from({ length: n }, (_, h) => `<img alt="" draggable="false" src="${base}${tile(f, v + 1, h + 1)}">`).join('')).join('') : '') + '</div>').join('');
  cubeEl.querySelectorAll('img').forEach(img => { img.onerror = () => { img.style.visibility = 'hidden'; }; });   // sem o bloco, fica a prévia
}
function show() {
  if (!cur) return;
  const p = cur, natural = p.cube_natural, useNat = variant === 'nat' && !!natural;
  const cube = Object.assign({}, useNat ? natural : (p.cube || { folder: String(p.vtour || '').replace(/^scene_/, ''), mono: false, lvl: 0, size: 512 }));   // lvl 0: só a prévia
  $('#p360Natural').disabled = !natural;
  $('#p360Natural').setAttribute('aria-pressed', useNat);
  $('#p360Enh').setAttribute('aria-pressed', !useNat);
  build(cube); render();
}
function open(p) {
  cur = p; variant = p.cube_natural ? 'nat' : 'enh'; view = { yaw: 0, pitch: 0, fov: 100 };
  $('#p360Name').textContent = p.name || 'Panorama';
  $('#p360Credit').textContent = `${tr('Mastcam-Z')} · ${p.credits || 'NASA/JPL-Caltech/ASU/MSSS'} · ${tr('montagem')}: FU Berlin`;
  const a = document.createElement('a'); a.href = `https://maps.planet.fu-berlin.de/jezero/360/${encodeURIComponent(p.pano_id)}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `FU Berlin #${p.pano_id}`;
  $('#p360Src').replaceChildren(a);
  box.hidden = false; show(); box.focus();
}
function close() { box.hidden = true; cubeEl.innerHTML = ''; cur = null; }
$('#p360Close').onclick = close;
$('#p360Natural').onclick = () => { variant = 'nat'; show(); };
$('#p360Enh').onclick = () => { variant = 'enh'; show(); };

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
  if (e.key === 'Escape') close();
  const step = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
  if (step) { view.yaw += step[0]; view.pitch = Math.max(-89, Math.min(89, view.pitch + step[1])); render(); e.preventDefault(); }
});
window.addEventListener('resize', () => { if (!box.hidden) render(); });
A.pano360 = { open, close, get view() { return view; } };
})();
