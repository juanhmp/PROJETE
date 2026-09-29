'use strict';
window.criarIluminacao = function ({ mapa, travado, pausar, dirigir, aviso, atualizar }) {
  const KEY = 'lightsentinel.iluminacao.v1',
    RAIO = 20,
    $ = (id) => document.getElementById(id);
  let pontos = [],
    modo = 'editar',
    selecionado = null,
    camadas = [],
    rascunho = null,
    buscando = false,
    serial = 0,
    invalido = false;
  const dentro = (p) =>
    p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -22.285 &&
    p.lat <= -22.22 &&
    p.lng >= -45.74 &&
    p.lng <= -45.675;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (
        !Array.isArray(v) ||
        v.length > 500 ||
        !v.every(
          (p) =>
            dentro(p) &&
            typeof p.id === 'string' &&
            Number.isFinite(p.lux) &&
            p.lux >= 0 &&
            p.lux <= 88000
        )
      )
        throw Error();
      pontos = v;
    }
  } catch {
    invalido = true;
    aviso(
      'Não foi possível abrir os pontos de iluminação. Os dados existentes foram preservados.',
      true
    );
  }
  function persistir(novos) {
    try {
      localStorage.setItem(KEY, JSON.stringify(novos));
      pontos = novos;
      return true;
    } catch {
      aviso('Não foi possível guardar a iluminação neste navegador.', true);
      return false;
    }
  }
  function cor(lux) {
    return lux >= 80 ? '#00008b' : lux >= 50 ? '#22c55e' : lux >= 20 ? '#eab308' : '#ef4444';
  }
  function controles() {
    const lock = travado() || invalido || buscando;
    $('salvarPonto').disabled = lock || !selecionado || modo !== 'editar';
    $('excluirPonto').disabled = lock || !selecionado?.id || modo !== 'editar';
    $('modoEditar').disabled = travado() || invalido;
    $('modoDirigir').disabled = travado();
    $('modoEditar').setAttribute('aria-pressed', String(modo === 'editar'));
    $('modoDirigir').setAttribute('aria-pressed', String(modo === 'dirigir'));
    $('pontoSelecionado').textContent = buscando
      ? 'Localizando a rua…'
      : selecionado
        ? `Ponto: ${selecionado.lat.toFixed(6)}, ${selecionado.lng.toFixed(6)}`
        : 'Toque na rua para definir um ponto.';
    $('totalPontos').textContent =
      `${pontos.length} pontos configurados • detecção a até ${RAIO} m`;
    $('mapHint').textContent =
      modo === 'editar'
        ? '1. Toque na rua, escolha os lux e salve o ponto.'
        : '2. Toque nas paradas, na ordem desejada, e clique em Iniciar rota.';
  }
  function selecionar(p) {
    if (travado() || invalido) return;
    serial++;
    buscando = false;
    selecionado = { ...p };
    $('lux').value = p.lux ?? 20;
    $('luxRange').value = Math.min(100, p.lux ?? 20);
    if (rascunho) mapa.removeLayer(rascunho);
    rascunho = L.circleMarker([p.lat, p.lng], {
      radius: 13,
      color: '#111827',
      weight: 3,
      fillOpacity: 0,
      interactive: false,
    }).addTo(mapa);
    controles();
  }
  function desenhar() {
    camadas.forEach((c) => mapa.removeLayer(c));
    camadas = [];
    for (const p of pontos) {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: cor(p.lux),
        fillOpacity: 1,
        bubblingMouseEvents: false,
      })
        .bindTooltip(`${p.lux} lux`, { direction: 'top' })
        .addTo(mapa);
      m.on('click', () => {
        if (travado()) return;
        if (modo === 'editar') selecionar(p);
        else dirigir(p);
      });
      camadas.push(m);
    }
    controles();
  }
  async function escolher(p) {
    if (travado() || invalido) return;
    if (!dentro(p)) {
      aviso('Escolha um ponto dentro da área da demonstração.', true);
      return;
    }
    pausar();
    const id = ++serial;
    buscando = true;
    selecionado = null;
    controles();
    try {
      const r = await fetch(
        '/api/navegacao/rua?' + new URLSearchParams({ origem: `${p.lng},${p.lat}` }),
        { signal: AbortSignal.timeout(15000) }
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.mensagem || 'Não foi possível localizar a rua.');
      if (id !== serial || travado() || modo !== 'editar') return;
      const novo = { lng: d.posicao[0], lat: d.posicao[1], lux: Number($('lux').value) || 0 };
      if (!dentro(novo)) throw Error('A rua encontrada está fora da área de demonstração.');
      const existente = pontos.find(
        (q) => Percurso.distancia([q.lng, q.lat], [novo.lng, novo.lat]) < 5
      );
      selecionar(existente || novo);
      aviso('Escolha os lux e toque em Salvar iluminação. Isso ainda não cria uma leitura.');
    } catch (e) {
      if (id === serial)
        aviso(e.name === 'TimeoutError' ? 'A busca demorou; tente novamente.' : e.message, true);
    } finally {
      if (id === serial) {
        buscando = false;
        controles();
      }
    }
  }
  function mudarModo(novo) {
    if (travado()) return;
    pausar();
    serial++;
    buscando = false;
    modo = novo;
    if (rascunho) {
      mapa.removeLayer(rascunho);
      rascunho = null;
    }
    controles();
    atualizar();
  }
  $('modoEditar').onclick = () => mudarModo('editar');
  $('modoDirigir').onclick = () => mudarModo('dirigir');
  $('salvarPonto').onclick = () => {
    if (travado() || invalido || buscando || !selecionado || modo !== 'editar') return;
    const texto = $('lux').value,
      lux = Number(texto);
    if (texto === '' || !Number.isFinite(lux) || lux < 0 || lux > 88000) {
      aviso('Informe de 0 a 88000 lux.', true);
      return;
    }
    if (!selecionado.id && pontos.length >= 500) {
      aviso('Limite de 500 pontos configurados.', true);
      return;
    }
    const id =
      selecionado.id ||
      'P-' +
        Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
          b.toString(16).padStart(2, '0')
        ).join('');
    const p = { id, lat: selecionado.lat, lng: selecionado.lng, lux };
    if (persistir([...pontos.filter((q) => q.id !== id), p])) {
      selecionado = p;
      desenhar();
      atualizar();
      aviso('Iluminação salva. Configure outros pontos ou toque em Dirigir caminhão.');
    }
  };
  $('excluirPonto').onclick = () => {
    if (travado() || invalido || !selecionado?.id) return;
    if (persistir(pontos.filter((p) => p.id !== selecionado.id))) {
      selecionado = null;
      if (rascunho) {
        mapa.removeLayer(rascunho);
        rascunho = null;
      }
      desenhar();
      atualizar();
    }
  };
  function sensor(pos) {
    let proximo = null,
      menor = RAIO;
    for (const p of pontos) {
      const d = Percurso.distancia([p.lng, p.lat], [pos.lng, pos.lat]);
      if (d <= menor) {
        menor = d;
        proximo = p;
      }
    }
    return proximo;
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) {
      invalido = true;
      pausar();
      controles();
      aviso('Os pontos foram alterados em outra aba. Recarregue esta página.', true);
    }
  });
  desenhar();
  return {
    sensor,
    controles,
    get editando() {
      return modo === 'editar';
    },
    get invalido() {
      return invalido;
    },
    clique(p) {
      if (modo !== 'editar') return false;
      escolher(p);
      return true;
    },
  };
};
