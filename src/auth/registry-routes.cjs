// ════════════════════════════════════════════════════════════════════════════
// Registry — auto-registro de sistemas consumidores ("plugar na IAM").
// ════════════════════════════════════════════════════════════════════════════
// Um sistema novo (gerador de tarefas, etc.) declara ELE MESMO, via API, o próprio
// sistema + suas telas/permissões. Aparece sozinho no console /admin, sem a TI
// rodar SQL. NÃO altera schema (só insere linhas em IAM_SISTEMAS/IAM_PERMISSOES) e
// é ISOLADO: a chave de um sistema só mexe nas permissões daquele sistema.
//
// Autenticação: header  X-Registry-Key: <chave>
//   - REGISTRY_KEYS (JSON no .env) mapeia sistema→chave. Ex.: {"TAREFAS":"abc123"}
//     → a chave só autoriza aquele SISTEMA (mais seguro, recomendado).
//   - REGISTRY_KEY (chave mestra única) → autoriza registrar qualquer sistema novo
//     (o código vem no corpo). Conveniente, menos isolado.
// PCP e IAM são reservados: o registry nunca cria/altera/remove eles.
// ════════════════════════════════════════════════════════════════════════════

const express = require("express");
const { sql, getPool, IAM_SCHEMA } = require("../lib/db.cjs");
const { auditar } = require("../lib/audit.cjs");

const router = express.Router();
const RESERVADOS = new Set(["PCP", "IAM"]);

function lerChaves() {
  let mapa = {};
  try { if (process.env.REGISTRY_KEYS) mapa = JSON.parse(process.env.REGISTRY_KEYS); } catch { /* json inválido → ignora */ }
  return { mapa, mestra: process.env.REGISTRY_KEY || null };
}

// Autoriza pela chave. Define req.sistemaAutorizado (código) ou null se for chave mestra
// (nesse caso o código vem do corpo). 503 se o registry não foi habilitado (sem chaves).
function requireRegistryKey(req, res, next) {
  const { mapa, mestra } = lerChaves();
  if (!mestra && Object.keys(mapa).length === 0)
    return res.status(503).json({ erro: "Registry desabilitado. A TI precisa configurar REGISTRY_KEY(S)." });
  const chave = req.get("X-Registry-Key") || "";
  if (!chave) return res.status(401).json({ erro: "Falta o header X-Registry-Key" });
  // 1) chave por sistema
  const doSistema = Object.entries(mapa).find(([, v]) => v === chave);
  if (doSistema) { req.sistemaAutorizado = String(doSistema[0]).toUpperCase(); return next(); }
  // 2) chave mestra
  if (mestra && chave === mestra) { req.sistemaAutorizado = null; return next(); }
  return res.status(401).json({ erro: "Chave de registro inválida" });
}

router.use(requireRegistryKey);

const reCodigoSistema = /^[A-Z][A-Z0-9_]{1,29}$/;
// permissão precisa ser do namespace do sistema: "<sistema-minusculo>.<algo>"
const rePermValor = /^[a-z0-9:/._-]+$/;

// Estado atual do que o SEU sistema tem registrado (pros devs conferirem).
router.get("/me", async (req, res) => {
  try {
    const cod = req.sistemaAutorizado;
    const pool = await getPool();
    if (!cod) return res.json({ chave: "mestra", aviso: "chave mestra: informe 'sistema' no corpo do sync" });
    const sis = await pool.request().input("c", sql.VarChar, cod)
      .query(`SELECT CODIGO,NOME,URL_BASE,EXIGE_TREINAMENTO,ATIVO FROM ${IAM_SCHEMA}.IAM_SISTEMAS WHERE CODIGO=@c`);
    const perms = await pool.request().input("c", sql.VarChar, cod)
      .query(`SELECT CODIGO,DESCRICAO,GRUPO FROM ${IAM_SCHEMA}.IAM_PERMISSOES WHERE SISTEMA_CODIGO=@c ORDER BY CODIGO`);
    res.json({ sistema: sis.recordset[0] || null, permissoes: perms.recordset });
  } catch (e) { console.error("[registry/me]", e.message); res.status(500).json({ erro: "Falha ao ler registro" }); }
});

