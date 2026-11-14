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
  return { maxSafeSlope, metabolicFactor, o2AtReturn, verdict, O2_MIN: 30, NO_LOAD_SLOPE: 15 };
});
