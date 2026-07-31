// Helper de auditoria — grava uma linha em iam.IAM_AUDITORIA.
const { sql, IAM_SCHEMA } = require("./db.cjs");

async function auditar(pool, { usuarioId = null, acao, detalhe = null, ator = null }) {
  const req = pool.request();
  req.input("uid", sql.Int, usuarioId);
  req.input("acao", sql.VarChar(60), acao);
  req.input("detalhe", sql.NVarChar(sql.MAX), detalhe ? JSON.stringify(detalhe) : null);
  req.input("ator", sql.NVarChar(120), ator);
  await req.query(`
    INSERT INTO ${IAM_SCHEMA}.IAM_AUDITORIA (USUARIO_ID, ACAO, DETALHE, ATOR)
    VALUES (@uid, @acao, @detalhe, @ator)
  `);
}

module.exports = { auditar };
