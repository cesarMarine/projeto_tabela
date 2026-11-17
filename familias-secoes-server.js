const tabela = 'catalogo_secoes_familias';
const faltando = erro => ['42P01', 'PGRST205'].includes(erro?.code);

export function validarSecoes(body) {
  const grupo = String(body?.grupo || '').trim().toUpperCase();
  if (!grupo || grupo.length > 100 || typeof body?.ativo !== 'boolean' || !Array.isArray(body?.secoes) || body.secoes.length > 100) {
    throw new Error('Informe o grupo, a exibição e uma lista válida de seções.');
  }
  const ids = new Set(), familias = new Set();
  const secoes = body.secoes.map(s => {
    const id = String(s?.id || '');
    const nome = String(s?.nome || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) || !nome || nome.length > 100 || !Array.isArray(s.familias) || !s.familias.length) {
      throw new Error('Cada seção precisa de identificador único, nome de até 100 caracteres e famílias.');
    }
    ids.add(id);
    const membros = s.familias.map(valor => {
      const chave = String(valor);
      if (!/^\d+$/.test(chave) || familias.has(chave)) throw new Error('Cada família pode pertencer a apenas uma seção neste grupo.');
      familias.add(chave);
      return chave;
    });
    return { id, nome, familias: membros };
  });
  if (familias.size > 2000) throw new Error('Limite de 2000 famílias por grupo.');
  return { grupo, ativo: body.ativo, secoes };
}

export function registrarSecoesFamilias(app, supabase) {
  app.get('/api/catalogo/secoes-familias', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { data, error } = await supabase.from(tabela).select('grupo,ativo,secoes').order('grupo');
      if (faltando(error)) return res.json({ ok: true, configurado: false, grupos: [] });
      if (error) throw error;
      return res.json({ ok: true, configurado: true, grupos: data || [] });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });
  app.put('/api/admin/secoes-familias', async (req, res) => {
    let configuracao;
    try { configuracao = validarSecoes(req.body); }
    catch (e) { return res.status(400).json({ ok: false, erro: e.message }); }
    try {
      const ids = configuracao.secoes.flatMap(s => s.familias);
      // Valide todos os cadastros antes de salvar a configuracao inteira de uma vez.
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        const { data, error } = await supabase.from('catalogo_familias').select('id').in('id', lote);
        if (error) throw error;
        const encontrados = new Set((data || []).map(f => String(f.id)));
        if (lote.some(id => !encontrados.has(id))) return res.status(409).json({ ok: false, erro: 'Uma família foi removida. Atualize os cadastros antes de salvar.' });
      }
      const { data, error } = await supabase.from(tabela)
        .upsert({ ...configuracao, atualizado_em: new Date().toISOString() }, { onConflict: 'grupo' })
        .select('grupo,ativo,secoes').single();
      if (faltando(error)) return res.status(503).json({ ok: false, erro: 'Execute familias-secoes.sql para habilitar as seções.' });
      if (error) throw error;
      if (!data) throw new Error('O banco não confirmou a configuração.');
      res.json({ ok: true, configuracao: data });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });
}
