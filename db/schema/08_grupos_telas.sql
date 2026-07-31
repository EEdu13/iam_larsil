-- Agrupa as telas do PCP em "grupos" (espelhando as abas do menu) para o console
-- listar por grupo e permitir liberar/negar tudo de um grupo de uma vez. Idempotente.

IF COL_LENGTH('iam.IAM_PERMISSOES', 'GRUPO') IS NULL
    ALTER TABLE iam.IAM_PERMISSOES ADD GRUPO NVARCHAR(40) NULL;
GO

UPDATE iam.IAM_PERMISSOES SET GRUPO =
  CASE CODIGO
    WHEN 'pcp.tela:/home'                  THEN 'Home'
    WHEN 'pcp.tela:/'                       THEN 'Gestão'
    WHEN 'pcp.tela:/relatorios'             THEN 'Gestão'
    WHEN 'pcp.tela:/gestao/minha-gestao'    THEN 'Gestão'
    WHEN 'pcp.tela:/boletins/acompanhar'    THEN 'Gestão'
    WHEN 'pcp.tela:/gestao/boletins'        THEN 'Gestão'
    WHEN 'pcp.tela:/boletins'               THEN 'Produção'
    WHEN 'pcp.tela:/boletins/ticket'        THEN 'Produção'
    WHEN 'pcp.tela:/boletins/ordens'        THEN 'Produção'
    WHEN 'pcp.tela:/boletins/pendencias'    THEN 'Produção'
    WHEN 'pcp.tela:/premios'                THEN 'Prêmios'
    WHEN 'pcp.tela:/premios/pendencias'     THEN 'Prêmios'
    WHEN 'pcp.tela:/premios/colaboradores'  THEN 'Prêmios'
    WHEN 'pcp.tela:/premios/lancar'         THEN 'Prêmios'
    WHEN 'pcp.tela:/gestao/organograma'     THEN 'Cadastros'
    WHEN 'pcp.tela:/gestao/colaboradores'   THEN 'Cadastros'
    WHEN 'pcp.tela:/insumos/auditoria'      THEN 'Insumos'
    WHEN 'pcp.tela:/insumos/views'          THEN 'Insumos'
    WHEN 'pcp.tela:/localizacao'            THEN 'Campo'
    WHEN 'pcp.tela:/premio-teste'           THEN 'Testes'
    WHEN 'pcp.tela:/usuarios'               THEN 'Admin'
    ELSE GRUPO
  END
WHERE SISTEMA_CODIGO = 'PCP';
GO
