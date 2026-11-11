// Rotas isoladas para não modificar o cadastro de famílias.
export function registrarAgrupados(app, supabase) {
  app.get('/api/produtos-agrupados', async (req, res) => {
    try {
      const resultado = [];
      for (let inicio = 0; ; inicio += 200) {
        const { data, error } = await supabase.from('produtos_agrupados').select('*')
          .order('id', { ascending: true }).range(inicio, inicio + 199);
        if (error) {
          if (['42P01', 'PGRST205'].includes(error.code)) return res.json({ ok: true, configurado: false, produtos: [] });
          throw error;
        }
        resultado.push(...(data || []));
        if (!data || data.length < 200) break;
      }
      res.json({ ok: true, configurado: true, produtos: resultado });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });

  app.post('/api/admin/produtos-agrupados', async (req, res) => {
    try {
      const { id, nome, grupo, imagem_url = '', minimo, componentes } = req.body || {};
      if (typeof nome !== 'string' || !nome.trim() || nome.length > 160 ||
          typeof grupo !== 'string' || !grupo.trim() || grupo.length > 100 ||
          !Number.isSafeInteger(minimo) || minimo < 1 ||
          !Array.isArray(componentes) || componentes.length < 2 || componentes.length > 100 ||
          (id != null && !/^\d+$/.test(String(id)))) {
        return res.status(400).json({ ok: false, erro: 'Informe nome, grupo, mínimo inteiro positivo e pelo menos dois produtos.' });
      }
      if (typeof imagem_url !== 'string' || (imagem_url && !/^https?:\/\//i.test(imagem_url))) {
        return res.status(400).json({ ok: false, erro: 'A imagem deve ser um endereço HTTP ou HTTPS.' });
      }
      const codigos = new Set();
      for (const c of componentes) {
        if (typeof c.codigo !== 'string' || !c.codigo.trim() || c.codigo.startsWith('kit:') ||
            !Number.isSafeInteger(c.quantidade) || c.quantidade < 1 || codigos.has(c.codigo)) {
          return res.status(400).json({ ok: false, erro: 'Componentes inválidos, repetidos ou com quantidade inválida.' });
        }
        codigos.add(c.codigo);
      }
      const { data: encontrados, error: erroProdutos } = await supabase.from('itens_sistema')
        .select('codigo').in('codigo', [...codigos]);
      if (erroProdutos) throw erroProdutos;
      if ((encontrados || []).length !== codigos.size) return res.status(400).json({ ok: false, erro: 'Um dos códigos não existe mais no cadastro de produtos.' });
      const registro = { nome: nome.trim(), grupo: grupo.trim(), imagem_url: imagem_url.trim(), minimo,
        componentes: componentes.map(c => ({ codigo: c.codigo, quantidade: c.quantidade })), atualizado_em: new Date().toISOString() };
      const consulta = id ? supabase.from('produtos_agrupados').update(registro).eq('id', id)
        : supabase.from('produtos_agrupados').insert(registro);
      const { data, error } = await consulta.select().single();
      if (error) throw error;
      res.json({ ok: true, produto: data });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });

  app.patch('/api/admin/produtos-agrupados/:id/ativo', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.id) || typeof req.body?.ativo !== 'boolean') return res.status(400).json({ ok: false, erro: 'Dados inválidos.' });
      const { data, error } = await supabase.from('produtos_agrupados').update({ ativo: req.body.ativo })
        .eq('id', req.params.id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, erro: 'Agrupado não encontrado.' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });
}

// Só acrescenta o campo em pedidos que usam o novo recurso.
export function composicaoPedido(body) {
  const composicao = body.composicao_agrupados;
  if (composicao == null) return {};
  if (composicao.versao !== 1 || !composicao.carrinho || Array.isArray(composicao.carrinho) || typeof composicao.carrinho !== 'object') throw new Error('Composição inválida.');
  const totais = new Map();
  for (const [codigo, item] of Object.entries(composicao.carrinho)) {
    if (!Number.isSafeInteger(item.qtd) || item.qtd <= 0) throw new Error('Quantidade inválida na composição.');
    if (codigo.startsWith('kit:')) {
      if (!item.kit || !Array.isArray(item.kit.componentes) || item.kit.componentes.length < 2 ||
          !Number.isSafeInteger(item.kit.minimo) || item.kit.minimo < 1 || item.qtd < item.kit.minimo) throw new Error('Agrupado inválido.');
      for (const c of item.kit.componentes) {
        if (typeof c.codigo !== 'string' || c.codigo.startsWith('kit:') || !Number.isSafeInteger(c.quantidade) || c.quantidade < 1) throw new Error('Componente inválido.');
        totais.set(c.codigo, (totais.get(c.codigo) || 0) + c.quantidade * item.qtd);
      }
    } else totais.set(codigo, (totais.get(codigo) || 0) + item.qtd);
  }
  if (!Array.isArray(body.itens) || body.itens.length !== totais.size || new Set(body.itens.map(i => String(i.codigo))).size !== totais.size ||
      body.itens.some(i => totais.get(String(i.codigo)) !== Number(i.qtd))) throw new Error('Os itens não correspondem à composição do carrinho.');
  return { composicao_agrupados: composicao };
}
