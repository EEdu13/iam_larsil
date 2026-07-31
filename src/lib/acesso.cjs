// ════════════════════════════════════════════════════════════════════════════
// Motor de acesso — permissões efetivas + filtro de escopo genérico.
// ════════════════════════════════════════════════════════════════════════════
// Esta é a peça central da IAM. Todo sistema consumidor usa estas duas funções e
// NUNCA reimplementa "quem vê o quê":
//
//   resolverAcesso(pool, usuarioId)  -> { papeis, permissoes, escopos, global }
//   montarFiltroEscopo(escopos, mapaColunas) -> { clause, params }
//
// Regra de escopo (do ESCOPO_IAM_LARSIL.md): cada usuário tem TIPO + ÂNCORA.
//   GLOBAL       -> vê tudo (sem filtro)
//   COORDENADOR  -> WHERE <colCoord> = <nome>
//   SUPERVISOR   -> WHERE <colSup>   = <nome>   (resolve sozinho vários projetos)
//   EQUIPE       -> WHERE <colEquipe>= <codigo>
//   PROJETO      -> WHERE <colProj>  IN (<codigos>)
// Várias linhas de escopo são combinadas com OR.
// ════════════════════════════════════════════════════════════════════════════

const { sql, IAM_SCHEMA } = require("./db.cjs");

/**
 * Resolve papéis, permissões efetivas e escopos de um usuário.
 * Efetiva = (permissões dos papéis) ∪ (exceções CONCEDER) \ (exceções NEGAR).
 */
async function resolverAcesso(pool, usuarioId) {
  const r = await pool.request().input("id", sql.Int, usuarioId).query(`
    SELECT p.NOME AS PAPEL, p.ESCOPO_TIPO_PADRAO
      FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS up
      JOIN ${IAM_SCHEMA}.IAM_PAPEIS p ON p.ID = up.PAPEL_ID
     WHERE up.USUARIO_ID = @id;

    SELECT DISTINCT pp.PERMISSAO_CODIGO AS COD
      FROM ${IAM_SCHEMA}.IAM_USUARIO_PAPEIS up
      JOIN ${IAM_SCHEMA}.IAM_PAPEL_PERMISSOES pp ON pp.PAPEL_ID = up.PAPEL_ID
     WHERE up.USUARIO_ID = @id;

    SELECT PERMISSAO_CODIGO AS COD, TIPO
      FROM ${IAM_SCHEMA}.IAM_USUARIO_PERMISSOES WHERE USUARIO_ID = @id;

    SELECT TIPO, VALOR FROM ${IAM_SCHEMA}.IAM_USUARIO_ESCOPO WHERE USUARIO_ID = @id;
  `);

  const papeis = r.recordsets[0].map((x) => x.PAPEL);
  const efetivas = new Set(r.recordsets[1].map((x) => x.COD));
  for (const e of r.recordsets[2]) {
    if (e.TIPO === "CONCEDER") efetivas.add(e.COD);
    else if (e.TIPO === "NEGAR") efetivas.delete(e.COD);
  }
  const escopos = r.recordsets[3].map((x) => ({ tipo: x.TIPO, valor: x.VALOR }));
  const global = escopos.some((e) => e.tipo === "GLOBAL");

  return { papeis, permissoes: [...efetivas].sort(), escopos, global };
}

/**
 * Monta um trecho WHERE + params a partir dos escopos do usuário.
 * @param {Array<{tipo,valor}>} escopos
 * @param {object} mapaColunas  ex.: { COORDENADOR:'COORDENADOR', SUPERVISOR:'SUPERVISOR', EQUIPE:'EQUIPE', PROJETO:'PROJETO' }
 * @param {string} [px] prefixo dos parâmetros (evita colisão ao usar em várias queries)
 * @returns {{ clause:string, params:Array<{name,value}> }}
 *   - GLOBAL (ou sem escopo mapeável) -> clause '1=1' (sem restrição)
 *   - sem NENHUM escopo -> clause '1=0' (não vê nada) — fail-safe
 */
function montarFiltroEscopo(escopos, mapaColunas, px = "esc") {
  if (!escopos || escopos.length === 0) return { clause: "1=0", params: [] };
  if (escopos.some((e) => e.tipo === "GLOBAL")) return { clause: "1=1", params: [] };

  const ors = [];
  const params = [];
  let i = 0;

  // agrupa por tipo para permitir IN em PROJETO/EQUIPE com vários valores
  const porTipo = {};
  for (const e of escopos) {
    if (!e.valor) continue;
    (porTipo[e.tipo] = porTipo[e.tipo] || []).push(e.valor);
  }

  for (const [tipo, valores] of Object.entries(porTipo)) {
    const col = mapaColunas[tipo];
    if (!col) continue; // tabela não tem essa coluna -> ignora esse tipo
    const nomes = valores.map((v) => {
      const nome = `${px}${i++}`;
      params.push({ name: nome, value: v });
      return `@${nome}`;
    });
    if (nomes.length === 1) ors.push(`LTRIM(RTRIM(${col})) = ${nomes[0]}`);
    else ors.push(`LTRIM(RTRIM(${col})) IN (${nomes.join(", ")})`);
  }

  if (ors.length === 0) return { clause: "1=0", params: [] };
  return { clause: "(" + ors.join(" OR ") + ")", params };
}

/** Aplica os params retornados por montarFiltroEscopo num request do mssql. */
function aplicarParams(request, params) {
  for (const p of params) request.input(p.name, sql.NVarChar(255), p.value);
  return request;
}

module.exports = { resolverAcesso, montarFiltroEscopo, aplicarParams };
