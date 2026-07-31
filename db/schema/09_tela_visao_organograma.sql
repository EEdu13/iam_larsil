-- "Visão Organograma" vira uma TELA própria (rota /gestao/visao-organograma), no grupo Gestão.
-- Antes dividia a rota /gestao/organograma com "Atribuições" (Cadastros) via ?aba=visao — o que
-- impedia liberar a visão sem liberar a edição, e escondia a tela do grupo Gestão no console.
-- Idempotente.

IF NOT EXISTS (SELECT 1 FROM iam.IAM_PERMISSOES WHERE CODIGO = 'pcp.tela:/gestao/visao-organograma')
    INSERT INTO iam.IAM_PERMISSOES (CODIGO, SISTEMA_CODIGO, DESCRICAO, GRUPO)
    VALUES ('pcp.tela:/gestao/visao-organograma', 'PCP', 'Visão Organograma', 'Gestão');
ELSE
    UPDATE iam.IAM_PERMISSOES SET DESCRICAO = 'Visão Organograma', GRUPO = 'Gestão'
    WHERE CODIGO = 'pcp.tela:/gestao/visao-organograma';
GO

-- Mesma concessão da tela de organograma: COORDENADOR, GERENCIA, SUPERVISOR, TI.
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, 'pcp.tela:/gestao/visao-organograma'
  FROM iam.IAM_PAPEIS p
 WHERE p.NOME IN ('COORDENADOR', 'GERENCIA', 'SUPERVISOR', 'TI')
   AND NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEL_PERMISSOES pp
                    WHERE pp.PAPEL_ID = p.ID AND pp.PERMISSAO_CODIGO = 'pcp.tela:/gestao/visao-organograma');
GO
