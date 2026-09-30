'use strict';
(function (root) {
  // Localização de referência da ETE FMC; tolerância cobre o acesso pela rua.
  const CENTRAL = Object.freeze({
    lat: -22.25724663,
    lng: -45.70340646,
    nome: 'Escola Técnica Francisco Moreira da Costa',
    raio: 80,
    saida: 110,
  });
  function criarDetector(distancia, aoChegar) {
    let dentro = false;
    return (posicao, habilitado = true) => {
      const metros = distancia([posicao.lng, posicao.lat], [CENTRAL.lng, CENTRAL.lat]);
      if (metros > CENTRAL.saida) dentro = false;
      if (habilitado && !dentro && metros <= CENTRAL.raio) {
        dentro = true;
        aoChegar();
      }
    };
  }
  function instalar({
    mapa,
    obterEstado,
    travado,
    pausar,
    atualizar,
    descarregar,
    adicionarParada,
  }) {
    const $ = (id) => document.getElementById(id);
    const dialogo = $('confirmarCentral');
    const marcador = L.marker([CENTRAL.lat, CENTRAL.lng], {
      icon: L.divIcon({
        className: 'central-marker',
        html: '<span>⌂</span>',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
      title: `Central • ${CENTRAL.nome}`,
      zIndexOffset: 600,
    }).addTo(mapa);
    marcador.bindTooltip(`Central • ${CENTRAL.nome}`);
    const adicionar = () => {
      if (!travado()) adicionarParada(CENTRAL);
    };
    marcador.on('click', adicionar);
    $('adicionarCentral').onclick = adicionar;
    const verificar = criarDetector(Percurso.distancia, () => {
      pausar();
      atualizar();
      $('resumoCentral').textContent =
        `Você chegou à ${CENTRAL.nome}. Deseja descarregar as ${obterEstado().medicoes.length} leituras guardadas?`;
      dialogo.showModal();
    });
    $('cancelarCentral').onclick = () => dialogo.close();
    $('descarregarCentral').onclick = async () => {
      dialogo.close();
      await descarregar();
    };
    return {
      verificar(posicao) {
        verificar(posicao, !travado() && obterEstado().medicoes.length > 0);
      },
      controles() {
        $('adicionarCentral').disabled = travado();
      },
    };
  }
  const api = { CENTRAL, criarDetector, instalar };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CentralSimulada = api;
})(typeof window !== 'undefined' ? window : globalThis);
