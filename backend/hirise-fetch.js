/* Leitura dos blocos de 1 m do HiRISE (arquivo GeoTIFF de 1,8 GB na USGS, sem compressão, float32 por pixel).
   Cada linha do arquivo fica num lugar fixo, então um bloco de 256 x 256 m são 256 leituras de faixa de bytes.
   Para a demo ficar previsível:
   - Agrupa: pedidos de blocos vizinhos na mesma fileira (mesmo ty) que chegam juntos viram uma leitura por linha
     cobrindo todos eles (até `maxRun` blocos), em vez de uma por bloco.
   - Prazo: cada leitura tem tempo próprio (`perRequestMs`, com uma nova tentativa) e o grupo inteiro tem um prazo
     total (`deadlineMs`). Passado o prazo, as leituras em curso são canceladas e o pedido falha (o backend responde 504).
   `fetchRange(start, end, signal)` faz a leitura de verdade; nos testes é um falso local. */
'use strict';

function createReader(opts) {
  const o = Object.assign({ tile: 256, concurrency: 16, deadlineMs: 30000, batchWindowMs: 25, maxRun: 6, retries: 1 }, opts);
  for (const k of ['fetchRange', 'width', 'height', 'dataStart', 'rowBytes']) if (o[k] == null) throw new Error('hirise-fetch: falta ' + k);
  const pending = new Map();   // ty -> Map(tx -> [{ resolve, reject }])
  let timer = null;
  const stats = { requests: 0, groups: 0, tiles: 0, timeouts: 0 };

  function tile(tx, ty) {
    return new Promise((resolve, reject) => {
      let row = pending.get(ty); if (!row) pending.set(ty, row = new Map());
      if (!row.has(tx)) row.set(tx, []);
      row.get(tx).push({ resolve, reject });
      if (!timer) timer = setTimeout(flush, o.batchWindowMs);
    });
  }

  function flush() {
    timer = null;
    const rows = [...pending]; pending.clear();
    for (const [ty, m] of rows) {
      const txs = [...m.keys()].sort((a, b) => a - b);
      let run = [txs[0]];
      for (let i = 1; i < txs.length; i++) {
        if (txs[i] === run[run.length - 1] + 1 && run.length < o.maxRun) run.push(txs[i]);
        else { group(ty, run, m); run = [txs[i]]; }
      }
      group(ty, run, m);
    }
  }

  async function group(ty, txs, waiters) {
    stats.groups++;
    const ac = new AbortController();
    let to;
    const deadline = new Promise((_, reject) => { to = setTimeout(() => { stats.timeouts++; ac.abort(); reject(new Error(`prazo de ${o.deadlineMs} ms esgotado`)); }, o.deadlineMs); });
    try {
      const tiles = await Promise.race([readTiles(ty, txs[0], txs.length, ac.signal), deadline]);
      txs.forEach((tx, i) => { stats.tiles++; waiters.get(tx).forEach(w => w.resolve(tiles[i])); });
    } catch (e) {
      ac.abort();
      txs.forEach(tx => waiters.get(tx).forEach(w => w.reject(e)));
    } finally { clearTimeout(to); }
  }

  async function readTiles(ty, tx0, n, signal) {
    const T = o.tile, c0 = tx0 * T, cols = Math.min(n * T, o.width - c0), r0 = ty * T, rows = Math.min(T, o.height - r0);
    const outs = Array.from({ length: n }, () => { const body = Buffer.alloc(T * T * 2); for (let i = 0; i < T * T; i++) body.writeInt16LE(-32768, i * 2); return { body, valid: 0 }; });
    if (cols <= 0 || rows <= 0) return outs;
    let next = 0;
    const once = async (start, end) => {
      for (let attempt = 0; ; attempt++) {
        if (signal.aborted) throw new Error('cancelado');
        try {
          stats.requests++;
          const b = await o.fetchRange(start, end, signal);
          if (!b || b.length !== end - start + 1) throw new Error('faixa incompleta');
          return b;
        } catch (e) { if (attempt >= o.retries || signal.aborted) throw e; }
      }
    };
    const worker = async () => {
      while (next < rows) {
        if (signal.aborted) throw new Error('cancelado');
        const j = next++, off = o.dataStart + (r0 + j) * o.rowBytes + c0 * 4;
        const b = await once(off, off + cols * 4 - 1);
        for (let i = 0; i < cols; i++) {
          const v = b.readFloatLE(i * 4);
          if (v > -9000 && v < 30000) {
            const t = outs[Math.floor(i / T)], x = i % T;
            t.body.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((v + 2500) * 10))), (j * T + x) * 2); t.valid++;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.concurrency, rows) }, worker));
    return outs;
  }

  return { tile, stats };
}

module.exports = { createReader };
