// Testes das integrações da FU Berlin: lógica do visor 360° (frontend/pano-tiles.js) e rotas do backend.
// Rodar: node tests/fub-test.js  (precisa de `npm ci` em backend/). Não usa a internet: as rotas são chamadas
// em modo só-cache (?offline=1) ou com pedidos que o backend resolve sozinho (validação, fora da cobertura).
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const P = require('../frontend/pano-tiles.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.log('  ✘ ' + name + '\n     ' + e.message); }
}
const root = path.resolve(__dirname, '..');
const panos = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/fub/panoramas.geojson'), 'utf8')).features.map(f => f.properties);

(async () => {
  console.log('Visor 360°: lógica pura (pano-tiles.js)');
  await test('foto real x vista sintética pelo pano_id', () => {
    assert.strictEqual(P.isSynthetic({ pano_id: '-8' }), true);
    assert.strictEqual(P.isSynthetic({ pano_id: '23' }), false);
  });
  await test('cor natural quando existe; realce quando não existe (sem quebrar)', () => {
    const p = { pano_id: '23', cube: { folder: 'E', lvl: 2, size: 1152 }, cube_natural: { folder: 'N', lvl: 2, size: 1152 } };
    assert.strictEqual(P.pickCube(p, 'nat').cube.folder, 'N');
    assert.strictEqual(P.pickCube(p, 'enh').cube.folder, 'E');
    const semNatural = P.pickCube({ pano_id: '2', cube: { folder: 'E', lvl: 1, size: 512 } }, 'nat');
    assert.deepStrictEqual([semNatural.cube.folder, semNatural.useNatural, semNatural.naturalAvailable], ['E', false, false]);
    assert.strictEqual(P.pickCube({ pano_id: '9', vtour: 'scene_X' }, 'enh').cube.lvl, 0, 'sem dados de cubo: só a prévia');
  });
  await test('cubo estéreo de 1024 px: 2 x 2 blocos por face, caminho com dois dígitos', () => {
    const t = P.cubeTiles({ folder: 'X', mono: false, lvl: 1, size: 1024 });
    assert.strictEqual(t.n, 2); assert.strictEqual(t.tiles.length, 24); assert.deepStrictEqual(t.fractions, [50, 50]);
    assert.strictEqual(t.tiles[0].path, '1/f/l1/01/l1_1/f_01_01.jpg');
  });
  await test('cubo simples de 1280 px: último bloco menor (40/40/20%), caminho sem zeros', () => {
    const t = P.cubeTiles({ folder: 'paleo', mono: true, lvl: 2, size: 1280 });
    assert.strictEqual(t.n, 3); assert.deepStrictEqual(t.fractions, [40, 40, 20]);
    assert.strictEqual(t.tiles[8].path, 'f/l2/3/l2_f_3_3.jpg');
  });
  await test('esfera 1536 x 770: 3 x 2 blocos com três dígitos', () => {
    const t = P.sphereTiles({ folder: 'S', sphere: true, lvl: 1, w: 1536, h: 770 });
    assert.strictEqual(t.length, 6); assert.strictEqual(t[5].path, 'l1/002/l1_002_003.jpg');
  });
  await test('nitidez sob demanda: nível pelo tamanho que a tela pede, grade e caminho dos blocos', () => {
    const c = { folder: 'X', mono: false, lvl: 2, size: 1152, sizes: [640, 1152, 2304, 4736, 9472] };
    assert.strictEqual(P.hdLevel(c, 1000), 0, 'o nível base já basta');
    assert.strictEqual(P.hdLevel(c, 2000), 3); assert.strictEqual(P.hdLevel(c, 5000), 5);
    assert.strictEqual(P.hdLevel(c, 99999), 5, 'não passa do último nível');
    assert.strictEqual(P.hdLevel({ lvl: 2, size: 1152 }, 5000), 0, 'sem a lista de níveis, fica no base');
    assert.strictEqual(P.maxSize(c), 9472);
    const g = P.levelGrid(c, 4);
    assert.strictEqual(g.n, 10); assert.strictEqual(g.path('f', 10, 3), '1/f/l4/10/l4_1/f_10_03.jpg');
    const last = g.rect(10, 10);
    assert.ok(Math.abs(last.x1 - 1) < 1e-9 && Math.abs(last.x0 - 4608 / 4736) < 1e-9, 'o último bloco é menor e termina na borda');
    assert.strictEqual(P.levelGrid({ mono: true, sizes: [640, 1280, 2560] }, 3).path('u', 2, 5), 'u/l3/2/l3_u_2_5.jpg');
    const s = { folder: 'S', sphere: true, lvl: 1, w: 1536, h: 770, levels: [[1536, 770], [3072, 1536], [5888, 2946], [11776, 5888]] };
    assert.strictEqual(P.sphereLevel(s, 6000), 3); assert.strictEqual(P.sphereLevel(s, 3100), 2); assert.strictEqual(P.sphereLevel({ sphere: true, w: 1536, h: 768 }, 6000), 1);
    const t = P.sphereTiles(s, 3);
    assert.strictEqual(t.length, 12 * 6); assert.strictEqual(t[t.length - 1].path, 'l3/006/l3_006_012.jpg');
  });
  await test('resumo do carregamento: carregando, completo, parcial, falhou, só prévia', () => {
    assert.strictEqual(P.summarize({ total: 24, loaded: 10, failed: 0 }).state, 'loading');
    assert.strictEqual(P.summarize({ total: 24, loaded: 24, failed: 0 }).state, 'complete');
    const parcial = P.summarize({ total: 24, loaded: 20, failed: 4 });
    assert.deepStrictEqual([parcial.state, parcial.failed, parcial.pct], ['partial', 4, 100]);
    assert.strictEqual(P.summarize({ total: 24, loaded: 0, failed: 24 }).state, 'failed');
    assert.strictEqual(P.summarize({ total: 0 }).state, 'preview');
  });
  await test('endereço do bloco: modo só-cache offline e nova tentativa', () => {
    assert.strictEqual(P.tileUrl('/api/v1', 'A B', 'preview.jpg', {}), '/api/v1/fub/pano/A%20B/preview.jpg');
    assert.strictEqual(P.tileUrl('/api/v1', 'A', 'preview.jpg', { offline: true, retry: 2 }), '/api/v1/fub/pano/A/preview.jpg?offline=1&retry=2');
  });
  await test('dados: os 64 panoramas têm cubo; os sintéticos não se dizem foto da Mastcam-Z', () => {
    assert.strictEqual(panos.length, 64);
    assert.ok(panos.every(p => p.cube), 'todo panorama tem formato de cubo ou esfera');
    panos.filter(P.isSynthetic).forEach(p => assert.ok(!/Mastcam/i.test(p.credits || ''), p.name));
  });

  // ---------- backend numa porta de teste ----------
  const PORT = 3917, BASE = `http://127.0.0.1:${PORT}`;
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'error', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' });
  const server = spawn(process.execPath, [path.join(root, 'backend/server.js')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errText = ''; server.stderr.on('data', d => { errText += d; });
  const up = async () => { for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch (e) { /* ainda subindo */ } await new Promise(r => setTimeout(r, 200)); } return false; };
  const ok = await up();
  console.log('\nRotas da FU Berlin no backend');
  if (!ok) { failed++; console.log('  ✘ backend não subiu (rode npm ci em backend/)\n' + errText.slice(0, 500)); }
  else {
    await test('/api/v1/fub/lake: GeoJSON em graus dentro de Jezero e hash SHA-256 conferível', async () => {
      const r = await fetch(BASE + '/api/v1/fub/lake'); assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.strictEqual(j.data.type, 'FeatureCollection');
      const ring = j.data.features[0].geometry.coordinates[0];
      assert.ok(ring.every(([lon, lat]) => lon > 77 && lon < 78.2 && lat > 18 && lat < 18.8), 'margem do lago fora de Jezero');
      const hash = crypto.createHash('sha256').update(JSON.stringify(j.data)).digest('hex');
      assert.strictEqual(r.headers.get('x-aresnav-evidence-sha256'), hash);
    });
    await test('/api/v1/fub/:layer recusa camada desconhecida e caminho malicioso', async () => {
      assert.strictEqual((await fetch(BASE + '/api/v1/fub/senhas')).status, 400);
      assert.notStrictEqual((await fetch(BASE + '/api/v1/fub/..%2f..%2fpackage.json')).status, 200);
    });
    await test('panorama: recusa caminhos fora do formato do krpano', async () => {
      assert.strictEqual((await fetch(BASE + '/api/v1/fub/pano/X/..%2f..%2fserver.js')).status, 400);
      assert.strictEqual((await fetch(BASE + '/api/v1/fub/pano/X/1/f/l9/01/l9_1/f_01_01.jpg')).status, 400);
    });
    await test('panorama: o backend aceita o formato real de cada um dos 64 (estéreo, simples, esfera)', async () => {
      for (const p of panos) {
        const c = p.cube, first = c.sphere ? P.sphereTiles(c)[0].path : P.cubeTiles(c).tiles[0] ? P.cubeTiles(c).tiles[0].path : 'preview.jpg';
        const st = (await fetch(`${BASE}/api/v1/fub/pano/${encodeURIComponent(c.folder)}/${first}?offline=1`)).status;
        assert.ok(st === 200 || st === 504, `${p.name}: ${first} -> ${st}`);
      }
    });
    await test('panorama offline fora do cache: 504 com X-AresNav-Degraded (o visor mostra "indisponível offline")', async () => {
      const r = await fetch(`${BASE}/api/v1/fub/pano/nunca_aberto_teste/preview.jpg?offline=1`);
      assert.strictEqual(r.status, 504); assert.strictEqual(r.headers.get('x-aresnav-degraded'), 'true');
    });
    await test('blocos WMS: fora da cobertura dá 404 sem ir à internet; zoom além do máximo dá 400', async () => {
      assert.strictEqual((await fetch(BASE + '/api/v1/tiles/fubcolor/0/0/0')).status, 404);
      assert.strictEqual((await fetch(BASE + '/api/v1/tiles/fubcolor/18/0/0')).status, 400);
    });
    await test('blocos WMS dentro de Jezero, offline e fora do cache: 504 degradado', async () => {
      const z = 17, size = 180 / 2 ** z, x = Math.floor((79.19 + 180) / size), y = Math.floor((90 - 20.67) / size);
      const r = await fetch(`${BASE}/api/v1/tiles/fubcolor/${z}/${y}/${x}?offline=1`);
      assert.strictEqual(r.status, 504); assert.strictEqual(r.headers.get('x-aresnav-degraded'), 'true');
    });
    await test('a página abre com o CSP do frontend (pegaria o 500 do @fastify/static 10)', async () => {
      for (const f of ['/', '/app.js', '/pano360.js']) {
        const r = await fetch(BASE + f); assert.strictEqual(r.status, 200, f);
        assert.ok(/default-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'CSP ausente em ' + f);
      }
    });
    await test('API comprime JSON grande (brotli/gzip)', async () => {
      const r = await fetch(BASE + '/api/v1/fub/channel-lines', { headers: { 'accept-encoding': 'gzip' } });
      assert.strictEqual(r.headers.get('content-encoding'), 'gzip');
    });
    await test('copiloto sem chave da API: status diz modo local', async () => {
      const j = await (await fetch(BASE + '/api/v1/copilot/status')).json();
      assert.strictEqual(j.ai, false);
    });
  }
  server.kill();
  console.log(`\n${passed} testes passaram${failed ? `, ${failed} falharam` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
