-- Faltava registrar a aba "Boletins" (/gestao/boletins) como tela do PCP — por isso ficava
-- bloqueada pra todos. Registra e concede aos papéis de acesso total. Idempotente.

MERGE iam.IAM_PERMISSOES AS t
USING (VALUES ('pcp.tela:/gestao/boletins', N'Boletins (Gestão)')) AS s(CODIGO, DESCRICAO)
ON t.CODIGO = s.CODIGO
WHEN MATCHED THEN UPDATE SET DESCRICAO = s.DESCRICAO, SISTEMA_CODIGO = 'PCP'
WHEN NOT MATCHED THEN INSERT (CODIGO, SISTEMA_CODIGO, DESCRICAO) VALUES (s.CODIGO, 'PCP', s.DESCRICAO);
GO

INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, 'pcp.tela:/gestao/boletins'
FROM iam.IAM_PAPEIS p
WHERE p.NOME IN ('TI','GERENCIA','COORDENADOR')
  AND NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEL_PERMISSOES pp WHERE pp.PAPEL_ID=p.ID AND pp.PERMISSAO_CODIGO='pcp.tela:/gestao/boletins');
GO
