// ════════════════════════════════════════════════════════════════════════════
// Gerador de login — nome.sobrenome, normalizado e determinístico.
// ════════════════════════════════════════════════════════════════════════════
// Regra decidida com o dono do projeto:
//   - login = primeiro_nome.ultimo_sobrenome (ex.: "LEANDRO DLUGOSZ DA SILVA" -> leandro.silva)
//   - sem acento, ç -> c, minúsculo, só [a-z0-9.]
//   - partículas ("da", "de", "do", "dos", "das", "e", "di", "du") não contam como sobrenome
//   - o login é só um RÓTULO. A chave real é o ID interno + CPF. Login pode mudar
//     no futuro sem quebrar nada, porque nada aponta para a string do login.
//   - colisão (dois "João Silva"): tenta incluir um nome do meio; se ainda colidir,
//     acrescenta um número (2, 3, ...). Determinístico dado a ordem de processamento.
// ════════════════════════════════════════════════════════════════════════════

const PARTICULAS = new Set(["da", "de", "do", "dos", "das", "e", "di", "du", "del", "van", "von"]);

/** Remove acentos/diacríticos e baixa a caixa. "José" -> "jose", "Conceição" -> "conceicao". */
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")                  // separa letra base + acento combinante
    .replace(/[̀-ͯ]/g, "")   // remove os acentos combinantes (inclui o cedilha do ç)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")      // qualquer coisa que não seja letra/dígito vira espaço
    .replace(/\s+/g, " ")
    .trim();
}

/** Quebra o nome em tokens úteis, preservando a ordem. */
function tokens(nome) {
  return normalizar(nome).split(" ").filter((t) => t.length > 0);
}

/** Tokens que servem como "sobrenome" (exclui partículas). */
function tokensSignificativos(nome) {
  return tokens(nome).filter((t) => !PARTICULAS.has(t));
}

/**
 * Login base ideal (sem tratar colisão): primeiro.ultimo.
 * - 0 tokens  -> "" (chamador decide fallback, ex.: matrícula)
 * - 1 token   -> só ele
 * - 2+ tokens -> primeiro.ultimo (ignorando partículas no fim)
 */
function loginBase(nome) {
  const sig = tokensSignificativos(nome);
  if (sig.length === 0) return "";
  if (sig.length === 1) return sig[0];
  return `${sig[0]}.${sig[sig.length - 1]}`;
}

/**
 * Gera um login único dado o nome e um conjunto de logins já usados.
 * Estratégia de desempate, em ordem:
 *   1) primeiro.ultimo
 *   2) primeiro.meio.ultimo (cada nome do meio, da esquerda p/ direita)
 *   3) primeiro.ultimo2, primeiro.ultimo3, ...
 * Fallback quando não há nome utilizável: usa `fallbackBase` (ex.: matrícula).
 *
 * @param {string} nome
 * @param {Set<string>} usados  — logins já atribuídos (será atualizado com o novo)
 * @param {string} [fallbackBase] — base a usar se o nome não gerar nada
 * @returns {{ login: string, base: string, colidiu: boolean }}
 */
function gerarLoginUnico(nome, usados, fallbackBase) {
  const sig = tokensSignificativos(nome);
  const candidatos = [];

  const base = loginBase(nome);
  if (base) {
    candidatos.push(base);
    // primeiro.meio.ultimo — usa cada nome do meio como desempate
    if (sig.length >= 3) {
      const primeiro = sig[0];
      const ultimo = sig[sig.length - 1];
      for (let i = 1; i < sig.length - 1; i++) {
        candidatos.push(`${primeiro}.${sig[i]}.${ultimo}`);
      }
    }
  } else if (fallbackBase) {
    candidatos.push(normalizar(fallbackBase).replace(/\s/g, ""));
  } else {
    candidatos.push("user");
  }

  // tenta os candidatos "bonitos" primeiro
  for (const c of candidatos) {
    if (c && !usados.has(c)) {
      usados.add(c);
      return { login: c, base, colidiu: c !== base };
    }
  }

  // por último: sufixo numérico sobre o primeiro candidato
  const raiz = candidatos[0];
  for (let n = 2; n < 1000; n++) {
    const c = `${raiz}${n}`;
    if (!usados.has(c)) {
      usados.add(c);
      return { login: c, base, colidiu: true };
    }
  }
  throw new Error(`Não foi possível gerar login único para "${nome}"`);
}

module.exports = { normalizar, tokens, tokensSignificativos, loginBase, gerarLoginUnico, PARTICULAS };
