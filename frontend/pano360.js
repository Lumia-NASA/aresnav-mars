/* Visor 360° dentro do MarsView, para os panoramas do WebGIS de Jezero da FU Berlin
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
  <p class="p360-hint">Arraste para olhar em volta · roda do mouse aproxima · Esc fecha · Panorama: <span id="p360Src"></span><span id="p360Hd"></span></p>`;
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
  clearTimeout(hdTimer); hdTimer = setTimeout(hdUpdate, 140);   // quando o olhar para, busca os blocos mais nítidos do que está na tela
}

/* ---------- nitidez sob demanda ----------
   O nível base cobre o panorama inteiro. Acima dele, a FU Berlin tem faces de até ~9500 px (às vezes ~30000):
   baixar tudo seria centenas de MB, então só entram os blocos de 512 px que estão na tela, no nível que a tela pede.
   Falha de um bloco nítido não muda o estado do panorama: o nível base continua embaixo. */
const HD_MAX = 260;
let hdTimer = null, hd = { cube: null, tiles: new Map(), bad: new Set(), token: 0 };
const hdDpr = () => Math.min(window.devicePixelRatio || 1, 2);
function hdReset(cube) { clearTimeout(hdTimer); hd = { cube: cube && !cube.sphere && cube.sizes ? cube : null, tiles: new Map(), bad: new Set(), token: buildToken }; }
function minFov() {   // deixa aproximar até 1 pixel da foto = 1 pixel da tela
  const c = hd.cube; if (!c) return 35;
  return Math.max(6, Math.min(35, 90 * stage.clientWidth * hdDpr() / P.maxSize(c)));
}
function hdUpdate() {
  const c = hd.cube;
  if (!c || box.hidden || hd.token !== buildToken || typeof DOMMatrix === 'undefined') return;
  const w = stage.clientWidth, h = stage.clientHeight, p = (w / 2) / Math.tan(view.fov * Math.PI / 360);
  const lvl = P.hdLevel(c, 2 * p * hdDpr() * 1.4);   // folga de 40%: a perspectiva estica as bordas da tela
  hdNote(lvl ? c.sizes[lvl - 1] : c.size);
  if (!lvl) return;
  const g = P.levelGrid(c, lvl), R = new DOMMatrix(`rotateX(${view.pitch}deg) rotateY(${view.yaw}deg)`), mx = w / 2 + 260, my = h / 2 + 260, seen = new Set(), want = [];
  const faceEls = cubeEl.querySelectorAll('.p360-face');
  FACES.forEach((f, fi) => {
    const M = R.multiply(new DOMMatrix(PLACE[f]));
    const vis = (x, y) => { const q = M.transformPoint(new DOMPoint(x, y, 0)); if (q.z > -1) return false; const k = p / -q.z; return Math.abs(q.x * k) < mx && Math.abs(q.y * k) < my; };
    for (let v = 1; v <= g.n; v++) for (let hh = 1; hh <= g.n; hh++) {
      const r = g.rect(v, hh), x0 = r.x0 * 1024 - 512, x1 = r.x1 * 1024 - 512, y0 = r.y0 * 1024 - 512, y1 = r.y1 * 1024 - 512;
      if (!(vis((x0 + x1) / 2, (y0 + y1) / 2) || vis(x0, y0) || vis(x1, y0) || vis(x0, y1) || vis(x1, y1))) continue;
      const key = `${lvl}/${f}/${v}/${hh}`; seen.add(key);
      if (!hd.tiles.has(key) && !hd.bad.has(key)) want.push({ key, f, fi, v, hh, r });
    }
  });
  if (hd.tiles.size + want.length > HD_MAX) for (const [key, el] of hd.tiles) {   // descarta primeiro o que saiu da tela
    if (hd.tiles.size + want.length <= HD_MAX) break;
    if (!seen.has(key)) { el.remove(); hd.tiles.delete(key); }
  }
  const token = buildToken;
  want.forEach(t => {
    const el = document.createElement('div'); el.className = 'p360-hdt';
    el.style.cssText = `left:${t.r.x0 * 100}%;top:${t.r.y0 * 100}%;width:${(t.r.x1 - t.r.x0) * 100}%;height:${(t.r.y1 - t.r.y0) * 100}%;z-index:${lvl}`;
    hd.tiles.set(t.key, el);
    const wasOffline = offline();
    const show = src => { if (token !== buildToken || hd.tiles.get(t.key) !== el || !faceEls[t.fi]) return; el.style.backgroundImage = `url('${src}')`; faceEls[t.fi].appendChild(el); requestAnimationFrame(() => { el.style.opacity = 1; }); };
    const fail = () => { if (token !== buildToken) return; hd.tiles.delete(t.key); if (!wasOffline) hd.bad.add(t.key); };   // sem enlace o bloco só não estava no cache: tenta de novo quando o olhar mexer
    if (c.sph) { sphereTile(c, g, t).then(src => (src ? show(src) : fail()), fail); return; }
    const src = url(c.folder, g.path(t.f, t.v, t.hh)), img = new Image();
    img.onload = () => show(src); img.onerror = fail; img.src = src;
  });
}
/* Panorama esférico: o bloco nítido de uma face é reprojetado aqui, só a partir dos blocos da esfera que ele usa */
const sphCache = new Map();   // bloco da esfera já decodificado (no máximo 90)
function sphSrc(c0, lvl, row, col) {
  const key = `${c0.folder}/${lvl}/${row}/${col}`, pad = x => String(x).padStart(3, '0');
  if (!sphCache.has(key)) {
    if (sphCache.size >= 90) sphCache.delete(sphCache.keys().next().value);
    sphCache.set(key, loadImg(url(c0.folder, `l${lvl}/${pad(row)}/l${lvl}_${pad(row)}_${pad(col)}.jpg`)).then(img => {
      if (!img) { sphCache.delete(key); return null; }
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, cv.width, cv.height);
    }));
  }
  return sphCache.get(key);
}
async function sphereTile(c, g, t) {
  const [W, H] = c.sph.levels[g.lvl - 1], S = g.size, T = P.TILE;
  const w = Math.max(1, Math.round((t.r.x1 - t.r.x0) * S)), h = Math.max(1, Math.round((t.r.y1 - t.r.y0) * S));
  const sx = new Int32Array(w * h), sy = new Int32Array(w * h), need = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [dx, dy, dz] = FACE_DIR[t.f](2 * (t.r.x0 + (x + 0.5) / S) - 1, 2 * (t.r.y0 + (y + 0.5) / S) - 1);
    const lon = Math.atan2(dx, dz), lat = Math.atan2(dy, Math.hypot(dx, dz));
    const X = Math.min(W - 1, Math.floor((lon / (2 * Math.PI) + 0.5) * W)), Y = Math.min(H - 1, Math.floor((0.5 - lat / Math.PI) * H)), k = y * w + x;
    sx[k] = X; sy[k] = Y; need.add(Math.floor(Y / T) * 1000 + Math.floor(X / T));
  }
  if (need.size > 36) return null;   // perto dos polos um bloco da face pede a esfera quase inteira: fica no nível base
  const src = new Map();
  await Promise.all([...need].map(async k => { src.set(k, await sphSrc(c.sph, g.lvl, Math.floor(k / 1000) + 1, (k % 1000) + 1)); }));
  if ([...src.values()].some(v => !v)) return null;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cg = cv.getContext('2d'), out = cg.createImageData(w, h), d = out.data;
  for (let k = 0; k < w * h; k++) {
    const td = src.get(Math.floor(sy[k] / T) * 1000 + Math.floor(sx[k] / T));
    const si = (Math.min(td.height - 1, sy[k] % T) * td.width + Math.min(td.width - 1, sx[k] % T)) * 4, di = k * 4;
    d[di] = td.data[si]; d[di + 1] = td.data[si + 1]; d[di + 2] = td.data[si + 2]; d[di + 3] = 255;
  }
  cg.putImageData(out, 0, 0);
  return cv.toDataURL('image/jpeg', 0.92);
}
function hdNote(px) {
  const el = $('#p360Hd'); if (!el) return;
  el.textContent = cur && hd.cube ? ` · ${tr('Detalhe')}: ${px} px ${tr('por face')}${px < P.maxSize(hd.cube) ? ` · ${tr('aproxime para mais nitidez')}` : ''}` : '';
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
async function sphereFaces(c0, token) {
  /* nível da esfera: ~5900 px de largura em tela grande, ~3000 px em tela pequena (a reprojeção roda aqui, na memória do aparelho) */
  const big = window.matchMedia && window.matchMedia('(min-width: 900px)').matches && (navigator.deviceMemory || 8) >= 4;
  const lv = P.sphereLevel(c0, big ? 6000 : 3100), sz = P.sphereSize(c0, lv), c = { folder: c0.folder, w: sz.w, h: sz.h };
  const parts = P.sphereTiles(c0, lv), cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
  load = { total: parts.length, loaded: 0, failed: 0 }; status(token);
  const tiles = await Promise.all(parts.map(t => loadImg(url(c.folder, t.path)).then(img => { if (token === buildToken) { img ? load.loaded++ : load.failed++; status(token); } return img; })));
  if (token !== buildToken || tiles.some(t => !t)) return null;
  const g = cv.getContext('2d');
  tiles.forEach((t, k) => g.drawImage(t, (parts[k].col - 1) * P.TILE, (parts[k].row - 1) * P.TILE));
  const src = g.getImageData(0, 0, c.w, c.h).data, N = Math.max(512, Math.min(1536, Math.ceil(c.w / 4 / 256) * 256)), out = {};   // a face cobre 90°, um quarto da largura
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
  /* daqui para cima, a nitidez vem sob demanda: "cubo virtual" com face = um quarto da largura de cada nível da esfera */
  if (c0.levels) out.hd = { folder: c0.folder, lvl: lv, size: N, sizes: c0.levels.map(L => Math.ceil(L[0] / 4)), sph: c0 };
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
  const token = ++buildToken; clearTimeout(slowTimer); hdReset(cube); hdNote(cube.size);
  if (cube.sphere) {   // prévia já, faces reprojetadas quando os blocos chegarem
    faces(cube, false); startSlowTimer(token);
    sphereFaces(cube, token).then(fs => {
      if (!fs || token !== buildToken) return;
      cubeEl.querySelectorAll('.p360-face').forEach((el, k) => { el.style.backgroundImage = `url('${fs[FACES[k]]}')`; el.style.backgroundSize = '100% 100%'; el.style.backgroundPosition = '0 0'; });
      if (fs.hd) { hd.cube = fs.hd; hdUpdate(); }
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
  box.hidden = true; buildToken++; clearTimeout(slowTimer); hdReset(null); cubeEl.innerHTML = ''; cur = null;
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
stage.addEventListener('wheel', e => { e.preventDefault(); view.fov = Math.max(minFov(), Math.min(120, view.fov * Math.exp(e.deltaY * 0.001))); render(); }, { passive: false });
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
A.pano360 = { open, close, get view() { return view; }, get load() { return P.summarize(load); }, get hd() { return { tiles: hd.tiles.size, failed: hd.bad.size, max: hd.cube ? P.maxSize(hd.cube) : 0 }; } };
})();
