/* A mesma agregação exata é usada na prévia e no mapa publicado. */
(function(root) {
  function agregar(medicoes) {
    const grupos = new Map();
    for (const m of medicoes) {
      // Lotes antigos continuam usando o GPS que já foi armazenado.
      const {lat,lng} = m.referencia || m;
      const chave = `${lat},${lng}`;
      const a = grupos.get(chave) || {lat,lng,lux:0,quantidade:0};
      a.lux += m.lux; a.quantidade++; grupos.set(chave,a);
    }
    return [...grupos.values()].map(a => ({...a,lux:a.lux/a.quantidade}));
  }
  if(typeof module==='object' && module.exports)module.exports=agregar;
  else root.agregarAreasSimuladas=agregar;
})(typeof window!=='undefined'?window:globalThis);
