/* Hora e Sol em Marte (algoritmo do Mars24 da NASA GISS: Allison & McEwen 2000, com a correção de 2000/2009).
   Funções puras, usadas pelo app (relógio, pôr do sol, luz) e testadas em tests/sun-test.js contra os
   horários de nascer e pôr do sol publicados pelo MEDA do Perseverance.
   Horas em formato decimal (13.5 = 13:30). Hora local média (LMST) é a que o rover usa para planejar;
   hora solar verdadeira (LTST) é a do Sol no céu. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MarsSun = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const r = Math.PI / 180, mod = (x, m) => ((x % m) + m) % m;
  const M20_SOL0_MSD = 52304;   // sol 0 do Perseverance (18/02/2021)

  /* Estado orbital de Marte num instante (Date ou milissegundos) */
  function orbit(when) {
    const ms = when instanceof Date ? when.getTime() : Number(when);
    const jdTT = ms / 86400000 + 2440587.5 + 69.184 / 86400, dt = jdTT - 2451545.0;
    const msd = (jdTT - 2405522.0028779) / 1.0274912517, mtc = mod(24 * msd, 24);
    const M = (19.3871 + 0.52402073 * dt) * r, aFMS = 270.3871 + 0.524038496 * dt;
    // perturbações planetárias (PBS), da tabela do Mars24
    const PBS = [[0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736], [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095]]
      .reduce((s, [A, tau, phi]) => s + A * Math.cos((0.985626 * dt / tau + phi) * r), 0);
    const nuM = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.050 * Math.sin(3 * M) + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + PBS;
    const ls = mod(aFMS + nuM, 360);
    const dec = Math.asin(0.42565 * Math.sin(ls * r)) / r + 0.25 * Math.sin(ls * r);
    const eot = 2.861 * Math.sin(2 * ls * r) - 0.071 * Math.sin(4 * ls * r) + 0.002 * Math.sin(6 * ls * r) - nuM;   // graus
    return { msd, mtc, ls, dec, eot };
  }
  /* Hora local em uma longitude leste (graus) */
  function localTime(when, lonEast) {
    const o = orbit(when), lmst = mod(o.mtc + lonEast / 15, 24), ltst = mod(lmst + o.eot / 15, 24);
    return Object.assign(o, { lmst, ltst, sol: Math.floor(o.msd + lonEast / 360) - M20_SOL0_MSD });
  }
  /* Elevação do Sol (graus) numa hora solar verdadeira */
  function elevation(lat, dec, ltst) {
    const H = (ltst - 12) * 15 * r;
    return Math.asin(Math.sin(lat * r) * Math.sin(dec * r) + Math.cos(lat * r) * Math.cos(dec * r) * Math.cos(H)) / r;
  }
  /* Nascer e pôr do Sol em LMST para uma latitude e um estado orbital (dec e eot). h0: altura do Sol no horizonte (0 = centro) */
  function sunTimes(lat, o, h0) {
    const c = (Math.sin((h0 || 0) * r) - Math.sin(lat * r) * Math.sin(o.dec * r)) / (Math.cos(lat * r) * Math.cos(o.dec * r));
    if (c >= 1) return { polarNight: true }; if (c <= -1) return { polarDay: true };
    const H0 = Math.acos(c) / r / 15;   // horas
    return { sunrise: mod(12 - H0 - o.eot / 15, 24), sunset: mod(12 + H0 - o.eot / 15, 24), dayLength: 2 * H0 };
  }
  /* Conversões: LMST (horas) <-> LTST na mesma data, e "HH:MM" */
  const lmstToLtst = (lmst, o) => mod(lmst + o.eot / 15, 24);
  const hhmm = h => { const m = Math.round(mod(h, 24) * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  return { orbit, localTime, elevation, sunTimes, lmstToLtst, hhmm, M20_SOL0_MSD };
});
