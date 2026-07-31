-- ════════════════════════════════════════════════════════════════════════════
-- IAM Larsil — Contato empresarial (coletado no 1º acesso) + controle de troca de senha
-- ════════════════════════════════════════════════════════════════════════════
-- No primeiro login o usuário troca a senha e informa telefone/email empresarial,
-- pra ajudar a TI a manter esses dados. EMAIL já existe; falta o telefone e a marca
-- de que o onboarding foi concluído. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('iam.IAM_USUARIOS') AND name='TELEFONE_EMPRESARIAL')
    ALTER TABLE iam.IAM_USUARIOS ADD TELEFONE_EMPRESARIAL VARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('iam.IAM_USUARIOS') AND name='ONBOARDING_EM')
    ALTER TABLE iam.IAM_USUARIOS ADD ONBOARDING_EM DATETIME2(0) NULL;
GO
