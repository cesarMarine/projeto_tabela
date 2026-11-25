-- Executar uma vez no SQL Editor para habilitar os múltiplos individuais.
-- A configuração é independente das famílias e das importações de preços.
CREATE TABLE IF NOT EXISTS public.produtos_multiplos_venda (
  codigo text PRIMARY KEY CHECK (length(trim(codigo)) BETWEEN 1 AND 80),
  multiplo integer NOT NULL CHECK (multiplo BETWEEN 1 AND 1000000),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.produtos_multiplos_venda ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos_multiplos_venda TO service_role;
-- Somente o backend, pela chave de serviço existente, acessa a tabela.
