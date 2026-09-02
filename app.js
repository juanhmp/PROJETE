// ============================================================
// 1. BIBLIOTECAS USADAS PELO SERVIDOR
// ============================================================

// Express cria o servidor e as rotas, como /api/login.
const express = require('express');

// Path monta caminhos de arquivos de um jeito que funciona no Windows.
const path = require('path');

// SQLite é o banco de dados salvo no arquivo dados.db.
const sqlite3 = require('sqlite3').verbose();

// Bcrypt protege as senhas antes de salvá-las no banco.
const bcrypt = require('bcryptjs');

// Session mantém o usuário conectado depois do login.
const session = require('express-session');

// Helmet adiciona proteções básicas nas respostas do servidor.
const helmet = require('helmet');

// Rate limit limita tentativas seguidas de login.
const { rateLimit } = require('express-rate-limit');

// Crypto cria códigos aleatórios e faz comparações seguras.
const crypto = require('crypto');

// ============================================================
// 2. CONFIGURAÇÕES PRINCIPAIS
// ============================================================

const app = express();
const PORT = 3000;
const db = new sqlite3.Database(path.join(__dirname, 'dados.db'));
// Estas configurações podem vir do computador que executa o servidor.
// O valor depois de || é usado quando nenhuma configuração foi informada.
const producao = process.env.NODE_ENV === 'production';
const segredoDaSessao = process.env.SESSION_SECRET || 'troque-esta-chave-no-ambiente-de-producao';
const chaveDaBase = process.env.BASE_API_KEY || '';
const segredoDoOperador = process.env.OPERATOR_SECRET || '';
const saltDoOperador = process.env.OPERATOR_SALT || 'ff480e86b329a506e7f63d7929a23511';
const hashDoOperador = process.env.OPERATOR_HASH ||
  'd79a4effacf26474a8aa9d5dc6e658d3b9aaa584f4160fc1b9e90a1a83e8c0be2febfa1285f540957c02f47602e3229d360bd474b5257a4fc411fa6ab67958ee';
const permitirOperadorRemoto = process.env.ALLOW_OPERATOR_REMOTE === 'true';

// ============================================================
// 3. PREPARAÇÃO DO EXPRESS E DA SESSÃO
// ============================================================

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'lumi.sid',
  secret: segredoDaSessao,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: producao,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

if (!process.env.SESSION_SECRET) {
  console.warn('AVISO: usando SESSION_SECRET de desenvolvimento. Defina SESSION_SECRET antes de publicar o sistema.');
}

// As três funções desta parte transformam o SQLite, que normalmente usa
// callbacks, em Promises. Assim podemos usar await e ler o código de cima
// para baixo. run altera dados, get pega uma linha e all pega várias linhas.
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (erro) {
      if (erro) reject(erro);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (erro, linha) => {
      if (erro) reject(erro);
      else resolve(linha);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (erro, linhas) => {
      if (erro) reject(erro);
      else resolve(linhas);
    });
  });
}

