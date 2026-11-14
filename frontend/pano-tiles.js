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

  /* Blocos de uma esfera (equirretangular) no nível 1 */
  function sphereTiles(cube) {
    if (!cube || !cube.sphere) return [];
    const cols = Math.ceil(cube.w / TILE), rows = Math.ceil(cube.h / TILE), pad = x => String(x).padStart(3, '0'), out = [];
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) out.push({ row: r, col: c, path: `l1/${pad(r)}/l1_${pad(r)}_${pad(c)}.jpg` });
    return out;
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

  return { TILE, FACES, isSynthetic, pickCube, cubeTiles, sphereTiles, summarize, tileUrl };
});
