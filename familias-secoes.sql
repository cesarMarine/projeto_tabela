-- Executar uma vez no SQL Editor do Supabase para habilitar as secoes.
-- Nao altera familias, produtos, pedidos ou suas ordens atuais.
CREATE TABLE IF NOT EXISTS public.catalogo_secoes_familias (
  grupo text PRIMARY KEY CHECK (length(trim(grupo)) BETWEEN 1 AND 100),
  ativo boolean NOT NULL DEFAULT true,
  secoes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(secoes) = 'array'),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalogo_secoes_familias ENABLE ROW LEVEL SECURITY;
-- Somente o backend, com a chave de servico existente, acessa esta configuracao.
-- Para voltar ao visual antigo, desmarque "Exibir secoes no catalogo" no admin
-- e salve. Nao e necessario apagar a tabela nem as configuracoes.
