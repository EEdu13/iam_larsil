// ════════════════════════════════════════════════════════════════════════════
// Rotas de administração — consumidas pela tela de Usuários & Acessos.
// ════════════════════════════════════════════════════════════════════════════
// Fatia 2 (identidade): listar/buscar, gerar senha provisória, ativar/desativar.
// Fatia 3 acrescenta: atribuir papel, escopo, treinamento.
// Todas exigem admin (temporariamente via ADMIN_LOGINS no .env).
// ════════════════════════════════════════════════════════════════════════════

const express = require("express");
const { sql, getPool, IAM_SCHEMA } = require("../lib/db.cjs");
const { hashSenha, gerarSenhaProvisoria } = require("../lib/hash.cjs");
const { auditar } = require("../lib/audit.cjs");
const { resolverAcesso } = require("../lib/acesso.cjs");
const { gerarLoginUnico } = require("../lib/login.cjs");
const { requireAdmin } = require("./middleware.cjs");

const router = express.Router();
router.use(requireAdmin);

// Config da UI do console. fotoBase = URL do PCP que resolve a foto por nome
// (GET {fotoBase}/api/foto/{nome} → upload do usuário ou Unico People). Vazio = sem foto (só iniciais).
router.get("/ui-config", (_req, res) => {
  res.json({ fotoBase: (process.env.FOTO_BASE_URL || "").replace(/\/$/, "") });
});

// Catálogo para os seletores da tela (papéis, sistemas, permissões).
router.get("/catalogo", async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT ID, NOME, ESCOPO_TIPO_PADRAO FROM ${IAM_SCHEMA}.IAM_PAPEIS ORDER BY NOME;
      SELECT CODIGO, NOME, EXIGE_TREINAMENTO FROM ${IAM_SCHEMA}.IAM_SISTEMAS WHERE ATIVO=1 ORDER BY NOME;
      SELECT CODIGO, SISTEMA_CODIGO, DESCRICAO, GRUPO FROM ${IAM_SCHEMA}.IAM_PERMISSOES ORDER BY CODIGO;
    `);
    res.json({ papeis: r.recordsets[0], sistemas: r.recordsets[1], permissoes: r.recordsets[2] });
  } catch (e) { console.error("[catalogo]", e.message); res.status(500).json({ erro: "Falha no catálogo" }); }
});

// Opções de escopo — coordenadores/supervisores/líderes/projetos/equipes existentes no ORGANOGRAMA.
// (a TI escolhe a âncora do escopo a partir daqui, em vez de digitar à mão)
router.get("/escopo-opcoes", async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT DISTINCT LTRIM(RTRIM(COORDENADOR)) v FROM dbo.ORGANOGRAMA WHERE COORDENADOR IS NOT NULL AND LTRIM(RTRIM(COORDENADOR))<>'' ORDER BY v;
      SELECT DISTINCT LTRIM(RTRIM(SUPERVISOR)) v FROM dbo.ORGANOGRAMA WHERE SUPERVISOR IS NOT NULL AND LTRIM(RTRIM(SUPERVISOR))<>'' ORDER BY v;
      SELECT DISTINCT LTRIM(RTRIM(LIDER)) v FROM dbo.ORGANOGRAMA WHERE LIDER IS NOT NULL AND LTRIM(RTRIM(LIDER))<>'' ORDER BY v;
      SELECT DISTINCT LTRIM(RTRIM(PROJETO)) v FROM dbo.ORGANOGRAMA WHERE PROJETO IS NOT NULL AND LTRIM(RTRIM(PROJETO))<>'' ORDER BY v;
      SELECT DISTINCT LTRIM(RTRIM(EQUIPE)) v FROM dbo.ORGANOGRAMA WHERE EQUIPE IS NOT NULL AND LTRIM(RTRIM(EQUIPE))<>'' ORDER BY v;
    `);
    const m = (i) => r.recordsets[i].map((x) => x.v).filter(Boolean);
    res.json({ COORDENADOR: m(0), SUPERVISOR: m(1), LIDER: m(2), PROJETO: m(3), EQUIPE: m(4) });
  } catch (e) { console.error("[escopo-opcoes]", e.message); res.status(500).json({ erro: "Falha nas opções de escopo" }); }
});

