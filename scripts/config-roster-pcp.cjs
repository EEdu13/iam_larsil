// ════════════════════════════════════════════════════════════════════════════
// Configura papel + escopo do roster inicial do Painel PCP (pessoas reais).
// Sobrescreve o auto-seed por cargo destes logins específicos. Idempotente.
// Âncoras de escopo derivadas de ORGANOGRAMA (supervisor=nome; projeto=lançamento).
// ════════════════════════════════════════════════════════════════════════════
const { sql, getPool, IAM_SCHEMA } = require("../src/lib/db.cjs");

const ROSTER = [
  { login: "paulo.machado",    papel: "GERENCIA",   escopos: [["GLOBAL", null]] },                         // gerente, vê tudo
  { login: "leonardo.medalha", papel: "GERENCIA",   escopos: [["GLOBAL", null]] },                         // supervisor do PCP, vê tudo (mesmo acesso do gerente)
  { login: "rodrigo.oliveira", papel: "SUPERVISOR", escopos: [["SUPERVISOR", "RODRIGO GAUTO DE OLIVEIRA"]] },
  { login: "oscar.prates",     papel: "SUPERVISOR", escopos: [["SUPERVISOR", "OSCAR ANTONIO TEIXEIRA PRATES"]] },
  { login: "camila.reis",      papel: "PCP",        escopos: [["GLOBAL", null]] },                         // analista, vê tudo
  { login: "renata.prestes",   papel: "PCP",        escopos: [["PROJETO","202"],["PROJETO","705"],["PROJETO","706"]] },
  { login: "natalia.jesus",    papel: "PCP",        escopos: [["PROJETO","801"],["PROJETO","820"],["PROJETO","830"]] },
  { login: "zoraide.crabi",    papel: "PCP",        escopos: [["PROJETO","704"]] },
  { login: "hevelyn.carvalho", papel: "PCP",        escopos: [["PROJETO","206"],["PROJETO","708"]] },
  { login: "aline.faria",      papel: "PCP",        escopos: [["PROJETO","810"]] },
];

async function main() {
  const pool = await getPool();
  const papeis = {};
  for (const p of (await pool.request().query(`SELECT ID,NOME FROM ${IAM_SCHEMA}.IAM_PAPEIS`)).recordset) papeis[p.NOME] = p.ID;

  for (const r of ROSTER) {
    const u = (await pool.request().input("l", sql.VarChar(60), r.login)
      .query(`SELECT ID FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE LOGIN=@l`)).recordset[0];
    if (!u) { console.log(`  ⚠ ${r.login} NÃO encontrado — pulando`); continue; }
    const uid = u.ID;

    // limpa papéis/escopos anteriores DESTE usuário (config explícita substitui o auto-seed)
    await pool.request().input("id", sql.Int, uid).query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS WHERE USUARIO_ID=@id`);
    await pool.request().input("id", sql.Int, uid).query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@id`);

    // papel
    await pool.request().input("id", sql.Int, uid).input("pid", sql.Int, papeis[r.papel]).input("por", sql.NVarChar(120), "CONFIG:ROSTER-PCP")
      .query(`INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS (USUARIO_ID,PAPEL_ID,CRIADO_POR) VALUES (@id,@pid,@por)`);

    // escopos
    for (const [tipo, valor] of r.escopos) {
      await pool.request().input("id", sql.Int, uid).input("t", sql.VarChar(20), tipo)
        .input("v", sql.NVarChar(255), valor).input("por", sql.NVarChar(120), "CONFIG:ROSTER-PCP")
        .query(`INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO (USUARIO_ID,TIPO,VALOR,CRIADO_POR) VALUES (@id,@t,@v,@por)`);
    }
    console.log(`  ✓ ${r.login.padEnd(20)} -> ${r.papel.padEnd(11)} escopo: ${r.escopos.map(e => e[0] + (e[1] ? "=" + e[1] : "")).join(", ")}`);
  }
  await pool.close();
  console.log("\nRoster PCP configurado.");
}
main().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
