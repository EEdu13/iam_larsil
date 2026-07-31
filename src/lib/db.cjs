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
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;
function getPool() {
  if (!config.password) {
    throw new Error(
      "Sem credenciais de banco. Preencha iam_larsil/.env ou garanta o .env do timbertrack-hq."
    );
  }
  if (!poolPromise) poolPromise = new sql.ConnectionPool(config).connect();
  return poolPromise;
}

module.exports = { sql, getPool, IAM_SCHEMA, config };