// Cobertura de um escopo — quais projetos aquela âncora "enxerga" (pela ORGANOGRAMA).
// Deixa a TI ver o impacto: coordenador Toniel → puxa X projetos.
router.get("/escopo-cobertura", async (req, res) => {
  try {
    const tipo = String(req.query.tipo || "").toUpperCase();
    const valor = String(req.query.valor || "").trim();
    if (tipo === "GLOBAL") return res.json({ tudo: true, projetos: [] });
    if (tipo === "PROJETO") return res.json({ projetos: valor ? [valor] : [] });
    if (tipo === "EQUIPE") return res.json({ projetos: [], equipes: valor ? [valor] : [] });
    if (!["COORDENADOR", "SUPERVISOR"].includes(tipo) || !valor) return res.json({ projetos: [] });
    const col = tipo === "COORDENADOR" ? "COORDENADOR" : "SUPERVISOR";
    const pool = await getPool();
    const r = await pool.request().input("v", sql.NVarChar(255), valor)
      .query(`SELECT DISTINCT LTRIM(RTRIM(PROJETO)) p FROM dbo.ORGANOGRAMA
              WHERE LTRIM(RTRIM(${col}))=@v AND PROJETO IS NOT NULL AND LTRIM(RTRIM(PROJETO))<>'' ORDER BY p`);
    res.json({ projetos: r.recordset.map((x) => x.p) });
  } catch (e) { console.error("[escopo-cobertura]", e.message); res.status(500).json({ erro: "Falha na cobertura" }); }
});

// Detalhe completo de acesso de um usuário.
router.get("/usuarios/:id/detalhe", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    const r = await pool.request().input("id", sql.Int, id).query(`
      SELECT ID,LOGIN,NOME,CPF,MATRICULA,EMAIL,TELEFONE_EMPRESARIAL,ESTADO,ATIVO,ORIGEM,SENHA_PROVISORIA,
             CASE WHEN SENHA_HASH IS NULL THEN 0 ELSE 1 END AS TEM_SENHA
        FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE ID=@id;
      SELECT p.ID, p.NOME, p.ESCOPO_TIPO_PADRAO
        FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS up JOIN ${IAM_SCHEMA}.IAM_PAPEIS p ON p.ID=up.PAPEL_ID
        WHERE up.USUARIO_ID=@id ORDER BY p.NOME;
      SELECT ID, TIPO, VALOR FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@id ORDER BY TIPO;
      SELECT PERMISSAO_CODIGO, TIPO FROM ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES WHERE USUARIO_ID=@id;
      SELECT SISTEMA_CODIGO, TREINADO, DATA_TREINAMENTO, TREINADO_POR
        FROM ${IAM_SCHEMA}.IAM_USUARIO_TREINAMENTOS WHERE USUARIO_ID=@id;
    `);
    if (!r.recordsets[0][0]) return res.status(404).json({ erro: "Usuário não encontrado" });
    const acesso = await resolverAcesso(pool, id);
    res.json({
      usuario: r.recordsets[0][0],
      papeis: r.recordsets[1],
      escopos: r.recordsets[2],
      excecoes: r.recordsets[3],
      treinamentos: r.recordsets[4],
      efetivas: acesso.permissoes,
    });
  } catch (e) { console.error("[detalhe]", e.message); res.status(500).json({ erro: "Falha no detalhe" }); }
});

