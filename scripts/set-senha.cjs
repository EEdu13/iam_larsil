// Bootstrap: define a senha de um usuário pelo login (para criar o primeiro admin).
// Uso: node scripts/set-senha.cjs <login> <senha> [--provisoria]
const { sql, getPool, IAM_SCHEMA } = require("../src/lib/db.cjs");
const { hashSenha } = require("../src/lib/hash.cjs");

async function main() {
  const login = process.argv[2];
  const senha = process.argv[3];
  const provisoria = process.argv.includes("--provisoria") ? 1 : 0;
  if (!login || !senha) throw new Error("Uso: node scripts/set-senha.cjs <login> <senha> [--provisoria]");

  const pool = await getPool();
  const upd = await pool.request()
    .input("login", sql.VarChar(60), login.toLowerCase())
    .input("hash", sql.VarChar(255), hashSenha(senha))
    .input("prov", sql.Bit, provisoria)
    .query(`UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
            SET SENHA_HASH=@hash, SENHA_PROVISORIA=@prov,
                ESTADO=CASE WHEN ESTADO='PENDENTE_CONFIGURACAO' THEN 'ATIVO' ELSE ESTADO END,
                ATUALIZADO_EM=SYSUTCDATETIME()
            WHERE LOWER(LOGIN)=@login`);
  if (!upd.rowsAffected[0]) throw new Error(`Login "${login}" não encontrado.`);
  console.log(`Senha definida para ${login} (provisoria=${provisoria}).`);
  await pool.close();
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
