'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const viewer = location.pathname === '/mapa-simulado';
  const KEY = 'lightsentinel.microsd.v1';
  const CENTRO = [-22.252, -45.704];
  const limites = [
    [-22.285, -45.74],
    [-22.22, -45.675],
  ];
  let state = { lat: CENTRO[0], lng: CENTRO[1], lux: 20, medicoes: [], loteId: null };
  let ocupado = false,
    timer = null,
    bloqueado = false,
    heat = null,
    areas = [],
    navegacao = null,
    iluminacao = null,
    ultimoPontoColetado = null;
  function aviso(texto, erro = false) {
    $('mensagem').textContent = texto;
    $('mensagem').classList.toggle('error', erro);
  }
  if (!window.L || !L.heatLayer) {
    aviso('Não foi possível carregar o mapa. Recarregue a página.', true);
    return;
  }
  const dentro = (m) =>
    Number.isFinite(m.lat) &&
    Number.isFinite(m.lng) &&
    m.lat >= limites[0][0] &&
    m.lat <= limites[1][0] &&
    m.lng >= limites[0][1] &&
    m.lng <= limites[1][1];
  const leituraValida = (m) =>
    m &&
    dentro(m) &&
    Number.isFinite(m.lux) &&
    m.lux >= 0 &&
    m.lux <= 88000 &&
    typeof m.timestamp === 'string' &&
    Number.isFinite(Date.parse(m.timestamp)) &&
    (m.referencia === undefined || (m.referencia && dentro(m.referencia)));
  if (!viewer) {
    try {
      const salvo = localStorage.getItem(KEY);
      if (salvo) {
        const s = JSON.parse(salvo);
        if (
          !s ||
          !dentro(s) ||
          !Number.isFinite(s.lux) ||
          s.lux < 0 ||
          s.lux > 88000 ||
          !Array.isArray(s.medicoes) ||
          s.medicoes.length > 5000 ||
          !s.medicoes.every(leituraValida) ||
          !(s.loteId === null || (typeof s.loteId === 'string' && /^[\w-]{8,100}$/.test(s.loteId)))
        )
          throw new Error();
        state = s;
      }
    } catch {
      bloqueado = true;
      aviso(
        'O microSD virtual não pôde ser aberto. Confira o armazenamento do navegador; os dados existentes não foram sobrescritos.',
        true
      );
    }
  }
  function salvar(proximo) {
    try {
      localStorage.setItem(KEY, JSON.stringify(proximo));
      state = proximo;
      return true;
    } catch {
      parar();
      navegacao?.pausar(false);
      aviso(
        'Não foi possível guardar os dados no navegador. Libere espaço ou permita armazenamento antes de continuar.',
        true
      );
      return false;
    }
  }
  const mapa = L.map('map', {
    maxBounds: limites,
    maxBoundsViscosity: 1,
    minZoom: 13,
    maxZoom: 18,
    doubleClickZoom: false,
  }).setView(CENTRO, 14);
  let tileError = false;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    referrerPolicy: 'origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
    .on('tileerror', () => {
      if (!tileError) {
        tileError = true;
        aviso('O mapa de ruas precisa de internet. Verifique a conexão da rede Wi-Fi.', true);
      }
    })
    .addTo(mapa);
  mapa.createPane('heatPane');
  mapa.getPane('heatPane').style.pointerEvents = 'none';
  mapa.getPane('heatPane').style.opacity = '.70';
  function desenhar() {
    if (heat) {
      mapa.removeLayer(heat);
      heat = null;
    }
    if (!areas.length) return;
    const pontos = areas.map((a) => [
      a.lat,
      a.lng,
      Math.max(0.08, Math.min(0.95, 1 - a.lux / 100)),
    ]);
    heat = L.heatLayer(pontos, {
      radius: 22 + (mapa.getZoom() - 13) * 5,
      blur: 20,
      max: 0.95,
      maxZoom: 14,
      minOpacity: 0.2,
      pane: 'heatPane',
      gradient: {
        0.12: '#00008b',
        0.32: '#06b6d4',
        0.5: '#22c55e',
        0.67: '#eab308',
        0.82: '#f97316',
        1: '#ef4444',
      },
    }).addTo(mapa);
  }
  mapa.on('zoomend', desenhar);
  $('centralizar').onclick = () => mapa.setView(viewer ? CENTRO : [state.lat, state.lng], 14);
  if (viewer) {
    document.body.classList.add('viewer');
    $('titulo').textContent = 'Mapa de calor simulado';
    $('descricao').textContent =
      'Leituras da demonstração, publicadas após descarregar o microSD virtual.';
    $('estado').textContent = 'DADOS SIMULADOS';
    $('mapHint').textContent =
      'Toque em uma área para consultar a média de lux. Atualiza a cada 3 segundos.';
    $('rodape').textContent = 'Exibindo o último lote descarregado';
    let carregando = false;
    async function atualizar() {
      if (carregando) return;
      carregando = true;
      try {
        const r = await fetch('/api/simulacao/mapa', {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error();
        const d = await r.json();
        areas = d.areas;
        desenhar();
        $('mapStatus').textContent =
          `${d.totalLeituras} leituras • ${areas.length} áreas • ${d.recebidoEm ? 'Último envio: ' + new Date(d.recebidoEm).toLocaleString('pt-BR') : 'Nenhum lote recebido'}`;
        aviso(
          d.totalLeituras
            ? 'Mapa atualizado com o último lote confirmado.'
            : 'Aguardando o primeiro descarregamento no simulador.'
        );
      } catch {
        aviso(
          'Sem conexão com o servidor. Exibindo o último mapa carregado; tentando novamente.',
          true
        );
      } finally {
        carregando = false;
      }
    }
    mapa.on('click', (e) => {
      const clique = mapa.latLngToContainerPoint(e.latlng);
      let a = null,
        menor = 30;
      for (const area of areas) {
        const distancia = mapa.latLngToContainerPoint([area.lat, area.lng]).distanceTo(clique);
        if (distancia < menor) {
          menor = distancia;
          a = area;
        }
      }
      L.popup()
        .setLatLng(e.latlng)
        .setContent(
          a
            ? `<strong>${a.lux.toFixed(1)} lux</strong><br>${a.quantidade} leituras nesta área`
            : 'Sem leituras nesta área.'
        )
        .openOn(mapa);
    });
    atualizar();
    setInterval(atualizar, 3000);
    return;
  }
  fetch('/config.json')
    .then((r) => r.json())
    .then((c) => {
      const site = new URL(location.href);
      site.port = c.portaSite;
      site.pathname = '/mapa-simulado';
      site.search = '';
      site.hash = '';
      $('voltar').href = site.href;
      $('voltar').textContent = 'Ver mapa publicado ↗';
      $('voltar').target = '_blank';
      $('voltar').rel = 'noopener';
    })
    .catch(() => {
      $('voltar').hidden = true;
    });
  // Caminhão visto de cima: gira na direção do próximo trecho da rua.
  const truck = L.marker([state.lat, state.lng], {
    draggable: false,
    interactive: false,
    zIndexOffset: 1000,
    icon: L.divIcon({
      className: 'truck',
      iconSize: [60, 60],
      iconAnchor: [30, 30],
      html: `<div class="truck-heading"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="white" fill-opacity=".93"/><path d="M32 1l6 9H26z" fill="#4c6fff"/><rect x="14" y="18" width="7" height="12" rx="3" fill="#253345"/><rect x="43" y="18" width="7" height="12" rx="3" fill="#253345"/><rect x="17" y="45" width="7" height="12" rx="3" fill="#253345"/><rect x="40" y="45" width="7" height="12" rx="3" fill="#253345"/><rect x="20" y="29" width="24" height="28" rx="5" fill="#b9e87b" stroke="#254c3b" stroke-width="2.5"/><path d="M20 27V16q0-6 6-6h12q6 0 6 6v11z" fill="#73baee" stroke="#253345" stroke-width="2.5"/><path d="M24 17h16v8H24z" fill="#e8f8ff"/><path d="M25 36h14m-14 7h14m-14 7h14" stroke="#86b650" stroke-width="2"/><rect x="21" y="9" width="6" height="3" rx="1" fill="#ffec8b"/><rect x="37" y="9" width="6" height="3" rx="1" fill="#ffec8b"/></svg></div>`,
    }),
  }).addTo(mapa);
  iluminacao = criarIluminacao({
    mapa,
    travado: () => ocupado || bloqueado || !!state.loteId,
    pausar: () => {
      parar();
      navegacao?.pausar();
    },
    dirigir: (p) => navegacao?.destino(p),
    aviso,
    atualizar: () => {
      ultimoPontoColetado = null;
      atualizarUI();
      if (!iluminacao?.editando) navegacao?.inicializar();
    },
  });
  function atualizarSensor() {
    const ponto = iluminacao.sensor(state);
    state = { ...state, lux: ponto ? ponto.lux : 0 };
    $('sensorAtual').textContent = ponto
      ? `${ponto.lux} lux no local do caminhão`
      : 'Sem ponto de iluminação próximo';
    return ponto;
  }
  navegacao = criarNavegacao({
    mapa,
    truck,
    obterEstado: () => state,
    definirPosicao(p) {
      state = { ...state, lat: p.lat, lng: p.lng };
      $('coordenadas').textContent = `GPS ${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
      atualizarSensor();
    },
    persistir: () => salvar({ ...state }),
    travado: () =>
      ocupado || bloqueado || !!state.loteId || iluminacao.editando || iluminacao.invalido,
    atualizar: atualizarUI,
    aviso,
    pausarColeta: parar,
    cliqueMapa: (p) => iluminacao.clique(p),
    aoMover() {
      const ponto = atualizarSensor();
      if (!ponto) {
        ultimoPontoColetado = null;
        return;
      }
      if (ponto.id !== ultimoPontoColetado && registrar()) ultimoPontoColetado = ponto.id;
    },
  });
  function atualizarUI() {
    const travado = ocupado || bloqueado || !!state.loteId;
    $('quantidade').textContent = state.medicoes.length;
    $('coordenadas').textContent = `GPS ${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
    atualizarSensor();
    iluminacao?.controles();
    $('registrar').disabled =
      travado ||
      iluminacao.editando ||
      iluminacao.invalido ||
      !iluminacao.sensor(state) ||
      !navegacao?.pronto ||
      navegacao.carregando ||
      state.medicoes.length >= 5000;
    $('automatico').disabled = $('registrar').disabled;
    $('lux').disabled = travado;
    $('luxRange').disabled = travado;
    document.querySelectorAll('[data-lux]').forEach((b) => (b.disabled = travado));
    $('descarregar').disabled = ocupado || bloqueado || state.medicoes.length === 0;
    $('descarregar').textContent = ocupado
      ? 'Descarregando…'
      : state.loteId
        ? 'Descarregar novamente'
        : 'Descarregar';
    $('automatico').textContent = timer
      ? 'Pausar coleta automática'
      : 'Iniciar coleta a cada 1 segundo';
    $('estado').textContent = ocupado
      ? 'ENVIANDO LOTE'
      : timer
        ? 'COLETANDO • MICROSD VIRTUAL'
        : 'SIMULADOR DE HARDWARE';
    navegacao?.controles();
    truck.setLatLng([state.lat, state.lng]);
    $('leituras').replaceChildren(
      ...state.medicoes
        .slice(-3)
        .reverse()
        .map((m) => {
          const li = document.createElement('li');
          li.textContent = `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)} • ${m.lux} lux`;
          return li;
        })
    );
    areas = agregarAreasSimuladas(state.medicoes);
    desenhar();
    $('mapStatus').textContent =
      `${state.medicoes.length} leituras no microSD virtual • Prévia local, ainda não publicada`;
  }
  function ajustarLux(valor) {
    if (ocupado || bloqueado || state.loteId) return;
    if (
      valor === '' ||
      !Number.isFinite(Number(valor)) ||
      Number(valor) < 0 ||
      Number(valor) > 88000
    ) {
      aviso('Informe uma iluminação entre 0 e 88000 lux.', true);
      return false;
    }
    $('lux').value = Number(valor);
    $('luxRange').value = Math.min(100, Number(valor));
    return true;
  }
  $('lux').onchange = (e) => ajustarLux(e.target.value);
  $('luxRange').oninput = (e) => ajustarLux(e.target.value);
  document
    .querySelectorAll('[data-lux]')
    .forEach((b) => (b.onclick = () => ajustarLux(b.dataset.lux)));
  function registrar() {
    if (
      ocupado ||
      bloqueado ||
      state.loteId ||
      !navegacao.pronto ||
      navegacao.carregando ||
      iluminacao.editando ||
      iluminacao.invalido
    )
      return;
    if (state.medicoes.length >= 5000) {
      parar();
      navegacao.pausar();
      aviso('MicroSD virtual cheio (5000 leituras). Descarregue para continuar.', true);
      return;
    }
    const ponto = atualizarSensor();
    if (!ponto) return;
    const leitura = {
      lat: state.lat,
      lng: state.lng,
      lux: ponto.lux,
      timestamp: new Date().toISOString(),
      referencia: { lat: ponto.lat, lng: ponto.lng },
    };
    if (salvar({ ...state, medicoes: [...state.medicoes, leitura] })) {
      aviso('Leitura guardada no microSD virtual.');
      if (state.medicoes.length >= 5000) {
        parar();
        navegacao.pausar();
        aviso('MicroSD virtual cheio. Descarregue para continuar.');
      }
      atualizarUI();
      return true;
    }
  }
  function parar() {
    clearInterval(timer);
    timer = null;
  }
  $('registrar').onclick = registrar;
  $('automatico').onclick = () => {
    if (timer) {
      parar();
      atualizarUI();
      return;
    }
    const registrada = registrar();
    if (registrada && !ocupado && !bloqueado && !state.loteId && state.medicoes.length < 5000)
      timer = setInterval(registrar, 1000);
    atualizarUI();
  };
  $('descarregar').onclick = async () => {
    if (ocupado || bloqueado || !state.medicoes.length) return;
    parar();
    navegacao.pausar();
    // getRandomValues também funciona em HTTP pelo IP do computador, sem exigir HTTPS.
    if (!state.loteId) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const loteId = 'SIM-' + [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
      if (!salvar({ ...state, loteId })) return;
    }
    ocupado = true;
    atualizarUI();
    aviso('Conexão simulada: enviando todas as leituras ao servidor…');
    try {
      const r = await fetch('/api/simulacao/descarregar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loteId: state.loteId, medicoes: state.medicoes }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      if (
        !r.ok ||
        !d.sucesso ||
        d.loteId !== state.loteId ||
        d.quantidade !== state.medicoes.length
      )
        throw new Error(d.mensagem || 'O servidor não confirmou o lote completo.');
      if (salvar({ ...state, medicoes: [], loteId: null }))
        aviso(
          `${d.quantidade} leituras descarregadas! MicroSD virtual vazio e mapa simulado atualizado. Você pode iniciar uma nova coleta.`
        );
    } catch (e) {
      aviso(
        `${e.message || 'Falha no envio.'} Leituras preservadas. Use “Descarregar novamente” antes de iniciar outra coleta.`,
        true
      );
    } finally {
      ocupado = false;
      atualizarUI();
      navegacao.inicializar();
    }
  };
  // Uma segunda aba não deve sobrescrever leituras que outra aba acabou de guardar.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) {
      bloqueado = true;
      parar();
      navegacao.pausar(false);
      atualizarUI();
      aviso(
        'Outra aba alterou o microSD virtual. Recarregue esta página antes de continuar.',
        true
      );
    }
  });
  window.addEventListener('pagehide', parar);
  atualizarUI();
  if (!bloqueado && state.loteId)
    aviso(
      'Existe um descarregamento sem confirmação. Reenvie o mesmo lote para concluir com segurança.'
    );
  else if (!bloqueado && state.medicoes.length)
    aviso(`${state.medicoes.length} leituras recuperadas do microSD virtual.`);
})();