// ── Papéis ──
router.post("/usuarios/:id/papeis", async (req, res) => {
  try {
    const id = Number(req.params.id), papelId = Number(req.body?.papel_id);
    if (!papelId) return res.status(400).json({ erro: "papel_id obrigatório" });
    const pool = await getPool();
    await pool.request().input("uid", sql.Int, id).input("pid", sql.Int, papelId).input("por", sql.NVarChar(120), req.usuario.login)
      .query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS WHERE USUARIO_ID=@uid AND PAPEL_ID=@pid)
              INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS (USUARIO_ID,PAPEL_ID,CRIADO_POR) VALUES (@uid,@pid,@por)`);
    await auditar(pool, { usuarioId: id, acao: "PAPEL_ADICIONADO", detalhe: { papelId }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[papel+]", e.message); res.status(500).json({ erro: "Falha ao adicionar papel" }); }
});
router.delete("/usuarios/:id/papeis/:papelId", async (req, res) => {
  try {
    const id = Number(req.params.id), papelId = Number(req.params.papelId);
    const pool = await getPool();
    await pool.request().input("uid", sql.Int, id).input("pid", sql.Int, papelId)
      .query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS WHERE USUARIO_ID=@uid AND PAPEL_ID=@pid`);
    await auditar(pool, { usuarioId: id, acao: "PAPEL_REMOVIDO", detalhe: { papelId }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[papel-]", e.message); res.status(500).json({ erro: "Falha ao remover papel" }); }
});

// ── Escopo ──
router.post("/usuarios/:id/escopo", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tipo = String(req.body?.tipo || "").toUpperCase();
    let valor = req.body?.valor != null ? String(req.body.valor).trim() : null;
    const validos = ["GLOBAL", "COORDENADOR", "SUPERVISOR", "EQUIPE", "PROJETO"];
    if (!validos.includes(tipo)) return res.status(400).json({ erro: "tipo inválido" });
    if (tipo === "GLOBAL") valor = null;
    else if (!valor) return res.status(400).json({ erro: "valor obrigatório para " + tipo });
    const pool = await getPool();
    await pool.request().input("uid", sql.Int, id).input("tipo", sql.VarChar(20), tipo)
      .input("valor", sql.NVarChar(255), valor).input("por", sql.NVarChar(120), req.usuario.login)
      .query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid AND TIPO=@tipo AND (VALOR=@valor OR (VALOR IS NULL AND @valor IS NULL)))
              INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO (USUARIO_ID,TIPO,VALOR,CRIADO_POR) VALUES (@uid,@tipo,@valor,@por)`);
    await auditar(pool, { usuarioId: id, acao: "ESCOPO_ADICIONADO", detalhe: { tipo, valor }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[escopo+]", e.message); res.status(500).json({ erro: "Falha ao adicionar escopo" }); }
});
router.delete("/usuarios/:id/escopo/:escopoId", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("eid", sql.Int, Number(req.params.escopoId)).input("uid", sql.Int, Number(req.params.id))
      .query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE ID=@eid AND USUARIO_ID=@uid`);
    await auditar(pool, { usuarioId: Number(req.params.id), acao: "ESCOPO_REMOVIDO", detalhe: { escopoId: req.params.escopoId }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[escopo-]", e.message); res.status(500).json({ erro: "Falha ao remover escopo" }); }
});

// "Destravar" um escopo derivado (COORDENADOR/SUPERVISOR): transforma-o em N escopos PROJETO
// individuais, para a TI poder tirar/pôr projeto a projeto. Idempotente e reversível (é só
// remover os projetos e re-adicionar o COORDENADOR/SUPERVISOR).
router.post("/usuarios/:id/escopo/:escopoId/expandir", async (req, res) => {
  try {
    const uid = Number(req.params.id), eid = Number(req.params.escopoId);
    const pool = await getPool();
    const cur = await pool.request().input("eid", sql.Int, eid).input("uid", sql.Int, uid)
      .query(`SELECT TIPO, VALOR FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE ID=@eid AND USUARIO_ID=@uid`);
    const row = cur.recordset[0];
    if (!row) return res.status(404).json({ erro: "Escopo não encontrado" });
    if (!["COORDENADOR", "SUPERVISOR"].includes(row.TIPO)) return res.status(400).json({ erro: "Só coordenador/supervisor pode ser destravado" });
    const col = row.TIPO === "COORDENADOR" ? "COORDENADOR" : "SUPERVISOR";
    const pr = await pool.request().input("v", sql.NVarChar(255), row.VALOR)
      .query(`SELECT DISTINCT LTRIM(RTRIM(PROJETO)) p FROM dbo.ORGANOGRAMA
              WHERE LTRIM(RTRIM(${col}))=@v AND PROJETO IS NOT NULL AND LTRIM(RTRIM(PROJETO))<>'' ORDER BY p`);
    const projetos = pr.recordset.map((x) => x.p);
    for (const p of projetos) {
      await pool.request().input("uid", sql.Int, uid).input("valor", sql.NVarChar(255), p).input("por", sql.NVarChar(120), req.usuario.login)
        .query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid AND TIPO='PROJETO' AND VALOR=@valor)
                INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO (USUARIO_ID,TIPO,VALOR,CRIADO_POR) VALUES (@uid,'PROJETO',@valor,@por)`);
    }
    await pool.request().input("eid", sql.Int, eid).input("uid", sql.Int, uid)
      .query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE ID=@eid AND USUARIO_ID=@uid`);
    await auditar(pool, { usuarioId: uid, acao: "ESCOPO_DESTRAVADO", detalhe: { tipo: row.TIPO, valor: row.VALOR, projetos }, ator: req.usuario.login });
    res.json({ ok: true, projetos });
  } catch (e) { console.error("[escopo-expandir]", e.message); res.status(500).json({ erro: "Falha ao destravar escopo" }); }
});

