(() => {
  const painel = document.getElementById('painelMetricasVendedor');
  if (!painel) return;
  const zona = 'America/Sao_Paulo';
  const hoje = () => new Intl.DateTimeFormat('sv-SE', { timeZone: zona }).format(new Date());
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const horario = (v, comData = false) => {
    if (!v || !Number.isFinite(Date.parse(v))) return 'Não informado';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: zona, ...(comData ? { day: '2-digit', month: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(v));
  };
  const nomes = { celular: 'Celular', computador: 'Computador', tablet: 'Tablet', nao_identificado: 'Não informado' };
  const el = id => painel.querySelector('#' + id);
  let vendedor = null, senha = '', dados = null, timer = null, versao = 0, emAndamento = null;
  let paginaAcessos = 0, paginaRascunhos = 0;
  painel.innerHTML = `<style>
    #painelMetricasVendedor .met-barra { display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between; }
    #painelMetricasVendedor .met-filtros { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    #painelMetricasVendedor input { padding:8px; border:1px solid #cbd5e1; border-radius:6px; }
    #painelMetricasVendedor .met-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin:16px 0; }
    #painelMetricasVendedor .met-item { padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-top:3px solid #0d3b66; border-radius:9px; }
    #painelMetricasVendedor .met-item h3 { font-size:.75rem; color:#475569; margin-bottom:8px; }
    #painelMetricasVendedor .met-item strong { display:block; font-size:1.35rem; color:#0d3b66; overflow-wrap:anywhere; }
    #painelMetricasVendedor small { display:block; font-size:.73rem; color:#64748b; line-height:1.6; margin-top:6px; }
    #painelMetricasVendedor .met-aparelhos { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
    #painelMetricasVendedor .met-aparelhos span { padding:6px 10px; background:#eff6ff; color:#1e40af; border-radius:7px; font-size:.75rem; }
    #painelMetricasVendedor details { margin-top:12px; border-top:1px solid #e2e8f0; padding-top:12px; }
    #painelMetricasVendedor summary { cursor:pointer; color:#0d3b66; font-weight:700; }
    #painelMetricasVendedor .met-tabela { overflow-x:auto; }
    #painelMetricasVendedor table { min-width:590px; }
    #painelMetricasVendedor .met-paginas { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; align-items:center; margin-top:10px; font-size:.8rem; }
    #painelMetricasVendedor .met-recente { color:#047857; font-weight:700; }
    @media(max-width:480px) { #painelMetricasVendedor .met-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } #painelMetricasVendedor .met-item { padding:10px; } #painelMetricasVendedor .met-item strong { font-size:1.1rem; } }
  </style>
  <div class="met-barra"><h2 style="margin:0;border:0;">Acompanhamento da minha carteira</h2><div class="met-filtros"><label for="met-data">Dia</label><input id="met-data" type="date"><button type="button" class="btn-toggle-detalhe" id="met-atualizar">Atualizar</button></div></div>
  <small>Acessos e envios no dia escolhido, em horário de Brasília. Rascunhos mostram o que está em aberto agora. Atualização automática a cada 2 minutos enquanto esta aba estiver visível.</small>
  <p id="met-status" role="status" aria-live="polite" style="font-size:.8rem;margin-top:10px;color:#475569;">Entre para consultar os indicadores.</p>
  <div class="met-grid">
    <div class="met-item"><h3>Clientes que acessaram no dia</h3><strong id="met-acessaram">—</strong><small id="met-carteira">Clientes distintos da sua carteira.</small></div>
    <div class="met-item"><h3>Clientes com rascunho</h3><strong id="met-clientes-rascunho">—</strong><small id="met-abertos">Rascunhos em aberto de qualquer data.</small></div>
    <div class="met-item"><h3>Montando pedido (15 min)</h3><strong id="met-recentes">—</strong><small>Clientes com rascunho alterado nos últimos 15 minutos. Não indica presença online.</small></div>
    <div class="met-item"><h3>Pedidos enviados no dia</h3><strong id="met-enviados">—</strong><small>Envios registrados pela tabela.</small></div>
    <div class="met-item"><h3>Valor enviado no dia</h3><strong id="met-valor-enviado">—</strong><small>Pedidos enviados, sem comprovação de faturamento.</small></div>
    <div class="met-item"><h3>Valor em rascunhos</h3><strong id="met-valor-rascunho">—</strong><small>Total em aberto, de qualquer data.</small></div>
  </div>
  <small>Acessos por tipo de aparelho no dia (cada acesso é contado):</small><div class="met-aparelhos" id="met-aparelhos"></div>
  <details><summary id="met-titulo-acessos">Clientes, horários e aparelhos</summary><small>O aparelho é o registrado no último acesso do cliente no dia escolhido. Registros antigos podem não ter essa informação.</small><div class="met-tabela"><table><thead><tr><th>Nº cliente</th><th>Cliente</th><th>Último acesso</th><th>Aparelho</th><th>Acessos no dia</th></tr></thead><tbody id="met-lista-acessos"></tbody></table></div><div class="met-paginas" id="met-paginas-acessos"></div></details>
  <details><summary id="met-titulo-rascunhos">Rascunhos em aberto e última alteração</summary><div class="met-tabela"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Última alteração</th><th>Atividade</th><th>Valor</th></tr></thead><tbody id="met-lista-rascunhos"></tbody></table></div><div class="met-paginas" id="met-paginas-rascunhos"></div></details>`;
  el('met-data').value = hoje();
  function paginacao(tipo, pagina, tamanho) {
    const paginas = Math.max(1, Math.ceil(tamanho / 10));
    el('met-paginas-' + tipo).innerHTML = `<button type="button" class="btn-toggle-detalhe" data-pagina="${tipo}" data-delta="-1" ${pagina === 0 ? 'disabled' : ''}>Anterior</button><span>${tamanho} registro(s) · ${pagina + 1} / ${paginas}</span><button type="button" class="btn-toggle-detalhe" data-pagina="${tipo}" data-delta="1" ${pagina >= paginas - 1 ? 'disabled' : ''}>Próxima</button>`;
  }
  function tabelas() {
    if (!dados) return;
    paginaAcessos = Math.max(0, Math.min(paginaAcessos, Math.ceil(dados.acessos.length / 10) - 1));
    paginaRascunhos = Math.max(0, Math.min(paginaRascunhos, Math.ceil(dados.rascunhos.length / 10) - 1));
    el('met-titulo-acessos').textContent = `Clientes, horários e aparelhos (${dados.acessos.length})`;
    el('met-titulo-rascunhos').textContent = `Rascunhos em aberto e última alteração (${dados.rascunhos.length})`;
    el('met-lista-acessos').innerHTML = dados.acessos.slice(paginaAcessos * 10, paginaAcessos * 10 + 10).map(c => `<tr><td>${esc(c.codigo_cliente || '—')}</td><td>${esc(c.nome_cliente)} <span class="badge-uf">${esc(c.uf)}</span></td><td>${esc(horario(c.ultimo_acesso))}</td><td>${esc(nomes[c.dispositivo] || nomes.nao_identificado)}</td><td>${esc(c.quantidade_acessos)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum cliente da carteira acessou neste dia.</td></tr>';
    el('met-lista-rascunhos').innerHTML = dados.rascunhos.slice(paginaRascunhos * 10, paginaRascunhos * 10 + 10).map(p => `<tr><td>#${esc(p.id)}</td><td>${esc(p.codigo_cliente || '—')} — ${esc(p.nome_cliente)}</td><td>${esc(horario(p.ultima_alteracao, true))}</td><td class="${p.alterado_recentemente ? 'met-recente' : ''}">${p.alterado_recentemente ? 'Alterado nos últimos 15 min' : 'Em aberto'}</td><td>${esc(moeda(p.total))}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum rascunho em aberto na carteira.</td></tr>';
    paginacao('acessos', paginaAcessos, dados.acessos.length); paginacao('rascunhos', paginaRascunhos, dados.rascunhos.length);
  }
  function renderizar() {
    const campos = { 'met-acessaram': dados.clientes_acessaram, 'met-clientes-rascunho': dados.clientes_com_rascunho,
      'met-recentes': dados.clientes_rascunho_recente, 'met-enviados': dados.pedidos_enviados,
      'met-valor-enviado': moeda(dados.valor_enviado), 'met-valor-rascunho': moeda(dados.valor_rascunhos) };
    Object.entries(campos).forEach(([id, valor]) => { el(id).textContent = valor; });
    el('met-carteira').textContent = `${dados.clientes_acessaram} de ${dados.total_clientes} clientes da carteira · ${dados.total_acessos} acesso(s).`;
    el('met-abertos').textContent = `${dados.quantidade_rascunhos} rascunho(s) em aberto, de qualquer data.`;
    el('met-aparelhos').innerHTML = Object.entries(nomes).map(([id, nome]) => `<span>${nome}: <strong>${Number(dados.dispositivos[id]) || 0}</strong></span>`).join('');
    tabelas();
  }
  function atualizar() {
    if (!vendedor || document.hidden) return Promise.resolve();
    if (emAndamento) return emAndamento;
    const atual = ++versao, data = el('met-data').value;
    el('met-atualizar').disabled = true; el('met-data').disabled = true;
    el('met-status').textContent = 'Atualizando indicadores…';
    emAndamento = (async () => {
      try {
        const resposta = await fetch(`/api/vendedor/${encodeURIComponent(vendedor.codigo)}/metricas?data=${encodeURIComponent(data)}`, { cache: 'no-store', headers: { 'x-vendedor-senha': senha } });
        const j = await resposta.json();
        if (atual !== versao) return;
        if (!resposta.ok || !j.ok) throw new Error(j.erro || 'Falha ao atualizar os indicadores.');
        dados = j.metricas; renderizar();
        el('met-status').textContent = `Atualizado às ${horario(dados.atualizado_em)} · Brasília.`;
      } catch (e) {
        if (atual === versao) el('met-status').textContent = `${e.message} ${dados ? `Mantidos os dados de ${dados.data}, atualizados às ${horario(dados.atualizado_em)}.` : 'Use Atualizar para tentar novamente.'}`;
      } finally {
        if (atual === versao) { emAndamento = null; el('met-atualizar').disabled = false; el('met-data').disabled = false; }
      }
    })();
    return emAndamento;
  }
  el('met-atualizar').addEventListener('click', atualizar);
  el('met-data').addEventListener('change', () => { paginaAcessos = 0; paginaRascunhos = 0; atualizar(); });
  painel.addEventListener('click', e => {
    const botao = e.target.closest('[data-pagina]');
    if (!botao || botao.disabled || !dados) return;
    if (botao.dataset.pagina === 'acessos') paginaAcessos += Number(botao.dataset.delta);
    else paginaRascunhos += Number(botao.dataset.delta);
    tabelas();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
  window.painelVendedorMetricas = {
    iniciar(usuario, credencial) {
      vendedor = usuario; senha = credencial;
      if (timer) clearInterval(timer);
      timer = setInterval(atualizar, 120000);
      return atualizar();
    }, atualizar
  };
})();
