# IAM Larsil — Identidade e Acesso Central

Sistema central de **usuário único** da Larsil. Uma pessoa = uma identidade, que dá acesso a
todos os sistemas conforme papel e escopo. Os sistemas (Painel PCP, gerador de tarefas, PWA de
apontamentos, etc.) **apenas consomem** esta IAM — nunca criam tabela de login própria.

> Base conceitual: `../iam_larsil/ESCOPO_IAM_LARSIL.md`. Fonte de identidade: `dbo.COLABORADORES`
> (Azure SQL `Tabela_teste`). A senha do banco **nunca** é versionada — vem do `.env` (ver abaixo).

## Estado atual — Fatia 1: Identidade

Construção por fatias verticais. A Fatia 1 cria só a base de identidade, sem senha e sem acesso:

1. **Identidade** ← estamos aqui (schema `iam.IAM_USUARIOS` + `iam.IAM_AUDITORIA`, import de COLABORADORES)
2. Login único (Auth API: hash argon2 + JWT, validação real no backend)
3. Papéis, permissões e o motor de escopo (GLOBAL/COORDENADOR/SUPERVISOR/EQUIPE/PROJETO)

## Configuração

```bash
cp .env.example .env   # preencha, OU deixe em branco para herdar o .env do timbertrack-hq
npm install            # instala mssql, argon2, dotenv
```

`src/lib/db.cjs` carrega as credenciais do `.env` local; se não achar `DB_PASSWORD`, cai
automaticamente no `.env` do `timbertrack-hq` (não duplica a senha).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run import:colaboradores:dry` | Prévia do import (não grava): mostra logins gerados e colisões |
| `npm run import:colaboradores` | Cria/atualiza identidades a partir de `dbo.COLABORADORES` ativos (sem senha) |
| `node scripts/import-colaboradores.cjs --todos` | Inclui também colaboradores inativos |
| `npm run test:login` | Testa o gerador de login offline (sem banco) |

Antes do primeiro import real, rode o schema: `db/schema/01_identidade.sql`.

## Princípios (não quebrar)

- **Login é rótulo, não chave.** Chave real = `ID` interno + `CPF`. Login pode mudar sem quebrar nada.
- **Sem senha até ter acesso.** A credencial só nasce quando um acesso é concedido.
- **Nada de tabela de login por sistema.** Sistema novo = 1 linha em `IAM_SISTEMAS` + N permissões.
- **Isolado no schema `iam`.** Não altera nenhuma tabela existente do banco.
