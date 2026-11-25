-- Executar uma vez. Cadastro manual independente do scraping e das famílias.
CREATE TABLE IF NOT EXISTS public.produtos_compatibilidade (
  codigo text PRIMARY KEY CHECK (length(trim(codigo)) BETWEEN 1 AND 80),
  compatibilidade text NOT NULL CHECK (length(trim(compatibilidade)) BETWEEN 1 AND 4000),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.produtos_compatibilidade ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos_compatibilidade TO service_role;
