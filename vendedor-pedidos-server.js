import { createHash } from 'node:crypto';
import { criarCacheConsultas } from './cache-consultas.js';

async function todas(consulta) {
  const rows = [];
  for (let inicio = 0; ; inicio += 200) {
    const { data, error } = await consulta().range(inicio, inicio + 199);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 200) return rows;
  }
}
export function resumirPedidosVendedor(pedidos) {
  const rascunho = p => String(p.status || '').toUpperCase() === 'RASCUNHO';
  const finalizado = p => p.finalizado_vendedor === true && !rascunho(p);
  const soma = lista => lista.reduce((n, p) => n + (Number.isFinite(Number(p.total)) ? Math.round(Number(p.total) * 100) : 0), 0) / 100;
  const finalizados = pedidos.filter(finalizado), rascunhos = pedidos.filter(rascunho);
  return { finalizados: finalizados.length, rascunhos: rascunhos.length,
    pendentes: pedidos.length - finalizados.length - rascunhos.length,
    valor_finalizados: soma(finalizados), valor_rascunhos: soma(rascunhos),
    enviados: pedidos.filter(p => !rascunho(p)).length };
}
export function registrarLeituraPedidosVendedor(app, supabase, cache = criarCacheConsultas()) {
  app.get('/api/vendedor/:codigo/pedidos-resumo', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo) return res.status(400).json({ ok: false, erro: 'Informe o vendedor.' });
    try {
      const resumo = await cache.obter(`vendedor:${codigo}:resumo`, 30000, async () => {
        let pedidos;
        const ler = campos => todas(() => supabase.from('pedidos02').select(campos).eq('codigo_representante', codigo).order('id', { ascending: false }));
        try { pedidos = await ler('id,total,status,data_criacao,finalizado_vendedor,finalizado_vendedor_em'); }
        catch (error) {
          if (!['42703', 'PGRST204'].includes(error?.code)) throw error;
          pedidos = await ler('id,total,status,data_criacao');
        }
        const assinatura = createHash('sha256').update(JSON.stringify(pedidos)).digest('hex');
        return { assinatura, ...resumirPedidosVendedor(pedidos) };
      });
      res.json({ ok: true, resumo });
    } catch { res.status(500).json({ ok: false, erro: 'Nao foi possivel atualizar o resumo dos pedidos.' }); }
  });

  app.get('/api/vendedor/:codigo/pedidos', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const codigo = String(req.params.codigo || '').trim();
    try {
      const pedidos = await cache.obter(`vendedor:${codigo}:detalhes`, 15000, async () => {
        const cabecalhos = await todas(() => supabase.from('pedidos02').select('*').eq('codigo_representante', codigo).order('id', { ascending: false }));
        const itens = new Map(), clientes = new Map();
        const ids = cabecalhos.map(p => p.id), documentos = [...new Set(cabecalhos.map(p => p.cnpj_cliente).filter(Boolean))];
        for (let i = 0; i < ids.length; i += 100) {
          const lote = await todas(() => supabase.from('pedidos02_itens').select('*').in('pedido_id', ids.slice(i, i + 100)).order('pedido_id').order('codigo_produto'));
          for (const item of lote) { if (!itens.has(item.pedido_id)) itens.set(item.pedido_id, []); itens.get(item.pedido_id).push(item); }
        }
        for (let i = 0; i < documentos.length; i += 100) {
          const lote = await todas(() => supabase.from('clientes').select('cnpj,codigo,nome_fantasia,razao_social,uf').in('cnpj', documentos.slice(i, i + 100)).order('cnpj'));
          lote.forEach(c => clientes.set(c.cnpj, c));
        }
        return cabecalhos.map(p => {
          const cli = clientes.get(p.cnpj_cliente);
          return { ...p, itens: itens.get(p.id) || [], ...(cli ? {
            codigo_cliente: cli.codigo, nome_fantasia: cli.nome_fantasia, razao_social: cli.razao_social, uf: cli.uf
          } : {}) };
        });
      });
      res.json({ ok: true, pedidos });
    } catch { res.status(500).json({ ok: false, erro: 'Nao foi possivel carregar os pedidos.' }); }
  });
}
