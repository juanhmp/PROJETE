'use strict';
// Aplicação independente, sem dependências npm. Requer Node.js 18 ou superior.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { consultar } = require('./rotas');
const PORT = Number(process.env.SIMULADOR_PORT || 3001);
const DESTINO = new URL(process.env.LIGHTSENTINEL_URL || 'http://127.0.0.1:3000');
const PUBLIC = path.join(__dirname, 'public');
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  const urlLocal = new URL(req.url, 'http://localhost');
  const pathname = urlLocal.pathname;
  if (req.method === 'GET' && ['/api/navegacao/rota', '/api/navegacao/rua'].includes(pathname)) {
    try {
      const dados = await consultar(pathname.endsWith('/rota') ? 'rota' : 'rua', urlLocal.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(dados));
    } catch (e) {
      res.writeHead(e.status || 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mensagem: e.message }));
    }
    return;
  }
  if ((req.method === 'POST' && pathname === '/api/simulacao/descarregar') ||
      (req.method === 'GET' && pathname === '/api/simulacao/mapa')) {
    try {
      const partes = []; let tamanho = 0;
      for await (const parte of req) {
        tamanho += parte.length;
        if (tamanho > 2 * 1024 * 1024) { res.writeHead(413).end(); return; }
        partes.push(parte);
      }
      const resposta = await fetch(new URL(pathname, DESTINO), {
        method: req.method, headers: { 'Content-Type': 'application/json' },
        body: req.method === 'POST' ? Buffer.concat(partes) : undefined,
        signal: AbortSignal.timeout(15000)
      });
      res.writeHead(resposta.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(await resposta.text());
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mensagem: 'Servidor LightSentinel indisponível. Inicie o site na porta 3000 e tente descarregar novamente. Suas leituras continuam no tablet.' }));
    }
    return;
  }
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ portaSite: DESTINO.port || (DESTINO.protocol === 'https:' ? '443' : '80') })); return;
  }
  let relativo;
  try { relativo = decodeURIComponent(pathname === '/' ? '/index.html' : pathname.replace(/^\/simulacao-assets/, '')); }
  catch { res.writeHead(400).end(); return; }
  const arquivo = path.resolve(PUBLIC, '.' + relativo);
  if (!arquivo.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(arquivo, (e, dados) => {
    if (e) { res.writeHead(404).end('Arquivo não encontrado.'); return; }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dados);
  });
});
if (require.main === module) server.listen(PORT, '0.0.0.0', () => {
  console.log(`Simulador: http://localhost:${PORT}`);
  try {
    for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`Tablet (mesmo Wi-Fi): http://${i.address}:${PORT}`);
    }
  } catch { console.log(`Consulte o IPv4 com ipconfig e abra http://IP-DO-COMPUTADOR:${PORT} no tablet.`); }
});
module.exports = server;
