# Como um sistema novo consome a IAM Larsil

> **Regra de ouro:** todo sistema fala com a IAM pela **Auth API (HTTP)**. **Nunca** leia as
> tabelas `IAM_*` direto, nem crie tabela de login/usuário própria. A tabela é detalhe interno;
> a API é o contrato. É isso que impede a volta da bagunça de "uma tabela de usuário por sistema".

A IAM roda em **`http://localhost:4000`** (configurável — use uma env `IAM_URL`).
Autenticação por **JWT** (HS256). O token traz identidade + papéis + permissões + escopo.

---

## 1. Login — `POST /api/auth/login`

**Request**
```json
{ "login": "camila.reis", "senha": "..." }
```

**Response 200**
```json
{
  "token": "<JWT>",
  "senha_provisoria": false,
  "usuario": {
    "id": 60,
    "login": "camila.reis",
    "nome": "CAMILA ROCHA DOS REIS",
    "cpf": "…",              // pode ser null (contas de TI/serviço)
    "admin": false,
    "email": "…",           // pode ser null
    "telefone": "…",        // pode ser null
    "papeis": ["PCP"],
    "permissoes": ["pcp.acesso", "tarefas.criar", "..."],
    "escopos": [{ "tipo": "PROJETO", "valor": "801" }, { "tipo": "PROJETO", "valor": "820" }],
    "global": false
  }
}
```

**Erros**
- `401 { "erro": "Login ou senha inválidos" }`
- `403 { "erro": "Sua conta está desativada. Entre em contato com a TI da empresa.", "motivo": "INATIVO" }`
  → mostre essa mensagem ao usuário; a conta existe mas a TI desativou.

Se `senha_provisoria === true`, force o fluxo de 1º acesso (ver seção 4) antes de liberar o sistema.

---

## 2. Como o seu backend valida o token

Toda requisição do seu front manda o header:
```
Authorization: Bearer <JWT>
```

Seu backend valida de um dos dois jeitos (escolha um):

**A) Local (mais rápido)** — verifica a assinatura com o segredo compartilhado:
```js
const jwt = require("jsonwebtoken");
const payload = jwt.verify(token, process.env.JWT_SECRET); // MESMO segredo do .env da IAM
// payload = { sub, login, nome, cpf, admin, papeis, permissoes, escopos, global, iat, exp }
```
> Peça o `JWT_SECRET` ao dono da IAM (não está aqui e nunca vai pro git).

**B) Remoto (sem compartilhar segredo)** — pergunta pra IAM:
```
GET /api/auth/resolve   (com o Bearer)
→ { usuario_id, papeis, permissoes, escopos, global }
```
Use este quando quiser refletir mudança de permissão sem esperar o token expirar.

**Nunca confie em papel/escopo que venha do corpo/query do cliente. Só do token.**

---

## 3. Como aplicar permissão e escopo

**Permissão (pode ou não fazer a ação):**
```js
if (!payload.permissoes.includes("tarefas.criar")) return res.status(403).json({ erro: "sem permissão" });
```

**Escopo (o que a pessoa ENXERGA):** o token traz `escopos: [{tipo, valor}]` e `global`.
Regra: `global === true` (ou algum escopo `GLOBAL`) → vê tudo. Senão, filtra pelos escopos.
Tipos: `GLOBAL | COORDENADOR | SUPERVISOR | EQUIPE | PROJETO`.
Aplique o MESMO padrão em toda query (não reinvente por tela):

```js
// mapa: quais colunas da SUA tabela representam cada tipo
const MAPA = { COORDENADOR: "COORDENADOR", SUPERVISOR: "SUPERVISOR", EQUIPE: "EQUIPE", PROJETO: "PROJETO" };

function filtroEscopo(escopos, mapa) {
  if (!escopos?.length) return { clause: "1=0", params: [] };           // sem escopo = não vê nada (fail-safe)
  if (escopos.some(e => e.tipo === "GLOBAL")) return { clause: "1=1", params: [] }; // vê tudo
  const ors = [], params = []; let i = 0; const porTipo = {};
  for (const e of escopos) if (e.valor) (porTipo[e.tipo] ||= []).push(e.valor);
  for (const [tipo, vals] of Object.entries(porTipo)) {
    const col = mapa[tipo]; if (!col) continue;
    const names = vals.map(v => { const n = `esc${i++}`; params.push({ name: n, value: v }); return `@${n}`; });
    ors.push(`LTRIM(RTRIM(${col})) IN (${names.join(",")})`);
  }
  return ors.length ? { clause: `(${ors.join(" OR ")})`, params } : { clause: "1=0", params: [] };
}
// SELECT ... WHERE <suas condições> AND ${clause}   (bind cada params[])
```
> Detalhe importante: o valor de COORDENADOR/SUPERVISOR é o **nome** da pessoa, e ele casa com a
> coluna `COORDENADOR`/`SUPERVISOR` que já vem gravada em cada linha dos dados. Para EQUIPE/PROJETO
> o valor é o código.

---

## 4. Primeiro acesso — `POST /api/auth/onboarding`  (com Bearer)

Quando `senha_provisoria` for true, colete e envie:
```json
{ "novaSenha": "…", "telefone": "…", "email": "…" }
```
→ `200 { "ok": true }`. Depois disso a senha provisória vira definitiva e o onboarding fica marcado.

---

## 5. Registrar o SEU sistema na IAM (feito pelo dono da IAM, não pelo consumidor)

Sistema novo = **1 linha em `IAM_SISTEMAS` + N linhas em `IAM_PERMISSOES`** — nunca tabela de login.
Peça ao dono da IAM para rodar algo como:
```sql
INSERT INTO iam.IAM_SISTEMAS (CODIGO, NOME, URL_BASE) VALUES ('TAREFAS', 'Gerador de Tarefas', 'https://…');
INSERT INTO iam.IAM_PERMISSOES (CODIGO, SISTEMA_CODIGO, DESCRICAO) VALUES
  ('tarefas.acesso',    'TAREFAS', 'Entrar no sistema'),
  ('tarefas.criar',     'TAREFAS', 'Criar tarefa'),
  ('tarefas.mencionar', 'TAREFAS', 'Mencionar colega');
-- e ligar aos papéis que já ganham por padrão (IAM_PAPEL_PERMISSOES)
```
As permissões `tarefas.*` já existem de exemplo. A pessoa só passa a "ter" a permissão quando o
papel dela concede (ou por exceção individual) — isso é atribuído na tela **Usuários & Acessos** da IAM.

---

## 6. Checklist do projeto novo
- [ ] Não criar tabela de login/usuário própria
- [ ] Login chama `POST /api/auth/login` (nunca compara senha na mão)
- [ ] Backend valida o **JWT** em toda rota (seção 2) — não confia no cliente
- [ ] Permissão checada por `permissoes.includes("sistema.acao")`
- [ ] Escopo aplicado pelo helper único (seção 3), lendo do token — nunca da query
- [ ] Sistema + permissões registrados na IAM (seção 5)
- [ ] Trata `senha_provisoria` (onboarding) e o `403 INATIVO` (mensagem "procure a TI")

---

*Referência viva: este projeto (`iam_larsil`). O Painel PCP (`timbertrack-hq`) já consome exatamente
assim — o `POST /api/auth/login` dele é um proxy+adaptador pra esta API. Use-o como exemplo real.*
