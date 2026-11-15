/* Lógica pura do visor 360° (sem tela): quais blocos pedir, cor natural x realce e o resumo do carregamento.
   Usada por pano360.js e testada em tests/fub-test.js.
   Formatos do krpano da FU Berlin:
   - cubo estéreo:  1/f/l2/01/l2_1/f_01_02.jpg   (dois dígitos)
   - cubo simples:  f/l2/1/l2_f_1_2.jpg          (sem zeros à esquerda; cenas sintéticas)
   - esfera:        l1/001/l1_001_002.jpg        (equirretangular, três dígitos)
   Blocos de 512 px; o último bloco de cada linha pode ser menor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PanoTiles = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TILE = 512, FACES = ['f', 'r', 'b', 'l', 'u', 'd'];

  /* pano_id negativo = vista sintética renderizada do relevo (não é foto) */
  const isSynthetic = p => Number(p && p.pano_id) < 0;

  /* Escolhe o cubo pela variante pedida. Sem versão natural, cai no realce (e diz isso). */
  function pickCube(p, variant) {
    const naturalAvailable = !!(p && p.cube_natural);
    const useNatural = variant === 'nat' && naturalAvailable;
    const fallback = { folder: String((p && p.vtour) || '').replace(/^scene_/, ''), mono: false, lvl: 0, size: TILE };   // lvl 0: só a prévia
    const cube = Object.assign({}, useNatural ? p.cube_natural : ((p && p.cube) || fallback));
    return { cube, useNatural, naturalAvailable };
  }

  /* Blocos de um cubo: n x n por face; frações de cada coluna (o último bloco pode ser menor) */
  function cubeTiles(cube) {
    if (!cube || !cube.lvl || cube.sphere) return { n: 0, fractions: [], tiles: [] };
    const n = Math.ceil(cube.size / TILE);
    const fractions = Array.from({ length: n }, (_, k) => ((k < n - 1 ? TILE : cube.size - TILE * (n - 1)) / cube.size) * 100);
    const pad = x => (cube.mono ? String(x) : String(x).padStart(2, '0'));
    const tiles = [];
    for (const f of FACES) for (let v = 1; v <= n; v++) for (let h = 1; h <= n; h++) {
      tiles.push({ face: f, v, h, path: cube.mono ? `${f}/l${cube.lvl}/${v}/l${cube.lvl}_${f}_${v}_${h}.jpg` : `1/${f}/l${cube.lvl}/${pad(v)}/l${cube.lvl}_1/${f}_${pad(v)}_${pad(h)}.jpg` });
    }
    return { n, fractions, tiles };
  }

  /* Blocos de uma esfera (equirretangular). Sem `lvl`, o nível 1; com `lvl`, usa cube.levels ([[w, h], ...]) */
  function sphereSize(cube, lvl) {
    const L = cube && cube.levels && lvl ? cube.levels[lvl - 1] : null;
    return L ? { lvl, w: L[0], h: L[1] } : { lvl: 1, w: cube.w, h: cube.h };
  }
  function sphereTiles(cube, lvl) {
    if (!cube || !cube.sphere) return [];
    const s = sphereSize(cube, lvl);
    const cols = Math.ceil(s.w / TILE), rows = Math.ceil(s.h / TILE), pad = x => String(x).padStart(3, '0'), out = [];
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) out.push({ row: r, col: c, path: `l${s.lvl}/${pad(r)}/l${s.lvl}_${pad(r)}_${pad(c)}.jpg` });
    return out;
  }
  /* Nível da esfera a usar: o maior com largura até maxW (a reprojeção roda no navegador) */
  function sphereLevel(cube, maxW) {
    const Ls = (cube && cube.levels) || [];
    let best = 1;
    Ls.forEach((L, i) => { if (L[0] <= maxW) best = i + 1; });
    return best;
  }

  /* ---------- nitidez sob demanda ----------
     cube.sizes = lado da face em cada nível do krpano (ex.: [640, 1152, 2304, 4736, 9472]).
     O nível base (cube.lvl) carrega inteiro; os níveis acima só para os blocos que estão na tela. */
  function hdLevel(cube, needPx) {
    const sizes = (cube && cube.sizes) || [];
    if (!cube || cube.sphere || !cube.lvl || sizes.length <= cube.lvl || needPx <= cube.size) return 0;
    for (let l = cube.lvl + 1; l <= sizes.length; l++) if (sizes[l - 1] >= needPx) return l;
    return sizes.length;
  }
  const maxSize = cube => { const s = (cube && cube.sizes) || []; return s.length ? s[s.length - 1] : ((cube && cube.size) || TILE); };
  /* Grade de um nível: n x n blocos por face; rect devolve a posição do bloco na face, em frações 0..1 */
  function levelGrid(cube, lvl) {
    const size = cube.sizes[lvl - 1], n = Math.ceil(size / TILE);
    const pad = x => (cube.mono ? String(x) : String(x).padStart(2, '0'));
    const edge = k => Math.min(size, k * TILE) / size;
    return {
      lvl, size, n,
      rect: (v, h) => ({ x0: edge(h - 1), x1: edge(h), y0: edge(v - 1), y1: edge(v) }),
      path: (f, v, h) => (cube.mono ? `${f}/l${lvl}/${v}/l${lvl}_${f}_${v}_${h}.jpg` : `1/${f}/l${lvl}/${pad(v)}/l${lvl}_1/${f}_${pad(v)}_${pad(h)}.jpg`)
    };
  }

  /* Resumo do carregamento. state: loading | complete | partial | failed | preview (só prévia) */
  function summarize(s) {
    const total = s.total | 0, loaded = s.loaded | 0, failed = s.failed | 0, pending = Math.max(0, total - loaded - failed);
    let state;
    if (!total) state = 'preview';
    else if (pending) state = 'loading';
    else if (!failed) state = 'complete';
    else if (loaded) state = 'partial';
    else state = 'failed';
    return { state, total, loaded, failed, pending, pct: total ? Math.round(((loaded + failed) / total) * 100) : 100 };
  }

  /* Endereço de um bloco: cache-only quando o enlace está fora (?offline=1) e marca de nova tentativa */
  function tileUrl(base, folder, path, opts) {
    const q = [], o = opts || {};
    if (o.offline) q.push('offline=1');
    if (o.retry) q.push('retry=' + o.retry);
    return `${base}/fub/pano/${encodeURIComponent(folder)}/${path}${q.length ? '?' + q.join('&') : ''}`;
  }

  return { TILE, FACES, isSynthetic, pickCube, cubeTiles, sphereTiles, sphereSize, sphereLevel, hdLevel, maxSize, levelGrid, summarize, tileUrl };
});
