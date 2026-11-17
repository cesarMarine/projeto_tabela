const zona = 'America/Sao_Paulo';
const documento = v => String(v || '').replace(/\D/g, '');
const tipos = ['celular', 'computador', 'tablet', 'nao_identificado'];
export const dataBrasilia = agora => new Intl.DateTimeFormat('sv-SE', { timeZone: zona }).format(agora);

export function limitesDiaBrasilia(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida.');
  const [ano, mes, dia] = data.split('-').map(Number);
  const alvo = Date.UTC(ano, mes - 1, dia);
  if (new Date(alvo).toISOString().slice(0, 10) !== data) throw new Error('Data inválida.');
  const formato = new Intl.DateTimeFormat('en-CA', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const meiaNoite = referencia => {
    let valor = referencia;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(formato.formatToParts(new Date(valor)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
      valor += referencia - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    }
    return new Date(valor).toISOString();
  };
  return { inicio: meiaNoite(alvo), fim: meiaNoite(alvo + 86400000) };
}

export function resumirMetricas({ clientes, pedidos, logins, data, agora = new Date() }) {
  const { inicio, fim } = limitesDiaBrasilia(data);
  const desde = Date.parse(inicio), ate = Date.parse(fim), instante = agora.getTime();
  const carteira = new Map(clientes.map(c => [documento(c.cnpj), c]).filter(([id]) => id));
  const identidade = id => {
    const c = carteira.get(id) || {};
    return { codigo_cliente: c.codigo || '', nome_cliente: c.nome_fantasia || c.razao_social || 'Cliente sem nome', uf: c.uf || '' };
  };
  const centavos = valor => { const n = Number(valor); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  const proprios = pedidos.filter(p => carteira.has(documento(p.cnpj_cliente)));
  const rascunhos = proprios.filter(p => String(p.status || '').trim().toUpperCase() === 'RASCUNHO');
  const enviados = proprios.filter(p => String(p.status || '').trim().toUpperCase() === 'ENVIADO' && Date.parse(p.data_criacao) >= desde && Date.parse(p.data_criacao) < ate);
  const recentes = rascunhos.filter(p => Date.parse(p.data_criacao) >= instante - 15 * 60000 && Date.parse(p.data_criacao) <= instante);
  const acessos = new Map(), dispositivos = Object.fromEntries(tipos.map(t => [t, 0]));
  for (const l of logins) {
    const id = documento(l.cnpj), quando = Date.parse(l.data_login);
    if (!carteira.has(id) || !(quando >= desde && quando < ate)) continue;
    const dispositivo = tipos.includes(l.dispositivo) ? l.dispositivo : 'nao_identificado';
    dispositivos[dispositivo]++;
    let c = acessos.get(id);
    if (!c) { c = { ...identidade(id), quantidade_acessos: 0, ultimo_acesso: null, dispositivo: 'nao_identificado' }; acessos.set(id, c); }
    c.quantidade_acessos++;
    if (!c.ultimo_acesso || quando > Date.parse(c.ultimo_acesso)) { c.ultimo_acesso = l.data_login; c.dispositivo = dispositivo; }
  }
  const abertos = rascunhos.map(p => ({ ...identidade(documento(p.cnpj_cliente)), id: p.id,
    total: centavos(p.total) / 100, ultima_alteracao: p.data_criacao || null,
    alterado_recentemente: recentes.includes(p) })).sort((a, b) => (Date.parse(b.ultima_alteracao) || 0) - (Date.parse(a.ultima_alteracao) || 0));
  return { data, atualizado_em: agora.toISOString(), fuso: zona, janela_minutos: 15,
    total_clientes: carteira.size, clientes_acessaram: acessos.size,
    total_acessos: Object.values(dispositivos).reduce((a, b) => a + b, 0),
    clientes_com_rascunho: new Set(rascunhos.map(p => documento(p.cnpj_cliente))).size,
    clientes_rascunho_recente: new Set(recentes.map(p => documento(p.cnpj_cliente))).size,
    pedidos_enviados: enviados.length, valor_enviado: enviados.reduce((s, p) => s + centavos(p.total), 0) / 100,
    quantidade_rascunhos: rascunhos.length, valor_rascunhos: rascunhos.reduce((s, p) => s + centavos(p.total), 0) / 100,
    dispositivos, acessos: [...acessos.values()].sort((a, b) => Date.parse(b.ultimo_acesso) - Date.parse(a.ultimo_acesso)), rascunhos: abertos };
}

async function paginar(criarConsulta) {
  const linhas = [];
  for (let inicio = 0; ; inicio += 200) {
    const { data, error } = await criarConsulta().range(inicio, inicio + 199);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < 200) return linhas;
  }
}

export function registrarMetricasVendedor(app, supabase, relogio = () => new Date()) {
  app.get('/api/vendedor/:codigo/metricas', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const codigo = String(req.params.codigo || '').trim(), senha = req.get('x-vendedor-senha');
    if (!codigo || !senha) return res.status(401).json({ ok: false, erro: 'Entre novamente com código e senha.' });
    const agora = relogio(), data = req.query.data || dataBrasilia(agora);
    let limites;
    try { limites = limitesDiaBrasilia(data); }
    catch { return res.status(400).json({ ok: false, erro: 'Escolha uma data válida.' }); }
    try {
      const { data: vendedor, error: erroVendedor } = await supabase.from('vendedores').select('id').eq('codigo_representante', codigo).eq('ativo', 1).single();
      if (erroVendedor || !vendedor) return res.status(401).json({ ok: false, erro: 'Acesso inválido.' });
      const { data: acesso, error: erroAcesso } = await supabase.from('vendedores_acesso').select('senha').eq('vendedor_id', vendedor.id).single();
      if (erroAcesso || !acesso || acesso.senha !== senha) return res.status(401).json({ ok: false, erro: 'Acesso inválido.' });

      const clientes = await paginar(() => supabase.from('clientes').select('codigo,cnpj,nome_fantasia,razao_social,uf').eq('codigo_representante', codigo).order('cnpj'));
      const pedidos = clientes.length ? await paginar(() => supabase.from('pedidos02').select('id,cnpj_cliente,total,status,data_criacao').eq('codigo_representante', codigo).order('id')) : [];
      const documentos = [...new Set(clientes.map(c => documento(c.cnpj)).filter(Boolean))];
      let logins = [], aparelhoDisponivel = true;
      const consultarLogins = async comDispositivo => {
        const resultado = [];
        for (let i = 0; i < documentos.length; i += 100) {
          resultado.push(...await paginar(() => supabase.from('logins_clientes')
            .select(comDispositivo ? 'cnpj,data_login,dispositivo' : 'cnpj,data_login')
            .in('cnpj', documentos.slice(i, i + 100)).gte('data_login', limites.inicio).lt('data_login', limites.fim)
            .order('data_login', { ascending: false }).order('cnpj')));
        }
        return resultado;
      };
      try { logins = await consultarLogins(true); }
      catch (e) {
        if (!['42703', 'PGRST204'].includes(e?.code)) throw e;
        aparelhoDisponivel = false; logins = await consultarLogins(false);
      }
      res.json({ ok: true, metricas: { ...resumirMetricas({ clientes, pedidos, logins, data, agora }), aparelho_disponivel: aparelhoDisponivel } });
    } catch { res.status(500).json({ ok: false, erro: 'Não foi possível carregar os indicadores. Tente novamente.' }); }
  });
}
