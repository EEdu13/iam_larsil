// ════════════════════════════════════════════════════════════════════════════
// IAM Larsil — servidor central (Auth API + tela de administração).
// ════════════════════════════════════════════════════════════════════════════
// Este é o único ponto que emite/valida token. Sistemas (Painel PCP, gerador de
// tarefas, PWA) apenas chamam /api/auth/* e validam o JWT — nunca fazem login próprio.
// ════════════════════════════════════════════════════════════════════════════

require("../src/lib/db.cjs"); // carrega o .env (local ou fallback timbertrack) cedo
const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./auth/auth-routes.cjs");
const adminRoutes = require("./auth/admin-routes.cjs");
const registryRoutes = require("./auth/registry-routes.cjs");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, servico: "iam-larsil" }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/registry", registryRoutes); // auto-registro de sistemas consumidores (X-Registry-Key)

// tela de administração (estática) em /admin
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));
app.get("/", (_req, res) => res.redirect("/admin"));

// AUTH_PORT (local) tem prioridade; Railway/hospedagem injeta PORT; 4000 é o fallback local.
const PORT = Number(process.env.AUTH_PORT || process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`Painel ADM Larsil rodando na porta ${PORT}  (tela: /admin)`);
});
