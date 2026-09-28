'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sqlite3 = require('sqlite3');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const instalar = require('../simulador/integracao');

test('lotes simulados: validação, repetição, concorrência, persistência e isolamento', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ls-simulador-'));
  const arquivo = path.join(dir, 'dados.db');
  const original = new sqlite3.Database(arquivo);
  await new Promise((resolve, reject) =>
    original.exec(
      'CREATE TABLE medicoes (id INTEGER, luminosidade REAL); INSERT INTO medicoes VALUES (99,42); CREATE TABLE ocorrencias (id INTEGER); INSERT INTO ocorrencias VALUES (7);',
      (e) => (e ? reject(e) : resolve())
    )
  );
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  let banco = instalar(app, { arquivo });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const leitura = { lat: -22.252, lng: -45.704, lux: 150, timestamp: '2026-09-28T12:00:00.000Z' };
  const post = (data) =>
    fetch(base + '/api/simulacao/descarregar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  const mapa = async () => (await fetch(base + '/api/simulacao/mapa')).json();
  try {
    assert.equal((await mapa()).totalLeituras, 0);
    for (const medicoes of [
      [],
      [null],
      [{ ...leitura, lux: -1 }],
      [{ ...leitura, lux: '20' }],
      [{ ...leitura, lat: 0 }],
      [{ ...leitura, timestamp: 'inválido' }],
      Array(5001).fill(leitura),
    ]) {
      assert.equal((await post({ loteId: 'SIM-invalid', medicoes })).status, 400);
    }
    assert.equal((await mapa()).totalLeituras, 0);
    const primeiro = { loteId: 'SIM-primeiro', medicoes: [leitura, { ...leitura, lux: 50 }] };
    assert.equal((await post(primeiro)).status, 201);
    assert.equal((await mapa()).areas[0].lux, 100);
    assert.equal((await post(primeiro)).status, 200);
    assert.equal((await post({ ...primeiro, medicoes: [leitura] })).status, 409);
    assert.equal(
      (await post({ loteId: 'SIM-parcial', medicoes: [leitura, { ...leitura, lux: null }] }))
        .status,
      400
    );
    assert.equal((await mapa()).loteId, primeiro.loteId);
    const segundo = { loteId: 'SIM-segundo', medicoes: [{ ...leitura, lux: 0 }] };
    const simultaneos = await Promise.all([post(segundo), post(segundo)]);
    assert.deepEqual(simultaneos.map((r) => r.status).sort(), [200, 201]);
    assert.equal((await mapa()).totalLeituras, 1);
    assert.equal((await mapa()).areas[0].lux, 0);
    await post(primeiro); // reenvio antigo não substitui a publicação nova
    assert.equal((await mapa()).loteId, segundo.loteId);
    const rows = await new Promise((resolve, reject) =>
      original.all('SELECT * FROM medicoes', (e, r) => (e ? reject(e) : resolve(r)))
    );
    assert.deepEqual(rows, [{ id: 99, luminosidade: 42 }]);
    assert.equal((await fetch(base + '/mapa-simulado')).status, 200);
    await banco.close();
    banco = instalar.criarBanco(arquivo);
    assert.equal((await banco.mapa()).loteId, segundo.loteId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await banco.close();
    await new Promise((resolve) => original.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