async function garantirColuna(tabela, nome, definicao) {
  const colunas = await all(`PRAGMA table_info(${tabela})`);
  if (!colunas.some(c => c.name === nome)) {
    await run(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicao}`);
  }
}

// ============================================================
// 4. CRIAÇÃO E ATUALIZAÇÃO DO BANCO DE DADOS
// ============================================================

async function iniciarBanco() {
  await run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    nome TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    trocar_senha INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT,
    ultimo_login TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS ocorrencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    timestamp TEXT NOT NULL,
    criado_por INTEGER
  )`);

  await run(`CREATE TABLE IF NOT EXISTS medicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    luminosidade REAL NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    local TEXT,
    origem TEXT NOT NULL,
    lote_id TEXT,
    timestamp TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`);

  await garantirColuna('usuarios', 'ativo', 'INTEGER NOT NULL DEFAULT 1');
  await garantirColuna('usuarios', 'trocar_senha', 'INTEGER NOT NULL DEFAULT 0');
  await garantirColuna('usuarios', 'criado_em', 'TEXT');
  await garantirColuna('usuarios', 'ultimo_login', 'TEXT');
  await garantirColuna('ocorrencias', 'status', "TEXT NOT NULL DEFAULT 'pendente'");
  await garantirColuna('ocorrencias', 'criado_por', 'INTEGER');
  await garantirColuna('ocorrencias', 'foto', 'TEXT');
  await garantirColuna('medicoes', 'lote_id', 'TEXT');

  await run(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('modo_teste', '0')`);

  const total = await get('SELECT COUNT(*) AS total FROM usuarios');
  if (!total || total.total === 0) {
    await run(
      `INSERT INTO usuarios (username, password, role, nome, ativo, trocar_senha, criado_em)
       VALUES (?, ?, 'admin', ?, 1, 1, ?)`,
      ['admin', bcrypt.hashSync('Admin@123', 12), 'Administrador', new Date().toISOString()]
    );
    console.log('Primeiro acesso: admin / Admin@123 (troca de senha obrigatória)');
  } else {
    await run(
      "UPDATE usuarios SET criado_em = COALESCE(criado_em, ?) WHERE criado_em IS NULL",
      [new Date().toISOString()]
    );
  }
}

// ============================================================
// 5. FUNÇÕES DE LOGIN E PERMISSÃO
// ============================================================

// Retorna somente as informações que podem ser enviadas ao navegador.
// A senha nunca é incluída.
function usuarioPublico(u) {
  return {
    id: u.id,
    nome: u.nome,
    username: u.username,
    role: u.role,
    ativo: Boolean(u.ativo),
    trocarSenha: Boolean(u.trocar_senha),
    criadoEm: u.criado_em || null,
    ultimoLogin: u.ultimo_login || null
  };
}

async function carregarUsuarioSessao(req) {
  if (!req.session || !req.session.usuarioId) return null;
  const u = await get('SELECT * FROM usuarios WHERE id = ?', [req.session.usuarioId]);
  if (!u || !u.ativo) return null;
  return u;
}

// Middleware é uma função executada antes da rota.
// Esta deixa continuar apenas quando existe um usuário conectado.
async function exigirAutenticacao(req, res, next) {
  try {
    const u = await carregarUsuarioSessao(req);
    if (!u) {
      if (req.session) req.session.usuarioId = null;
      return res.status(401).json({ mensagem: 'Sessão inválida ou expirada.' });
    }
    req.usuario = u;
    next();
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao validar sessão.' });
  }
}

function segredoCorresponde(recebido, esperado) {
  const a = crypto.createHash('sha256').update(String(recebido || '')).digest();
  const b = crypto.createHash('sha256').update(String(esperado || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

// Confere a chave da Central do Operador sem guardar a senha aberta no código.
function senhaOperadorCorresponde(recebida) {
  if (segredoDoOperador) return segredoCorresponde(recebida, segredoDoOperador);
  const calculado = crypto.scryptSync(String(recebida || ''), saltDoOperador, 64);
  const esperado = Buffer.from(hashDoOperador, 'hex');
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

function exigirMaquinaOperador(req, res, next) {
  if (permitirOperadorRemoto) return next();
  const ip = String(req.socket.remoteAddress || '');
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!local) return res.status(403).send('A Central do Operador só pode ser acessada na máquina do servidor.');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function exigirOperador(req, res, next) {
  if (!req.session || req.session.operadorAutenticado !== true) {
    return res.status(401).json({ mensagem: 'Acesso exclusivo do operador.' });
  }
  next();
}

function exigirCsrfOperador(req, res, next) {
  const recebido = String(req.get('x-csrf-token') || '');
  const esperado = String(req.session?.operadorCsrf || '');
  if (!recebido || !esperado || !segredoCorresponde(recebido, esperado)) {
    return res.status(403).json({ mensagem: 'Requisição de operador inválida.' });
  }
  next();
}

async function paginaOperador(req, res, nome) {
  if (!req.session || req.session.operadorAutenticado !== true) return res.redirect('/operador-login');
  res.sendFile(path.join(__dirname, 'pages', nome));
}

async function exigirAdmin(req, res, next) {
  try {
    const u = await carregarUsuarioSessao(req);
    if (!u) return res.status(401).json({ mensagem: 'Faça login para continuar.' });
    if (u.trocar_senha) {
      return res.status(403).json({
        mensagem: 'Troque sua senha antes de continuar.',
        codigo: 'TROCA_SENHA'
      });
    }
    if (u.role !== 'admin') return res.status(403).json({ mensagem: 'Acesso permitido somente a administradores.' });
    req.usuario = u;
    next();
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao validar permissão.' });
  }
}

async function paginaProtegida(role, req, res, nome) {
  try {
    const u = await carregarUsuarioSessao(req);
    if (!u) return res.redirect(role === 'admin' ? '/login-admin' : '/login');
    if (u.trocar_senha && nome !== 'senha.html') return res.redirect('/senha');
    if (role && u.role !== role) return res.redirect(u.role === 'admin' ? '/admin' : '/usuario');
    res.sendFile(path.join(__dirname, 'pages', nome));
  } catch (erro) {
    res.redirect('/login');
  }
}

function senhaValida(senha) {
  return typeof senha === 'string' && senha.length >= 8 && senha.length <= 72 &&
    /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /\d/.test(senha);
}

function usernameValido(username) {
  return typeof username === 'string' && /^[A-Za-z0-9._-]{3,32}$/.test(username);
}

const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { mensagem: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' }
});

// ============================================================
// 6. PÁGINAS DO SITE
// ============================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'login.html')));
app.get('/login-admin', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'admin-login.html')));
app.get('/esqueceu-senha', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'esqueceu-senha.html')));
app.get('/operador-login', exigirMaquinaOperador, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'operador-login.html'));
});
app.get('/operador', exigirMaquinaOperador, (req, res) => paginaOperador(req, res, 'operador.html'));

app.get('/admin', (req, res) => paginaProtegida('admin', req, res, 'admin.html'));
app.get('/usuario', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'usuario.html')));
app.get('/mapa', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'mapa.html')));
app.get('/ocorrencias', (req, res) => paginaProtegida('admin', req, res, 'ocorrencias.html'));
app.get('/registrar', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'registrar.html')));
app.get('/senha', (req, res) => paginaProtegida('admin', req, res, 'senha.html'));

// ============================================================
// 7. CENTRAL DO OPERADOR
// ============================================================

const limitarOperador = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { mensagem: 'Muitas tentativas de acesso ao operador. Aguarde alguns minutos.' }
});

app.post('/api/operador/login', exigirMaquinaOperador, limitarOperador, (req, res) => {
  const chave = String(req.body.chave || '');
  if (!senhaOperadorCorresponde(chave)) {
    return res.status(401).json({ mensagem: 'Chave do operador inválida.' });
  }
  req.session.regenerate(erro => {
    if (erro) return res.status(500).json({ mensagem: 'Não foi possível criar a sessão do operador.' });
    req.session.operadorAutenticado = true;
    req.session.operadorCsrf = crypto.randomBytes(32).toString('hex');
    req.session.cookie.maxAge = 30 * 60 * 1000;
    res.json({ sucesso: true, destino: '/operador' });
  });
});

app.post('/api/operador/logout', exigirMaquinaOperador, exigirOperador, exigirCsrfOperador, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('lumi.sid');
    res.json({ sucesso: true });
      });
});

app.get('/api/operador/sessao', exigirMaquinaOperador, exigirOperador, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ autenticado: true, csrfToken: req.session.operadorCsrf });
});

app.get('/api/operador/administradores', exigirMaquinaOperador, exigirOperador, async (req, res) => {
  try {
    const usuarios = await all(
      `SELECT id, nome, username, ativo, trocar_senha, criado_em, ultimo_login
       FROM usuarios WHERE role = 'admin' ORDER BY nome COLLATE NOCASE`
    );
    res.json(usuarios.map(u => ({
      id: u.id, nome: u.nome, username: u.username, ativo: Boolean(u.ativo),
      trocarSenha: Boolean(u.trocar_senha), criadoEm: u.criado_em, ultimoLogin: u.ultimo_login
    })));
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar administradores.' });
  }
});

app.post(
  '/api/operador/administradores',
  exigirMaquinaOperador,
  exigirOperador,
  exigirCsrfOperador,
  async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const username = String(req.body.username || '').trim();
    const senha = String(req.body.senhaTemporaria || '');
    if (nome.length < 2 || nome.length > 80) return res.status(400).json({ mensagem: 'Informe um nome válido.' });
    if (!usernameValido(username)) {
      return res.status(400).json({
        mensagem: 'O usuário deve ter de 3 a 32 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.'
      });
    }
    if (!senhaValida(senha)) {
      return res.status(400).json({
        mensagem: 'A senha temporária deve ter 8 a 72 caracteres, com letra maiúscula, minúscula e número.'
      });
    }
    const existe = await get('SELECT id FROM usuarios WHERE username = ?', [username]);
    if (existe) return res.status(409).json({ mensagem: 'Esse nome de usuário já existe.' });
    const resultado = await run(
      `INSERT INTO usuarios (username, password, role, nome, ativo, trocar_senha, criado_em)
       VALUES (?, ?, 'admin', ?, 1, 1, ?)`,
      [username, bcrypt.hashSync(senha, 12), nome, new Date().toISOString()]
    );
    res.status(201).json({
      mensagem: 'Administrador criado. A senha é temporária e deverá ser alterada no primeiro login.',
      id: resultado.id
    });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao criar administrador.' });
  }
});

app.put('/api/operador/administradores/:id', exigirMaquinaOperador, exigirOperador, exigirCsrfOperador, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const atual = await get("SELECT * FROM usuarios WHERE id = ? AND role = 'admin'", [id]);
    if (!atual) return res.status(404).json({ mensagem: 'Administrador não encontrado.' });
    const nome = String(req.body.nome ?? atual.nome).trim();
    const username = String(req.body.username ?? atual.username).trim();
    const ativo = req.body.ativo === undefined ? Boolean(atual.ativo) : Boolean(req.body.ativo);
    if (nome.length < 2 || nome.length > 80) return res.status(400).json({ mensagem: 'Informe um nome válido.' });
    if (!usernameValido(username)) return res.status(400).json({ mensagem: 'Nome de usuário inválido.' });
    const conflito = await get('SELECT id FROM usuarios WHERE username = ? AND id <> ?', [username, id]);
    if (conflito) return res.status(409).json({ mensagem: 'Esse nome de usuário já está em uso.' });
    if (!ativo && atual.ativo) {
      const ativos = await get("SELECT COUNT(*) AS total FROM usuarios WHERE role = 'admin' AND ativo = 1");
      if (ativos.total <= 1) return res.status(400).json({ mensagem: 'Não é possível desativar o único administrador ativo.' });
    }
    await run('UPDATE usuarios SET nome = ?, username = ?, ativo = ? WHERE id = ?', [nome, username, ativo ? 1 : 0, id]);
    res.json({ mensagem: ativo ? 'Administrador atualizado.' : 'Administrador desativado.' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao atualizar administrador.' });
  }
});

app.put('/api/operador/administradores/:id/redefinir-senha', exigirMaquinaOperador, exigirOperador, exigirCsrfOperador, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const senha = String(req.body.senhaTemporaria || '');
    const u = await get("SELECT id FROM usuarios WHERE id = ? AND role = 'admin'", [id]);
    if (!u) return res.status(404).json({ mensagem: 'Administrador não encontrado.' });
    if (!senhaValida(senha)) return res.status(400).json({ mensagem: 'A senha temporária deve ter 8 a 72 caracteres, com letra maiúscula, minúscula e número.' });
    await run('UPDATE usuarios SET password = ?, trocar_senha = 1, ativo = 1 WHERE id = ?', [bcrypt.hashSync(senha, 12), id]);
    res.json({ mensagem: 'Senha redefinida. No próximo login, o administrador será obrigado a criar uma nova senha.' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao redefinir senha.' });
  }
  }
);

// ============================================================
// 8. LOGIN E SESSÃO DO ADMINISTRADOR
// ============================================================

app.post('/api/login', limitarLogin, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const u = await get("SELECT * FROM usuarios WHERE username = ? AND role = 'admin'", [username]);

    if (!u || !u.ativo || !bcrypt.compareSync(password, u.password)) {
      return res.status(401).json({ sucesso: false, mensagem: 'Administrador ou senha inválidos.' });
    }

    req.session.regenerate(async erro => {
      if (erro) return res.status(500).json({ mensagem: 'Não foi possível criar a sessão.' });
      req.session.usuarioId = u.id;
      const agora = new Date().toISOString();
      await run('UPDATE usuarios SET ultimo_login = ? WHERE id = ?', [agora, u.id]);
      const atual = { ...u, ultimo_login: agora };
      res.json({ sucesso: true, usuario: usuarioPublico(atual), destino: u.trocar_senha ? '/senha' : '/admin' });
    });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao consultar o banco de dados.' });
  }
});

app.post('/api/logout', (req, res) => {
  if (!req.session) return res.json({ sucesso: true });
  req.session.destroy(() => {
    res.clearCookie('lumi.sid');
    res.json({ sucesso: true });
  });
});

app.get('/api/sessao', exigirAutenticacao, (req, res) => {
  res.json({ usuario: usuarioPublico(req.usuario) });
});

app.put('/api/minha-senha', exigirAutenticacao, async (req, res) => {
  try {
    const atual = String(req.body.senhaAtual || '');
    const nova = String(req.body.novaSenha || '');
    if (!bcrypt.compareSync(atual, req.usuario.password)) {
      return res.status(400).json({ mensagem: 'A senha atual está incorreta.' });
    }
    if (!senhaValida(nova)) {
      return res.status(400).json({ mensagem: 'A nova senha deve ter 8 a 72 caracteres, com letra maiúscula, minúscula e número.' });
    }
    if (bcrypt.compareSync(nova, req.usuario.password)) {
      return res.status(400).json({ mensagem: 'A nova senha deve ser diferente da senha atual.' });
    }
    await run('UPDATE usuarios SET password = ?, trocar_senha = 0 WHERE id = ?', [bcrypt.hashSync(nova, 12), req.usuario.id]);
    res.json({ mensagem: 'Senha alterada com sucesso.', destino: req.usuario.role === 'admin' ? '/admin' : '/usuario' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao alterar senha.' });
  }
});

// ============================================================
// 9. OCORRÊNCIAS
// ============================================================

app.get('/api/ocorrencias', exigirAdmin, async (req, res) => {
  try {
    res.json(await all('SELECT * FROM ocorrencias ORDER BY id DESC'));
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar ocorrências.' });
  }
});

app.post('/api/ocorrencias', async (req, res) => {
  try {
    const { location, description, priority, foto } = req.body;

    if (
      !location ||
      !description ||
      !['high', 'medium', 'low'].includes(priority)
    ) {
      return res.status(400).json({
        mensagem: 'Preencha os campos obrigatórios corretamente.'
      });
    }

    if (
      String(location).length > 120 ||
      String(description).length > 1000
    ) {
      return res.status(400).json({
        mensagem: 'Localização ou descrição muito longa.'
      });
    }

    if (foto && !String(foto).startsWith('data:image/')) {
      return res.status(400).json({
        mensagem: 'A foto enviada é inválida.'
      });
    }

    if (foto && String(foto).length > 1400000) {
      return res.status(400).json({
        mensagem: 'A foto deve ter no máximo 1 MB.'
      });
    }

    const timestamp = new Date().toISOString();

    const resultado = await run(
      `INSERT INTO ocorrencias
        (location, description, priority, status, timestamp, criado_por, foto)
       VALUES (?, ?, ?, 'pendente', ?, ?, ?)`,
      [
        String(location).trim(),
        String(description).trim(),
        priority,
        timestamp,
        null,
        foto || null
      ]
    );

    res.status(201).json({
      mensagem: 'Ocorrência registrada com sucesso.',
      id: resultado.id
    });
  } catch (erro) {
    res.status(500).json({
      mensagem: 'Erro ao registrar ocorrência.'
    });
  }
});

app.put('/api/ocorrencias/:id/status', exigirAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pendente', 'andamento', 'resolvida'].includes(status)) return res.status(400).json({ mensagem: 'Status inválido.' });
    const resultado = await run('UPDATE ocorrencias SET status = ? WHERE id = ?', [status, req.params.id]);
    if (!resultado.changes) return res.status(404).json({ mensagem: 'Ocorrência não encontrada.' });
    res.json({ mensagem: 'Status atualizado.', status });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao atualizar ocorrência.' });
  }
});

// ============================================================
// 10. MEDIÇÕES E MAPA DE CALOR
// ============================================================

app.get('/api/medicoes', exigirAdmin, async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 300, 1), 1000);
    res.json(await all('SELECT * FROM medicoes ORDER BY id DESC LIMIT ?', [limite]));
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar medições.' });
  }
});

app.get('/api/mapa/calor', async (req, res) => {
  try {
    const ultimoLote = await get(`SELECT lote_id FROM medicoes WHERE lote_id IS NOT NULL ORDER BY id DESC LIMIT 1`);
    let dados;
    let loteId = null;
    if (ultimoLote && ultimoLote.lote_id) {
      loteId = ultimoLote.lote_id;
      dados = await all(`SELECT ROUND(lat * 500, 0) / 500.0 AS lat_celula,
          ROUND(lng * 500, 0) / 500.0 AS lng_celula,
          AVG(luminosidade) AS luminosidade_media, COUNT(*) AS quantidade
        FROM medicoes WHERE lote_id = ?
        GROUP BY ROUND(lat * 500, 0), ROUND(lng * 500, 0)`, [loteId]);
    } else {
      dados = await all(`SELECT ROUND(lat * 500, 0) / 500.0 AS lat_celula,
          ROUND(lng * 500, 0) / 500.0 AS lng_celula,
          AVG(luminosidade) AS luminosidade_media, COUNT(*) AS quantidade
        FROM (SELECT * FROM medicoes ORDER BY id DESC LIMIT 5000)
        GROUP BY ROUND(lat * 500, 0), ROUND(lng * 500, 0)`);
    }
    res.json({ loteId, totalAreas: dados.length, areas: dados.map(d => ({
      lat: Number(d.lat_celula), lng: Number(d.lng_celula),
      luminosidade: Number(Number(d.luminosidade_media).toFixed(1)), quantidade: d.quantidade
    })) });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao montar dados do mapa de calor.' });
  }
});

async function salvarMedicao(dado, origem = 'bluetooth', loteId = null) {
  const valor = Number(dado.luminosidade);
  const latitude = Number(dado.lat);
  const longitude = Number(dado.lng);
  if (!Number.isFinite(valor) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('DADOS_INVALIDOS');
  if (valor < 0 || valor > 100 || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('DADOS_INVALIDOS');
  const timestamp = dado.timestamp || new Date().toISOString();
  const resultado = await run(
    'INSERT INTO medicoes (luminosidade, lat, lng, local, origem, lote_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [valor, latitude, longitude, String(dado.local || 'Santa Rita do Sapucaí').slice(0, 120), origem, loteId, timestamp]
  );
  return { id: resultado.id, luminosidade: valor, lat: latitude, lng: longitude, lote_id: loteId, timestamp };
}

// Aceita o envio quando ele vem de um administrador conectado ou da base
// Bluetooth que conhece a chave configurada em BASE_API_KEY.
async function exigirBaseOuAdmin(req, res, next) {
  try {
    const u = await carregarUsuarioSessao(req);
    if (u && u.role === 'admin' && !u.trocar_senha) { req.usuario = u; return next(); }
    const chave = req.get('x-base-key') || '';
    if (chaveDaBase && chave === chaveDaBase) return next();
    res.status(401).json({ mensagem: 'Envio não autorizado. Use uma sessão de administrador ou uma chave da base.' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao validar a origem dos dados.' });
  }
}

app.post('/api/medicoes', exigirBaseOuAdmin, async (req, res) => {
  try {
    const medicao = await salvarMedicao(req.body, 'bluetooth');
    res.status(201).json({ mensagem: 'Medição recebida.', medicao });
  } catch (erro) {
    if (erro.message === 'DADOS_INVALIDOS') return res.status(400).json({ mensagem: 'Medição inválida.' });
    res.status(500).json({ mensagem: 'Erro ao salvar medição.' });
  }
});

app.post('/api/medicoes/lote', exigirBaseOuAdmin, async (req, res) => {
  try {
    const medicoes = Array.isArray(req.body) ? req.body : req.body.medicoes;
    if (!Array.isArray(medicoes) || medicoes.length === 0) return res.status(400).json({ mensagem: 'Envie uma lista de medições.' });
    if (medicoes.length > 5000) return res.status(400).json({ mensagem: 'O lote ultrapassa o limite de 5000 medições.' });
    const loteId = `LOTE-${Date.now()}`;
    await run('BEGIN TRANSACTION');
    try {
      for (const medicao of medicoes) await salvarMedicao(medicao, 'bluetooth-lote', loteId);
      await run('COMMIT');
    } catch (erro) {
      await run('ROLLBACK');
      throw erro;
    }
    res.status(201).json({ mensagem: 'Lote recebido e registrado.', loteId, quantidade: medicoes.length });
  } catch (erro) {
    if (erro.message === 'DADOS_INVALIDOS') return res.status(400).json({ mensagem: 'Uma ou mais medições do lote são inválidas.' });
    res.status(500).json({ mensagem: 'Erro ao registrar lote de medições.' });
  }
});

// ============================================================
// 11. MODO DE TESTE E SIMULAÇÃO
// ============================================================

app.get('/api/configuracao/teste', exigirAdmin, async (req, res) => {
  try {
    const config = await get("SELECT valor FROM configuracoes WHERE chave = 'modo_teste'");
    res.json({ ativo: config && config.valor === '1' });
  } catch (erro) { res.status(500).json({ mensagem: 'Erro ao consultar modo de teste.' }); }
});

app.put('/api/configuracao/teste', exigirAdmin, async (req, res) => {
  try {
    const ativo = Boolean(req.body.ativo);
    await run("UPDATE configuracoes SET valor = ? WHERE chave = 'modo_teste'", [ativo ? '1' : '0']);
    res.json({ ativo, mensagem: ativo ? 'Modo de teste ativado.' : 'Modo de teste desativado.' });
  } catch (erro) { res.status(500).json({ mensagem: 'Erro ao alterar modo de teste.' }); }
});

// A simulação representa um caminhão que percorreu a cidade e descarregou
// o cartão na base. Os pontos sintéticos seguem vários corredores/percursos,
// em vez de preencherem um retângulo perfeito. Isso evita um heatmap artificial.
const areaTeste = {
  centroLat: -22.2520,
  centroLng: -45.7040,
  raioLat: 0.0260,
  raioLng: 0.0270
};

function coordenadaDaArea(x, y) {
  return {
    lat: areaTeste.centroLat + y * areaTeste.raioLat,
    lng: areaTeste.centroLng + x * areaTeste.raioLng
  };
}

function luminosidadeSimulada(lat, lng) {
  const x = (lng - areaTeste.centroLng) / areaTeste.raioLng;
  const y = (lat - areaTeste.centroLat) / areaTeste.raioLat;

  // Cria regiões amplas com níveis diferentes, para o mapa ter transições
  // de iluminação e não simplesmente ficar todo vermelho.
  const zona1 = 25 * Math.exp(-(((x + 0.42) ** 2) / 0.10 + ((y - 0.18) ** 2) / 0.18));
  const zona2 = -24 * Math.exp(-(((x - 0.35) ** 2) / 0.12 + ((y + 0.28) ** 2) / 0.14));
  const zona3 = 17 * Math.exp(-(((x - 0.12) ** 2) / 0.20 + ((y - 0.48) ** 2) / 0.10));
  const variacao = Math.sin(x * 5.2 + y * 2.0) * 8 + Math.cos(y * 5.5) * 6;
  const ruido = (Math.random() - 0.5) * 7;

  return Math.round(Math.max(10, Math.min(96, 57 + zona1 + zona2 + zona3 + variacao + ruido)));
}

function adicionarTrecho(medicoes, x1, y1, x2, y2, quantidade, inicio, intervalo) {
  for (let i = 0; i < quantidade; i++) {
    const t = quantidade === 1 ? 0 : i / (quantidade - 1);
    const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 0.009;
    const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 0.009;

    // Mantém a simulação dentro de uma área urbana arredondada/irregular.
        if ((x * x) + (y * y) > 0.98) continue;

    const pos = coordenadaDaArea(x, y);
    medicoes.push({
      luminosidade: luminosidadeSimulada(pos.lat, pos.lng),
      lat: pos.lat,
      lng: pos.lng,
      local: 'Santa Rita do Sapucaí - simulação',
      timestamp: new Date(inicio + medicoes.length * intervalo).toISOString()
    });
  }
}

function montarLoteTeste() {
  const medicoes = [];
  const inicio = Date.now() - 2 * 60 * 60 * 1000;
  const intervalo = 3200;

  // Percursos aproximadamente horizontais pela cidade.
  for (let faixa = -0.78; faixa <= 0.78; faixa += 0.13) {
    const limiteX = Math.sqrt(Math.max(0, 0.92 - faixa * faixa));
    const ondulacao = Math.sin(faixa * 8) * 0.045;
    adicionarTrecho(medicoes, -limiteX, faixa, limiteX, faixa + ondulacao, 48, inicio, intervalo);
  }

  // Percursos aproximadamente verticais, cruzando os anteriores como uma malha viária.
  for (let faixa = -0.72; faixa <= 0.72; faixa += 0.16) {
    const limiteY = Math.sqrt(Math.max(0, 0.90 - faixa * faixa));
    const deslocamento = Math.cos(faixa * 7) * 0.04;
    adicionarTrecho(medicoes, faixa, -limiteY, faixa + deslocamento, limiteY, 44, inicio, intervalo);
  }

  // Alguns eixos diagonais quebram o padrão de grade e deixam o resultado mais orgânico.
  adicionarTrecho(medicoes, -0.82, -0.30, 0.74, 0.56, 62, inicio, intervalo);
  adicionarTrecho(medicoes, -0.70, 0.66, 0.68, -0.52, 62, inicio, intervalo);
  adicionarTrecho(medicoes, -0.88, 0.14, 0.82, -0.04, 68, inicio, intervalo);

  return medicoes;
}


app.post('/api/teste/enviar-lote', exigirAdmin, async (req, res) => {
  try {
    const config = await get("SELECT valor FROM configuracoes WHERE chave = 'modo_teste'");
    if (!config || config.valor !== '1') return res.status(400).json({ mensagem: 'Ative o modo de teste primeiro.' });
    const lote = montarLoteTeste();
    const loteId = `TESTE-${Date.now()}`;
    await run('BEGIN TRANSACTION');
    try {
      for (const medicao of lote) await salvarMedicao(medicao, 'teste-cartao', loteId);
      await run('COMMIT');
    } catch (erro) {
      await run('ROLLBACK');
      throw erro;
    }
    res.status(201).json({ mensagem: 'Caminhão simulado chegou à base e enviou o conteúdo do cartão.', loteId, quantidade: lote.length });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao simular envio do cartão.' });
  }
});

app.get('/api/dashboard', exigirAdmin, async (req, res) => {
  try {
    const ocorrencias = await get('SELECT COUNT(*) AS total FROM ocorrencias');
    const medicoes = await get('SELECT COUNT(*) AS total FROM medicoes');
    const config = await get("SELECT valor FROM configuracoes WHERE chave = 'modo_teste'");
    res.json({
      totalOcorrencias: ocorrencias.total,
      totalMedicoes: medicoes.total,
      modoTeste: config && config.valor === '1'
    });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar dashboard.' });
  }
});

// ============================================================
// 12. FINALIZAÇÃO DO SERVIDOR
// ============================================================

// Se nenhuma rota acima foi encontrada, o servidor responde com erro 404.
app.use((req, res) => res.status(404).json({ mensagem: 'Rota não encontrada.' }));

// Primeiro prepara o banco. Somente depois começa a aceitar acessos na porta 3000.
iniciarBanco()
  .then(() => app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`)))
  .catch(erro => console.error('Erro ao iniciar banco:', erro));