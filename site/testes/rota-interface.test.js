'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Percurso = require('../../simulador/public/percurso');
class Elemento {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.value = '6';
    this.disabled = false;
    this.textContent = '';
  }
  append(...e) {
    this.children.push(...e);
  }
  replaceChildren(...e) {
    this.children = e;
  }
  setAttribute() {}
  querySelectorAll(tag) {
    return this.children.flatMap((e) => [
      ...(e.tag === tag ? [e] : []),
      ...e.querySelectorAll(tag),
    ]);
  }
}
test('planejar, reordenar, iniciar e percorrer várias paradas sem sair antes da confirmação', async () => {
  const els = new Map();
  const $ = (id) => {
    if (!els.has(id)) els.set(id, new Elemento());
    return els.get(id);
  };
  const frames = new Map();
  let frame = 0,
    pos = { lat: -22.252, lng: -45.704 },
    rotas = 0,
    ultimoPedido;
  const camadas = new Set(),
    handlers = {},
    visitados = new Set();
  const mapa = {
    on: (n, f) => (handlers[n] = f),
    setView() {},
    getZoom: () => 16,
    panTo() {},
    removeLayer: (m) => camadas.delete(m),
  };
  const layer = () => ({
    addTo() {
      camadas.add(this);
      return this;
    },
  });
  const truck = {
    setOpacity() {},
    setLatLng(p) {
      pos = { lat: p[0], lng: p[1] };
    },
    getLatLng: () => pos,
    getElement: () => null,
  };
  const ambiente = {
    window: { addEventListener() {} },
    document: {
      getElementById: $,
      createElement: (t) => new Elemento(t),
      addEventListener() {},
      hidden: false,
    },
    L: { marker: layer, polyline: layer, circleMarker: layer, divIcon: (x) => x },
    Percurso,
    URLSearchParams,
    AbortController,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: (f) => {
      frames.set(++frame, f);
      return frame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    fetch: async (url) => {
      const u = new URL(url, 'http://localhost');
      if (u.pathname.endsWith('/rua'))
        return { ok: true, json: async () => ({ posicao: [pos.lng, pos.lat], rua: 'Inicial' }) };
      rotas++;
      ultimoPedido = u.searchParams.get('destinos');
      const pontos = ultimoPedido.split(';').map((p) => p.split(',').map(Number));
      const dados = {
        coordenadas: [[pos.lng, pos.lat], ...pontos],
        paradas: pontos.map(([lng, lat], i) => ({ lng, lat, nome: 'Rua ' + i })),
      };
      return { ok: true, json: async () => dados };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../../simulador/public/navegacao.js'), 'utf8'),
    ambiente
  );
  const a = { lat: -22.252, lng: -45.703 },
    b = { lat: -22.251, lng: -45.703 };
  const nav = ambiente.window.criarNavegacao({
    mapa,
    truck,
    obterEstado: () => pos,
    definirPosicao: (p) => (pos = p),
    persistir: () => true,
    travado: () => false,
    atualizar() {},
    aviso() {},
    pausarColeta() {},
    aoMover() {
      for (const [nome, p] of [
        ['a', a],
        ['b', b],
      ])
        if (Percurso.distancia([pos.lng, pos.lat], [p.lng, p.lat]) < 10) visitados.add(nome);
    },
  });
  await nav.inicializar();
  nav.destino(a);
  nav.destino(b);
  assert.equal(rotas, 0);
  assert.equal(frames.size, 0);
  assert.equal($('listaParadas').children.length, 2);
  $('listaParadas').children[1].children[1].children[0].onclick(); // segunda parada sobe
  await $('iniciarRota').onclick();
  assert.equal(ultimoPedido, `${b.lng},${b.lat};${a.lng},${a.lat}`);
  assert.equal(rotas, 1);
  for (let t = 1; t < 30001 && frames.size; t += 100) {
    for (const [id, f] of [...frames]) {
      frames.delete(id);
      f(t);
    }
  }
  assert.deepEqual([...visitados].sort(), ['a', 'b']);
  assert.equal(pos.lat, a.lat);
  assert.equal(pos.lng, a.lng);
  assert.match($('distanciaRota').textContent, /Todas as paradas/);
  $('limparRota').onclick();
  assert.equal($('listaParadas').children.length, 0);
  assert.ok($('iniciarRota').disabled);
});
