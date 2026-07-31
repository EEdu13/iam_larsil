-- ════════════════════════════════════════════════════════════════════════════
-- IAM Larsil — FASE B: as TELAS (abas) do Painel PCP viram permissões do IAM
-- ════════════════════════════════════════════════════════════════════════════
-- Antes: quem via qual aba vinha de PAINEL_PERFIS (por perfil). Agora cada aba é uma
-- permissão `pcp.tela:<rota>` no IAM, então dá pra LIBERAR/NEGAR aba por aba, por
-- pessoa, na tela de Usuários & Acessos. O adaptador do PCP passa a montar o menu a
-- partir das permissões efetivas do IAM (ver server/index.cjs).
-- Idempotente. Substitui as permissões pcp.* grossas antigas pelas de tela.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) remove as permissões pcp.* antigas (grossas) e seus vínculos — serão trocadas pelas de tela
DELETE FROM iam.IAM_PAPEL_PERMISSOES   WHERE PERMISSAO_CODIGO LIKE 'pcp.%' AND PERMISSAO_CODIGO NOT LIKE 'pcp.tela:%';
DELETE FROM iam.IAM_USUARIO_PERMISSOES WHERE PERMISSAO_CODIGO LIKE 'pcp.%' AND PERMISSAO_CODIGO NOT LIKE 'pcp.tela:%';
DELETE FROM iam.IAM_PERMISSOES         WHERE SISTEMA_CODIGO = 'PCP' AND CODIGO NOT LIKE 'pcp.tela:%';
GO

-- 2) cadastra as 20 telas do Painel PCP (codigo = pcp.tela:<rota>, descricao = rótulo do menu)
MERGE iam.IAM_PERMISSOES AS t
USING (VALUES
  ('pcp.tela:/home',                   N'Home'),
  ('pcp.tela:/',                       N'Faturamento'),
  ('pcp.tela:/gestao/minha-gestao',    N'Minha gestão'),
  ('pcp.tela:/relatorios',             N'Relatórios'),
  ('pcp.tela:/boletins/acompanhar',    N'Status Apontamento'),
  ('pcp.tela:/boletins',               N'Produção'),
  ('pcp.tela:/boletins/ticket',        N'Ticket'),
  ('pcp.tela:/boletins/ordens',        N'Ordem de Serviço'),
  ('pcp.tela:/boletins/pendencias',    N'Produção — Pendências'),
  ('pcp.tela:/premios',                N'Prêmios'),
  ('pcp.tela:/premios/pendencias',     N'Prêmios — Pendências'),
  ('pcp.tela:/premios/colaboradores',  N'Prêmios — Colaboradores'),
  ('pcp.tela:/premios/lancar',         N'Lançar prêmio'),
  ('pcp.tela:/gestao/organograma',     N'Atribuições / Organograma'),
  ('pcp.tela:/gestao/colaboradores',   N'Colaboradores'),
  ('pcp.tela:/insumos/auditoria',      N'Insumos — Auditoria'),
  ('pcp.tela:/insumos/views',          N'Insumos — Views'),
  ('pcp.tela:/localizacao',            N'Posição de campo'),
  ('pcp.tela:/premio-teste',           N'Teste Prêmio 820'),
  ('pcp.tela:/usuarios',               N'Usuários do PCP (admin)')
) AS s(CODIGO, DESCRICAO)
ON t.CODIGO = s.CODIGO
WHEN MATCHED THEN UPDATE SET DESCRICAO = s.DESCRICAO, SISTEMA_CODIGO = 'PCP'
WHEN NOT MATCHED THEN INSERT (CODIGO, SISTEMA_CODIGO, DESCRICAO) VALUES (s.CODIGO, 'PCP', s.DESCRICAO);
GO

-- 3) mapeia telas -> papéis (espelha o que PAINEL_PERFIS concedia por perfil)
-- helper: limpa os vínculos de tela dos papéis que vamos redefinir, pra ficar idempotente
DELETE pp FROM iam.IAM_PAPEL_PERMISSOES pp
JOIN iam.IAM_PAPEIS p ON p.ID = pp.PAPEL_ID
WHERE pp.PERMISSAO_CODIGO LIKE 'pcp.tela:%'
  AND p.NOME IN ('TI','GERENCIA','COORDENADOR','SUPERVISOR','PCP');
GO

-- TI e GERENCIA e COORDENADOR: todas as telas (COORDENADOR/GERENCIA sem /usuarios)
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p
JOIN iam.IAM_PERMISSOES perm ON perm.CODIGO LIKE 'pcp.tela:%'
WHERE p.NOME = 'TI';
GO
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p
JOIN iam.IAM_PERMISSOES perm ON perm.CODIGO LIKE 'pcp.tela:%' AND perm.CODIGO <> 'pcp.tela:/usuarios'
WHERE p.NOME IN ('GERENCIA','COORDENADOR');
GO

-- SUPERVISOR: 7 telas
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p
JOIN iam.IAM_PERMISSOES perm ON perm.CODIGO IN (
  'pcp.tela:/home','pcp.tela:/boletins/acompanhar','pcp.tela:/boletins',
  'pcp.tela:/localizacao','pcp.tela:/','pcp.tela:/gestao/organograma','pcp.tela:/gestao/minha-gestao')
WHERE p.NOME = 'SUPERVISOR';
GO

-- PCP: 6 telas
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p
JOIN iam.IAM_PERMISSOES perm ON perm.CODIGO IN (
  'pcp.tela:/boletins/acompanhar','pcp.tela:/boletins','pcp.tela:/boletins/pendencias',
  'pcp.tela:/localizacao','pcp.tela:/','pcp.tela:/relatorios')
WHERE p.NOME = 'PCP';
GO
