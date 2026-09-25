const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const banco = require('./banco');
const {
  iniciarBanco,
  buscarUsuarioPorId,
  listarAdministradores,
  buscarUsuarioPorUsername,
  criarAdministrador,
  buscarAdministradorPorId,
  buscarConflitoUsername,
  contarAdministradoresAtivos,
  atualizarAdministrador,
  redefinirSenhaAdministrador,
  buscarAdministradorPorLogin,
  atualizarUltimoLogin,
  alterarSenhaUsuario,
  listarOcorrencias,
  criarOcorrencia,
  atualizarStatusOcorrencia,
  listarMedicoes,
  buscarAreasMapaCalor,
  inserirMedicao,
  excluirTodasMedicoes,
  obterUltimoRecebimentoMedicao,
  registrarUltimoRecebimentoMedicao,
  executarTransacao,
  obterDashboard
} = banco;
const app = express();
const PORT = 3000;
// Se nenhuma medição chegar durante este período, a próxima inicia
// uma nova coleta e substitui todas as medições da coleta anterior.
const TEMPO_NOVA_COLETA_MS = 5 * 60 * 1000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const SESSION_SECRET = "lightSentinel3403";
const OPERATOR_SECRET = "Projete@3403!";
const PERMITIR_OPERADOR_REMOTO = process.env.ALLOW_OPERATOR_REMOTE === 'true';

