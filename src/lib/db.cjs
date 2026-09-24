// ════════════════════════════════════════════════════════════════════════════
// Conexão com o Azure SQL — reaproveita o padrão do timbertrack-hq.
// ════════════════════════════════════════════════════════════════════════════
// Ordem de carga das credenciais:
//   1) .env deste projeto (iam_larsil/.env), se existir e tiver DB_PASSWORD;
//   2) fallback: .env do timbertrack-hq — para NÃO duplicar a senha do banco.
// A senha nunca é escrita em nenhum arquivo versionado deste repositório.
// ════════════════════════════════════════════════════════════════════════════

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// 1) tenta o .env local
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

// 2) se não veio senha (ausente OU em branco), cai no .env do timbertrack.
//    override:true porque o .env local deixa DB_* em branco de propósito — assim os
//    valores reais do timbertrack preenchem sem duplicar a senha aqui.
if (!process.env.DB_PASSWORD) {
  const timberEnv = path.resolve(
    __dirname, "..", "..", "..", "timbertrack-hq", ".env"
  );
  if (fs.existsSync(timberEnv)) {
    dotenv.config({ path: timberEnv, override: true });
  }
}

const sql = require("mssql");

const IAM_SCHEMA = process.env.IAM_SCHEMA || "iam";

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: { encrypt: true, trustServerCertificate: false },
  // timeouts explícitos: nada pode ficar pendurado pra sempre (senão o login "trava" em vez de errar).
  connectionTimeout: 15000,
  requestTimeout: 20000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// Pool resiliente: se a conexão falhar ou cair, DESCARTA a promise e reconecta na próxima chamada.
// Antes o pool era cacheado pra sempre — uma falha transitória (piscar de rede, Azure fechando
// conexão ociosa, redeploy) envenenava o pool e derrubava TODA a autenticação até reiniciar o processo.
let poolPromise = null;
function getPool() {
  if (!config.password) {
    throw new Error(
      "Sem credenciais de banco. Preencha iam_larsil/.env ou garanta o .env do timbertrack-hq."
    );
  }
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    pool.on("error", (err) => {
      console.error("[db] pool caiu, vai reconectar na próxima query:", err.message);
      poolPromise = null; // erro/desconexão do pool → recria na próxima getPool()
    });
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null; // NÃO cacheia a promise falha → a próxima chamada tenta de novo
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool, IAM_SCHEMA, config };
