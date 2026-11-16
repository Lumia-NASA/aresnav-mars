// Teste de ponta a ponta do percurso da apresentação, num Chrome de verdade (sem janela):
// escolher destino -> aumentar a carga -> receber NO-GO -> usar a ação recomendada -> abrir um panorama 360°
// -> cortar o enlace Terra-Marte -> continuar com os dados disponíveis -> abrir um panorama pré-carregado, que tem de vir completo.
// O panorama tem dois cenários: no primeiro a rede pode falhar (o visor tem de explicar); no segundo ele já está no cache e falhar não vale.
// Rodar: node tests/demo-flow-test.js  (precisa de `npm ci` em backend/ e de um Chrome/Edge instalado;
// CHROME_PATH aponta outro navegador). Sobe o backend numa porta de teste.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.join(__dirname, '../backend/node_modules/puppeteer-core'));

const os = require('os');
const P = require('../frontend/pano-tiles.js');

const root = path.resolve(__dirname, '..');
// Cache de panoramas só deste teste: começa vazio, então o cenário "pré-carregado" não depende do que há no disco de quem roda
const PANO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aresnav-pano-'));
const panos = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/fub/panoramas.geojson'), 'utf8')).features.map(f => f.properties);
const PORT = 3919, URL = `http://127.0.0.1:${PORT}/?lang=en`;
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const chrome = CANDIDATES.find(p => fs.existsSync(p));

