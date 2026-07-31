// ════════════════════════════════════════════════════════════════════════════
// JWT — assinatura/verificação do token de sessão.
// ════════════════════════════════════════════════════════════════════════════
// O token carrega a IDENTIDADE (sub=id, login, nome, cpf). Papéis/permissões/escopo
// entram aqui na Fatia 3 — o formato já é extensível. O backend de cada sistema
// valida ESTE token e NUNCA confia em papel/escopo vindo do corpo/query do cliente.
// ════════════════════════════════════════════════════════════════════════════

const jwt = require("jsonwebtoken");

const SEGREDO = process.env.JWT_SECRET || "";
const EXPIRACAO = process.env.JWT_EXPIRA || "12h";

if (!SEGREDO) {
  console.warn("[jwt] AVISO: JWT_SECRET não definido no .env — defina antes de produção.");
}

function assinar(payload) {
  return jwt.sign(payload, SEGREDO || "dev-inseguro", { expiresIn: EXPIRACAO });
}

function verificar(token) {
  return jwt.verify(token, SEGREDO || "dev-inseguro"); // lança se inválido/expirado
}

module.exports = { assinar, verificar };
