-- ════════════════════════════════════════════════════════════════════════════
-- IAM Larsil — Seed do catálogo: sistemas, permissões, papéis e defaults.
-- ════════════════════════════════════════════════════════════════════════════
-- Ponto de partida real (baseado em FUNCAO de COLABORADORES e nas abas do Painel PCP).
-- Idempotente: só insere o que ainda não existe. Ampliar conforme novos sistemas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Sistemas ────────────────────────────────────────────────────────────────
INSERT INTO iam.IAM_SISTEMAS (CODIGO, NOME, URL_BASE, EXIGE_TREINAMENTO)
SELECT v.CODIGO, v.NOME, v.URL_BASE, v.EXIGE
FROM (VALUES
    ('IAM',        N'Usuários & Acessos',   NULL, 0),
    ('PCP',        N'Painel PCP',           NULL, 1),
    ('TAREFAS',    N'Gerador de Tarefas',   NULL, 0),
    ('APONTAMENTO',N'App de Apontamento',   NULL, 1),
    ('RH',         N'Portal RH',            NULL, 0)
) v(CODIGO, NOME, URL_BASE, EXIGE)
WHERE NOT EXISTS (SELECT 1 FROM iam.IAM_SISTEMAS s WHERE s.CODIGO = v.CODIGO);
GO

-- ── Permissões ──────────────────────────────────────────────────────────────
INSERT INTO iam.IAM_PERMISSOES (CODIGO, SISTEMA_CODIGO, DESCRICAO)
SELECT v.CODIGO, v.SIST, v.DESCR
FROM (VALUES
    ('iam.usuarios.gerenciar', 'IAM',     N'Administrar usuários e acessos'),
    ('pcp.acesso',             'PCP',     N'Entrar no Painel PCP'),
    ('pcp.producao.ver',       'PCP',     N'Ver produção'),
    ('pcp.gestao.ver',         'PCP',     N'Ver gestão'),
    ('pcp.premios.ver',        'PCP',     N'Ver prêmios'),
    ('pcp.premios.lancar',     'PCP',     N'Lançar prêmios'),
    ('pcp.cadastros.ver',      'PCP',     N'Ver cadastros'),
    ('pcp.insumos.ver',        'PCP',     N'Ver insumos'),
    ('pcp.usuarios.ver',       'PCP',     N'Ver aba de usuários do PCP'),
    ('tarefas.acesso',         'TAREFAS', N'Entrar no gerador de tarefas'),
    ('tarefas.criar',          'TAREFAS', N'Criar tarefas'),
    ('tarefas.atribuir',       'TAREFAS', N'Atribuir tarefas a outros'),
    ('tarefas.mencionar',      'TAREFAS', N'Mencionar colegas em tarefas'),
    ('apontamento.acesso',     'APONTAMENTO', N'Entrar no app de apontamento'),
    ('apontamento.lancar',     'APONTAMENTO', N'Lançar apontamento'),
    ('rh.acesso',              'RH',      N'Entrar no portal RH'),
    ('rh.holerite.ver',        'RH',      N'Ver holerite')
) v(CODIGO, SIST, DESCR)
WHERE NOT EXISTS (SELECT 1 FROM iam.IAM_PERMISSOES p WHERE p.CODIGO = v.CODIGO);
GO

-- ── Papéis (cargos-molde) + escopo sugerido ─────────────────────────────────
INSERT INTO iam.IAM_PAPEIS (NOME, ESCOPO_TIPO_PADRAO, DESCRICAO)
SELECT v.NOME, v.ESC, v.DESCR
FROM (VALUES
    ('GERENCIA',    'GLOBAL',      N'Gerência / diretoria — vê tudo'),
    ('TI',          'GLOBAL',      N'Tecnologia da Informação — administra acessos'),
    ('COORDENADOR', 'COORDENADOR', N'Coordenador — sua cadeia inteira abaixo'),
    ('SUPERVISOR',  'SUPERVISOR',  N'Supervisor — seus líderes/equipes (resolve múltiplos projetos)'),
    ('LIDER',       'EQUIPE',      N'Líder — apenas a equipe dele'),
    ('PCP',         'PROJETO',     N'Analista de PCP — tudo do(s) projeto(s)'),
    ('ADM',         'NENHUM',      N'Administrativo — acesso por setor'),
    ('TRABALHADOR', 'NENHUM',      N'Trabalhador de campo — sem sistema por enquanto')
) v(NOME, ESC, DESCR)
WHERE NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEIS p WHERE p.NOME = v.NOME);
GO

-- ── Defaults: quais permissões cada papel concede ───────────────────────────
-- TI e GERENCIA: tudo.
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p CROSS JOIN iam.IAM_PERMISSOES perm
WHERE p.NOME IN ('TI','GERENCIA')
  AND NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEL_PERMISSOES pp WHERE pp.PAPEL_ID=p.ID AND pp.PERMISSAO_CODIGO=perm.CODIGO);
GO

-- COORDENADOR / SUPERVISOR / PCP: acesso ao PCP (ver) + tarefas.
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p JOIN iam.IAM_PERMISSOES perm
  ON perm.CODIGO IN ('pcp.acesso','pcp.producao.ver','pcp.gestao.ver','pcp.premios.ver',
                     'pcp.cadastros.ver','pcp.insumos.ver','tarefas.acesso','tarefas.criar',
                     'tarefas.atribuir','tarefas.mencionar')
WHERE p.NOME IN ('COORDENADOR','SUPERVISOR','PCP')
  AND NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEL_PERMISSOES pp WHERE pp.PAPEL_ID=p.ID AND pp.PERMISSAO_CODIGO=perm.CODIGO);
GO

-- COORDENADOR e PCP também lançam prêmio.
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, 'pcp.premios.lancar'
FROM iam.IAM_PAPEIS p
WHERE p.NOME IN ('COORDENADOR','PCP')
  AND NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEL_PERMISSOES pp WHERE pp.PAPEL_ID=p.ID AND pp.PERMISSAO_CODIGO='pcp.premios.lancar');
GO

-- LIDER: acesso ao PCP e apontamento + tarefas.
INSERT INTO iam.IAM_PAPEL_PERMISSOES (PAPEL_ID, PERMISSAO_CODIGO)
SELECT p.ID, perm.CODIGO
FROM iam.IAM_PAPEIS p JOIN iam.IAM_PERMISSOES perm
  ON perm.CODIGO IN ('pcp.acesso','pcp.producao.ver','apontamento.acesso','apontamento.lancar',
                     'tarefas.acesso','tarefas.criar','tarefas.mencionar')
WHERE p.NOME = 'LIDER'
  AND NOT EXISTS (SELECT 1 FROM iam.IAM_PAPEL_PERMISSOES pp WHERE pp.PAPEL_ID=p.ID AND pp.PERMISSAO_CODIGO=perm.CODIGO);
GO