// Declara/atualiza o sistema + suas permissões (telas e ações). Idempotente.
//  body: { sistema?, nome?, url_base?, exige_treinamento?, modo?: "merge"|"sync", permissoes: [...] }
//   - modo "merge" (padrão): só cria/atualiza o que veio.
//   - modo "sync": além disso, REMOVE as permissões do sistema que não vieram no manifesto
//                  (e as concessões dela) — o manifesto vira a fonte da verdade.
router.post("/sync", async (req, res) => {
  const b = req.body || {};
  const cod = (req.sistemaAutorizado || String(b.sistema || "")).toUpperCase();
  if (!cod) return res.status(400).json({ erro: "Informe 'sistema' no corpo (chave mestra)" });
  if (RESERVADOS.has(cod)) return res.status(403).json({ erro: `Sistema '${cod}' é reservado e não pode ser registrado pela API` });
  if (!reCodigoSistema.test(cod)) return res.status(400).json({ erro: "Código de sistema inválido (use MAIÚSCULAS, ex.: TAREFAS)" });

  const prefixo = cod.toLowerCase() + ".";
  const perms = Array.isArray(b.permissoes) ? b.permissoes : [];
  // valida cada permissão: precisa ser do namespace do próprio sistema
  for (const p of perms) {
    const c = String(p?.codigo || "");
    if (!c.startsWith(prefixo) || !rePermValor.test(c))
      return res.status(400).json({ erro: `Permissão '${c}' inválida: precisa começar com '${prefixo}' e usar só [a-z0-9:/._-]` });
  }
  const modo = b.modo === "sync" ? "sync" : "merge";

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const rq = () => new sql.Request(tx);
    // 1) upsert do sistema
    await rq()
      .input("c", sql.VarChar, cod)
      .input("n", sql.NVarChar, String(b.nome || cod))
      .input("u", sql.NVarChar, b.url_base != null ? String(b.url_base) : null)
      .input("t", sql.Bit, b.exige_treinamento ? 1 : 0)
      .query(`IF EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_SISTEMAS WHERE CODIGO=@c)
                UPDATE ${IAM_SCHEMA}.IAM_SISTEMAS SET NOME=@n, URL_BASE=@u, EXIGE_TREINAMENTO=@t, ATIVO=1 WHERE CODIGO=@c;
              ELSE
                INSERT INTO ${IAM_SCHEMA}.IAM_SISTEMAS (CODIGO,NOME,URL_BASE,EXIGE_TREINAMENTO,ATIVO) VALUES (@c,@n,@u,@t,1);`);

    // 2) upsert das permissões (checa existência ANTES para contar certo)
    let criadas = 0, atualizadas = 0;
    for (const p of perms) {
      const cP = String(p.codigo);
      const existia = (await rq().input("c", sql.VarChar, cP)
        .query(`SELECT 1 x FROM ${IAM_SCHEMA}.IAM_PERMISSOES WHERE CODIGO=@c`)).recordset.length > 0;
      await rq()
        .input("c", sql.VarChar, cP)
        .input("s", sql.VarChar, cod)
        .input("d", sql.NVarChar, p.descricao != null ? String(p.descricao) : cP)
        .input("g", sql.NVarChar, p.grupo != null && p.grupo !== "" ? String(p.grupo) : null)
        .query(`IF EXISTS (SELECT 1 FROM ${IAM_SCHEMA}.IAM_PERMISSOES WHERE CODIGO=@c)
                  UPDATE ${IAM_SCHEMA}.IAM_PERMISSOES SET SISTEMA_CODIGO=@s, DESCRICAO=@d, GRUPO=@g WHERE CODIGO=@c;
                ELSE
                  INSERT INTO ${IAM_SCHEMA}.IAM_PERMISSOES (CODIGO,SISTEMA_CODIGO,DESCRICAO,GRUPO) VALUES (@c,@s,@d,@g);`);
      existia ? atualizadas++ : criadas++;
    }

    // 3) prune (modo sync): remove permissões do sistema que não vieram
    let removidas = 0;
    if (modo === "sync") {
      const manifest = perms.map((p) => String(p.codigo));
      const atuais = (await rq().input("s", sql.VarChar, cod)
        .query(`SELECT CODIGO FROM ${IAM_SCHEMA}.IAM_PERMISSOES WHERE SISTEMA_CODIGO=@s`)).recordset.map((x) => x.CODIGO);
      const remover = atuais.filter((c) => !manifest.includes(c));
      for (const c of remover) {
        await rq().input("c", sql.VarChar, c).query(`DELETE FROM ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES WHERE PERMISSAO_CODIGO=@c`);
        await rq().input("c", sql.VarChar, c).query(`DELETE FROM ${IAM_SCHEMA}.IAM_PAPEL_PERMISSOES WHERE PERMISSAO_CODIGO=@c`);
        await rq().input("c", sql.VarChar, c).query(`DELETE FROM ${IAM_SCHEMA}.IAM_PERMISSOES WHERE CODIGO=@c`);
        removidas++;
      }
    }
    await tx.commit();

    // contagem final confiável
    const finalPerms = (await pool.request().input("s", sql.VarChar, cod)
      .query(`SELECT COUNT(*) n FROM ${IAM_SCHEMA}.IAM_PERMISSOES WHERE SISTEMA_CODIGO=@s`)).recordset[0].n;
    try { await auditar(pool, { usuarioId: null, acao: "REGISTRY_SYNC", detalhe: { sistema: cod, modo, enviadas: perms.length, removidas }, ator: `registry:${cod}` }); }
    catch (ae) { console.error("[registry/sync audit]", ae.message); } // auditoria é best-effort, não derruba o sync
    res.json({ ok: true, sistema: cod, modo, criadas, atualizadas, removidas, permissoes_totais: finalPerms });
  } catch (e) {
    await tx.rollback();
    console.error("[registry/sync]", e.message);
    res.status(500).json({ erro: "Falha ao registrar", detalhe: e.message });
  }
});

module.exports = router;
