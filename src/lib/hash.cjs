// ════════════════════════════════════════════════════════════════════════════
// Hash de senha — scrypt (core do Node, sem módulo nativo).
// ════════════════════════════════════════════════════════════════════════════
// scrypt é memory-hard e recomendado pela OWASP para hashing de senha. Usar o
// core do Node evita compilar argon2/bcrypt no Windows. Se um dia quiserem trocar
// por argon2id, basta reimplementar hashSenha/verificarSenha mantendo a assinatura.
//
// Formato armazenado em IAM_USUARIOS.SENHA_HASH:
//   scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
// ════════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

const N = 16384; // custo de CPU/memória
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Gera o hash de uma senha em texto. Retorna a string completa a guardar no banco. */
function hashSenha(senha) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(String(senha), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Confere uma senha contra o hash guardado. Retorna boolean. Nunca lança por senha errada. */
function verificarSenha(senha, armazenado) {
  try {
    if (!armazenado || typeof armazenado !== "string") return false;
    const partes = armazenado.split("$");
    if (partes.length !== 6 || partes[0] !== "scrypt") return false;
    const [, n, r, p, saltHex, hashHex] = partes;
    const salt = Buffer.from(saltHex, "hex");
    const esperado = Buffer.from(hashHex, "hex");
    const derived = crypto.scryptSync(String(senha), salt, esperado.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return derived.length === esperado.length && crypto.timingSafeEqual(derived, esperado);
  } catch {
    return false;
  }
}

/** Gera uma senha provisória legível (evita caracteres ambíguos como O/0, l/1). */
function gerarSenhaProvisoria(tamanho = 8) {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  let s = "";
  const bytes = crypto.randomBytes(tamanho);
  for (let i = 0; i < tamanho; i++) s += alfabeto[bytes[i] % alfabeto.length];
  return s;
}

module.exports = { hashSenha, verificarSenha, gerarSenhaProvisoria };
