'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const agregar=require('../simulador/public/areas');
test('calor usa coordenadas exatas da referência, mantendo GPS do caminhão',()=>{
 const referencia={lat:-22.252345678,lng:-45.704456789};
 const leitura={lat:-22.2524,lng:-45.7045,lux:80,referencia};
 const resultado=agregar([leitura]);
 assert.deepEqual(resultado,[{...referencia,lux:80,quantidade:1}]);
 assert.equal(leitura.lat,-22.2524);
});
test('pontos próximos da mesma antiga célula permanecem separados',()=>{
 const p={lat:-22.25234,lng:-45.70445,lux:10};
 const q={lat:-22.25284,lng:-45.70465,lux:90};
 const resultado=agregar([p,q]);
 assert.equal(resultado.length,2);
 assert.deepEqual(resultado.map(a=>[a.lat,a.lng,a.lux]),[[p.lat,p.lng,10],[q.lat,q.lng,90]]);
});
test('duas passagens no mesmo ponto formam média sem deslocamento',()=>{
 const referencia={lat:-22.25345,lng:-45.70567};
 const resultado=agregar([{lat:-22.2534,lng:-45.7056,lux:10,referencia},{lat:-22.2535,lng:-45.7057,lux:30,referencia}]);
 assert.deepEqual(resultado,[{...referencia,lux:20,quantidade:2}]);
});
test('lotes antigos preservam suas coordenadas sem arredondar',()=>{
 assert.deepEqual(agregar([{lat:-22.252345,lng:-45.704567,lux:0}]),[{lat:-22.252345,lng:-45.704567,lux:0,quantidade:1}]);
});
