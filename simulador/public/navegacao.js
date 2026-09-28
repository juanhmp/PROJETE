'use strict';
window.criarNavegacao = function({ mapa, truck, obterEstado, definirPosicao, persistir, travado, atualizar, aviso, pausarColeta, cliqueMapa, aoMover }) {
  const $ = id => document.getElementById(id);
  let pronto=false, carregando=false, andando=false, seguir=true, rota=null, metros=0;
  let frame=0, anterior=0, ultimoSave=0, ultimaCamera=0, camada=null, alvo=null, pedido=0;
  let controle=null;
  function controles() {
    $('pausarTrajeto').disabled = travado() || carregando || !rota || metros>=rota.total;
    $('pausarTrajeto').textContent = andando ? 'Pausar trajeto' : 'Continuar trajeto';
    $('seguir').textContent = seguir ? 'Seguir caminhão ✓' : 'Seguir caminhão';
    $('seguir').setAttribute('aria-pressed', String(seguir));
  }
  function gps(p) {
    definirPosicao(p); truck.setLatLng([p.lat,p.lng]);
    const desenho=truck.getElement()?.querySelector('.truck-heading');
    if(desenho && Number.isFinite(p.angulo)) desenho.style.transform=`rotate(${p.angulo}deg)`;
  }
  function pausar(gravar=true) {
    andando=false; cancelAnimationFrame(frame); anterior=0;
    if(gravar && pronto && !travado()) persistir();
    controles();
  }
  function cancelarPedido() {
    pedido++; controle?.abort(); carregando=false;
  }
  function pararTudo(gravar=true) { cancelarPedido(); pausar(gravar); }
  function tick(agora) {
    if(!andando || travado() || document.hidden) { pausar(); return; }
    if(!anterior)anterior=agora;
    const dt=Math.min(.15,(agora-anterior)/1000);anterior=agora;
    metros=Math.min(rota.total,metros+dt*(30/3.6)*Number($('velocidade').value));
    gps(Percurso.posicao(rota,metros));
    aoMover?.();
    if(!andando)return;
    $('distanciaRota').textContent=`${Math.ceil(rota.total-metros)} m restantes • 30 km/h • ${$('velocidade').value}×`;
    if(seguir && agora-ultimaCamera>200){mapa.panTo(truck.getLatLng(),{animate:false});ultimaCamera=agora;}
    if(agora-ultimoSave>1000){ultimoSave=agora;if(!persistir()){pausar(false);return;}}
    if(metros>=rota.total){pausar();$('instrucaoRota').textContent='Você chegou!';$('distanciaRota').textContent='Toque em outra rua para continuar';return;}
    frame=requestAnimationFrame(tick);
  }
  function continuar() {
    if(travado() || carregando || !rota || metros>=rota.total)return;
    andando=true;anterior=0;controles();frame=requestAnimationFrame(tick);
  }
  async function api(tipo, params) {
    controle=new AbortController();
    const timeout=setTimeout(()=>controle?.abort(),15000);
    try {
      const r=await fetch('/api/navegacao/'+tipo+'?'+new URLSearchParams(params),{signal:controle.signal});
      const d=await r.json();if(!r.ok)throw new Error(d.mensagem || 'Não foi possível calcular a rota.');return d;
    } finally { clearTimeout(timeout); }
  }
  async function inicializar() {
    if(travado() || carregando || pronto)return;
    const id=++pedido;carregando=true;atualizar();
    const s=obterEstado();
    try {
      const d=await api('rua',{origem:`${s.lng},${s.lat}`});
      if(id!==pedido || travado())return;
      gps({lng:d.posicao[0],lat:d.posicao[1]});
      pronto=persistir();
      if(pronto){truck.setOpacity(1);mapa.setView(truck.getLatLng(),16);$('instrucaoRota').textContent=d.rua;$('distanciaRota').textContent='Toque na rua de destino';}
    } catch(e){if(id===pedido){$('instrucaoRota').textContent='Toque no mapa para tentar novamente';aviso(e.name==='AbortError'?'A busca da rua demorou. Toque novamente para tentar.':e.message,true);}}
    finally{if(id===pedido){carregando=false;atualizar();}}
  }
  async function destino(latlng) {
    if(travado() || carregando)return;
    if(!pronto){await inicializar();if(!pronto)return;}
    if(latlng.lat< -22.285 || latlng.lat> -22.220 || latlng.lng< -45.740 || latlng.lng> -45.675){aviso('Escolha uma rua dentro da área de demonstração.',true);return;}
    pausar();pausarColeta();
    const id=++pedido;carregando=true;atualizar();$('instrucaoRota').textContent='Calculando caminho pelas ruas…';
    const s=obterEstado();
    try{
      const d=await api('rota',{origem:`${s.lng},${s.lat}`,destino:`${latlng.lng},${latlng.lat}`});
      if(id!==pedido || travado())return;
      const nova=Percurso.preparar(d.coordenadas);
      if(nova.total<1){$('instrucaoRota').textContent='Você já está aqui';return;}
      // Origem corrigida na própria rua. Não interpolar até o clique fora dela.
      rota=nova;metros=0;gps(Percurso.posicao(rota,0));
      if(!persistir()){rota=null;return;}
      if(camada)mapa.removeLayer(camada);if(alvo)mapa.removeLayer(alvo);
      camada=L.polyline(d.coordenadas.map(p=>[p[1],p[0]]),{color:'#5373ff',weight:7,opacity:.85,interactive:false}).addTo(mapa);
      const fim=d.coordenadas[d.coordenadas.length-1];
      alvo=L.circleMarker([fim[1],fim[0]],{radius:8,color:'#fff',weight:3,fillColor:'#5373ff',fillOpacity:1,interactive:false}).addTo(mapa);
      $('instrucaoRota').textContent='Destino: '+d.destino;
      $('distanciaRota').textContent=`${Math.round(rota.total)} m pelas ruas`;
      carregando=false;seguir=true;mapa.setView(truck.getLatLng(),Math.max(16,mapa.getZoom()));
      continuar();aviso('Caminhão seguindo a rota. Os lux serão registrados ao passar pelos pontos configurados.');
    }catch(e){if(id===pedido){$('instrucaoRota').textContent='Não foi possível traçar esse caminho';aviso(e.name==='AbortError'?'O cálculo demorou. Toque novamente na rua.':e.message,true);}}
    finally{if(id===pedido){carregando=false;atualizar();}}
  }
  mapa.on('click',e=>{if(!cliqueMapa?.(e.latlng))destino(e.latlng);});
  mapa.on('dragstart',()=>{seguir=false;controles();});
  $('pausarTrajeto').onclick=()=>andando?pausar():continuar();
  $('seguir').onclick=()=>{seguir=!seguir;if(seguir)mapa.panTo(truck.getLatLng());controles();};
  $('centralizar').onclick=()=>{seguir=true;mapa.setView(truck.getLatLng(),16);controles();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pararTudo();pausarColeta();atualizar();}});
  window.addEventListener('pagehide',()=>pararTudo());
  // A posição só fica habilitada para coleta após ser associada a uma rua.
  truck.setOpacity(.4);
  const resultado={get pronto(){return pronto;},get carregando(){return carregando;},pausar:pararTudo,controles,inicializar,destino};
  setTimeout(inicializar,0);
  return resultado;
};
