// Executa um arquivo .sql dividindo em batches por linhas "GO" (o driver mssql não entende GO).
// Uso: node scripts/run-sql.cjs db/schema/01_identidade.sql
const fs = require("fs");
const path = require("path");
const { getPool } = require("../src/lib/db.cjs");

async function main() {
  const arq = process.argv[2];
  if (!arq) throw new Error("Informe o arquivo .sql. Ex.: node scripts/run-sql.cjs db/schema/01_identidade.sql");
  const sqlText = fs.readFileSync(path.resolve(arq), "utf8");

  // divide em batches por linhas que contêm só "GO"
  const batches = sqlText
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const pool = await getPool();
  console.log(`Executando ${arq} — ${batches.length} batch(es)...`);
  for (let i = 0; i < batches.length; i++) {
    await pool.request().batch(batches[i]);
    console.log(`  batch ${i + 1}/${batches.length} OK`);
  }
  console.log("Concluído.");
  await pool.close();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