// Transferir/copiar o escopo de um usuário para outro (ex.: férias, saída, cobrir alguém).
// modo: "copiar" mantém no atual; "mover" remove do atual. Copia TIPO/VALOR de cada escopo.
router.post("/usuarios/:id/escopo/transferir", async (req, res) => {
  try {
    const origem = Number(req.params.id);
    const destino = Number(req.body?.destino_id);
    const modo = String(req.body?.modo || "copiar").toLowerCase();
    const escopoIds = Array.isArray(req.body?.escopo_ids) ? req.body.escopo_ids.map(Number).filter(Boolean) : null;
    if (!destino || destino === origem) return res.status(400).json({ erro: "destino_id inválido" });
    const pool = await getPool();
    const dst = await pool.request().input("id", sql.Int, destino).query(`SELECT NOME,LOGIN FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE ID=@id`);
    if (!dst.recordset[0]) return res.status(404).json({ erro: "Destino não encontrado" });
    const filtro = escopoIds && escopoIds.length ? ` AND ID IN (${escopoIds.join(",")})` : "";
    const src = await pool.request().input("uid", sql.Int, origem)
      .query(`SELECT ID, TIPO, VALOR FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid${filtro}`);
    for (const e of src.recordset) {
      await pool.request().input("uid", sql.Int, destino).input("tipo", sql.VarChar(20), e.TIPO)
        .input("valor", sql.NVarChar(255), e.VALOR).input("por", sql.NVarChar(120), req.usuario.login)
        .query(`IF NOT EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid AND TIPO=@tipo AND (VALOR=@valor OR (VALOR IS NULL AND @valor IS NULL)))
                INSERT INTO ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO (USUARIO_ID,TIPO,VALOR,CRIADO_POR) VALUES (@uid,@tipo,@valor,@por)`);
    }
    if (modo === "mover" && src.recordset.length) {
      await pool.request().input("uid", sql.Int, origem)
        .query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID=@uid${filtro}`);
    }
    await auditar(pool, { usuarioId: origem, acao: "ESCOPO_TRANSFERIDO", detalhe: { destino, modo, qtd: src.recordset.length }, ator: req.usuario.login });
    res.json({ ok: true, destino: dst.recordset[0].NOME, qtd: src.recordset.length, modo });
  } catch (e) { console.error("[escopo-transferir]", e.message); res.status(500).json({ erro: "Falha ao transferir escopo" }); }
});

// ── Exceções (conceder/negar permissão pontual) ──
router.post("/usuarios/:id/excecao", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cod = String(req.body?.permissao_codigo || "");
    const tipo = String(req.body?.tipo || "").toUpperCase();
    if (!cod || !["CONCEDER", "NEGAR"].includes(tipo)) return res.status(400).json({ erro: "permissao_codigo e tipo (CONCEDER|NEGAR) obrigatórios" });
    const pool = await getPool();
    await pool.request().input("uid", sql.Int, id).input("cod", sql.VarChar(80), cod)
      .input("tipo", sql.VarChar(10), tipo).input("por", sql.NVarChar(120), req.usuario.login)
      .query(`MERGE ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES AS t
              USING (SELECT @uid AS U, @cod AS C) s ON t.USUARIO_ID=s.U AND t.PERMISSAO_CODIGO=s.C
              WHEN MATCHED THEN UPDATE SET TIPO=@tipo, CRIADO_POR=@por
              WHEN NOT MATCHED THEN INSERT (USUARIO_ID,PERMISSAO_CODIGO,TIPO,CRIADO_POR) VALUES (@uid,@cod,@tipo,@por);`);
    await auditar(pool, { usuarioId: id, acao: "EXCECAO_DEFINIDA", detalhe: { cod, tipo }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[excecao+]", e.message); res.status(500).json({ erro: "Falha ao definir exceção" }); }
});
router.delete("/usuarios/:id/excecao/:codigo", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("uid", sql.Int, Number(req.params.id)).input("cod", sql.VarChar(80), req.params.codigo)
      .query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES WHERE USUARIO_ID=@uid AND PERMISSAO_CODIGO=@cod`);
    await auditar(pool, { usuarioId: Number(req.params.id), acao: "EXCECAO_REMOVIDA", detalhe: { cod: req.params.codigo }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[excecao-]", e.message); res.status(500).json({ erro: "Falha ao remover exceção" }); }
});

// Ação em LOTE sobre várias telas: liberar/negar/herdar de uma vez (um grupo ou o sistema todo).
// tipo: CONCEDER | NEGAR | HERDAR (herdar = remove exceção, volta a seguir o papel).
router.post("/usuarios/:id/excecoes-lote", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tipo = String(req.body?.tipo || "").toUpperCase();
    const codigos = Array.isArray(req.body?.codigos) ? req.body.codigos.filter((c) => typeof c === "string") : [];
    if (!["CONCEDER", "NEGAR", "HERDAR"].includes(tipo)) return res.status(400).json({ erro: "tipo inválido (CONCEDER|NEGAR|HERDAR)" });
    if (!codigos.length) return res.status(400).json({ erro: "nenhuma tela informada" });
    const pool = await getPool();
    for (const cod of codigos) {
      const rq = pool.request().input("uid", sql.Int, id).input("cod", sql.VarChar(80), cod);
      if (tipo === "HERDAR") {
        await rq.query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES WHERE USUARIO_ID=@uid AND PERMISSAO_CODIGO=@cod`);
      } else {
        await rq.input("tipo", sql.VarChar(10), tipo).input("por", sql.NVarChar(120), req.usuario.login)
          .query(`MERGE ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES AS t
                  USING (SELECT @uid AS U, @cod AS C) s ON t.USUARIO_ID=s.U AND t.PERMISSAO_CODIGO=s.C
                  WHEN MATCHED THEN UPDATE SET TIPO=@tipo, CRIADO_POR=@por
                  WHEN NOT MATCHED THEN INSERT (USUARIO_ID,PERMISSAO_CODIGO,TIPO,CRIADO_POR) VALUES (@uid,@cod,@tipo,@por);`);
      }
    }
    await auditar(pool, { usuarioId: id, acao: "EXCECOES_LOTE", detalhe: { tipo, qtd: codigos.length }, ator: req.usuario.login });
    res.json({ ok: true, aplicadas: codigos.length });
  } catch (e) { console.error("[excecoes-lote]", e.message); res.status(500).json({ erro: "Falha na ação em lote" }); }
});

// ── Treinamento por sistema ──
router.post("/usuarios/:id/treinamento", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sistema = String(req.body?.sistema_codigo || "");
    const treinado = req.body?.treinado ? 1 : 0;
    if (!sistema) return res.status(400).json({ erro: "sistema_codigo obrigatório" });
    const pool = await getPool();
    await pool.request().input("uid", sql.Int, id).input("sis", sql.VarChar(30), sistema)
      .input("tr", sql.Bit, treinado).input("por", sql.NVarChar(120), req.usuario.login)
      .query(`MERGE ${IAM_SCHEMA}.IAM_USUARIO_TREINAMENTOS AS t
              USING (SELECT @uid AS U, @sis AS S) s ON t.USUARIO_ID=s.U AND t.SISTEMA_CODIGO=s.S
              WHEN MATCHED THEN UPDATE SET TREINADO=@tr, DATA_TREINAMENTO=CASE WHEN @tr=1 THEN CAST(SYSUTCDATETIME() AS DATE) ELSE NULL END, TREINADO_POR=@por, ATUALIZADO_EM=SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT (USUARIO_ID,SISTEMA_CODIGO,TREINADO,DATA_TREINAMENTO,TREINADO_POR,ATUALIZADO_EM)
                   VALUES (@uid,@sis,@tr,CASE WHEN @tr=1 THEN CAST(SYSUTCDATETIME() AS DATE) ELSE NULL END,@por,SYSUTCDATETIME());`);
    await auditar(pool, { usuarioId: id, acao: "TREINAMENTO_DEFINIDO", detalhe: { sistema, treinado }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) { console.error("[treino]", e.message); res.status(500).json({ erro: "Falha no treinamento" }); }
});

// GET /api/admin/usuarios?busca=&estado=&limit=&offset=
router.get("/usuarios", async (req, res) => {
  try {
    const busca = String(req.query.busca || "").trim();
    const estado = String(req.query.estado || "").trim();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const pool = await getPool();
    const rq = pool.request();
    const wheres = [];
    if (busca) {
      rq.input("busca", sql.NVarChar(255), `%${busca}%`);
      wheres.push("(NOME LIKE @busca OR LOGIN LIKE @busca OR CPF LIKE @busca OR MATRICULA LIKE @busca)");
    }
    if (estado) {
      rq.input("estado", sql.VarChar(30), estado);
      wheres.push("ESTADO = @estado");
    }
    const whereSql = wheres.length ? "WHERE " + wheres.join(" AND ") : "";
    rq.input("limit", sql.Int, limit);
    rq.input("offset", sql.Int, offset);

    const r = await rq.query(`
      SELECT ID, LOGIN, NOME, CPF, MATRICULA, EMAIL, ESTADO, ATIVO,
             CASE WHEN SENHA_HASH IS NULL THEN 0 ELSE 1 END AS TEM_SENHA,
             SENHA_PROVISORIA, CRIADO_EM
      FROM ${IAM_SCHEMA}.IAM_USUARIOS
      ${whereSql}
      ORDER BY NOME
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;

      SELECT COUNT(*) AS total FROM ${IAM_SCHEMA}.IAM_USUARIOS ${whereSql};
    `);
    res.json({ usuarios: r.recordsets[0], total: r.recordsets[1][0].total, limit, offset });
  } catch (e) {
    console.error("[usuarios]", e.message);
    res.status(500).json({ erro: "Falha ao listar usuários" });
  }
});

// POST /api/admin/usuarios/:id/senha-provisoria
// Gera uma senha aleatória, guarda o hash, marca como provisória e devolve o texto UMA vez.
// POST /api/admin/usuarios — cria uma identidade MANUAL (ex.: diretores que não estão em
// dbo.COLABORADORES). Só cria a identidade; senha continua sendo gerada depois pela TI.
// Login é derivado (nome.sobrenome, único). CPF é opcional, mas se vier tem que ser único.
router.post("/usuarios", async (req, res) => {
  try {
    const nome = String(req.body?.nome || "").trim();
    if (!nome || nome.length < 3) return res.status(400).json({ erro: "Nome é obrigatório" });
    const cpf = String(req.body?.cpf || "").replace(/\D/g, "");
    if (cpf && cpf.length !== 11) return res.status(400).json({ erro: "CPF deve ter 11 dígitos" });
    const matricula = req.body?.matricula ? String(req.body.matricula).trim() : null;
    const email = req.body?.email ? String(req.body.email).trim() : null;
    const telefone = req.body?.telefone ? String(req.body.telefone).replace(/\D/g, "") : null;

    const pool = await getPool();
    if (cpf) {
      const dup = await pool.request().input("cpf", sql.Char(11), cpf)
        .query(`SELECT LOGIN FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE CPF=@cpf`);
      if (dup.recordset[0]) return res.status(409).json({ erro: `Já existe usuário com esse CPF (${dup.recordset[0].LOGIN})` });
    }
    const usadosR = await pool.request().query(`SELECT LOGIN FROM ${IAM_SCHEMA}.IAM_USUARIOS`);
    const usados = new Set(usadosR.recordset.map((r) => String(r.LOGIN).toLowerCase()));
    const g = gerarLoginUnico(nome, usados, `mat${matricula || cpf || Date.now()}`);
    const login = (g && g.login) ? g.login : g; // devolve {login,...} ou string

    const ins = await pool.request()
      .input("cpf", sql.Char(11), cpf || null)
      .input("mat", sql.VarChar(20), matricula)
      .input("nome", sql.NVarChar(255), nome)
      .input("login", sql.VarChar(60), login)
      .input("email", sql.NVarChar(255), email)
      .input("tel", sql.VarChar(20), telefone)
      .input("por", sql.NVarChar(120), req.usuario.login)
      .query(`INSERT INTO ${IAM_SCHEMA}.IAM_USUARIOS (CPF, MATRICULA, NOME, LOGIN, EMAIL, TELEFONE_EMPRESARIAL, ORIGEM, ESTADO, ATIVO, CRIADO_POR)
              OUTPUT INSERTED.ID
              VALUES (@cpf, @mat, @nome, @login, @email, @tel, 'MANUAL', 'PENDENTE_CONFIGURACAO', 1, @por)`);
    const id = ins.recordset[0].ID;
    await auditar(pool, { usuarioId: id, acao: "USUARIO_CRIADO_MANUAL", detalhe: { nome, login, cpf: cpf || null }, ator: req.usuario.login });
    res.json({ ok: true, id, login });
  } catch (e) {
    console.error("[usuario-criar]", e.message);
    res.status(500).json({ erro: "Falha ao criar usuário", detalhe: e.message });
  }
});

router.post("/usuarios/:id/senha-provisoria", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    const r = await pool.request().input("id", sql.Int, id)
      .query(`SELECT ID, LOGIN, NOME FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE ID=@id`);
    const u = r.recordset[0];
    if (!u) return res.status(404).json({ erro: "Usuário não encontrado" });

    const senha = gerarSenhaProvisoria(8);
    await pool.request()
      .input("id", sql.Int, id)
      .input("hash", sql.VarChar(255), hashSenha(senha))
      .query(`UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
              SET SENHA_HASH=@hash, SENHA_PROVISORIA=1,
                  ESTADO=CASE WHEN ESTADO='PENDENTE_CONFIGURACAO' THEN 'ATIVO' ELSE ESTADO END,
                  ATUALIZADO_EM=SYSUTCDATETIME()
              WHERE ID=@id`);
    await auditar(pool, { usuarioId: id, acao: "SENHA_PROVISORIA_GERADA", ator: req.usuario.login });

    // texto da senha só trafega aqui, uma vez — não é guardado em claro em lugar nenhum.
    res.json({ login: u.LOGIN, nome: u.NOME, senha_provisoria: senha });
  } catch (e) {
    console.error("[senha-provisoria]", e.message);
    res.status(500).json({ erro: "Falha ao gerar senha" });
  }
});

// POST /api/admin/usuarios/:id/estado  { ativo: true|false }
router.post("/usuarios/:id/estado", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ativo = req.body?.ativo ? 1 : 0;
    const pool = await getPool();
    const upd = await pool.request()
      .input("id", sql.Int, id)
      .input("ativo", sql.Bit, ativo)
      .query(`UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
              SET ATIVO=@ativo, ATUALIZADO_EM=SYSUTCDATETIME() WHERE ID=@id`);
    if (!upd.rowsAffected[0]) return res.status(404).json({ erro: "Usuário não encontrado" });
    await auditar(pool, { usuarioId: id, acao: ativo ? "ATIVADO" : "DESATIVADO", ator: req.usuario.login });
    res.json({ ok: true, ativo: !!ativo });
  } catch (e) {
    console.error("[estado]", e.message);
    res.status(500).json({ erro: "Falha ao alterar estado" });
  }
});

module.exports = router;
