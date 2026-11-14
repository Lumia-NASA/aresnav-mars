// Teste de ponta a ponta do percurso da apresentação, num Chrome de verdade (sem janela):
// escolher destino -> aumentar a carga -> receber NO-GO -> usar a ação recomendada -> abrir um panorama 360°
// -> cortar o enlace Terra-Marte -> continuar com os dados disponíveis.
// Rodar: node tests/demo-flow-test.js  (precisa de `npm ci` em backend/ e de um Chrome/Edge instalado;
// CHROME_PATH aponta outro navegador). Sobe o backend numa porta de teste.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(path.join(__dirname, '../backend/node_modules/puppeteer-core'));

const root = path.resolve(__dirname, '..');
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
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'error', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' });
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
    await step('nenhum erro de JavaScript na página durante o percurso', async () => {
      assert.deepStrictEqual(pageErrors, []);
    });
  } catch (e) { /* o passo que falhou já foi registrado */ }
  await browser.close(); server.kill();
  console.log(`\n${passed} passos passaram${failed ? `, ${failed} falhou` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
