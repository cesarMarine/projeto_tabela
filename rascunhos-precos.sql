-- Executar uma vez no SQL Editor. Não envia pedidos nem apaga itens.
BEGIN;
ALTER TABLE public.pedidos02_itens ADD COLUMN IF NOT EXISTS esgotado boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.tabela_controle_precos (
  id integer PRIMARY KEY CHECK(id=1),
  revisao bigint NOT NULL DEFAULT 1,
  importando boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.tabela_controle_precos(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.tabela_controle_precos ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.tabela_controle_precos TO service_role;

CREATE OR REPLACE FUNCTION public.tabela_codigo(v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN btrim(v) ~ '^[0-9]+$' THEN coalesce(nullif(ltrim(btrim(v),'0'),''),'0') ELSE lower(btrim(v)) END;
$$;
CREATE INDEX IF NOT EXISTS idx_itens_sistema_codigo_precos ON public.itens_sistema(public.tabela_codigo(codigo::text));
CREATE INDEX IF NOT EXISTS idx_ofertas_codigo_precos ON public.ofertas(public.tabela_codigo(codigo::text));
CREATE INDEX IF NOT EXISTS idx_pedidos02_itens_pedido_precos ON public.pedidos02_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj_precos ON public.clientes(cnpj);
CREATE INDEX IF NOT EXISTS idx_pedidos02_rascunhos_precos ON public.pedidos02(id) WHERE status='RASCUNHO';

CREATE OR REPLACE FUNCTION public.tabela_preco_produto(p_codigo text,p_cnpj text)
RETURNS TABLE(preco_base numeric,preco_final numeric,esgotado boolean,estoque numeric,preco_original numeric,desconto_porcentagem numeric)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_preco numeric; v_estoque numeric; v_ativo text; v_uf text; v_acrescimo numeric:=0; v_desconto numeric:=0;
BEGIN
 SELECT c.uf INTO v_uf FROM public.clientes c WHERE c.cnpj::text=p_cnpj;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado para atualizar preços.'; END IF;
 SELECT coalesce(g.acrescimo,0) INTO v_acrescimo FROM public.uf_acrescimo u JOIN public.grupos_acrescimo g ON g.id=u.grupo_id WHERE upper(u.uf)=upper(v_uf) LIMIT 1;
 v_acrescimo:=coalesce(v_acrescimo,0);
 SELECT s.preco_venda,s.estoque,s.ativo::text INTO v_preco,v_estoque,v_ativo FROM public.itens_sistema s
 WHERE public.tabela_codigo(s.codigo::text)=public.tabela_codigo(p_codigo)
 ORDER BY (s.codigo::text=p_codigo) DESC,s.atualizado_em DESC NULLS LAST LIMIT 1;
 esgotado:=NOT FOUND OR coalesce(v_estoque,0)<=0 OR coalesce(v_preco,0)<=0 OR lower(coalesce(v_ativo,'1')) IN ('0','false','f');
 estoque:=coalesce(v_estoque,0);
 SELECT o.desconto_porcentagem INTO v_desconto FROM public.ofertas o WHERE public.tabela_codigo(o.codigo::text)=public.tabela_codigo(p_codigo) LIMIT 1;
 v_desconto:=coalesce(v_desconto,0);
 IF v_desconto<0 OR v_desconto>100 OR v_acrescimo < -100 THEN RAISE EXCEPTION 'Regra de preço inválida para produto %.',p_codigo; END IF;
 preco_base:=CASE WHEN esgotado THEN 0 ELSE v_preco END;
 preco_original:=round(preco_base*(1+v_acrescimo/100),6);desconto_porcentagem:=v_desconto;
 preco_final:=round(preco_original*(1-v_desconto/100),6);
 RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION public.tabela_cotar_itens(p_cnpj text,p_itens jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb; p record; linhas jsonb:='[]'; total numeric:=0; quantidade numeric; revisao_atual bigint;
BEGIN
 IF p_itens IS NULL OR jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)>2000 THEN RAISE EXCEPTION 'Lista de itens inválida.'; END IF;
 IF EXISTS(SELECT 1 FROM public.tabela_controle_precos WHERE id=1 AND importando) THEN RAISE EXCEPTION 'A tabela está sendo importada. Aguarde para atualizar o pedido.'; END IF;
 SELECT revisao INTO revisao_atual FROM public.tabela_controle_precos WHERE id=1;
 FOR v IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
   quantidade:=(v->>'qtd')::numeric;
   IF quantidade IS NULL OR quantidade<=0 OR quantidade<>trunc(quantidade) OR coalesce(v->>'codigo','')='' THEN RAISE EXCEPTION 'Código ou quantidade inválidos.'; END IF;
   SELECT * INTO p FROM public.tabela_preco_produto(v->>'codigo',p_cnpj);
   linhas:=linhas||jsonb_build_array(jsonb_build_object('codigo',v->>'codigo','qtd',quantidade,'precoBase',p.preco_base,'precoFinal',p.preco_final,'precoOriginal',p.preco_original,'pctDesconto',p.desconto_porcentagem,'esgotado',p.esgotado,'estoque',p.estoque));
   total:=total+round(p.preco_final*quantidade,2);
 END LOOP;
 RETURN jsonb_build_object('itens',linhas,'total',total,'revisao',revisao_atual);
END; $$;

CREATE OR REPLACE FUNCTION public.tabela_precificar_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cliente text; situacao text; p record;
BEGIN
 -- Mesma ordem da importação: bloquear o pedido antes do bloqueio de preços.
 SELECT cnpj_cliente,status INTO cliente,situacao FROM public.pedidos02 WHERE id=NEW.pedido_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock_shared(hashtext('tabela_atualizar_rascunhos'));
 -- Recalcular rascunhos e itens novos. Uma importação não altera pedidos já enviados.
 IF TG_OP='INSERT' OR situacao='RASCUNHO' THEN
   IF EXISTS(SELECT 1 FROM public.tabela_controle_precos WHERE id=1 AND importando) THEN RAISE EXCEPTION 'Tabela em atualização. Tente salvar novamente em instantes.'; END IF;
   SELECT * INTO p FROM public.tabela_preco_produto(NEW.codigo_produto::text,cliente);
   NEW.preco_base:=p.preco_base; NEW.preco_final:=p.preco_final; NEW.esgotado:=p.esgotado;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tabela_precificar_item ON public.pedidos02_itens;
CREATE TRIGGER tabela_precificar_item BEFORE INSERT OR UPDATE ON public.pedidos02_itens FOR EACH ROW EXECUTE FUNCTION public.tabela_precificar_item();

CREATE OR REPLACE FUNCTION public.tabela_total_pedido() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pedido integer; valor numeric;
BEGIN
 -- A tabela de transição contém todos os itens da instrução, não apenas uma linha.
 FOR pedido IN SELECT DISTINCT n.pedido_id FROM tabela_itens_modificados n ORDER BY n.pedido_id LOOP
   SELECT coalesce(sum(round(coalesce(i.preco_final,0)::numeric*i.quantidade::numeric,2)),0) INTO valor FROM public.pedidos02_itens i WHERE i.pedido_id=pedido;
   UPDATE public.pedidos02 SET total=valor WHERE id=pedido AND (status='RASCUNHO' OR TG_OP='INSERT') AND total IS DISTINCT FROM valor;
 END LOOP;
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS tabela_total_pedido ON public.pedidos02_itens;
DROP TRIGGER IF EXISTS tabela_total_pedido_insercao ON public.pedidos02_itens;
DROP TRIGGER IF EXISTS tabela_total_pedido_atualizacao ON public.pedidos02_itens;
CREATE TRIGGER tabela_total_pedido_insercao AFTER INSERT ON public.pedidos02_itens
 REFERENCING NEW TABLE AS tabela_itens_modificados FOR EACH STATEMENT EXECUTE FUNCTION public.tabela_total_pedido();
CREATE TRIGGER tabela_total_pedido_atualizacao AFTER UPDATE ON public.pedidos02_itens
 REFERENCING NEW TABLE AS tabela_itens_modificados FOR EACH STATEMENT EXECUTE FUNCTION public.tabela_total_pedido();

CREATE OR REPLACE FUNCTION public.tabela_atualizar_rascunhos_lote(p_depois bigint DEFAULT 0,p_ate bigint DEFAULT NULL,p_limite integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pedido record; ids integer[]; n integer; pedidos integer:=0; itens integer:=0; esgotados integer:=0; ultimo bigint:=p_depois; ate bigint; rev bigint; restantes boolean;
BEGIN
 IF p_depois IS NULL OR p_depois<0 OR p_limite IS NULL OR p_limite<1 OR p_limite>20 OR p_ate<0 THEN RAISE EXCEPTION 'Intervalo de atualização inválido.'; END IF;
 SELECT coalesce(p_ate,max(p.id),0) INTO ate FROM public.pedidos02 p WHERE p.status='RASCUNHO';
 SELECT array_agg(q.id ORDER BY q.id) INTO ids FROM (
   SELECT p.id FROM public.pedidos02 p WHERE p.status='RASCUNHO' AND p.id>p_depois AND p.id<=ate ORDER BY p.id LIMIT p_limite FOR UPDATE
 ) q;
 -- Lotes curtos; nunca mantém todos os rascunhos bloqueados durante a atualização.
 PERFORM pg_advisory_xact_lock(hashtext('tabela_atualizar_rascunhos'));
 IF EXISTS(SELECT 1 FROM public.tabela_controle_precos WHERE id=1 AND importando) THEN RAISE EXCEPTION 'A importação ainda não terminou.'; END IF;
 FOR pedido IN SELECT p.id FROM public.pedidos02 p WHERE p.id=ANY(ids) AND p.status='RASCUNHO' ORDER BY p.id LOOP
   UPDATE public.pedidos02_itens SET preco_base=preco_base WHERE pedido_id=pedido.id;
   GET DIAGNOSTICS n=ROW_COUNT; itens:=itens+n;
   IF n=0 THEN UPDATE public.pedidos02 SET total=0 WHERE id=pedido.id AND status='RASCUNHO' AND total IS DISTINCT FROM 0; END IF;
   pedidos:=pedidos+1; ultimo:=pedido.id;
 END LOOP;
 SELECT count(*) INTO esgotados FROM public.pedidos02_itens i WHERE i.pedido_id=ANY(ids) AND i.esgotado;
 SELECT EXISTS(SELECT 1 FROM public.pedidos02 p WHERE p.status='RASCUNHO' AND p.id>ultimo AND p.id<=ate) INTO restantes;
 IF pedidos>0 THEN
   UPDATE public.tabela_controle_precos SET revisao=revisao+1,atualizado_em=now() WHERE id=1 RETURNING revisao INTO rev;
 ELSE SELECT revisao INTO rev FROM public.tabela_controle_precos WHERE id=1;
 END IF;
 RETURN jsonb_build_object('pedidos',pedidos,'itens',itens,'esgotados',esgotados,'revisao',rev,'ultimo_id',ultimo,'ate_id',ate,'tem_mais',restantes);
END; $$;

CREATE OR REPLACE FUNCTION public.tabela_atualizar_rascunhos() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE lote jsonb; pedidos integer:=0; itens integer:=0; esgotados integer:=0; ultimo bigint:=0; ate bigint; rev bigint;
BEGIN
 -- Compatibilidade com versões anteriores; o admin novo usa uma transação por lote.
 PERFORM p.id FROM public.pedidos02 p WHERE p.status='RASCUNHO' ORDER BY p.id FOR UPDATE;
 LOOP
   lote:=public.tabela_atualizar_rascunhos_lote(ultimo,ate,5);
   pedidos:=pedidos+(lote->>'pedidos')::integer; itens:=itens+(lote->>'itens')::integer; esgotados:=esgotados+(lote->>'esgotados')::integer;
   ultimo:=(lote->>'ultimo_id')::bigint; ate:=(lote->>'ate_id')::bigint; rev:=(lote->>'revisao')::bigint;
   EXIT WHEN NOT (lote->>'tem_mais')::boolean;
 END LOOP;
 RETURN jsonb_build_object('pedidos',pedidos,'itens',itens,'esgotados',esgotados,'revisao',rev);
END; $$;

CREATE OR REPLACE FUNCTION public.tabela_importar_precos(p_itens jsonb,p_lista_completa boolean DEFAULT false,p_data date DEFAULT current_date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer; ausentes integer:=0; resumo jsonb;
BEGIN
 IF p_itens IS NULL OR jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 OR jsonb_array_length(p_itens)>100000 THEN RAISE EXCEPTION 'A planilha está vazia ou excede o limite permitido.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_itens) v WHERE coalesce(v->>'codigo','')='' OR (v->>'preco_venda')::numeric<0) THEN RAISE EXCEPTION 'A planilha contém código ou preço inválido.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('tabela_atualizar_rascunhos'));
 INSERT INTO public.itens_sistema(codigo,cod_barras,descricao,estoque,preco_venda,ordem_excel,ativo,atualizado_em,is_lancamento,is_chegou,lancamento_em,chegou_em)
 SELECT x.codigo,x.cod_barras,x.descricao,x.estoque,x.preco_venda,x.ordem_excel,x.ativo,x.atualizado_em,x.is_lancamento,x.is_chegou,x.lancamento_em,x.chegou_em
 FROM jsonb_populate_recordset(NULL::public.itens_sistema,p_itens) x
 ON CONFLICT(codigo) DO UPDATE SET cod_barras=EXCLUDED.cod_barras,descricao=EXCLUDED.descricao,estoque=EXCLUDED.estoque,preco_venda=EXCLUDED.preco_venda,ordem_excel=EXCLUDED.ordem_excel,ativo=EXCLUDED.ativo,atualizado_em=EXCLUDED.atualizado_em,is_lancamento=EXCLUDED.is_lancamento,is_chegou=EXCLUDED.is_chegou,lancamento_em=EXCLUDED.lancamento_em,chegou_em=EXCLUDED.chegou_em;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF p_lista_completa THEN
   UPDATE public.itens_sistema s SET estoque=0,atualizado_em=now() WHERE coalesce(s.estoque,0)<>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_itens) v WHERE public.tabela_codigo(v->>'codigo')=public.tabela_codigo(s.codigo::text));
   GET DIAGNOSTICS ausentes=ROW_COUNT;
 END IF;
 INSERT INTO public.historico_estoque(data_importacao,codigo_produto,estoque,preco_venda)
 SELECT p_data,s.codigo,s.estoque,s.preco_venda FROM public.itens_sistema s WHERE p_lista_completa OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_itens) v WHERE public.tabela_codigo(v->>'codigo')=public.tabela_codigo(s.codigo::text))
 ON CONFLICT(data_importacao,codigo_produto) DO UPDATE SET estoque=EXCLUDED.estoque,preco_venda=EXCLUDED.preco_venda;
 -- A carga do catálogo é atômica. O admin recalcula os rascunhos em transações curtas depois dela.
 UPDATE public.tabela_controle_precos SET revisao=revisao+1,atualizado_em=now() WHERE id=1;
 resumo:=jsonb_build_object('pendente',true,'pedidos',0,'itens',0,'esgotados',0);
 RETURN jsonb_build_object('inseridos',n,'ausentes_esgotados',ausentes,'rascunhos',resumo);
END; $$;
REVOKE ALL ON FUNCTION public.tabela_importar_precos(jsonb,boolean,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tabela_importar_precos(jsonb,boolean,date) TO service_role;
REVOKE ALL ON FUNCTION public.tabela_preco_produto(text,text),public.tabela_cotar_itens(text,jsonb),public.tabela_precificar_item(),public.tabela_total_pedido(),public.tabela_atualizar_rascunhos() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tabela_preco_produto(text,text),public.tabela_cotar_itens(text,jsonb),public.tabela_atualizar_rascunhos() TO service_role;
REVOKE ALL ON FUNCTION public.tabela_atualizar_rascunhos_lote(bigint,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tabela_atualizar_rascunhos_lote(bigint,bigint,integer) TO service_role;
COMMIT;
