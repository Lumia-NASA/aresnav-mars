/* Física de carga do traje: como o peso carregado muda o limite de declive seguro e o consumo.
   Funções puras, usadas pelo app e testadas em tests/physics-test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Physics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const kg = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  /* Limite de declive seguro em graus: 15° sem carga, menos 0,2° por kg, nunca abaixo de 8° */
  const maxSafeSlope = payloadKg => Math.max(8, 15 - kg(payloadKg) * 0.2);
  /* Multiplicador do consumo de oxigênio e do esforço: +1,8% por kg */
  const metabolicFactor = payloadKg => 1 + kg(payloadKg) * 0.018;
  /* Oxigênio previsto ao fim de uma caminhada de totalMin minutos (em % do tanque) */
  const o2AtReturn = (totalMin, payloadKg, autonomyMin) => Math.max(0, 100 - totalMin / autonomyMin * 100 * metabolicFactor(payloadKg));
  /* Veredito de saída. Riscos à vida em ordem: declive, depois oxigênio */
  function verdict(s) {
    if (!s.hasRoute || s.maxSlope > s.limit) return { go: false, code: 'SLOPE' };
    if (s.o2 < 30) return { go: false, code: 'METABOLIC' };
    return { go: true, code: 'GO' };
  }
  /* ---------- Cinemática: função de Tobler adaptada ao traje ----------
     v = v0 · e^(−3,5 · |tan θ + 0,05|) · (1 − 0,012 · kg). θ positivo = subida no sentido da caminhada.
     v0 dá 2,7 km/h no plano sem carga (ritmo de astronauta de traje, base SEXTANT/Apollo). */
  const V0 = 2.7 / Math.exp(-3.5 * 0.05);
  const loadFactor = payloadKg => Math.max(0.2, 1 - kg(payloadKg) * 0.012);
  const walkSpeedKmh = (slopeDeg, payloadKg) => V0 * Math.exp(-3.5 * Math.abs(Math.tan((Number(slopeDeg) || 0) * Math.PI / 180) + 0.05)) * loadFactor(payloadKg);
  /* Tempo de ida e de volta pelo mesmo caminho. segs: [{ d: metros, dh: subida em metros no sentido da ida }].
     Na volta o sinal do declive inverte: a subida da ida vira descida. */
  const segMin = (s, sign, payloadKg) => { const d = Number(s.d) || 0; if (d <= 0) return 0; const deg = Math.atan2(sign * (Number(s.dh) || 0), d) * 180 / Math.PI; return d / (walkSpeedKmh(deg, payloadKg) / 3.6) / 60; };
  function walkTimes(segs, payloadKg) {
    let outMin = 0, backMin = 0;
    for (const s of segs || []) { outMin += segMin(s, 1, payloadKg); backMin += segMin(s, -1, payloadKg); }
    return { outMin, backMin };
  }

  /* ---------- Ponto de retorno (bingo de O₂) ----------
     Para cada ponto k da ida: tempo até ali + tempo de volta dali até a base.
     O ponto de retorno é o último k em que, virando ali, o astronauta chega com pelo menos reservePct de O₂. */
  function turnBackPoint(segs, payloadKg, autonomyMin, reservePct) {
    const reserve = reservePct == null ? 30 : reservePct, list = segs || [], n = list.length;
    const outCum = [0], backCum = [0];   // backCum[k]: tempo de volta do ponto k até a base
    for (let k = 0; k < n; k++) { outCum.push(outCum[k] + segMin(list[k], 1, payloadKg)); backCum.push(backCum[k] + segMin(list[k], -1, payloadKg)); }
    let index = -1;
    for (let k = 0; k <= n; k++) { if (o2AtReturn(outCum[k] + backCum[k], payloadKg, autonomyMin) >= reserve) index = k; else break; }
    const at = Math.max(0, index);
    return { index, reachesEnd: index === n, outMin: outCum[at], o2AtBase: o2AtReturn(outCum[at] + backCum[at], payloadKg, autonomyMin) };
  }

  /* ---------- Linha de visada do rádio (como o Sightline do MMGIS) ----------
     elevations: altitudes do chão do habitat até o astronauta, igualmente espaçadas.
     Antena do habitat a 2 m, capacete a 1,7 m. opts.spacingM inclui a curvatura de Marte. */
  function checkLineOfSight(elevations, opts) {
    const e = (elevations || []).map(Number).filter(Number.isFinite), o = opts || {};
    const mastA = o.mastA == null ? 2 : o.mastA, mastB = o.mastB == null ? 1.7 : o.mastB, R = o.radius || 3389500;
    if (e.length < 3) return { losClear: true, maxObstructionMeters: 0, obstructionIndex: -1, mode: 'DIRECT_UHF' };
    const n = e.length - 1, h0 = e[0] + mastA, h1 = e[n] + mastB, total = (o.spacingM || 0) * n;
    let worst = -Infinity, at = -1;
    for (let i = 1; i < n; i++) {
      const f = i / n, d1 = f * total, bulge = total ? d1 * (total - d1) / (2 * R) : 0;   // curvatura: o meio do caminho "sobe"
      const over = e[i] + bulge - (h0 + (h1 - h0) * f);
      if (over > worst) { worst = over; at = i; }
    }
    const losClear = worst <= 0;
    return { losClear, maxObstructionMeters: Math.max(0, Math.round(worst * 10) / 10), obstructionIndex: losClear ? -1 : at, mode: losClear ? 'DIRECT_UHF' : 'ORBITER_RELAY' };
  }

  /* ---------- Veredito em 3 níveis com os motivos (explicabilidade) ----------
     NO-GO: risco à vida (sem rota, declive acima do limite, O₂ abaixo de 30% na volta).
     CAUTION: dentro dos limites, mas perto deles, sem rádio direto ou com volta perto do pôr do sol. */
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  function assess(s) {
    const limit = Number(s.limit), slope = Number(s.maxSlope) || 0, o2 = Number(s.o2), p = kg(s.payloadKg);
    const reasons = [], cautions = [];
    if (!s.hasRoute) reasons.push('No walkable route within the slope limit');
    else if (slope > limit) reasons.push(`Max slope ${f1(slope)}° exceeds ${f1(limit)}° limit for ${f1(p)} kg payload`);
    if (Number.isFinite(o2) && o2 < 30) reasons.push(`Return O2 margin ${Math.round(o2)}% < 30% safety threshold`);
    if (s.hasRoute && slope <= limit && slope > limit * 0.85) cautions.push(`Max slope ${f1(slope)}° is within 15% of the ${f1(limit)}° limit`);
    if (Number.isFinite(o2) && o2 >= 30 && o2 < 40) cautions.push(`Return O2 margin ${Math.round(o2)}% is close to the 30% reserve`);
    if (s.losClear === false) cautions.push(`Terrain blocks direct radio by ${f1(s.obstructionM || 0)} m: relay through orbiter`);
    if (s.lateReturn) cautions.push('Return ends close to sunset');
    const level = reasons.length ? 'NO-GO' : cautions.length ? 'CAUTION' : 'GO';
    if (level !== 'NO-GO') reasons.push(`Max slope ${f1(slope)}° within ${f1(limit)}° limit for ${f1(p)} kg payload`, `Return O2 margin ${Math.round(o2)}% ≥ 30% safety threshold`);
    // NO-GO: o motivo decisivo vem primeiro; GO e CAUTION: as ressalvas vêm primeiro
    return { level, go: level !== 'NO-GO', code: verdict(s).code, reasons: level === 'NO-GO' ? reasons.concat(cautions) : cautions.concat(reasons) };
  }

  return { maxSafeSlope, metabolicFactor, o2AtReturn, verdict, walkSpeedKmh, walkTimes, turnBackPoint, checkLineOfSight, assess, O2_MIN: 30, NO_LOAD_SLOPE: 15 };
});
