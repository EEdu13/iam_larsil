// Middleware de autenticação/autorização da Auth API.
const { verificar } = require("../lib/jwt.cjs");

// Lista temporária de admins (Fatia 2). Na Fatia 3 isso vira papel na IAM.
// Ex.: ADMIN_LOGINS=eduardo.ferreira,fulano.silva
const ADMIN_LOGINS = new Set(
  String(process.env.ADMIN_LOGINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

/** Exige um JWT válido no header Authorization: Bearer <token>. Popula req.usuario. */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ erro: "Token ausente" });
  try {
    req.usuario = verificar(token);
    next();
  } catch {
    return res.status(401).json({ erro: "Token inválido ou expirado" });
  }
}

/** Exige que o usuário do token seja admin: está em ADMIN_LOGINS (legado) OU tem o papel TI. */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const login = String(req.usuario?.login || "").toLowerCase();
    const papeis = req.usuario?.papeis || [];
    const ehAdmin = ADMIN_LOGINS.has(login) || papeis.includes("TI");
    if (!ehAdmin) {
      return res.status(403).json({ erro: "Acesso restrito à administração" });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, ADMIN_LOGINS };