if (!SESSION_SECRET || !OPERATOR_SECRET) {
  throw new Error(
    'Configure SESSION_SECRET e OPERATOR_SECRET nas variáveis de ambiente antes de iniciar o servidor.'
  );
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'lumi.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: PRODUCAO,
    maxAge: 8 * 60 * 60 * 1000
  }
}));
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
  const u = await buscarUsuarioPorId(req.session.usuarioId);
  if (!u || !u.ativo) return null;
  return u;
}
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
function senhaOperadorCorresponde(recebida) {
  return segredoCorresponde(recebida, OPERATOR_SECRET);
}
function exigirMaquinaOperador(req, res, next) {
  if (PERMITIR_OPERADOR_REMOTO) return next();
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
    if (u.trocar_senha) return res.status(403).json({ mensagem: 'Troque sua senha antes de continuar.', codigo: 'TROCA_SENHA' });
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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'login.html')));
app.get('/login-admin', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'admin-login.html')));
app.get('/esqueceu-senha', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'esqueceu-senha.html')));
app.get('/operador-login', exigirMaquinaOperador, (req, res) => res.sendFile(path.join(__dirname, 'pages', 'operador-login.html')));
app.get('/operador', exigirMaquinaOperador, (req, res) => paginaOperador(req, res, 'operador.html'));
app.get('/admin', (req, res) => paginaProtegida('admin', req, res, 'admin.html'));
app.get('/usuario', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'usuario.html')));
app.get('/mapa', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'mapa.html')));
app.get('/ocorrencias', (req, res) => paginaProtegida('admin', req, res, 'ocorrencias.html'));
app.get('/registrar', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'registrar.html')));
app.get('/senha', (req, res) => paginaProtegida('admin', req, res, 'senha.html'));
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
    const usuarios = await listarAdministradores();
    res.json(usuarios.map(u => ({
      id: u.id, nome: u.nome, username: u.username, ativo: Boolean(u.ativo),
      trocarSenha: Boolean(u.trocar_senha), criadoEm: u.criado_em, ultimoLogin: u.ultimo_login
    })));
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar administradores.' });
  }
});
app.post('/api/operador/administradores', exigirMaquinaOperador, exigirOperador, exigirCsrfOperador, async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const username = String(req.body.username || '').trim();
    const senha = String(req.body.senhaTemporaria || '');
    if (nome.length < 2 || nome.length > 80) return res.status(400).json({ mensagem: 'Informe um nome válido.' });
    if (!usernameValido(username)) return res.status(400).json({ mensagem: 'O usuário deve ter de 3 a 32 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.' });
    if (!senhaValida(senha)) return res.status(400).json({ mensagem: 'A senha temporária deve ter 8 a 72 caracteres, com letra maiúscula, minúscula e número.' });
    const existe = await buscarUsuarioPorUsername(username);
    if (existe) return res.status(409).json({ mensagem: 'Esse nome de usuário já existe.' });
    const resultado = await criarAdministrador({
      username,
      passwordHash: bcrypt.hashSync(senha, 12),
      nome,
      criadoEm: new Date().toISOString()
    });
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
    const atual = await buscarAdministradorPorId(id);
    if (!atual) return res.status(404).json({ mensagem: 'Administrador não encontrado.' });
    const nome = String(req.body.nome ?? atual.nome).trim();
    const username = String(req.body.username ?? atual.username).trim();
    const ativo = req.body.ativo === undefined ? Boolean(atual.ativo) : Boolean(req.body.ativo);
    if (nome.length < 2 || nome.length > 80) return res.status(400).json({ mensagem: 'Informe um nome válido.' });
    if (!usernameValido(username)) return res.status(400).json({ mensagem: 'Nome de usuário inválido.' });
    const conflito = await buscarConflitoUsername(username, id);
    if (conflito) return res.status(409).json({ mensagem: 'Esse nome de usuário já está em uso.' });
    if (!ativo && atual.ativo) {
      const ativos = await contarAdministradoresAtivos();
      if (ativos.total <= 1) return res.status(400).json({ mensagem: 'Não é possível desativar o único administrador ativo.' });
    }
    await atualizarAdministrador(id, nome, username, ativo);
    res.json({ mensagem: ativo ? 'Administrador atualizado.' : 'Administrador desativado.' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao atualizar administrador.' });
  }
});
app.put('/api/operador/administradores/:id/redefinir-senha', exigirMaquinaOperador, exigirOperador, exigirCsrfOperador, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const senha = String(req.body.senhaTemporaria || '');
    const u = await buscarAdministradorPorId(id);
    if (!u) return res.status(404).json({ mensagem: 'Administrador não encontrado.' });
    if (!senhaValida(senha)) return res.status(400).json({ mensagem: 'A senha temporária deve ter 8 a 72 caracteres, com letra maiúscula, minúscula e número.' });
    await redefinirSenhaAdministrador(id, bcrypt.hashSync(senha, 12));
    res.json({ mensagem: 'Senha redefinida. No próximo login, o administrador será obrigado a criar uma nova senha.' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao redefinir senha.' });
  }
});
app.post('/api/login', limitarLogin, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const u = await buscarAdministradorPorLogin(username);
    if (!u || !u.ativo || !bcrypt.compareSync(password, u.password)) {
      return res.status(401).json({ sucesso: false, mensagem: 'Administrador ou senha inválidos.' });
    }
    req.session.regenerate(async erro => {
      if (erro) return res.status(500).json({ mensagem: 'Não foi possível criar a sessão.' });
      req.session.usuarioId = u.id;
      const agora = new Date().toISOString();
      await atualizarUltimoLogin(u.id, agora);
      const atual = { ...u, ultimo_login: agora };
      res.json({
        sucesso: true,
        usuario: usuarioPublico(atual),
        destino: u.trocar_senha ? '/senha' : '/admin'
      });
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
    if (!bcrypt.compareSync(atual, req.usuario.password)) return res.status(400).json({ mensagem: 'A senha atual está incorreta.' });
    if (!senhaValida(nova)) return res.status(400).json({ mensagem: 'A nova senha deve ter 8 a 72 caracteres, com letra maiúscula, minúscula e número.' });
    if (bcrypt.compareSync(nova, req.usuario.password)) return res.status(400).json({ mensagem: 'A nova senha deve ser diferente da senha atual.' });
    await alterarSenhaUsuario(req.usuario.id, bcrypt.hashSync(nova, 12));
    res.json({ mensagem: 'Senha alterada com sucesso.', destino: req.usuario.role === 'admin' ? '/admin' : '/usuario' });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao alterar senha.' });
  }
});
app.get('/api/ocorrencias', exigirAdmin, async (req, res) => {
  try {
    res.json(await listarOcorrencias());
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar ocorrências.' });
  }
});
app.post('/api/ocorrencias', async (req, res) => {
  try {
    const { location, description, priority } = req.body;
    if (!location || !description || !['high', 'medium', 'low'].includes(priority)) {
      return res.status(400).json({ mensagem: 'Preencha os campos obrigatórios corretamente.' });
    }
    if (String(location).length > 120 || String(description).length > 1000) {
      return res.status(400).json({ mensagem: 'Localização ou descrição muito longa.' });
    }
    const timestamp = new Date().toISOString();
    const resultado = await criarOcorrencia({
      location: String(location).trim(),
      description: String(description).trim(),
      priority,
      timestamp,
      criadoPor: null
    });
    res.status(201).json({ mensagem: 'Ocorrência registrada com sucesso.', id: resultado.id });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao registrar ocorrência.' });
  }
});
app.put('/api/ocorrencias/:id/status', exigirAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pendente', 'andamento', 'resolvida'].includes(status)) return res.status(400).json({ mensagem: 'Status inválido.' });
    const resultado = await atualizarStatusOcorrencia(req.params.id, status);
    if (!resultado.changes) return res.status(404).json({ mensagem: 'Ocorrência não encontrada.' });
    res.json({ mensagem: 'Status atualizado.', status });
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao atualizar ocorrência.' });
  }
});
app.get('/api/medicoes', exigirAdmin, async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 300, 1), 1000);
    res.json(await listarMedicoes(limite));
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar medições.' });
  }
});
app.get('/api/mapa/calor', async (req, res) => {
  try {
    const { loteId, dados } = await buscarAreasMapaCalor();
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
  const resultado = await inserirMedicao({
    luminosidade: valor,
    lat: latitude,
    lng: longitude,
    local: String(dado.local || 'Santa Rita do Sapucaí').slice(0, 120),
    origem,
    loteId,
    timestamp
  });
  return { id: resultado.id, luminosidade: valor, lat: latitude, lng: longitude, lote_id: loteId, timestamp };
}

async function prepararRecebimentoMedicoes(recebidoEm) {
  const registro = await obterUltimoRecebimentoMedicao();
  const ultimoRecebimento = registro ? Date.parse(registro.valor) : NaN;
  const agora = Date.parse(recebidoEm);
  const ficouSemReceber = Number.isFinite(ultimoRecebimento)
    && (agora - ultimoRecebimento >= TEMPO_NOVA_COLETA_MS);

  if (ficouSemReceber) {
    await excluirTodasMedicoes();
  }

  return ficouSemReceber;
}

app.post('/api/medicoes', async (req, res) => {
  try {
    const recebidoEm = new Date().toISOString();
    let medicao;
    let novaColeta = false;

    await executarTransacao(async () => {
      novaColeta = await prepararRecebimentoMedicoes(recebidoEm);
      medicao = await salvarMedicao(req.body, 'bluetooth');
      await registrarUltimoRecebimentoMedicao(recebidoEm);
    });

    res.status(201).json({ mensagem: 'Medição recebida.', novaColeta, medicao });
  } catch (erro) {
    if (erro.message === 'DADOS_INVALIDOS') return res.status(400).json({ mensagem: 'Medição inválida.' });
    res.status(500).json({ mensagem: 'Erro ao salvar medição.' });
  }
});
app.post('/api/medicoes/lote', async (req, res) => {
  try {
    const medicoes = Array.isArray(req.body) ? req.body : req.body.medicoes;

    if (!Array.isArray(medicoes) || medicoes.length === 0) {
      return res.status(400).json({
        mensagem: 'Envie uma lista de medições.'
      });
    }

    if (medicoes.length > 5000) {
      return res.status(400).json({
        mensagem: 'O lote ultrapassa o limite de 5000 medições.'
      });
    }

    const loteId = String(
      req.body.loteId || `LOTE-${Date.now()}`
    );

    const recebidoEm = new Date().toISOString();
    let novaColeta = false;

    await executarTransacao(async () => {
      novaColeta = await prepararRecebimentoMedicoes(recebidoEm);
      for (const medicao of medicoes) {
        await salvarMedicao(
          medicao,
          'bluetooth-lote',
          loteId
        );
      }
      await registrarUltimoRecebimentoMedicao(recebidoEm);
    });

    res.status(201).json({
      mensagem: 'Lote recebido e registrado.',
      loteId,
      novaColeta,
      quantidade: medicoes.length
    });
  } catch (erro) {
    if (erro.message === 'DADOS_INVALIDOS') {
      return res.status(400).json({
        mensagem: 'Uma ou mais medições do lote são inválidas.'
      });
    }

    res.status(500).json({
      mensagem: 'Erro ao registrar lote de medições.'
    });
  }
});
app.get('/api/dashboard', exigirAdmin, async (req, res) => {
  try {
    res.json(await obterDashboard());
  } catch (erro) {
    res.status(500).json({ mensagem: 'Erro ao carregar dashboard.' });
  }
});
app.use((req, res) => res.status(404).json({ mensagem: 'Rota não encontrada.' }));
iniciarBanco()
  .then(() => app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`)))
  .catch(erro => console.error('Erro ao iniciar banco:', erro));
