'use strict';
// Apenas tabelas simulacao_*. Nenhuma consulta ou escrita nas medições reais.
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const agregarAreas = require('../simulador/public/areas');
const LIMITES = { sul: -22.285, norte: -22.22, oeste: -45.74, leste: -45.675 };

function validarLote(body) {
  if (!body || typeof body.loteId !== 'string' || !/^[\w-]{8,100}$/.test(body.loteId)) {
    throw new Error('Identificação do lote inválida.');
  }
  if (!Array.isArray(body.medicoes) || !body.medicoes.length || body.medicoes.length > 5000) {
    throw new Error('Envie entre 1 e 5000 leituras.');
  }
  return body.medicoes.map((m) => {
    if (
      !m ||
      !['lat', 'lng', 'lux'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k])) ||
      m.lat < LIMITES.sul ||
      m.lat > LIMITES.norte ||
      m.lng < LIMITES.oeste ||
      m.lng > LIMITES.leste ||
      m.lux < 0 ||
      m.lux > 88000 ||
      typeof m.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(m.timestamp))
    ) {
      throw new Error(
        'Leitura inválida: confira a área de demonstração, os lux (0 a 88000) e a data.'
      );
    }
    const leitura = {
      lat: m.lat,
      lng: m.lng,
      lux: m.lux,
      timestamp: new Date(m.timestamp).toISOString(),
    };
    if (m.referencia !== undefined) {
      const p = m.referencia;
      if (
        !p ||
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lng) ||
        p.lat < LIMITES.sul ||
        p.lat > LIMITES.norte ||
        p.lng < LIMITES.oeste ||
        p.lng > LIMITES.leste
      ) {
        throw new Error('Coordenadas do ponto de referência inválidas.');
      }
      leitura.referencia = { lat: p.lat, lng: p.lng };
    }
    return leitura;
  });
}

function criarBanco(arquivo) {
  // Conexão própria e escrita atômica de todo o lote; não participa das transações do hardware.
  const db = new sqlite3.Database(arquivo);
  db.configure('busyTimeout', 5000);
  const run = (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.run(sql, params, function (e) {
        e ? reject(e) : resolve({ changes: this.changes });
      })
    );
  const get = (sql, params = []) =>
    new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
  const pronto = run(`CREATE TABLE IF NOT EXISTS simulacao_lotes (
    sequencia INTEGER PRIMARY KEY AUTOINCREMENT, lote_id TEXT NOT NULL UNIQUE,
    hash TEXT NOT NULL, medicoes TEXT NOT NULL, recebido_em TEXT NOT NULL
  )`);
  // Converte eventual falha de inicialização em erro HTTP quando houver uma requisição.
  pronto.catch((e) => console.error('Falha ao preparar simulação:', e.message));
  return {
    async salvar(loteId, medicoes) {
      await pronto;
      const json = JSON.stringify(medicoes);
      const hash = crypto.createHash('sha256').update(json).digest('hex');
      const r = await run(
        `INSERT INTO simulacao_lotes (lote_id, hash, medicoes, recebido_em)
        VALUES (?, ?, ?, ?) ON CONFLICT(lote_id) DO NOTHING`,
        [loteId, hash, json, new Date().toISOString()]
      );
      const salvo = await get('SELECT hash FROM simulacao_lotes WHERE lote_id = ?', [loteId]);
      if (salvo.hash !== hash) {
        const e = new Error('Este identificador já foi usado por outro lote.');
        e.status = 409;
        throw e;
      }
      return { loteId, quantidade: medicoes.length, repetido: r.changes === 0 };
    },
    async mapa() {
      await pronto;
      const lote = await get('SELECT * FROM simulacao_lotes ORDER BY sequencia DESC LIMIT 1');
      if (!lote) return { loteId: null, totalLeituras: 0, areas: [], recebidoEm: null };
      const medicoes = JSON.parse(lote.medicoes);
      return {
        loteId: lote.lote_id,
        recebidoEm: lote.recebido_em,
        totalLeituras: medicoes.length,
        areas: agregarAreas(medicoes),
      };
    },
    close: () => new Promise((resolve, reject) => db.close((e) => (e ? reject(e) : resolve()))),
  };
}

function instalar(app, opcoes = {}) {
  const banco = criarBanco(opcoes.arquivo || path.join(__dirname, '..', 'dados.db'));
  const pasta = path.join(__dirname, '..', 'simulador', 'public');
  app.use('/simulacao-assets', express.static(pasta));
  app.get('/mapa-simulado', (req, res) => res.sendFile(path.join(pasta, 'index.html')));
  app.get('/api/simulacao/mapa', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(await banco.mapa());
    } catch (e) {
      res.status(503).json({ mensagem: 'Não foi possível ler o mapa simulado. Tente novamente.' });
    }
  });
  app.post('/api/simulacao/descarregar', async (req, res) => {
    let medicoes;
    try {
      medicoes = validarLote(req.body);
    } catch (e) {
      return res.status(400).json({ mensagem: e.message });
    }
    try {
      const resultado = await banco.salvar(req.body.loteId, medicoes);
      res.status(resultado.repetido ? 200 : 201).json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(e.status || 503).json({
        mensagem: e.status
          ? e.message
          : 'Falha ao salvar. As leituras devem permanecer no microSD virtual; tente novamente.',
      });
    }
  });
  return banco;
}
module.exports = instalar;
module.exports.criarBanco = criarBanco;
module.exports.validarLote = validarLote;
