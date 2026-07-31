// Teste offline do gerador de login (sem banco). Roda: node scripts/test-login.cjs
const { gerarLoginUnico, loginBase, normalizar } = require("../src/lib/login.cjs");

const casos = [
  "LEANDRO DLUGOSZ DA SILVA",
  "JOSÉ DA CONCEIÇÃO",
  "ADILSON DE LIMA",
  "TONIEL RODRIGUES",
  "MARIA",
  "ANTÔNIO CÉSAR DOS SANTOS",
];

console.log("── normalização / base ──");
for (const c of casos) console.log(`  ${c.padEnd(30)} -> ${loginBase(c) || "(vazio)"}`);

console.log("\n── colisão (mesmo conjunto) ──");
const usados = new Set();
for (const nome of ["JOAO SILVA", "JOAO PEDRO SILVA", "JOAO SILVA", "JOAO SILVA"]) {
  const g = gerarLoginUnico(nome, usados, "matX");
  console.log(`  ${nome.padEnd(20)} -> ${g.login}${g.colidiu ? "  (desempate)" : ""}`);
}
