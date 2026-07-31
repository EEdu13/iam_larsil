-- ════════════════════════════════════════════════════════════════════════════
-- IAM Larsil — Ajuste: permitir contas que NÃO são colaboradores (TI/admin/serviço)
-- ════════════════════════════════════════════════════════════════════════════
-- Nem toda identidade é um colaborador de dbo.COLABORADORES: TI, admin e futuras
-- contas de serviço/externas não têm CPF de RH. Então CPF passa a ser opcional,
-- mas continua ÚNICO para quem tem (índice filtrado). Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) remove a constraint UNIQUE antiga do CPF (que também impede NULLs múltiplos)
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_IAM_USUARIOS_CPF')
    ALTER TABLE iam.IAM_USUARIOS DROP CONSTRAINT UQ_IAM_USUARIOS_CPF;
GO

-- 2) CPF passa a aceitar NULL
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('iam.IAM_USUARIOS') AND name = 'CPF' AND is_nullable = 0
)
    ALTER TABLE iam.IAM_USUARIOS ALTER COLUMN CPF CHAR(11) NULL;
GO

-- 3) unicidade só para quem TEM CPF (índice único filtrado)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_IAM_USUARIOS_CPF' AND object_id = OBJECT_ID('iam.IAM_USUARIOS'))
    CREATE UNIQUE INDEX UX_IAM_USUARIOS_CPF
        ON iam.IAM_USUARIOS (CPF) WHERE CPF IS NOT NULL;
GO

-- 4) marca a origem da conta: 'COLABORADOR' (importada) x 'SISTEMA' (TI/admin/serviço)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('iam.IAM_USUARIOS') AND name = 'ORIGEM'
)
    ALTER TABLE iam.IAM_USUARIOS
        ADD ORIGEM VARCHAR(20) NOT NULL
            CONSTRAINT DF_IAM_USUARIOS_ORIGEM DEFAULT ('COLABORADOR');
GO
