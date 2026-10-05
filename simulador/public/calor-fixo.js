/* Camada de calor com extensão geográfica fixa, independente do zoom da tela. */
(function (root) {
  'use strict';
  const ZOOM_REFERENCIA = 15;
  const GRADIENTE = {
    0.12: '#0000ff',
    0.22: '#0000ff',
    0.32: '#06b6d4',
    0.5: '#22c55e',
    0.67: '#eab308',
    0.82: '#f97316',
    1: '#ef4444',
  };

  root.criarCalorFixo = function (pontos, limites, opcoes = {}) {
    const L = root.L;
    const bounds = L.latLngBounds(limites);
    const crs = L.CRS.EPSG3857;
    const origem = crs.latLngToPoint(bounds.getNorthWest(), ZOOM_REFERENCIA);
    const fim = crs.latLngToPoint(bounds.getSouthEast(), ZOOM_REFERENCIA);
    // Versão calor-menor, com alcance reduzido em mais um terço.
    // O raster inteiro mantém essa escala, inclusive ao mover ou ampliar o mapa.
    const raio = 18;
    const suavizacao = 14;
    const margem = raio + suavizacao;
    const celula = margem / 2;
    const grupos = new Map();
    for (const p of pontos) {
      if (!p.every(Number.isFinite) || !bounds.contains([p[0], p[1]])) continue;
      const pixel = crs.latLngToPoint(L.latLng(p[0], p[1]), ZOOM_REFERENCIA);
      const x = pixel.x - origem.x;
      const y = pixel.y - origem.y;
      const intensidade = Math.max(0, Math.min(0.95, p[2]));
      if (!intensidade) continue;
      // A grade é ancorada na cidade, nunca na posição da janela do navegador.
      const chave = `${Math.floor(x / celula)},${Math.floor(y / celula)}`;
      const anterior = grupos.get(chave);
      if (anterior) {
        const soma = anterior[2] + intensidade;
        anterior[0] = (anterior[0] * anterior[2] + x * intensidade) / soma;
        anterior[1] = (anterior[1] * anterior[2] + y * intensidade) / soma;
        anterior[2] = soma;
      } else grupos.set(chave, [x, y, intensidade]);
    }
    if (!grupos.size) return null;
    const dados = [...grupos.values()];
    // Recortar a imagem à área medida reduz memória e trabalho no tablet.
    let esquerda = Infinity, topo = Infinity, direita = -Infinity, base = -Infinity;
    for (const p of dados) {
      esquerda = Math.min(esquerda, p[0] - margem);
      topo = Math.min(topo, p[1] - margem);
      direita = Math.max(direita, p[0] + margem);
      base = Math.max(base, p[1] + margem);
    }
    esquerda = Math.max(0, Math.floor(esquerda));
    topo = Math.max(0, Math.floor(topo));
    direita = Math.min(Math.ceil(fim.x - origem.x), Math.ceil(direita));
    base = Math.min(Math.ceil(fim.y - origem.y), Math.ceil(base));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, direita - esquerda);
    canvas.height = Math.max(1, base - topo);
    root.simpleheat(canvas)
      .radius(raio, suavizacao)
      .gradient(GRADIENTE)
      .max(0.95)
      .data(dados.map((p) => [p[0] - esquerda, p[1] - topo, Math.min(0.95, p[2])]))
      .draw(opcoes.minOpacity ?? 0.18);
    const noroeste = crs.pointToLatLng(L.point(origem.x + esquerda, origem.y + topo), ZOOM_REFERENCIA);
    const sudeste = crs.pointToLatLng(L.point(origem.x + direita, origem.y + base), ZOOM_REFERENCIA);
    return L.imageOverlay(canvas.toDataURL('image/png'), L.latLngBounds(noroeste, sudeste), {
      pane: opcoes.pane || 'heatPane',
      interactive: false,
    });
  };
})(window);
