// ════════════════════════════════════════════════════════════════════════════
// FATIA 3 — Seed de papel + escopo por usuário, a partir do cargo (dbo.COLABORADORES.FUNCAO)
// e da hierarquia (dbo.ORGANOGRAMA). É a SUGESTÃO inicial baseada no cargo-molde;
// o admin pode ajustar depois na tela. Idempotente. Flags: --dry-run
// ════════════════════════════════════════════════════════════════════════════
const { sql, getPool, IAM_SCHEMA } = require("../src/lib/db.cjs");
const DRY = process.argv.includes("--dry-run");

// cargo (FUNCAO) -> papel. Primeira regra que casar vence.
function papelDoCargo(funcao) {
  const f = (funcao || "").toUpperCase();
  if (f.includes("COORDENADOR")) return "COORDENADOR";
  if (f.includes("GERENTE")) return "GERENCIA";
  if (f.includes("SUPERVISOR")) return "SUPERVISOR";
  if (f.includes("TECNOLOGIA DA INFORMAC")) return "TI";
  if (f.includes("LIDER") || f.includes("MONITOR FLORESTAL")) return "LIDER";
  if (f.includes("PCP") || f.includes("PLANEJAMENTO")) return "PCP";
  if (f.includes("ADMINISTRATIV") || f.includes("ASSISTENTE") || f.includes("AUXILIAR") ||
      f.includes("ANALISTA") || f.includes("FINANCEIRO") || f.includes("COMPRADOR") ||
      f.includes("TECNICO") || f.includes("ENFERMEIR") || f.includes("QUALIDADE") ||
      f.includes("SEGURANC") || f.includes("APRENDIZ")) return "ADM";
  return "TRABALHADOR"; // trabalhador florestal, operador, motorista, serviços gerais, mecânico...
}

async function main() {
  const pool = await getPool();

  // mapa papel -> id e escopo padrão
  const papeisRs = await pool.request().query(`SELECT ID, NOME, ESCOPO_TIPO_PADRAO FROM ${IAM_SCHEMA}.IAM_PAPEIS`);
  const papelId = {}; const escopoPadrao = {};
  for (const p of papeisRs.recordset) { papelId[p.NOME] = p.ID; escopoPadrao[p.NOME] = p.ESCOPO_TIPO_PADRAO; }

  // usuários COLABORADORES (com FUNCAO/PROJETO/EQUIPE via join por CPF)
  const usuarios = await pool.request().query(`
    SELECT u.ID, u.NOME, u.LOGIN, u.ORIGEM, c.FUNCAO, c.PROJETO, c.EQUIPE
    FROM ${IAM_SCHEMA}.IAM_USUARIOS u
    LEFT JOIN dbo.COLABORADORES c ON c.CPF = u.CPF
  `);

  // equipes lideradas (ORGANOGRAMA.LIDER = nome) e nomes de coord/sup existentes
  const orgRs = await pool.request().query(`
    SELECT DISTINCT LTRIM(RTRIM(LIDER)) AS LIDER, LTRIM(RTRIM(EQUIPE)) AS EQUIPE FROM dbo.ORGANOGRAMA WHERE LIDER IS NOT NULL AND EQUIPE IS NOT NULL
  `);
  const equipesDoLider = {};
  for (const o of orgRs.recordset) {
    if (!o.LIDER) continue;
    (equipesDoLider[o.LIDER] = equipesDoLider[o.LIDER] || new Set()).add(o.EQUIPE);
  }

  // monta plano
  const plano = [];
  const contagem = {};
  for (const u of usuarios.recordset) {
    let papel;
    let escopos = []; // [{tipo, valor}]
    if (u.ORIGEM === "SISTEMA") {
      papel = "TI"; escopos = [{ tipo: "GLOBAL", valor: null }];
    } else {
      papel = papelDoCargo(u.FUNCAO);
      const tipo = escopoPadrao[papel];
      const nome = (u.NOME || "").trim();
      if (tipo === "GLOBAL") escopos = [{ tipo: "GLOBAL", valor: null }];
      else if (tipo === "COORDENADOR") escopos = [{ tipo: "COORDENADOR", valor: nome }];
      else if (tipo === "SUPERVISOR") escopos = [{ tipo: "SUPERVISOR", valor: nome }];
      else if (tipo === "PROJETO" && u.PROJETO) escopos = [{ tipo: "PROJETO", valor: String(u.PROJETO).trim() }];
      else if (tipo === "EQUIPE") {
        const eqs = equipesDoLider[nome] ? [...equipesDoLider[nome]] : (u.EQUIPE ? [String(u.EQUIPE).trim()] : []);
        escopos = eqs.map((e) => ({ tipo: "EQUIPE", valor: e }));
      }
      // ADM/TRABALHADOR -> NENHUM -> sem escopo
    }
    contagem[papel] = (contagem[papel] || 0) + 1;
    plano.push({ id: u.ID, login: u.LOGIN, nome: u.NOME, papel, escopos });
  }

  console.log("════════════════════════════════════════════════════════");
  console.log(`  SEED papel/escopo ${DRY ? "(DRY-RUN)" : "(GRAVANDO)"} — ${plano.length} usuários`);
  console.log("════════════════════════════════════════════════════════");
  console.log("  Distribuição por papel:");
  for (const [p, n] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${p}`);
  console.log("\n  Amostra de escopos definidos (com âncora):");
  for (const p of plano.filter((x) => x.escopos.length && x.escopos[0].tipo !== "GLOBAL").slice(0, 12)) {
    console.log(`    ${p.papel.padEnd(12)} ${p.login.padEnd(24)} -> ${p.escopos.map((e) => e.tipo + (e.valor ? "=" + e.valor : "")).join(", ")}`);
  }

  if (DRY) { console.log("\n  DRY-RUN: nada gravado."); await pool.close(); return; }

  let papeisIns = 0, escoposIns = 0;
  for (const p of plano) {
    // papel (idempotente)
    const rp = await pool.request()
      .input("uid", sql.Int, p.id).input("pid", sql.Int, papelId[p.papel])
      .query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS WHERE USUARIO_ID=@uid AND PAPEL_ID=@pid)
              INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS (USUARIO_ID, PAPEL_ID, CRIADO_POR) VALUES (@uid,@pid,'SEED:CARGO')`);
    papeisIns += rp.rowsAffected[0] || 0;
    // escopos (idempotente)
    for (const e of p.escopos) {
      const rq = pool.request().input("uid", sql.Int, p.id).input("tipo", sql.VarChar(20), e.tipo);
      if (e.valor == null) {
        rq.query; // GLOBAL: guarda contra duplicar
        const r = await rq.query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid AND TIPO=@tipo AND VALOR IS NULL)
                INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO (USUARIO_ID, TIPO, VALOR, CRIADO_POR) VALUES (@uid,@tipo,NULL,'SEED:CARGO')`);
        escoposIns += r.rowsAffected[0] || 0;
      } else {
        rq.input("valor", sql.NVarChar(255), e.valor);
        const r = await rq.query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid AND TIPO=@tipo AND VALOR=@valor)
                INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO (USUARIO_ID, TIPO, VALOR, CRIADO_POR) VALUES (@uid,@tipo,@valor,'SEED:CARGO')`);
        escoposIns += r.rowsAffected[0] || 0;
      }
    }
  }
  console.log(`\n  GRAVADO: ${papeisIns} papéis, ${escoposIns} escopos inseridos.`);
  await pool.close();
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
