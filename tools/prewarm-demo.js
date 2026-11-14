// Pré-carrega no cache do backend tudo o que a demo usa, para ela abrir sem internet.
// Uso (com o backend rodando):
//   node tools/prewarm-demo.js            baixa pela internet e grava no cache do backend
//   node tools/prewarm-demo.js --check    confere SEM internet (?offline=1) que cada item abre do cache
// Variáveis: ARESNAV_URL (padrão http://localhost:3000).
//
// O que entra (a área da demo: base Ares-1 -> depósito Three Forks, em Jezero):
// - dados: telemetria, trajeto, paradas do rover, relevo, CRISM, zonas, camadas da FU Berlin;
// - blocos de imagem do globo e do mapa: Viking e infravermelho THEMIS (níveis baixos) e a cor natural da FU Berlin
//   (níveis 8 a 14) em volta da rota;
// - panoramas 360°: os da demo (Three Forks, lago antigo, pouso, Lookout Hill), em cor natural quando existe;
// - fotos da Navcam do modo Capacete a até 2,5 km da rota.
// - relevo HiRISE de 1 m numa faixa de 400 m para cada lado da linha base -> Three Forks (corredor da rota e o chão do capacete).
const path = require('path');
const fs = require('fs');
const P = require('../frontend/pano-tiles.js');
const HiRise = require('../frontend/hirise-core.js');

const BASE = (process.env.ARESNAV_URL || 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const CHECK = process.argv.includes('--check');
const root = path.resolve(__dirname, '..');
const BOX = { w: 77.36, e: 77.49, s: 18.40, n: 18.48 };          // base (77.45 E, 18.44 N) até Three Forks (77.40 E, 18.45 N), com folga
const DEMO_PANOS = ['23', '24', '-8', '1', '41'];
const NAVCAM_KM = 2.5;
const DEPOT = [18.45133, 77.40126];   // Depósito de amostras Three Forks (destino da demo)

function tilesIn(layer, z, box) {
  const size = 180 / 2 ** z, out = [];
  const x0 = Math.floor((box.w + 180) / size), x1 = Math.floor((box.e + 180) / size);
  const y0 = Math.floor((90 - box.n) / size), y1 = Math.floor((90 - box.s) / size);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`/tiles/${layer}/${z}/${y}/${x}`);
  return out;
}
function km(a, b) { const r = Math.PI / 180, R = 3389.5, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r; return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2)); }

function plan() {
  const items = ['/telemetry', '/traverse', '/waypoints', '/dem/jezero', '/crism', '/zones',
    '/fub/lake', '/fub/channel-lines', '/fub/landingellipse', '/fub/poi', '/fub/panoramas'];
  for (let z = 0; z <= 7; z++) items.push(...tilesIn('viking', z, BOX));
  for (let z = 0; z <= 9; z++) items.push(...tilesIn('themis', z, BOX));
  for (let z = 8; z <= 14; z++) items.push(...tilesIn('fubcolor', z, BOX));
  // panoramas da demo
  const panos = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/fub/panoramas.geojson'), 'utf8')).features.map(f => f.properties);
  for (const id of DEMO_PANOS) {
    const p = panos.find(x => String(x.pano_id) === id); if (!p) continue;
    const { cube } = P.pickCube(p, 'nat');
    const parts = cube.sphere ? P.sphereTiles(cube).map(t => t.path) : P.cubeTiles(cube).tiles.map(t => t.path);
    for (const rel of ['preview.jpg'].concat(parts)) items.push(`/fub/pano/${encodeURIComponent(cube.folder)}/${rel}`);
  }
  // relevo HiRISE de 1 m em volta da rota da demo
  HiRise.tilesAlong([[18.4405, 77.4625], DEPOT], 400).forEach(t => items.push(`/dem/hirise/${t.tx}/${t.ty}`));
  // fotos da Navcam perto da rota
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'frontend/data/pano/index.json'), 'utf8'));
  const mid = [(BOX.s + BOX.n) / 2, (BOX.w + BOX.e) / 2];
  for (const p of idx.panos) if (km([p.lat, p.lon], mid) <= NAVCAM_KM + 4) p.s.forEach(s => items.push('/navcam/' + s[4]));
  return items;
}

async function run() {
  const items = plan();
  let ok = 0, miss = 0, outside = 0, failed = [];
  const queue = items.slice(), started = Date.now();
  async function worker() {
    while (queue.length) {
      const u = queue.shift();
      try {
        const r = await fetch(BASE + u + (CHECK ? (u.includes('?') ? '&' : '?') + 'offline=1' : ''));
        if (r.status === 200) ok++;
        else if (r.status === 404 && u.startsWith('/tiles/')) outside++;   // bloco fora da cobertura: esperado
        else { miss++; if (failed.length < 15) failed.push(`${r.status} ${u}`); }
        await r.arrayBuffer();
      } catch (e) { miss++; if (failed.length < 15) failed.push(`ERR ${u}`); }
    }
  }
  await Promise.all(Array.from({ length: CHECK ? 8 : 4 }, worker));
  const s = Math.round((Date.now() - started) / 100) / 10;
  console.log(`${CHECK ? 'Conferência offline' : 'Pré-carga'}: ${items.length} itens · ${ok} ok · ${outside} fora da cobertura · ${miss} faltando · ${s} s`);
  if (failed.length) console.log('Faltando (primeiros):\n  ' + failed.join('\n  '));
  return miss;
}

run().then(miss => process.exit(CHECK && miss ? 1 : 0)).catch(e => { console.error(e); process.exit(2); });
