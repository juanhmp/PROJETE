'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { consultar } = require('../../simulador/rotas');
const P = require('../../simulador/public/percurso');
const origem = [-45.704, -22.252],
  esquina = [-45.703, -22.252],
  destino = [-45.703, -22.251];
const params = new URLSearchParams({ origem: origem.join(','), destino: destino.join(',') });
const resposta = (coords) => ({
  ok: true,
  json: async () => ({
    code: 'Ok',
    waypoints: [
      { location: origem, distance: 1 },
      { location: destino, distance: 2, name: 'Rua de destino' },
    ],
    routes: [{ geometry: { coordinates: coords } }],
  }),
});
test('movimento acompanha esquina, sem cortar diagonal, com distância e direção', () => {
  const r = P.preparar([origem, origem, esquina, destino]);
  assert.equal(r.pontos.length, 3);
  const a = P.posicao(r, r.acumulado[1] / 2);
  assert.equal(a.lat, origem[1]);
  assert.ok(Math.abs(a.angulo - 90) < 0.01);
  const b = P.posicao(r, r.acumulado[1] + (r.total - r.acumulado[1]) / 2);
  assert.equal(b.lng, destino[0]);
  assert.ok(Math.abs(b.angulo) < 0.01);
  const fim = P.posicao(r, r.total + 500);
  assert.equal(fim.lng, destino[0]);
  assert.equal(fim.lat, destino[1]);
});
test('rota conserva todos os pontos da rua e pede geometria completa ao serviço', async () => {
  const d = await consultar('rota', params, async (url) => {
    assert.equal(url.searchParams.get('overview'), 'full');
    assert.equal(url.searchParams.get('geometries'), 'geojson');
    return resposta([origem, esquina, destino]);
  });
  assert.deepEqual(d.coordenadas, [origem, esquina, destino]);
});
test('falhas e pontos fora da cidade não viram rotas em linha reta', async () => {
  await assert.rejects(
    consultar('rota', new URLSearchParams({ origem: '0,0', destino: destino.join(',') })),
    { status: 400 }
  );
  await assert.rejects(
    consultar('rota', params, async () => {
      throw Error('rede');
    }),
    { status: 503 }
  );
  await assert.rejects(
    consultar('rota', params, async () => ({ ok: false, json: async () => ({ code: 'NoRoute' }) })),
    { status: 422 }
  );
  await assert.rejects(
    consultar('rota', params, async () => resposta([origem, [0, 0], destino])),
    { status: 422 }
  );
  await assert.rejects(
    consultar('rota', params, async () => {
      const r = resposta([origem, destino]);
      const d = await r.json();
      d.waypoints[1].distance = 121;
      return { ok: true, json: async () => d };
    }),
    { status: 422 }
  );
});
test('posição inicial é corrigida para uma rua próxima', async () => {
  const r = await consultar('rua', params, async () => ({
    ok: true,
    json: async () => ({
      code: 'Ok',
      waypoints: [{ location: esquina, distance: 15, name: 'Rua A' }],
    }),
  }));
  assert.deepEqual(r.posicao, esquina);
  await assert.rejects(
    consultar('rua', params, async () => ({
      ok: true,
      json: async () => ({ code: 'Ok', waypoints: [{ location: esquina, distance: 251 }] }),
    })),
    { status: 422 }
  );
});
test('rota de várias paradas mantém a ordem e retorna todas as referências', async () => {
  const paradas = [destino, esquina, origem];
  const p = new URLSearchParams({
    origem: origem.join(','),
    destinos: paradas.map((p) => p.join(',')).join(';'),
  });
  const r = await consultar('rota', p, async (url) => {
    assert.equal(
      url.pathname.split('/').pop(),
      [origem, ...paradas].map((p) => p.join(',')).join(';')
    );
    assert.equal(url.searchParams.get('radiuses'), '120;120;120;120');
    return {
      ok: true,
      json: async () => ({
        code: 'Ok',
        waypoints: [origem, ...paradas].map((location, i) => ({
          location,
          distance: 0,
          name: 'Rua ' + i,
        })),
        routes: [{ geometry: { coordinates: [origem, ...paradas] } }],
      }),
    };
  });
  assert.deepEqual(
    r.paradas.map((p) => [p.lng, p.lat]),
    paradas
  );
});
test('rejeita lista vazia, excessiva ou parada inválida antes de consultar rotas', async () => {
  for (const destinos of [
    '',
    Array(21).fill(destino.join(',')).join(';'),
    destino.join(',') + ';0,0',
  ]) {
    await assert.rejects(
      consultar('rota', new URLSearchParams({ origem: origem.join(','), destinos }), () => {
        throw Error('Não deveria chamar serviço');
      }),
      { status: 400 }
    );
  }
});
test('rejeita resposta que omita uma das paradas escolhidas', async () => {
  const p = new URLSearchParams({
    origem: origem.join(','),
    destinos: [esquina, destino].map((p) => p.join(',')).join(';'),
  });
  await assert.rejects(
    consultar('rota', p, async () => resposta([origem, esquina, destino])),
    { status: 422 }
  );
});
