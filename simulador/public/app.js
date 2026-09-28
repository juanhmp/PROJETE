'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const viewer = location.pathname === '/mapa-simulado';
  const KEY = 'lightsentinel.microsd.v1';
  const CENTRO = [-22.252, -45.704];
  const limites = [[-22.285, -45.740], [-22.220, -45.675]];
  let state = { lat: CENTRO[0], lng: CENTRO[1], lux: 20, medicoes: [], loteId: null };
  let ocupado = false, timer = null, bloqueado = false, heat = null, areas = [];
  function aviso(texto, erro = false) { $('mensagem').textContent = texto; $('mensagem').classList.toggle('error', erro); }
  if (!window.L || !L.heatLayer) { aviso('Não foi possível carregar o mapa. Recarregue a página.', true); return; }
  const dentro = m => Number.isFinite(m.lat) && Number.isFinite(m.lng) && m.lat >= limites[0][0] && m.lat <= limites[1][0] && m.lng >= limites[0][1] && m.lng <= limites[1][1];
  const leituraValida = m => m && dentro(m) && Number.isFinite(m.lux) && m.lux >= 0 && m.lux <= 88000 && typeof m.timestamp === 'string' && Number.isFinite(Date.parse(m.timestamp));
  if (!viewer) {
    try {
      const salvo = localStorage.getItem(KEY);
      if (salvo) {
        const s = JSON.parse(salvo);
        if (!s || !dentro(s) || !Number.isFinite(s.lux) || s.lux < 0 || s.lux > 88000 ||
          !Array.isArray(s.medicoes) || s.medicoes.length > 5000 || !s.medicoes.every(leituraValida) ||
          !(s.loteId === null || (typeof s.loteId === 'string' && /^[\w-]{8,100}$/.test(s.loteId)))) throw new Error();
        state = s;
      }
    } catch { bloqueado = true; aviso('O microSD virtual não pôde ser aberto. Confira o armazenamento do navegador; os dados existentes não foram sobrescritos.', true); }
  }
  function salvar(proximo) {
    try { localStorage.setItem(KEY, JSON.stringify(proximo)); state = proximo; return true; }
    catch { parar(); aviso('Não foi possível guardar os dados no navegador. Libere espaço ou permita armazenamento antes de continuar.', true); return false; }
  }
  const mapa = L.map('map', { maxBounds: limites, maxBoundsViscosity: 1, minZoom: 13, maxZoom: 18 }).setView(CENTRO, 14);
  let tileError = false;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, referrerPolicy: 'origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).on('tileerror', () => {
    if (!tileError) { tileError = true; aviso('O mapa de ruas precisa de internet. Verifique a conexão da rede Wi-Fi.', true); }
  }).addTo(mapa);
  mapa.createPane('heatPane'); mapa.getPane('heatPane').style.pointerEvents = 'none';
  mapa.getPane('heatPane').style.opacity = '.70';
  function desenhar() {
    if (heat) { mapa.removeLayer(heat); heat = null; }
    if (!areas.length) return;
    const pontos = areas.map(a => [a.lat, a.lng, Math.max(.08, Math.min(.95, 1 - a.lux / 100))]);
    heat = L.heatLayer(pontos, { radius: 22 + (mapa.getZoom() - 13) * 5, blur: 20, max: .95,
      maxZoom: 14, minOpacity: .20, pane: 'heatPane',
      gradient: { .12: '#2563eb', .32: '#06b6d4', .50: '#22c55e', .67: '#eab308', .82: '#f97316', 1: '#ef4444' }
    }).addTo(mapa);
  }
  mapa.on('zoomend', desenhar);
  function agregar(medicoes) {
    const grupos = new Map();
    for (const m of medicoes) {
      const lat = Math.round(m.lat * 500) / 500, lng = Math.round(m.lng * 500) / 500;
      const chave = `${lat},${lng}`, a = grupos.get(chave) || { lat, lng, lux: 0, quantidade: 0 };
      a.lux += m.lux; a.quantidade++; grupos.set(chave, a);
    }
    return [...grupos.values()].map(a => ({ ...a, lux: a.lux / a.quantidade }));
  }
  $('centralizar').onclick = () => mapa.setView(viewer ? CENTRO : [state.lat, state.lng], 14);
  if (viewer) {
    document.body.classList.add('viewer');
    $('titulo').textContent = 'Mapa de calor simulado';
    $('descricao').textContent = 'Leituras da demonstração, publicadas após descarregar o microSD virtual.';
    $('estado').textContent = 'DADOS SIMULADOS';
    $('mapHint').textContent = 'Toque em uma área para consultar a média de lux. Atualiza a cada 3 segundos.';
    $('rodape').textContent = 'Exibindo o último lote descarregado';
    let carregando = false;
    async function atualizar() {
      if (carregando) return; carregando = true;
      try {
        const r = await fetch('/api/simulacao/mapa', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error();
        const d = await r.json(); areas = d.areas; desenhar();
        $('mapStatus').textContent = `${d.totalLeituras} leituras • ${areas.length} áreas • ${d.recebidoEm ? 'Último envio: ' + new Date(d.recebidoEm).toLocaleString('pt-BR') : 'Nenhum lote recebido'}`;
        aviso(d.totalLeituras ? 'Mapa atualizado com o último lote confirmado.' : 'Aguardando o primeiro descarregamento no simulador.');
      } catch { aviso('Sem conexão com o servidor. Exibindo o último mapa carregado; tentando novamente.', true); }
      finally { carregando = false; }
    }
    mapa.on('click', e => {
      const lat = Math.round(e.latlng.lat * 500) / 500, lng = Math.round(e.latlng.lng * 500) / 500;
      const a = areas.find(a => Math.abs(a.lat - lat) < .000001 && Math.abs(a.lng - lng) < .000001);
      L.popup().setLatLng(e.latlng).setContent(a ? `<strong>${a.lux.toFixed(1)} lux</strong><br>${a.quantidade} leituras nesta área` : 'Sem leituras nesta área.').openOn(mapa);
    });
    atualizar(); setInterval(atualizar, 3000); return;
  }
  fetch('/config.json').then(r => r.json()).then(c => {
    const site = new URL(location.href); site.port = c.portaSite; site.pathname = '/mapa-simulado'; site.search = ''; site.hash = '';
    $('voltar').href = site.href; $('voltar').textContent = 'Ver mapa publicado ↗'; $('voltar').target = '_blank'; $('voltar').rel = 'noopener';
  }).catch(() => { $('voltar').hidden = true; });
  // Ícone SVG original de caminhão, com contorno e expressão amigável.
  const truck = L.marker([state.lat, state.lng], { draggable: true, title: 'Caminhão LightSentinel: arraste para mudar o GPS',
    icon: L.divIcon({ className: 'truck', iconSize: [54,54], iconAnchor: [27,42], html: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="32" cy="31" r="28" fill="white" stroke="#214d3b" stroke-width="2"/><path d="M10 22h27v24H10z" fill="#b6e47d" stroke="#214d3b" stroke-width="2.5" stroke-linejoin="round"/><path d="M37 28h10l8 10v8H37z" fill="#4e8960" stroke="#214d3b" stroke-width="2.5"/><path d="M41 31h5l5 7H41z" fill="#d9f4f1"/><circle cx="20" cy="47" r="6" fill="#214d3b"/><circle cx="46" cy="47" r="6" fill="#214d3b"/><circle cx="20" cy="47" r="2" fill="white"/><circle cx="46" cy="47" r="2" fill="white"/><circle cx="19" cy="30" r="2" fill="#214d3b"/><circle cx="28" cy="30" r="2" fill="#214d3b"/><path d="M19 36q5 5 9 0" fill="none" stroke="#214d3b" stroke-width="2" stroke-linecap="round"/><path d="M38 24h7" stroke="#f4c34c" stroke-width="4" stroke-linecap="round"/></svg>` })
  }).addTo(mapa);
  function atualizarUI() {
    const travado = ocupado || bloqueado || !!state.loteId;
    $('quantidade').textContent = state.medicoes.length;
    $('coordenadas').textContent = `GPS ${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
    $('lux').value = state.lux; $('luxRange').value = Math.min(100, state.lux);
    $('registrar').disabled = travado || state.medicoes.length >= 5000;
    $('automatico').disabled = travado || state.medicoes.length >= 5000;
    $('lux').disabled = travado; $('luxRange').disabled = travado;
    document.querySelectorAll('[data-lux]').forEach(b => b.disabled = travado);
    $('descarregar').disabled = ocupado || bloqueado || state.medicoes.length === 0;
    $('descarregar').textContent = ocupado ? 'Descarregando…' : state.loteId ? 'Descarregar novamente' : 'Descarregar';
    $('automatico').textContent = timer ? 'Pausar coleta automática' : 'Iniciar coleta a cada 1 segundo';
    $('estado').textContent = ocupado ? 'ENVIANDO LOTE' : timer ? 'COLETANDO • MICROSD VIRTUAL' : 'SIMULADOR DE HARDWARE';
    travado ? truck.dragging.disable() : truck.dragging.enable();
    truck.setLatLng([state.lat, state.lng]);
    $('leituras').replaceChildren(...state.medicoes.slice(-3).reverse().map(m => {
      const li = document.createElement('li');
      li.textContent = `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)} • ${m.lux} lux`; return li;
    }));
    areas = agregar(state.medicoes); desenhar();
    $('mapStatus').textContent = `${state.medicoes.length} leituras no microSD virtual • Prévia local, ainda não publicada`;
  }
  function posicionar(latlng) {
    if (ocupado || bloqueado || state.loteId) return;
    if (!dentro(latlng)) { truck.setLatLng([state.lat, state.lng]); aviso('Escolha um ponto dentro da área de demonstração de Santa Rita.', true); return; }
    salvar({ ...state, lat: latlng.lat, lng: latlng.lng }); atualizarUI();
  }
  mapa.on('click', e => posicionar(e.latlng)); truck.on('dragend', () => posicionar(truck.getLatLng()));
  function ajustarLux(valor) {
    if (ocupado || bloqueado || state.loteId) return;
    if (valor === '' || !Number.isFinite(Number(valor)) || Number(valor) < 0 || Number(valor) > 88000) {
      aviso('Informe uma iluminação entre 0 e 88000 lux.', true); return false;
    }
    const ok = salvar({ ...state, lux: Number(valor) }); if (ok) atualizarUI(); return ok;
  }
  $('lux').onchange = e => ajustarLux(e.target.value);
  $('luxRange').oninput = e => ajustarLux(e.target.value);
  document.querySelectorAll('[data-lux]').forEach(b => b.onclick = () => ajustarLux(b.dataset.lux));
  function registrar() {
    if (ocupado || bloqueado || state.loteId) return;
    if (state.medicoes.length >= 5000) { parar(); aviso('MicroSD virtual cheio (5000 leituras). Descarregue para continuar.', true); return; }
    if (!ajustarLux($('lux').value)) { parar(); return; }
    const leitura = { lat: state.lat, lng: state.lng, lux: state.lux, timestamp: new Date().toISOString() };
    if (salvar({ ...state, medicoes: [...state.medicoes, leitura] })) {
      aviso('Leitura guardada no microSD virtual.');
      if (state.medicoes.length >= 5000) { parar(); aviso('MicroSD virtual cheio. Descarregue para continuar.'); }
      atualizarUI();
      return true;
    }
  }
  function parar() { clearInterval(timer); timer = null; }
  $('registrar').onclick = registrar;
  $('automatico').onclick = () => {
    if (timer) { parar(); atualizarUI(); return; }
    const registrada = registrar();
    if (registrada && !ocupado && !bloqueado && !state.loteId && state.medicoes.length < 5000) timer = setInterval(registrar, 1000);
    atualizarUI();
  };
  $('descarregar').onclick = async () => {
    if (ocupado || bloqueado || !state.medicoes.length) return;
    parar();
    // getRandomValues também funciona em HTTP pelo IP do computador, sem exigir HTTPS.
    if (!state.loteId) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const loteId = 'SIM-' + [...bytes].map(v => v.toString(16).padStart(2,'0')).join('');
      if (!salvar({ ...state, loteId })) return;
    }
    ocupado = true; atualizarUI(); aviso('Conexão simulada: enviando todas as leituras ao servidor…');
    try {
      const r = await fetch('/api/simulacao/descarregar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loteId: state.loteId, medicoes: state.medicoes }), signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      if (!r.ok || !d.sucesso || d.loteId !== state.loteId || d.quantidade !== state.medicoes.length) throw new Error(d.mensagem || 'O servidor não confirmou o lote completo.');
      if (salvar({ ...state, medicoes: [], loteId: null })) aviso(`${d.quantidade} leituras descarregadas! MicroSD virtual vazio e mapa simulado atualizado. Você pode iniciar uma nova coleta.`);
    } catch (e) { aviso(`${e.message || 'Falha no envio.'} Leituras preservadas. Use “Descarregar novamente” antes de iniciar outra coleta.`, true); }
    finally { ocupado = false; atualizarUI(); }
  };
  // Uma segunda aba não deve sobrescrever leituras que outra aba acabou de guardar.
  window.addEventListener('storage', e => {
    if (e.key === KEY || e.key === null) { bloqueado = true; parar(); atualizarUI(); aviso('Outra aba alterou o microSD virtual. Recarregue esta página antes de continuar.', true); }
  });
  window.addEventListener('pagehide', parar);
  atualizarUI();
  if (!bloqueado && state.loteId) aviso('Existe um descarregamento sem confirmação. Reenvie o mesmo lote para concluir com segurança.');
  else if (!bloqueado && state.medicoes.length) aviso(`${state.medicoes.length} leituras recuperadas do microSD virtual.`);
})();
