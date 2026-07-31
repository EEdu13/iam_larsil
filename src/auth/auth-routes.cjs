// ════════════════════════════════════════════════════════════════════════════
// Rotas de autenticação — o "login único" da Larsil.
// ════════════════════════════════════════════════════════════════════════════
//   POST /api/auth/login          { login, senha }  -> { token, usuario, senha_provisoria }
//   POST /api/auth/trocar-senha    (auth)  { senhaAtual, novaSenha }
//   GET  /api/auth/me              (auth)  -> dados do token
// ════════════════════════════════════════════════════════════════════════════

const express = require("express");
const { sql, getPool, IAM_SCHEMA } = require("../lib/db.cjs");
const { hashSenha, verificarSenha } = require("../lib/hash.cjs");
const { assinar } = require("../lib/jwt.cjs");
const { auditar } = require("../lib/audit.cjs");
const { resolverAcesso } = require("../lib/acesso.cjs");
const { requireAuth, ADMIN_LOGINS } = require("./middleware.cjs");

const router = express.Router();

// monta o payload do token: identidade + acesso resolvido (papéis, permissões, escopo)
async function payloadDe(pool, u) {
  const acesso = await resolverAcesso(pool, u.ID);
  return {
    sub: u.ID,
    login: u.LOGIN,
    nome: u.NOME,
    cpf: u.CPF,
    admin: ADMIN_LOGINS.has(String(u.LOGIN).toLowerCase()),
    papeis: acesso.papeis,
    permissoes: acesso.permissoes,
    escopos: acesso.escopos,
    global: acesso.global,
  };
}

router.post("/login", async (req, res) => {
  try {
    const { login, senha } = req.body || {};
    if (!login || !senha) return res.status(400).json({ erro: "Informe login e senha" });

    const pool = await getPool();
    const r = await pool.request()
      .input("login", sql.VarChar(60), String(login).trim().toLowerCase())
      .query(`SELECT TOP 1 * FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE LOWER(LOGIN) = @login`);

    const u = r.recordset[0];
    // resposta genérica para não revelar se o login existe (só valida a senha primeiro)
    if (!u || !u.SENHA_HASH || !verificarSenha(senha, u.SENHA_HASH)) {
      return res.status(401).json({ erro: "Login ou senha inválidos" });
    }
    // senha certa, mas conta desativada pela TI → mensagem específica (após validar a senha)
    if (u.ATIVO === false) {
      await auditar(pool, { usuarioId: u.ID, acao: "LOGIN_BLOQUEADO_INATIVO", ator: u.LOGIN });
      return res.status(403).json({ erro: "Sua conta está desativada. Entre em contato com a TI da empresa.", motivo: "INATIVO" });
    }

    const payload = await payloadDe(pool, u);
    const token = assinar(payload);
    await auditar(pool, { usuarioId: u.ID, acao: "LOGIN_OK", ator: u.LOGIN });

    res.json({
      token,
      senha_provisoria: !!u.SENHA_PROVISORIA,
      usuario: {
        id: u.ID, login: u.LOGIN, nome: u.NOME, cpf: u.CPF, admin: payload.admin,
        email: u.EMAIL || null, telefone: u.TELEFONE_EMPRESARIAL || null,
        papeis: payload.papeis, permissoes: payload.permissoes,
        escopos: payload.escopos, global: payload.global,
      },
    });
  } catch (e) {
    console.error("[login]", e.message);
    res.status(500).json({ erro: "Falha no login" });
  }
});

