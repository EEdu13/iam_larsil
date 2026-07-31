-- ════════════════════════════════════════════════════════════════════════════
-- IAM Larsil — FATIA 1: Identidade
-- ════════════════════════════════════════════════════════════════════════════
-- Cria APENAS a base de identidade (uma pessoa = uma linha) e a auditoria.
-- Não cria papéis, permissões nem escopo ainda (Fatia 3).
-- Não toca em NENHUMA tabela existente — só cria o schema `iam` e tabelas novas.
--
-- Fonte de verdade das pessoas: dbo.COLABORADORES (486 linhas, CPF único).
-- Ligação: iam.IAM_USUARIOS.CPF  <->  dbo.COLABORADORES.CPF
--
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ════════════════════════════════════════════════════════════════════════════

IF SCHEMA_ID('iam') IS NULL
    EXEC('CREATE SCHEMA iam');
GO

-- ── Identidade única por colaborador ────────────────────────────────────────
IF OBJECT_ID('iam.IAM_USUARIOS', 'U') IS NULL
BEGIN
    CREATE TABLE iam.IAM_USUARIOS (
        ID                INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_IAM_USUARIOS PRIMARY KEY,

        -- Chave de negócio imutável. Liga em dbo.COLABORADORES.CPF.
        CPF               CHAR(11)      NOT NULL
            CONSTRAINT UQ_IAM_USUARIOS_CPF UNIQUE,

        -- Identificador estável de RH (matrícula). Secundário, ajuda em conciliações.
        MATRICULA         VARCHAR(20)   NULL,

        -- Snapshot do nome (para exibição e base do login). Fonte autoritativa
        -- continua sendo dbo.COLABORADORES — aqui é só cópia de conveniência.
        NOME              NVARCHAR(255) NOT NULL,

        -- Login amigável (nome.sobrenome). É só um RÓTULO: nada aponta para ele,
        -- então pode mudar no futuro sem quebrar FK/token. Único, case-insensitive
        -- pela collation padrão do banco.
        LOGIN             VARCHAR(60)   NOT NULL
            CONSTRAINT UQ_IAM_USUARIOS_LOGIN UNIQUE,

        EMAIL             NVARCHAR(255) NULL,

        -- Credencial: NULL enquanto a pessoa ainda não precisou logar em nada.
        -- A senha só nasce quando um acesso é concedido (Fatia 3+).
        SENHA_HASH        VARCHAR(255)  NULL,
        -- 1 = senha provisória, força troca no primeiro acesso.
        SENHA_PROVISORIA  BIT           NOT NULL
            CONSTRAINT DF_IAM_USUARIOS_SENHAPROV DEFAULT (0),

        -- Ciclo de vida da identidade.
        --   PENDENTE_CONFIGURACAO = existe, mas sem papel/acesso atribuído
        --   ATIVO                 = com acesso concedido
        --   DESLIGADO             = colaborador saiu
        ESTADO            VARCHAR(30)   NOT NULL
            CONSTRAINT DF_IAM_USUARIOS_ESTADO DEFAULT ('PENDENTE_CONFIGURACAO'),

        -- Espelha se o colaborador está trabalhando (SITUACAO='1' em COLABORADORES).
        ATIVO             BIT           NOT NULL
            CONSTRAINT DF_IAM_USUARIOS_ATIVO DEFAULT (1),

        CRIADO_EM         DATETIME2(0)  NOT NULL
            CONSTRAINT DF_IAM_USUARIOS_CRIADO DEFAULT (SYSUTCDATETIME()),
        CRIADO_POR        NVARCHAR(120) NULL,
        ATUALIZADO_EM     DATETIME2(0)  NULL
    );
END
GO

-- ── Auditoria (desde o dia 1) ───────────────────────────────────────────────
-- Registra toda ação sobre identidade/acesso: quem fez, o quê, quando.
IF OBJECT_ID('iam.IAM_AUDITORIA', 'U') IS NULL
BEGIN
    CREATE TABLE iam.IAM_AUDITORIA (
        ID          BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_IAM_AUDITORIA PRIMARY KEY,
        USUARIO_ID  INT           NULL,   -- alvo da ação (FK lógica p/ IAM_USUARIOS)
        ACAO        VARCHAR(60)   NOT NULL,-- ex.: IDENTIDADE_CRIADA, LOGIN_GERADO
        DETALHE     NVARCHAR(MAX) NULL,    -- JSON com o antes/depois
        ATOR        NVARCHAR(120) NULL,    -- quem executou (login ou 'IMPORT')
        CRIADO_EM   DATETIME2(0)  NOT NULL
            CONSTRAINT DF_IAM_AUDITORIA_CRIADO DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_IAM_AUDITORIA_USUARIO ON iam.IAM_AUDITORIA (USUARIO_ID);
END
GO
