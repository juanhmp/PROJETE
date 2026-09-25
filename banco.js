const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database(path.join(__dirname, 'dados.db'));
//teste teste
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
  await garantirColuna('medicoes', 'lote_id', 'TEXT');

  // O modo de simulação não é mais usado.
  await run("DELETE FROM configuracoes WHERE chave = 'modo_teste'");

  // Limpeza executada uma única vez ao atualizar uma instalação antiga.
  // Mantém contas e ocorrências, removendo apenas as medições anteriores.
  const limpezaInicial = await get(
    "SELECT valor FROM configuracoes WHERE chave = 'limpeza_medicoes_v1'"
  );

  if (!limpezaInicial) {
    await run('DELETE FROM medicoes');
    await run("DELETE FROM configuracoes WHERE chave = 'ultimo_recebimento_medicao'");
    await run(
      "INSERT INTO configuracoes (chave, valor) VALUES ('limpeza_medicoes_v1', ?)",
      [new Date().toISOString()]
    );
  }

  const total = await get('SELECT COUNT(*) AS total FROM usuarios');

  if (!total || total.total === 0) {
    const senhaInicial = "Admin@123";

    if (!senhaInicial || senhaInicial.length < 8) {
      throw new Error(
        'Banco sem administrador. Configure INITIAL_ADMIN_PASSWORD com pelo menos 8 caracteres.'
      );
    }

    await run(
      `INSERT INTO usuarios (username, password, role, nome, ativo, trocar_senha, criado_em)
       VALUES (?, ?, 'admin', ?, 1, 1, ?)`,
      ['admin', bcrypt.hashSync(senhaInicial, 12), 'Administrador', new Date().toISOString()]
    );

    console.log('Administrador inicial criado. A troca de senha será exigida no primeiro acesso.');
  } else {
    await run(
      'UPDATE usuarios SET criado_em = COALESCE(criado_em, ?) WHERE criado_em IS NULL',
      [new Date().toISOString()]
    );
  }
}

function buscarUsuarioPorId(id) {
  return get('SELECT * FROM usuarios WHERE id = ?', [id]);
}

function listarAdministradores() {
  return all(
    `SELECT id, nome, username, ativo, trocar_senha, criado_em, ultimo_login
     FROM usuarios
     WHERE role = 'admin'
     ORDER BY nome COLLATE NOCASE`
  );
}

function buscarUsuarioPorUsername(username) {
  return get('SELECT id FROM usuarios WHERE username = ?', [username]);
}

function criarAdministrador({ username, passwordHash, nome, criadoEm }) {
  return run(
    `INSERT INTO usuarios (username, password, role, nome, ativo, trocar_senha, criado_em)
     VALUES (?, ?, 'admin', ?, 1, 1, ?)`,
    [username, passwordHash, nome, criadoEm]
  );
}

function buscarAdministradorPorId(id) {
  return get("SELECT * FROM usuarios WHERE id = ? AND role = 'admin'", [id]);
}

function buscarConflitoUsername(username, idIgnorado) {
  return get(
    'SELECT id FROM usuarios WHERE username = ? AND id <> ?',
    [username, idIgnorado]
  );
}

function contarAdministradoresAtivos() {
  return get(
    "SELECT COUNT(*) AS total FROM usuarios WHERE role = 'admin' AND ativo = 1"
  );
}

function atualizarAdministrador(id, nome, username, ativo) {
  return run(
    'UPDATE usuarios SET nome = ?, username = ?, ativo = ? WHERE id = ?',
    [nome, username, ativo ? 1 : 0, id]
  );
}

function redefinirSenhaAdministrador(id, passwordHash) {
  return run(
    'UPDATE usuarios SET password = ?, trocar_senha = 1, ativo = 1 WHERE id = ?',
    [passwordHash, id]
  );
}

function buscarAdministradorPorLogin(username) {
  return get(
    "SELECT * FROM usuarios WHERE username = ? AND role = 'admin'",
    [username]
  );
}

