// ════════════════════════════════════════════════════════════════════════════
// Sync de identidades: dbo.COLABORADORES (ativos) → iam.IAM_USUARIOS
// ════════════════════════════════════════════════════════════════════════════
// Mesma lógica do script scripts/import-colaboradores.cjs, mas como FUNÇÃO — o
// servidor chama sozinho (ao subir e a cada X horas) e o console tem um botão.
//   - insere novos ATIVOS (sem senha, PENDENTE_CONFIGURACAO), gera login único;
//   - atualiza nome/matrícula/ativo dos existentes (por CPF);
//   - NUNCA mexe em senha/papel/escopo/email/telefone;
//   - externos (ORIGEM='MANUAL'/'SISTEMA', sem CPF em COLABORADORES) não são tocados.
// NÃO fecha o pool (o servidor mantém vivo).
// ════════════════════════════════════════════════════════════════════════════

const { sql, getPool, IAM_SCHEMA } = require("./db.cjs");
const { gerarLoginUnico } = require("./login.cjs");

const soDigitos = (s) => String(s || "").replace(/\D/g, "");

async function sincronizarColaboradores({ todos = false } = {}) {
  const pool = await getPool();

  const filtro = todos ? "" : "WHERE LTRIM(RTRIM(SITUACAO)) = '1'";
  const src = await pool.request().query(`
    SELECT CPF, MATRICULA, NOME, SITUACAO FROM dbo.COLABORADORES ${filtro} ORDER BY NOME`);
  const rows = src.recordset
    .map((r) => ({
      cpf: soDigitos(r.CPF).padStart(11, "0"),
      matricula: r.MATRICULA ? String(r.MATRICULA).trim() : null,
      nome: (r.NOME || "").trim(),
      ativo: String(r.SITUACAO).trim() === "1" ? 1 : 0,
    }))
    .filter((r) => r.cpf.length === 11 && r.nome.length > 0);

  const existentes = await pool.request().query(`SELECT LOGIN, CPF, NOME, MATRICULA, ATIVO FROM ${IAM_SCHEMA}.IAM_USUARIOS`);
  const usados = new Set(existentes.recordset.map((r) => String(r.LOGIN).toLowerCase()));
  // mapa por CPF com o snapshot atual, pra só dar UPDATE em quem REALMENTE mudou (senão são
  // centenas de round-trips inúteis ao Azure a cada sync → demora demais).
  const porCpf = new Map(existentes.recordset.map((r) => [String(r.CPF), r]));
  const eq = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

  let inseridos = 0, atualizados = 0, inalterados = 0, colisoes = 0;
  for (const r of rows) {
    const atual = porCpf.get(r.cpf);
    if (atual) {
      const mudou = !eq(atual.NOME, r.nome) || !eq(atual.MATRICULA, r.matricula) || Number(atual.ATIVO) !== r.ativo;
      if (!mudou) { inalterados++; continue; }   // nada a fazer → sem ida ao banco
      await pool.request()
        .input("cpf", sql.Char(11), r.cpf).input("matricula", sql.VarChar(20), r.matricula)
        .input("nome", sql.NVarChar(255), r.nome).input("ativo", sql.Bit, r.ativo)
        .query(`UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
                   SET MATRICULA=@matricula, NOME=@nome, ATIVO=@ativo, ATUALIZADO_EM=SYSUTCDATETIME()
                 WHERE CPF=@cpf`);
      atualizados++;
    } else {
      const g = gerarLoginUnico(r.nome, usados, `mat${r.matricula || ""}`);
      if (g.colidiu) colisoes++;
      await pool.request()
        .input("cpf", sql.Char(11), r.cpf).input("matricula", sql.VarChar(20), r.matricula)
        .input("nome", sql.NVarChar(255), r.nome).input("login", sql.VarChar(60), g.login).input("ativo", sql.Bit, r.ativo)
        .query(`INSERT INTO ${IAM_SCHEMA}.IAM_USUARIOS (CPF,MATRICULA,NOME,LOGIN,ATIVO,ESTADO,ORIGEM,CRIADO_POR)
                VALUES (@cpf,@matricula,@nome,@login,@ativo,'PENDENTE_CONFIGURACAO','COLABORADOR','SYNC:COLABORADORES');
                INSERT INTO ${IAM_SCHEMA}.IAM_AUDITORIA (USUARIO_ID,ACAO,DETALHE,ATOR)
                VALUES (SCOPE_IDENTITY(),'IDENTIDADE_CRIADA',
                        (SELECT @cpf cpf,@login login,@nome nome FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),'SYNC')`);
      porCpf.set(r.cpf, { NOME: r.nome, MATRICULA: r.matricula, ATIVO: r.ativo }); usados.add(g.login.toLowerCase());
      inseridos++;
    }
  }
  return { fonte: rows.length, inseridos, atualizados, inalterados, colisoes, em: new Date().toISOString() };
}

module.exports = { sincronizarColaboradores };
