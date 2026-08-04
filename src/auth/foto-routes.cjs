// ════════════════════════════════════════════════════════════════════════════
// Foto de perfil (rápida) — resolvedor por nome, público (entra via <img>).
// ════════════════════════════════════════════════════════════════════════════
// Objetivo: renderizar rápido. Em vez de baixar a imagem e re-servir, a gente
// REDIRECIONA:
//   1) upload do usuário (dbo.FOTO_PERFIL.URL) → 302 direto pro Blob do Azure
//      (o navegador busca na fonte, com cache do Azure — sem hop pelo servidor).
//   2) sem upload → 302 pro resolvedor do PCP (FOTO_BASE_URL) que resolve o Unico People.
// Assim o caso comum (foto trocada = upload) fica instantâneo.
// ════════════════════════════════════════════════════════════════════════════

const express = require("express");
const { sql, getPool } = require("../lib/db.cjs");

const router = express.Router();

// mesma normalização do PCP (people.norm)
const norm = (s) => String(s || "").toUpperCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
const PCP_BASE = () => (process.env.FOTO_BASE_URL || "").replace(/\/$/, "");
const MIME_OK = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

let _tabelaOk = false; // FOTO_PERFIL é criada pelo PCP; aqui só leio — evito checar toda vez

router.get("/foto/:nome", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const nome = String(req.params.nome || "").trim();
    const nn = norm(nome);
    if (!nn) return res.status(404).end();

    let row = null;
    try {
      const pool = await getPool();
      const r = await pool.request().input("nn", sql.VarChar, nn)
        .query("SELECT TOP 1 URL, IMAGEM, MIME FROM dbo.FOTO_PERFIL WHERE NOME_NORM=@nn");
      row = r.recordset[0];
      _tabelaOk = true;
    } catch { /* tabela pode não existir ainda → cai no PCP */ }

    // 1) upload com URL → manda o navegador direto pro Blob (rápido)
    if (row && row.URL) {
      let alvo; try { alvo = new URL(row.URL); } catch { alvo = null; }
      if (alvo && alvo.protocol === "https:" && /(^|\.)blob\.core\.windows\.net$/i.test(alvo.hostname)) {
        res.set("Cache-Control", "public, max-age=120");
        return res.redirect(302, alvo.href);
      }
    }
    // 1b) upload legado (bytes no banco) → serve os bytes
    if (row && row.IMAGEM) {
      res.set("Content-Type", MIME_OK.has(row.MIME) ? row.MIME : "image/jpeg");
      res.set("Cache-Control", "public, max-age=120");
      return res.send(row.IMAGEM);
    }

    // 2) sem upload → resolvedor do PCP (Unico People por nome)
    const base = PCP_BASE();
    if (base) {
      res.set("Cache-Control", "public, max-age=120");
      return res.redirect(302, `${base}/api/foto/${encodeURIComponent(nome)}`);
    }
    return res.status(404).end();
  } catch (e) { return res.status(404).end(); }
});

module.exports = router;
