// ════════════════════════════════════════════════════════════════════════════
// FATIA 1 — Import de identidades: dbo.COLABORADORES  ->  iam.IAM_USUARIOS
// ════════════════════════════════════════════════════════════════════════════
// O que faz:
//   - lê os colaboradores ATIVOS de dbo.COLABORADORES (SITUACAO='1');
//   - gera um login nome.sobrenome único e determinístico para cada um;
//   - faz MERGE por CPF: quem já existe em iam.IAM_USUARIOS é atualizado
//     (nome/matrícula/ativo), quem não existe é inserido SEM SENHA.
//   - nunca cria senha, nunca concede acesso — só identidade.
//   - registra em iam.IAM_AUDITORIA.
//
// Uso:
//   node scripts/import-colaboradores.cjs --dry-run   (não grava, só mostra)
//   node scripts/import-colaboradores.cjs             (grava de verdade)
//   node scripts/import-colaboradores.cjs --todos     (inclui inativos também)
// ════════════════════════════════════════════════════════════════════════════

const { sql, getPool, IAM_SCHEMA } = require("../src/lib/db.cjs");
const { gerarLoginUnico } = require("../src/lib/login.cjs");

const DRY = process.argv.includes("--dry-run");
const TODOS = process.argv.includes("--todos");

function soDigitos(s) {
  return String(s || "").replace(/\D/g, "");
}

async function main() {
  const pool = await getPool();

  // 1) Lê a fonte de verdade
  const filtroSituacao = TODOS ? "" : "WHERE LTRIM(RTRIM(SITUACAO)) = '1'";
  const src = await pool.request().query(`
    SELECT CPF, MATRICULA, NOME, SITUACAO
    FROM dbo.COLABORADORES
    ${filtroSituacao}
    ORDER BY NOME
  `);

  const rows = src.recordset
    .map((r) => ({
      cpf: soDigitos(r.CPF).padStart(11, "0"),
      matricula: r.MATRICULA ? String(r.MATRICULA).trim() : null,
      nome: (r.NOME || "").trim(),
      ativo: String(r.SITUACAO).trim() === "1" ? 1 : 0,
    }))
    .filter((r) => r.cpf.length === 11 && r.nome.length > 0);

  // 2) Logins já usados no banco (para não colidir com quem já foi importado antes).
  //    Se a tabela ainda não existe (ex.: dry-run antes de criar o schema), assume vazio.
  const tabExiste = await pool
    .request()
    .query(`SELECT OBJECT_ID('${IAM_SCHEMA}.IAM_USUARIOS') AS oid`);
  let usados = new Set();
  let cpfExistente = new Set();
  if (tabExiste.recordset[0].oid != null) {
    const existentes = await pool.request().query(
      `SELECT LOGIN, CPF FROM ${IAM_SCHEMA}.IAM_USUARIOS`
    );
    usados = new Set(existentes.recordset.map((r) => String(r.LOGIN).toLowerCase()));
    cpfExistente = new Set(existentes.recordset.map((r) => String(r.CPF)));
  } else if (!DRY) {
    throw new Error(`Tabela ${IAM_SCHEMA}.IAM_USUARIOS não existe. Rode o schema db/schema/01_identidade.sql primeiro.`);
  }

  // 3) Gera logins e classifica insert vs update
  const plano = [];
  const colisoes = [];
  for (const r of rows) {
    const jaTem = cpfExistente.has(r.cpf);
    let login = null;
    if (!jaTem) {
      const g = gerarLoginUnico(r.nome, usados, `mat${r.matricula || ""}`);
      login = g.login;
      if (g.colidiu) colisoes.push({ nome: r.nome, login });
    }
    plano.push({ ...r, login, acao: jaTem ? "UPDATE" : "INSERT" });
  }

  const inserts = plano.filter((p) => p.acao === "INSERT");
  const updates = plano.filter((p) => p.acao === "UPDATE");

  // 4) Relatório
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  IMPORT COLABORADORES -> ${IAM_SCHEMA}.IAM_USUARIOS  ${DRY ? "(DRY-RUN)" : "(GRAVANDO)"}`);
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Fonte (dbo.COLABORADORES ${TODOS ? "todos" : "ativos"}): ${rows.length}`);
  console.log(`  Já existentes em IAM (por CPF): ${updates.length}`);
  console.log(`  Novas identidades a inserir:    ${inserts.length}`);
  console.log(`  Logins com desempate/colisão:   ${colisoes.length}`);
  console.log("");
  console.log("  Amostra de logins gerados (primeiros 15 novos):");
  for (const p of inserts.slice(0, 15)) {
    console.log(`    ${p.login.padEnd(28)}  <-  ${p.nome}`);
  }
  if (colisoes.length) {
    console.log("\n  Colisões resolvidas:");
    for (const c of colisoes.slice(0, 20)) console.log(`    ${c.login.padEnd(28)}  <-  ${c.nome}`);
  }

  if (DRY) {
    console.log("\n  DRY-RUN: nada foi gravado. Rode sem --dry-run para aplicar.");
    await pool.close();
    return;
  }

  // 5) Grava (INSERT dos novos + UPDATE snapshot dos existentes)
  let ok = 0;
  for (const p of inserts) {
    const req = pool.request();
    req.input("cpf", sql.Char(11), p.cpf);
    req.input("matricula", sql.VarChar(20), p.matricula);
    req.input("nome", sql.NVarChar(255), p.nome);
    req.input("login", sql.VarChar(60), p.login);
    req.input("ativo", sql.Bit, p.ativo);
    await req.query(`
      INSERT INTO ${IAM_SCHEMA}.IAM_USUARIOS (CPF, MATRICULA, NOME, LOGIN, ATIVO, ESTADO, CRIADO_POR)
      VALUES (@cpf, @matricula, @nome, @login, @ativo, 'PENDENTE_CONFIGURACAO', 'IMPORT:COLABORADORES');
      INSERT INTO ${IAM_SCHEMA}.IAM_AUDITORIA (USUARIO_ID, ACAO, DETALHE, ATOR)
      VALUES (SCOPE_IDENTITY(), 'IDENTIDADE_CRIADA',
              (SELECT @cpf AS cpf, @login AS login, @nome AS nome FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
              'IMPORT');
    `);
    ok++;
  }
  for (const p of updates) {
    const req = pool.request();
    req.input("cpf", sql.Char(11), p.cpf);
    req.input("matricula", sql.VarChar(20), p.matricula);
    req.input("nome", sql.NVarChar(255), p.nome);
    req.input("ativo", sql.Bit, p.ativo);
    await req.query(`
      UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
         SET MATRICULA = @matricula, NOME = @nome, ATIVO = @ativo, ATUALIZADO_EM = SYSUTCDATETIME()
       WHERE CPF = @cpf;
    `);
  }

  console.log(`\n  GRAVADO: ${ok} inseridos, ${updates.length} atualizados.`);
  await pool.close();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