let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.log('  ✘ ' + name + '\n     ' + e.message); throw e; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!chrome) { console.log('Nenhum Chrome/Edge encontrado (defina CHROME_PATH).'); process.exit(1); }
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'error', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', NVIDIA_API_KEY: '', COPILOT_PROVIDER: '', PANO_CACHE_DIR: PANO_DIR });
  const server = spawn(process.execPath, [path.join(root, 'backend/server.js')], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch (e) { /* subindo */ } await sleep(200); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.dismiss());
  const $text = sel => page.$eval(sel, el => el.innerText);
  const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return; await sleep(250); } throw new Error('tempo esgotado: ' + what); };

  console.log(`Percurso da demo (navegador: ${path.basename(chrome)})`);
  try {
    await step('o app abre e calcula a rota', async () => {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await until(() => typeof App !== 'undefined' && App.state.ready && App.state.info, 45000, 'app pronto');   // App é const global, não fica em window
    });
    await step('escolher o destino Three Forks pela lista de destinos', async () => {
      const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('#destList button')].find(x => /Three Forks/.test(x.innerText)); if (b) b.click(); return !!b; });
      assert.ok(ok, 'botão Three Forks não encontrado');
      await until(() => App.state.goalPoi && /Three Forks/.test(App.state.goalPoi.n), 5000, 'destino');
    });
    await step('aumentar a carga para 18,5 kg pelo controle e receber NO-GO', async () => {
      await page.evaluate(() => { const s = document.querySelector('#payload'); s.value = '18.5'; s.dispatchEvent(new Event('input', { bubbles: true })); });
      await until(() => /NO-GO/.test(document.querySelector('#gonogo').innerText), 8000, 'NO-GO');
      assert.ok(/O2 margin|O₂/.test(await $text('#gonogo')), 'o motivo de O₂ aparece no veredito');
    });
    await step('o quadro "What to do" leva ao trecho e corrige com a ação recomendada', async () => {
      await until(() => !document.querySelector('#decide').hidden, 5000, 'quadro de decisão');
      const before = await page.evaluate(() => App.globe && App.globe.viewer ? App.globe.viewer.entities.values.length : 0);
      await page.click('#gonogo');                                                   // vai até o trecho do problema
      await sleep(600);
      const after = await page.evaluate(() => App.globe && App.globe.viewer ? App.globe.viewer.entities.values.length : 0);
      assert.ok(after > before, 'o trecho foi marcado no globo');
      const label = await page.evaluate(() => { const b = [...document.querySelectorAll('#decide button')].find(x => /Carry|Levar/.test(x.innerText)); if (b) b.click(); return b && b.innerText; });
      assert.ok(label, 'ação "levar menos carga" disponível');
      await until(() => !/NO-GO/.test(document.querySelector('#gonogo').innerText), 8000, 'veredito sair do NO-GO');
      const o2 = await page.evaluate(() => App.state.plan.o2);
      assert.ok(o2 >= 30, `O₂ na volta ${o2}% depois da ação`);
    });
    await step('abrir o panorama 360° do depósito (abre ou explica por que não)', async () => {
      await until(() => App.mission && App.mission.FUB && App.mission.FUB.panoramas, 15000, 'panoramas carregados');
      await page.evaluate(() => App.pano360.open(App.mission.FUB.panoramas.features.map(f => f.properties).find(p => p.pano_id === '23')));
      await until(() => App.pano360.load.state !== 'loading', 40000, 'panorama terminar');
      const st = await page.evaluate(() => App.pano360.load);
      assert.ok(['complete', 'partial', 'failed'].includes(st.state));
      if (st.state !== 'complete') assert.ok((await $text('#p360Msg')).length > 10, 'sem os blocos, o visor explica o que houve');
      assert.ok(/REAL PHOTO|FOTO REAL/.test(await $text('#p360Kind')), 'etiqueta de foto real');
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => document.querySelector('.pano360').hidden), 'Esc fecha o visor');
    });
    await step('executar a caminhada: contagem até o ponto de retorno, "vire agora", virar e chegar em casa', async () => {
      await page.evaluate(() => { App.speak = () => {}; const s = document.querySelector('#payload'); s.value = '18.5'; s.dispatchEvent(new Event('input', { bubbles: true })); });
      await until(() => /NO-GO/.test(document.querySelector('#gonogo').innerText), 8000, 'voltar ao NO-GO com 18,5 kg');
      await page.evaluate(() => { document.querySelector('#execPace').value = '0.85'; document.querySelector('#execBtn').click(); App.state.speed = 3; });
      await until(() => !document.querySelector('#exec').hidden && /Turn back in|Vire em/.test(document.querySelector('#execTurnText').innerText), 8000, 'contagem aparecer');
      // vira no mesmo instante em que o aviso aparece (como o astronauta obedecendo ao ARES)
      await until(() => { if (!/TURN BACK NOW|VIRE AGORA/.test(document.querySelector('#execTurnText').innerText)) return false; document.querySelector('#execTurnNow').click(); return true; }, 60000, '"vire agora"');
      const log = await page.evaluate(() => [...document.querySelectorAll('#execLog li')].map(l => l.innerText).join(' | '));
      assert.ok(/Turn back now|Vire agora/.test(log), 'o ARES avisou: ' + log);
      await until(() => /Back at base|De volta à base/.test(document.querySelector('#execTurnText').innerText), 40000, 'chegar em casa');
      const o2 = await page.evaluate(() => App.execution.run.prev.o2Now);
      assert.ok(o2 >= 27, `virando no aviso chega perto da reserva de 30%: ${o2.toFixed(1)}%`);   // passo de 3 min: pode passar um pouco do ponto
      await page.evaluate(() => { App.state.speed = 1.5; document.querySelector('#execStop').click(); App.setView('globe'); });   // volta ao planejamento
    });
    await step('cortar o enlace Terra-Marte e seguir com os dados disponíveis', async () => {
      await page.click('#uplink');
      await until(() => document.body.classList.contains('offline'), 8000, 'modo offline');
      await page.evaluate(() => { const s = document.querySelector('#payload'); s.value = '17'; s.dispatchEvent(new Event('input', { bubbles: true })); });
      await until(() => App.state.payloadKg === 17 && App.state.info && App.state.assessment, 8000, 'recalcular offline');
      const v = await page.evaluate(() => ({ level: App.state.assessment.level, dist: App.state.info.dist, offlineTags: [...document.querySelectorAll('.offline-tag')].filter(e => e.offsetParent).length }));
      assert.ok(['GO', 'CAUTION', 'NO-GO'].includes(v.level) && v.dist > 3000, 'rota e veredito continuam sem enlace');
      assert.ok(v.offlineTags >= 4, 'camadas sem cópia local avisam "indisponível offline"');
    });
    await step('panorama pré-carregado, sem enlace: tem de abrir com a imagem completa', async () => {
      // Cenário oposto ao do passo do panorama acima: aqui falhar não vale. Um panorama de foto real (cubo) é gravado
      // inteiro no cache do habitat e aberto com o enlace cortado; todo bloco tem de vir do disco.
      const p = panos.find(x => !P.isSynthetic(x) && x.pano_id !== '23' && !P.pickCube(x, x.cube_natural ? 'nat' : 'enh').cube.sphere && P.cubeTiles(P.pickCube(x, x.cube_natural ? 'nat' : 'enh').cube).tiles.length);
      assert.ok(p, 'há um panorama de foto real em cubo para pré-carregar');
      const cube = P.pickCube(p, p.cube_natural ? 'nat' : 'enh').cube, tiles = P.cubeTiles(cube).tiles;
      const jpeg = Buffer.from((await page.evaluate(() => {   // um JPEG válido de 512 px, desenhado no próprio navegador
        const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
        g.fillStyle = '#b5713f'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#3a2218'; g.fillRect(0, 300, 512, 212);
        return c.toDataURL('image/jpeg', 0.8);
      })).split(',')[1], 'base64');
      for (const rel of ['preview.jpg', ...tiles.map(t => t.path)]) {
        const file = path.join(PANO_DIR, cube.folder, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, jpeg);
      }
      assert.ok(await page.evaluate(() => document.body.classList.contains('offline')), 'o enlace continua cortado');
      await page.evaluate(id => App.pano360.open(App.mission.FUB.panoramas.features.map(f => f.properties).find(x => x.pano_id === id)), p.pano_id);
      await until(() => App.pano360.load.state !== 'loading', 20000, 'panorama pré-carregado terminar');
      const r = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('#p360Cube img')];
        return { load: App.pano360.load, msg: document.querySelector('#p360Msg').innerText, retryHidden: document.querySelector('#p360Retry').hidden,
          imgs: imgs.length, drawn: imgs.filter(i => i.complete && i.naturalWidth > 0 && i.style.visibility !== 'hidden').length, cacheOnly: imgs.every(i => /[?&]offline=1/.test(i.src)) };
      });
      assert.strictEqual(r.load.state, 'complete', `estado ${r.load.state}: ${r.msg}`);
      assert.strictEqual(r.load.failed, 0, 'nenhum bloco falhou');
      assert.strictEqual(r.load.loaded, tiles.length, 'todos os blocos do panorama carregaram');
      assert.strictEqual(r.drawn, tiles.length, 'todos os blocos estão desenhados no visor');
      assert.strictEqual(r.msg.trim(), '', 'panorama completo não mostra aviso');
      assert.ok(r.retryHidden, 'sem botão "Tentar de novo"');
      assert.ok(r.cacheOnly, 'com o enlace fora, o visor pede só o cache (?offline=1)');
      const hdr = await page.evaluate(async src => (await fetch(src)).headers.get('X-AresNav-Cache'), await page.evaluate(() => document.querySelector('#p360Cube img').src));
      assert.strictEqual(hdr, 'OFFLINE', 'o backend respondeu do disco, sem ir à FU Berlin');
      await page.keyboard.press('Escape');
    });
    await step('relevo de 1 m com um morrinho íngreme na rota: por padrão só marca; com os desvios ligados, o desvio é aplicado e o Play ▶ percorre o contorno', async () => {
      // espera terminar o que o app já pedia de relevo de 1 m (blocos reais não podem chegar depois e sobrescrever os sintéticos)
      await until(() => App.state.fine && !App.state.fine.loading && App.fineLoading === 0, 90000, 'relevo de 1 m em curso');
      const r = await page.evaluate(async () => {
        const st = App.state, H = HiRise, path = st.path;
        let k = -1;
        for (let i = Math.floor(path.length / 2); i < path.length; i++) { const a = App.cellLL(path[i - 1]), b = App.cellLL(path[i]); if (H.inside(a[0], a[1]) && H.inside(b[0], b[1])) { k = i; break; } }
        if (k < 0) return { err: 'nenhum trecho da rota dentro do mosaico HiRISE' };
        const a = App.cellLL(path[k - 1]), b = App.cellLL(path[k]), m = H.pixelOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        // relevo sintético: plano a -2550 m com um morrinho de 12 m (raio 20 m) no meio do trecho k, em todos os blocos ao longo da rota
        H.tilesAlong(App.routeLL(), 130).forEach(t => {
          const arr = new Int16Array(256 * 256).fill(-500);
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const d = Math.hypot(t.tx * 256 + x + 0.5 - m.px, t.ty * 256 + y + 0.5 - m.py);
            if (d < 20) arr[y * 256 + x] = -500 + Math.round(120 * (1 - d / 20));
          }
          App.FINE.put(t.tx, t.ty, arr); App.FINE.bias.delete(H.key(t.tx, t.ty));
        });
        // padrão: desvios desligados, a rota fica a da grade de 200 m (o trecho íngreme só é marcado)
        await App.fineCorridor();
        if (st.via || (st.fine.detours || []).length) return { err: 'com os desvios desligados (padrão), a rota não deveria mudar' };
        if (!(st.fine.steepM > 0)) return { err: 'o morrinho deveria aparecer como trecho íngreme marcado' };
        st.detours = true;   // como ?detour=1
        await App.fineCorridor();
        const F = st.fine, det = (F.detours || []).find(d => d.k === k);
        if (!det || !det.ok || !st.via || !st.via[k]) return { err: 'desvio não aplicado no trecho ' + k, detours: F.detours, status: F.status };
        // o Play avança simT e chama tick(): é a mesma posição que aparece no mapa e no capacete
        const S = st.sim.S, i1 = S.findIndex(s => s.phase === 'Ida' && s.k === k), ta = S[i1 - 1].t, tb = S[i1].t;
        const via = App.edgePts(path, k), toM = p => { const q = H.pixelOf(p[0], p[1]); return [q.px, q.py]; };
        const segDist = (p, q, w) => { const [px, py] = toM(p), [qx, qy] = toM(q), [wx, wy] = toM(w), dx = wx - qx, dy = wy - qy, t = Math.max(0, Math.min(1, ((px - qx) * dx + (py - qy) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(px - qx - t * dx, py - qy - t * dy); };
        let onVia = 0, offLine = 0, nearMound = Infinity;
        for (let i = 1; i < 30; i++) {
          st.simT = ta + (tb - ta) * i / 30; App.tick(true);
          const p = [st.now.lat, st.now.lon];
          let dv = Infinity; for (let j = 1; j < via.length; j++) dv = Math.min(dv, segDist(p, via[j - 1], via[j]));
          onVia = Math.max(onVia, dv); offLine = Math.max(offLine, segDist(p, a, b));
          const q = toM(p); nearMound = Math.min(nearMound, Math.hypot(q[0] - m.px, q[1] - m.py));
        }
        return { k, status: F.status, maxDeg: F.maxDeg, limit: F.limitDeg, before: det.beforeDeg, after: det.afterDeg, onVia, offLine, nearMound, exportVia: App.routeLL().length > path.length };
      });
      assert.ok(!r.err, r.err + ' ' + JSON.stringify(r));
      assert.ok(r.before > 20, `o trecho reto passa pelo morrinho (${r.before}°)`);
      assert.ok(r.after <= r.limit, `o contorno fica abaixo do limite (${r.after}° de ${r.limit}°)`);
      assert.ok(r.onVia < 0.5, `a posição do Play fica no contorno (a ${r.onVia} m dele)`);
      assert.ok(r.offLine > 10, `e sai da reta antiga (até ${r.offLine} m dela)`);
      assert.ok(r.nearMound > 15, `sem passar por cima do morrinho (mais perto: ${r.nearMound} m do centro)`);
      assert.ok(r.exportVia, 'a rota exportada inclui os pontos do desvio');
    });
    await step('nenhum erro de JavaScript na página durante o percurso', async () => {
      assert.deepStrictEqual(pageErrors, []);
    });
  } catch (e) { /* o passo que falhou já foi registrado */ }
  await browser.close(); server.kill();
  try { fs.rmSync(PANO_DIR, { recursive: true, force: true }); } catch (e) { /* pasta temporária: o sistema limpa depois */ }
  console.log(`\n${passed} passos passaram${failed ? `, ${failed} falhou` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
