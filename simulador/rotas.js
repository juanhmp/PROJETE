'use strict';
const BASE = process.env.OSRM_URL || 'https://router.project-osrm.org';
const dentro = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) &&
  p[0] >= -45.740 && p[0] <= -45.675 && p[1] >= -22.285 && p[1] <= -22.220;
function ponto(valor) {
  if (typeof valor !== 'string' || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(valor)) throw Object.assign(new Error('Coordenadas inválidas.'), { status: 400 });
  const p = valor.split(',').map(Number);
  if (!dentro(p)) throw Object.assign(new Error('Escolha uma rua dentro da área de demonstração.'), { status: 400 });
  return p;
}
async function consultar(tipo, params, solicitar = fetch) {
  const origem = ponto(params.get('origem'));
  let destinos = [];
  if (tipo === 'rota') {
    const lista = params.has('destinos') ? params.get('destinos').split(';') : [params.get('destino')];
    if (!lista.length || lista.length > 20) throw Object.assign(new Error('Selecione de 1 a 20 paradas.'), { status: 400 });
    destinos = lista.map(ponto);
  }
  const servico = destinos.length ? 'route' : 'nearest';
  const coords = [origem, ...destinos].map(p => p.join(',')).join(';');
  const url = new URL(`/${servico}/v1/driving/${coords}`, BASE);
  url.search = destinos.length ? `overview=full&geometries=geojson&steps=false&radiuses=${Array(destinos.length+1).fill(120).join(';')}&alternatives=false&continue_straight=false` : 'number=1&radiuses=250';
  let r, d;
  try { r = await solicitar(url, { signal: AbortSignal.timeout(12000) }); d = await r.json(); }
  catch { throw Object.assign(new Error('Sem conexão com o serviço de rotas. Verifique a internet e toque na rua novamente.'), { status: 503 }); }
  if (!r.ok || d.code !== 'Ok') throw Object.assign(new Error('Não encontrei uma rota de carro nesse ponto. Toque mais perto de uma rua.'), { status: 422 });
  if (!destinos.length) {
    const p = d.waypoints?.[0];
    if (!p || !dentro(p.location) || !Number.isFinite(p.distance) || p.distance > 250) throw Object.assign(new Error('Não há uma rua próxima à posição atual.'), { status: 422 });
    return { posicao: p.location, rua: p.name || 'Rua sem nome' };
  }
  const rota = d.routes?.[0];
  if (!rota || !Array.isArray(rota.geometry?.coordinates) || rota.geometry.coordinates.length < 2 ||
      !rota.geometry.coordinates.every(dentro) || d.waypoints?.length !== destinos.length + 1 ||
      !d.waypoints.every(p => dentro(p.location) && Number.isFinite(p.distance) && p.distance <= 120)) {
    throw Object.assign(new Error('A rota sai da área da demonstração ou não chega a uma rua próxima. Escolha outro destino.'), { status: 422 });
  }
  return { coordenadas: rota.geometry.coordinates,
    destino: d.waypoints[d.waypoints.length-1].name || 'Destino selecionado',
    paradas: d.waypoints.slice(1).map(p => ({lng:p.location[0],lat:p.location[1],nome:p.name || 'Rua selecionada'})) };
}
module.exports = { consultar };
