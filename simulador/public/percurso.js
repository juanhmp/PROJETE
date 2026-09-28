/* Movimento pela geometria completa das ruas, sem atalhos entre origem e destino. */
(function(root) {
  function distancia(a, b) {
    const rad = Math.PI / 180, lat = (b[1] - a[1]) * rad, lon = (b[0] - a[0]) * rad;
    const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(lon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1-h)));
  }
  function preparar(coords) {
    const pontos = [coords[0]], acumulado = [0];
    for (let i = 1; i < coords.length; i++) {
      const d = distancia(pontos[pontos.length-1], coords[i]);
      if (d > .01) { pontos.push(coords[i]); acumulado.push(acumulado[acumulado.length-1] + d); }
    }
    return { pontos, acumulado, total: acumulado[acumulado.length-1] };
  }
  function posicao(rota, metros) {
    const {pontos:p, acumulado:a,total} = rota;
    if (p.length === 1) return {lng:p[0][0],lat:p[0][1],angulo:0};
    const d = Math.max(0,Math.min(total,metros));
    let low=1,high=a.length-1;
    while(low<high){const mid=(low+high)>>1;if(a[mid]<d)low=mid+1;else high=mid;}
    const i=low, t=(d-a[i-1])/(a[i]-a[i-1]);
    const angulo=Math.atan2((p[i][0]-p[i-1][0])*Math.cos(p[i-1][1]*Math.PI/180),p[i][1]-p[i-1][1])*180/Math.PI;
    return {lng:p[i-1][0]+t*(p[i][0]-p[i-1][0]),lat:p[i-1][1]+t*(p[i][1]-p[i-1][1]),angulo};
  }
  const api={distancia,preparar,posicao};
  if(typeof module==='object' && module.exports)module.exports=api;else root.Percurso=api;
})(typeof window !== 'undefined' ? window : globalThis);
