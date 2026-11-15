/* Desvio de 1 m: quando o relevo HiRISE acha um trecho curto acima do limite de declive num pedaço da rota
   (que foi traçada na grade de 200 m), procura um contorno entre as duas pontas desse pedaço.
   Busca A* numa grade de `stepM` metros (5 m: a mesma base do corredor de 1 m) numa faixa em volta da reta a-b.
   Um passo da grade só vale se o declive dele ficar abaixo do limite (com uma folga); o custo é o mesmo da rota
   segura (distância x (1 + (declive/4)^2)). Funções puras, usadas pelo app e testadas em tests/detour-test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Detour = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const R = 3396190, RAD = Math.PI / 180;

  /* plano local em metros com origem em `o` ([lat, lon]): x para leste, y para norte */
  function frame(o) {
    const mLat = R * RAD, mLon = R * RAD * Math.cos(o[0] * RAD);
    return { toXY: p => [(p[1] - o[1]) * mLon, (p[0] - o[0]) * mLat], toLL: (x, y) => [o[0] + y / mLat, o[1] + x / mLon] };
  }
  const meters = (p, q) => { const f = frame(p), d = f.toXY(q); return Math.hypot(d[0], d[1]); };
  function lengthOf(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += meters(pts[i - 1], pts[i]); return d; }

  /* a, b: [lat, lon]. heightFn(lat, lon) -> metros (NaN sem dado). Devolve { pts, lengthM, straightM } ou null. */
  function find(a, b, heightFn, opts) {
    const o = Object.assign({ stepM: 5, halfWidthM: 100, padM: 30, limitDeg: 12, marginDeg: 0.6, maxNodes: 60000 }, opts || {});
    const F = frame(a), B = F.toXY(b), L = Math.hypot(B[0], B[1]);
    if (!(L > o.stepM)) return null;
    const ux = B[0] / L, uy = B[1] / L, vx = -uy, vy = ux, s = o.stepM;
    const u0 = Math.round(o.padM / s), nu = u0 * 2 + Math.round(L / s) + 1, half = Math.ceil(o.halfWidthM / s), nv = half * 2 + 1;
    if (nu * nv > o.maxNodes) return null;
    const ll = (i, j) => { const u = (i - u0) * s, v = (j - half) * s; return F.toLL(u * ux + v * vx, u * uy + v * vy); };
    const H = new Float64Array(nu * nv);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const p = ll(i, j); H[i * nv + j] = heightFn(p[0], p[1]); }
    const start = u0 * nv + half, goal = (u0 + Math.round(L / s)) * nv + half, gi = (goal / nv) | 0, gj = goal % nv;
    const lim = o.limitDeg - o.marginDeg;
    const g = new Float64Array(nu * nv).fill(Infinity), came = new Int32Array(nu * nv).fill(-1), closed = new Uint8Array(nu * nv);
    const heap = [];   // [f, id], heap binário mínimo
    const push = (f, id) => { heap.push([f, id]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= f) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top[1]; };
    const hf = id => Math.hypot(((id / nv) | 0) - gi, (id % nv) - gj) * s;
    if (!isFinite(H[start]) || !isFinite(H[goal])) return null;
    g[start] = 0; push(hf(start), start);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
      const c = pop(); if (closed[c]) continue; closed[c] = 1; if (c === goal) break;
      const ci = (c / nv) | 0, cj = c % nv;
      for (const [di, dj] of D) {
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= nu || nj >= nv) continue;
        const n = ni * nv + nj; if (closed[n] || !isFinite(H[n])) continue;
        const d = s * Math.hypot(di, dj), sl = Math.atan(Math.abs(H[n] - H[c]) / d) / RAD;
        if (sl > lim) continue;
        const ng = g[c] + d * (1 + (sl / 4) ** 2);
        if (ng < g[n]) { g[n] = ng; came[n] = c; push(ng + hf(n), n); }
      }
    }
    if (came[goal] < 0) return null;
    const ids = [goal]; while (ids[ids.length - 1] !== start) ids.push(came[ids[ids.length - 1]]);
    ids.reverse();
    /* fica só com as curvas: pontos no meio de uma reta da grade não mudam o caminho */
    const keep = [ids[0]];
    for (let k = 1; k + 1 < ids.length; k++) {
      const a1 = ids[k] - ids[k - 1], a2 = ids[k + 1] - ids[k];
      if (a1 !== a2) keep.push(ids[k]);
    }
    keep.push(ids[ids.length - 1]);
    const pts = keep.map(id => ll((id / nv) | 0, id % nv));
    pts[0] = a.slice(); pts[pts.length - 1] = b.slice();
    return { pts, lengthM: lengthOf(pts), straightM: L };
  }

  return { find, frame, meters, lengthOf };
});
