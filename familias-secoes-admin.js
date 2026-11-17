(() => {
  const painel = document.getElementById('secoes-visuais-familias');
  if (!painel || !window.CatalogoSecoes) return;
  const { lista, grupo: normalizarGrupo } = window.CatalogoSecoes;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const copiar = c => ({ grupo: c.grupo, ativo: !!c.ativo, secoes: lista(c.secoes).map(s => ({ id: String(s.id), nome: String(s.nome), familias: lista(s.familias).map(String) })) });
  let familias = [], grupo = '', configuracoes = new Map(), base, rascunho;
  let selecionadas = new Set(), salvando = false, configurado = false, requisicao = 0;
  const el = id => painel.querySelector('#' + id);
  const alterado = () => !!rascunho && JSON.stringify(rascunho) !== JSON.stringify(base);
  const membros = () => familias.filter(f => f.grupo === grupo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  painel.innerHTML = `<style>
    #secoes-visuais-familias .sec-barra { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:12px 0; }
    #secoes-visuais-familias input:not([type="checkbox"]), #secoes-visuais-familias select { padding:9px; border:1px solid #475569; border-radius:6px; background:#0f172a; color:#e2e8f0; max-width:100%; }
    #secoes-visuais-familias button { min-height:36px; }
    #secoes-visuais-familias button:disabled { opacity:.45; }
    #secoes-visuais-familias .sec-card { border:1px solid #475569; border-left:4px solid #38bdf8; padding:12px; border-radius:8px; margin:8px 0; background:#0f172a; }
    #secoes-visuais-familias .sec-familias { max-height:370px; overflow:auto; border:1px solid #334155; border-radius:8px; }
    #secoes-visuais-familias .sec-familia { display:flex; align-items:center; gap:10px; padding:10px; margin:0; border-bottom:1px solid #334155; cursor:pointer; }
    #secoes-visuais-familias .sec-familia input { flex-shrink:0; width:18px; height:18px; }
    #secoes-visuais-familias small { display:block; color:#94a3b8; line-height:1.6; }
  </style>
  <h2>Seções com título no catálogo</h2>
  <p style="color:#94a3b8;line-height:1.6;">Exemplo: Perfil baixo e Carretilhas para pesqueiro. Selecione as famílias, dê um nome à seção e salve. Cada família mantém sua seção mesmo quando muda de posição.</p>
  <div class="sec-barra"><label for="sec-grupo">Grupo</label><select id="sec-grupo"></select><label style="display:flex;gap:8px;align-items:center;"><input id="sec-ativo" type="checkbox"> Exibir seções no catálogo</label></div>
  <p id="sec-mensagem" role="status" aria-live="polite" style="color:#38bdf8;line-height:1.6;"></p>
  <h3 style="margin-top:12px;">Seções na ordem de exibição</h3><div id="sec-lista"></div>
  <h3 style="margin:16px 0 8px;">Escolher famílias</h3>
  <small>Os números abaixo são as posições salvas na ordenação acima.</small>
  <div class="sec-barra"><label for="sec-de">Da posição</label><input id="sec-de" type="number" min="1" step="1" value="1" style="width:75px;"><label for="sec-ate">até</label><input id="sec-ate" type="number" min="1" step="1" value="1" style="width:75px;"><button type="button" class="btn-refresh" id="sec-faixa">Selecionar faixa</button></div>
  <div class="sec-barra"><button type="button" class="btn-refresh" id="sec-todas">Selecionar todas</button><button type="button" class="btn-refresh" id="sec-limpar">Limpar seleção</button><span id="sec-contagem"></span></div>
  <div id="sec-familias" class="sec-familias"></div>
  <div class="sec-barra"><label for="sec-nome">Nova seção</label><input id="sec-nome" maxlength="100" placeholder="Ex.: Perfil baixo"><button type="button" class="btn-primario" id="sec-criar">Criar com selecionadas</button></div>
  <div class="sec-barra"><label for="sec-destino">Mover selecionadas para</label><select id="sec-destino"></select><button type="button" class="btn-refresh" id="sec-mover">Aplicar seção</button><button type="button" class="btn-refresh" id="sec-desvincular">Deixar sem seção</button></div>
  <div class="sec-barra"><button type="button" class="btn-primario" id="sec-salvar">Salvar seções</button><button type="button" class="btn-refresh" id="sec-descartar">Descartar alterações</button></div>
  <small>Para voltar ao visual anterior, desmarque “Exibir seções no catálogo” e salve. Os cadastros e a ordem das famílias serão preservados.</small>`;

  function mensagem(t) { el('sec-mensagem').textContent = t; }
  function controles() {
    const bloqueado = salvando || !configurado || !grupo;
    painel.querySelectorAll('button,input,select').forEach(e => { e.disabled = bloqueado; });
    el('sec-salvar').disabled = bloqueado || !alterado();
    el('sec-descartar').disabled = salvando || !alterado();
    for (const id of ['sec-criar', 'sec-mover', 'sec-desvincular']) el(id).disabled = bloqueado || !selecionadas.size || (id === 'sec-mover' && !rascunho?.secoes.length);
    el('sec-contagem').textContent = `${selecionadas.size} selecionada(s)`;
    const cards = el('sec-lista').querySelectorAll('[data-secao]');
    cards.forEach((card, i) => {
      card.querySelector('[data-subir]').disabled = bloqueado || i === 0;
      card.querySelector('[data-descer]').disabled = bloqueado || i === cards.length - 1;
    });
  }
  function desenhar() {
    if (!rascunho) return;
    const atuais = membros();
    const porId = new Map(familias.map(f => [f.id, f]));
    el('sec-ativo').checked = rascunho.ativo;
    el('sec-lista').innerHTML = rascunho.secoes.map((s, i) => `<div class="sec-card" data-secao="${esc(s.id)}">
      <div class="sec-barra"><strong>${i + 1}.</strong><input data-renomear value="${esc(s.nome)}" maxlength="100" aria-label="Nome da seção ${esc(s.nome)}"><button type="button" class="btn-refresh" data-subir ${i === 0 ? 'disabled' : ''} aria-label="Subir seção">↑</button><button type="button" class="btn-refresh" data-descer ${i === rascunho.secoes.length - 1 ? 'disabled' : ''} aria-label="Descer seção">↓</button><button type="button" class="btn-refresh" data-remover>Remover seção</button></div>
      <small>${s.familias.length} família(s): ${s.familias.map(id => esc(porId.get(id)?.nome || `Família ${id} indisponível`)).join(' · ')}</small></div>`).join('') || '<p style="color:#94a3b8;padding:12px 0;">Nenhuma seção criada. A exibição atual é mantida.</p>';
    el('sec-familias').innerHTML = atuais.map((f, i) => {
      const secao = rascunho.secoes.find(s => s.familias.includes(f.id));
      return `<label class="sec-familia"><input type="checkbox" data-familia="${esc(f.id)}" ${selecionadas.has(f.id) ? 'checked' : ''}><span><strong style="color:#38bdf8;">${i + 1}.</strong> ${esc(f.nome)}<small>${esc(secao?.nome || 'Sem seção')}</small></span></label>`;
    }).join('');
    el('sec-destino').innerHTML = rascunho.secoes.map(s => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');
    controles();
  }
  function escolherGrupo() {
    const dados = configuracoes.get(grupo) || { grupo, ativo: true, secoes: [] };
    base = copiar(dados); rascunho = copiar(dados); selecionadas.clear(); el('sec-nome').value = '';
    desenhar();
    mensagem(configurado ? 'Selecione famílias para criar ou alterar uma seção. As mudanças precisam ser salvas.' : 'Seções ainda não habilitadas no banco. Execute o arquivo familias-secoes.sql antes de salvar.');
  }
  function aplicar(destino) {
    if (salvando || !configurado || !selecionadas.size) return;
    rascunho.secoes.forEach(s => { s.familias = s.familias.filter(id => !selecionadas.has(id)); });
    if (destino) destino.familias.push(...membros().filter(f => selecionadas.has(f.id)).map(f => f.id));
    rascunho.secoes = rascunho.secoes.filter(s => s.familias.length);
    selecionadas.clear(); desenhar(); mensagem('Prévia alterada. Clique em Salvar seções para publicar.');
  }
  el('sec-familias').addEventListener('change', e => {
    const campo = e.target.closest('[data-familia]');
    if (!campo || salvando || !configurado) return;
    if (campo.checked) selecionadas.add(campo.dataset.familia); else selecionadas.delete(campo.dataset.familia);
    controles();
  });
  el('sec-todas').addEventListener('click', () => { membros().forEach(f => selecionadas.add(f.id)); desenhar(); });
  el('sec-limpar').addEventListener('click', () => { selecionadas.clear(); desenhar(); });
  el('sec-faixa').addEventListener('click', () => {
    if (salvando || !configurado) return;
    const de = Number(el('sec-de').value), ate = Number(el('sec-ate').value), atuais = membros();
    if (!Number.isSafeInteger(de) || !Number.isSafeInteger(ate) || de < 1 || ate < de || ate > atuais.length) {
      mensagem(`Informe uma faixa de posições entre 1 e ${atuais.length}.`); return;
    }
    selecionadas = new Set(atuais.slice(de - 1, ate).map(f => f.id));
    desenhar(); mensagem(`${selecionadas.size} família(s) selecionada(s). Informe o nome da seção ou escolha uma existente.`);
  });
  el('sec-criar').addEventListener('click', () => {
    if (salvando || !configurado || !selecionadas.size) return;
    const nome = el('sec-nome').value.trim();
    if (!nome || nome.length > 100) { mensagem('Informe o nome da nova seção, com até 100 caracteres.'); return; }
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const nova = { id, nome, familias: [] };
    rascunho.secoes.push(nova); aplicar(nova); el('sec-nome').value = '';
  });
  el('sec-mover').addEventListener('click', () => aplicar(rascunho.secoes.find(s => s.id === el('sec-destino').value)));
  el('sec-desvincular').addEventListener('click', () => aplicar(null));
  el('sec-lista').addEventListener('change', e => {
    const campo = e.target.closest('[data-renomear]');
    if (!campo || salvando || !configurado) return;
    const s = rascunho.secoes.find(s => s.id === campo.closest('[data-secao]').dataset.secao);
    const nome = campo.value.trim();
    if (!nome || nome.length > 100) { campo.value = s.nome; mensagem('Informe um nome de até 100 caracteres.'); return; }
    s.nome = nome; desenhar(); mensagem('Nome alterado na prévia. Clique em Salvar seções.');
  });
  el('sec-lista').addEventListener('click', e => {
    if (salvando || !configurado) return;
    const botao = e.target.closest('[data-subir],[data-descer],[data-remover]');
    if (!botao || botao.disabled) return;
    const id = botao.closest('[data-secao]').dataset.secao, i = rascunho.secoes.findIndex(s => s.id === id);
    if (botao.hasAttribute('data-remover')) rascunho.secoes.splice(i, 1);
    else {
      const destino = i + (botao.hasAttribute('data-subir') ? -1 : 1);
      if (destino < 0 || destino >= rascunho.secoes.length) return;
      rascunho.secoes.splice(destino, 0, rascunho.secoes.splice(i, 1)[0]);
    }
    desenhar(); mensagem('Prévia alterada. Os cadastros das famílias permanecem iguais. Salve para publicar.');
  });
  el('sec-ativo').addEventListener('change', () => { if (rascunho && !salvando) { rascunho.ativo = el('sec-ativo').checked; controles(); } });
  el('sec-grupo').addEventListener('change', () => {
    if (alterado() && !confirm('Descartar as alterações de seções ainda não salvas?')) { el('sec-grupo').value = grupo; return; }
    grupo = el('sec-grupo').value; escolherGrupo();
  });
  el('sec-descartar').addEventListener('click', () => { if (!salvando) escolherGrupo(); });
  el('sec-salvar').addEventListener('click', async () => {
    if (salvando || !configurado || !alterado()) return;
    salvando = true; controles(); mensagem('Salvando as seções deste grupo…');
    try {
      const resposta = await fetch('/api/admin/secoes-familias', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rascunho) });
      const dados = await resposta.json();
      if (!resposta.ok || !dados.ok || !dados.configuracao || JSON.stringify(copiar(dados.configuracao)) !== JSON.stringify(rascunho)) throw new Error(dados.erro || 'O banco não confirmou a configuração solicitada.');
      configuracoes.set(grupo, copiar(dados.configuracao)); base = copiar(dados.configuracao);
      try { localStorage.setItem('catalogo_familias_ordem_atualizada', String(Date.now())); } catch {}
      mensagem(rascunho.ativo ? 'Seções salvas! Atualize ou volte à aba do catálogo para conferir.' : 'Seções ocultas. O catálogo volta a usar somente a ordem das famílias.');
    } catch (e) { mensagem(`Não foi possível confirmar o salvamento: ${e.message} A prévia foi mantida para tentar novamente.`); }
    finally { salvando = false; desenhar(); }
  });
  window.addEventListener('beforeunload', e => { if (alterado() || salvando) { e.preventDefault(); e.returnValue = ''; } });
  window.secoesFamilias = {
    async atualizar(cadastros, produtos) {
      if (salvando || alterado()) return;
      const atual = ++requisicao;
      const porCodigo = new Map(produtos.map(p => [String(p.codigo).trim(), p]));
      familias = cadastros.map(f => {
        const primeiro = lista(f.subgrupos || f.itens).map(c => porCodigo.get(String(c).trim())).find(Boolean);
        const n = Number(f.ordem);
        return { id: String(f.id), nome: String(f.nome || ''), ordem: f.ordem == null || f.ordem === '' || !Number.isFinite(n) ? 9999 : n, grupo: normalizarGrupo(primeiro?.grupo_scraping || primeiro?.grupo || f.grupo || 'OUTROS') };
      });
      mensagem('Carregando seções…');
      try {
        const dados = await window.CatalogoSecoes.carregar();
        if (atual !== requisicao || alterado() || salvando) return;
        configurado = dados.configurado === true;
        configuracoes = new Map(dados.grupos.map(c => [c.grupo, copiar(c)]));
        const grupos = [...new Set(familias.map(f => f.grupo))].sort();
        if (!grupos.includes(grupo)) grupo = grupos[0] || '';
        el('sec-grupo').innerHTML = grupos.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
        el('sec-grupo').value = grupo; escolherGrupo();
      } catch (e) { configurado = false; controles(); mensagem(`Não foi possível carregar as seções: ${e.message}`); }
    }
  };
  controles();
})();