router.post("/trocar-senha", requireAuth, async (req, res) => {
  try {
    const { senhaAtual, novaSenha } = req.body || {};
    if (!novaSenha || String(novaSenha).length < 6) {
      return res.status(400).json({ erro: "Nova senha deve ter ao menos 6 caracteres" });
    }
    const pool = await getPool();
    const r = await pool.request()
      .input("id", sql.Int, req.usuario.sub)
      .query(`SELECT * FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE ID = @id`);
    const u = r.recordset[0];
    if (!u) return res.status(404).json({ erro: "Usuário não encontrado" });
    if (!verificarSenha(senhaAtual, u.SENHA_HASH)) {
      return res.status(401).json({ erro: "Senha atual incorreta" });
    }
    await pool.request()
      .input("id", sql.Int, u.ID)
      .input("hash", sql.VarChar(255), hashSenha(novaSenha))
      .query(`UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
              SET SENHA_HASH=@hash, SENHA_PROVISORIA=0, ATUALIZADO_EM=SYSUTCDATETIME()
              WHERE ID=@id`);
    await auditar(pool, { usuarioId: u.ID, acao: "SENHA_TROCADA", ator: u.LOGIN });
    res.json({ ok: true });
  } catch (e) {
    console.error("[trocar-senha]", e.message);
    res.status(500).json({ erro: "Falha ao trocar senha" });
  }
});

// Onboarding do 1º acesso: troca a senha provisória e coleta telefone/email empresarial.
router.post("/onboarding", requireAuth, async (req, res) => {
  try {
    const { novaSenha, telefone, email } = req.body || {};
    if (!novaSenha || String(novaSenha).length < 6) {
      return res.status(400).json({ erro: "Nova senha deve ter ao menos 6 caracteres" });
    }
    const pool = await getPool();
    await pool.request()
      .input("id", sql.Int, req.usuario.sub)
      .input("hash", sql.VarChar(255), hashSenha(novaSenha))
      .input("tel", sql.VarChar(20), telefone ? String(telefone).trim().slice(0, 20) : null)
      .input("email", sql.NVarChar(255), email ? String(email).trim().slice(0, 255) : null)
      .query(`UPDATE ${IAM_SCHEMA}.IAM_USUARIOS
              SET SENHA_HASH=@hash, SENHA_PROVISORIA=0,
                  TELEFONE_EMPRESARIAL=COALESCE(@tel, TELEFONE_EMPRESARIAL),
                  EMAIL=COALESCE(@email, EMAIL),
                  ONBOARDING_EM=SYSUTCDATETIME(), ATUALIZADO_EM=SYSUTCDATETIME()
              WHERE ID=@id`);
    await auditar(pool, { usuarioId: req.usuario.sub, acao: "ONBOARDING_CONCLUIDO", detalhe: { telefone: !!telefone, email: !!email }, ator: req.usuario.login });
    res.json({ ok: true });
  } catch (e) {
    console.error("[onboarding]", e.message);
    res.status(500).json({ erro: "Falha no onboarding" });
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ usuario: req.usuario });
});

// Reconsulta o acesso direto do banco (papéis/permissões/escopo atuais), sem novo login.
// Consumidores chamam para refletir mudanças de permissão sem esperar o token expirar.
router.get("/resolve", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    // conta pode ter sido DESATIVADA pela TI depois que o token foi emitido → derruba a sessão
    const st = await pool.request().input("id", sql.Int, req.usuario.sub)
      .query(`SELECT ATIVO FROM ${IAM_SCHEMA}.IAM_USUARIOS WHERE ID=@id`);
    const row = st.recordset[0];
    if (!row || row.ATIVO === false) {
      return res.status(403).json({ erro: "Sua conta está desativada. Entre em contato com a TI da empresa.", motivo: "INATIVO" });
    }
    const acesso = await resolverAcesso(pool, req.usuario.sub);
    res.json({ usuario_id: req.usuario.sub, ...acesso });
  } catch (e) {
    console.error("[resolve]", e.message);
    res.status(500).json({ erro: "Falha ao resolver acesso" });
  }
});

// Registra um pedido de acesso a uma tela (a pessoa clicou "pedir acesso" no sistema consumidor).
// Fica na auditoria para a TI ver quem pediu o quê.
router.post("/solicitar-acesso", requireAuth, async (req, res) => {
  try {
    const { sistema, tela } = req.body || {};
    const pool = await getPool();
    await auditar(pool, {
      usuarioId: req.usuario.sub,
      acao: "ACESSO_SOLICITADO",
      detalhe: { sistema: sistema || null, tela: tela || null },
      ator: req.usuario.login,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("[solicitar-acesso]", e.message);
    res.status(500).json({ erro: "Falha ao registrar pedido" });
  }
});

module.exports = router;