function atualizarUltimoLogin(id, dataIso) {
  return run(
    'UPDATE usuarios SET ultimo_login = ? WHERE id = ?',
    [dataIso, id]
  );
}

function alterarSenhaUsuario(id, passwordHash) {
  return run(
    'UPDATE usuarios SET password = ?, trocar_senha = 0 WHERE id = ?',
    [passwordHash, id]
  );
}

function listarOcorrencias() {
  return all('SELECT * FROM ocorrencias ORDER BY id DESC');
}

function criarOcorrencia({ location, description, priority, timestamp, criadoPor = null }) {
  return run(
    `INSERT INTO ocorrencias
      (location, description, priority, status, timestamp, criado_por)
     VALUES (?, ?, ?, 'pendente', ?, ?)`,
    [location, description, priority, timestamp, criadoPor]
  );
}

function atualizarStatusOcorrencia(id, status) {
  return run(
    'UPDATE ocorrencias SET status = ? WHERE id = ?',
    [status, id]
  );
}

function listarMedicoes(limite) {
  return all(
    'SELECT * FROM medicoes ORDER BY id DESC LIMIT ?',
    [limite]
  );
}

async function buscarAreasMapaCalor() {
  const ultimoLote = await get(
    'SELECT lote_id FROM medicoes WHERE lote_id IS NOT NULL ORDER BY id DESC LIMIT 1'
  );

  let dados;
  let loteId = null;

  if (ultimoLote && ultimoLote.lote_id) {
    loteId = ultimoLote.lote_id;

    dados = await all(
      `SELECT
         ROUND(lat * 500, 0) / 500.0 AS lat_celula,
         ROUND(lng * 500, 0) / 500.0 AS lng_celula,
         AVG(luminosidade) AS luminosidade_media,
         COUNT(*) AS quantidade
       FROM medicoes
       WHERE lote_id = ?
       GROUP BY ROUND(lat * 500, 0), ROUND(lng * 500, 0)`,
      [loteId]
    );
  } else {
    dados = await all(
      `SELECT
         ROUND(lat * 500, 0) / 500.0 AS lat_celula,
         ROUND(lng * 500, 0) / 500.0 AS lng_celula,
         AVG(luminosidade) AS luminosidade_media,
         COUNT(*) AS quantidade
       FROM (
         SELECT * FROM medicoes ORDER BY id DESC LIMIT 5000
       )
       GROUP BY ROUND(lat * 500, 0), ROUND(lng * 500, 0)`
    );
  }

  return { loteId, dados };
}

function inserirMedicao({
  luminosidade,
  lat,
  lng,
  local,
  origem,
  loteId,
  timestamp
}) {
  return run(
    `INSERT INTO medicoes
      (luminosidade, lat, lng, local, origem, lote_id, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [luminosidade, lat, lng, local, origem, loteId, timestamp]
  );
}

function excluirTodasMedicoes() {
  return run('DELETE FROM medicoes');
}

function obterUltimoRecebimentoMedicao() {
  return get(
    "SELECT valor FROM configuracoes WHERE chave = 'ultimo_recebimento_medicao'"
  );
}

function registrarUltimoRecebimentoMedicao(dataIso) {
  return run(
    `INSERT INTO configuracoes (chave, valor)
     VALUES ('ultimo_recebimento_medicao', ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    [dataIso]
  );
}

async function executarTransacao(callback) {
  await run('BEGIN TRANSACTION');

  try {
    const resultado = await callback();
    await run('COMMIT');
    return resultado;
  } catch (erro) {
    await run('ROLLBACK');
    throw erro;
  }
}

async function obterDashboard() {
  const ocorrencias = await get('SELECT COUNT(*) AS total FROM ocorrencias');
  const medicoes = await get('SELECT COUNT(*) AS total FROM medicoes');

  return {
    totalOcorrencias: ocorrencias.total,
    totalMedicoes: medicoes.total
  };
}

module.exports = {
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
};
