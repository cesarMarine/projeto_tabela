(() => {
  const painel = document.getElementById('ordenacao-visual-familias');
  if (!painel) return;
  const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const listaJson = v => {
    for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const ordem = f => f.ordem !== undefined && f.ordem !== null && f.ordem !== '' && Number.isFinite(Number(f.ordem)) ? Number(f.ordem) : 9999;
  const comparar = (a, b) => ordem(a) - ordem(b) || String(a.nome || '').localeCompare(String(b.nome || ''));
  let familias = [], grupo = '', sequencia = [], original = [], salvando = false, arrastando = null, gravacaoPendente = false;
  const alterado = () => gravacaoPendente || JSON.stringify(sequencia) !== JSON.stringify(original);
  const el = id => painel.querySelector('#' + id);
  painel.innerHTML = `<style>
    #ordenacao-visual-familias .ordem-barra { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:14px 0; }
    #ordenacao-visual-familias select { max-width:100%; min-width:180px; padding:10px; color:#e2e8f0; background:#0f172a; border:1px solid #475569; border-radius:6px; }
    #ordenacao-visual-familias .ordem-lista { display:grid; gap:8px; list-style:none; padding:0; margin:14px 0; }
    #ordenacao-visual-familias .ordem-linha { display:flex; align-items:center; gap:10px; padding:12px; background:#0f172a; border:1px solid #334155; border-radius:9px; }
    #ordenacao-visual-familias .ordem-linha.arrastando { opacity:.45; }
    #ordenacao-visual-familias .ordem-linha.destino { outline:2px solid #38bdf8; }
    #ordenacao-visual-familias .ordem-foto { width:46px; height:46px; flex-shrink:0; object-fit:contain; background:white; border-radius:6px; }
    #ordenacao-visual-familias .ordem-nome { flex:1; min-width:0; overflow-wrap:anywhere; }
    #ordenacao-visual-familias .ordem-nome small { display:block; color:#94a3b8; margin-top:4px; }
    #ordenacao-visual-familias .ordem-posicao { min-width:24px; font-weight:800; color:#38bdf8; }
    #ordenacao-visual-familias .ordem-pega { cursor:grab; color:#94a3b8; font-size:20px; padding:4px; }
    #ordenacao-visual-familias .ordem-setas { display:flex; gap:4px; }
    #ordenacao-visual-familias button { min-height:36px; }
    #ordenacao-visual-familias button:disabled { opacity:.45; cursor:default; }
    @media(max-width:600px) {
      #ordenacao-visual-familias .ordem-linha { gap:6px; padding:8px; }
      #ordenacao-visual-familias .ordem-foto { width:34px; height:34px; }
      #ordenacao-visual-familias .ordem-setas { flex-direction:column; }
    }
  </style>
  <h2>Organizar a exibição das famílias</h2>
  <p style="color:#94a3b8;line-height:1.6;">Escolha o grupo. Arraste pelo ☰ ou use ↑ ↓. A primeira família da lista aparece antes das demais no catálogo.</p>
  <div class="ordem-barra"><label for="ordem-grupo">Grupo</label><select id="ordem-grupo" aria-label="Grupo de famílias"></select></div>
  <p id="ordem-mensagem" role="status" aria-live="polite" style="color:#38bdf8;line-height:1.6;"></p>
  <ol id="ordem-lista" class="ordem-lista" aria-label="Sequência das famílias"></ol>
  <div class="ordem-barra"><button type="button" class="btn-primario" id="ordem-salvar">Salvar ordem</button><button type="button" class="btn-refresh" id="ordem-descartar">Descartar alterações</button></div>
  <small style="color:#94a3b8;">Aqui você organiza as famílias. A ordem dos modelos dentro delas e a posição dos kits continuam nos controles próprios. Famílias sem saldo também aparecem nesta lista para você organizá-las.</small>`;

  function mensagem(texto) { el('ordem-mensagem').textContent = texto; }
  function controles() {
    el('ordem-grupo').disabled = salvando || !familias.length;
    el('ordem-salvar').disabled = salvando || !alterado();
    el('ordem-descartar').disabled = salvando || !alterado();
  }
  function desenhar() {
    const linhas = sequencia.map(id => familias.find(f => f.id === id));
    el('ordem-lista').innerHTML = linhas.map((f, i) => `<li class="ordem-linha" data-familia="${escapar(f.id)}">
      <span class="ordem-pega" draggable="${!salvando}" title="Arraste para mudar a posição" aria-hidden="true">☰</span>
      <span class="ordem-posicao">${i + 1}</span>
      ${f.foto ? `<img class="ordem-foto" src="${escapar(f.foto)}" alt="" loading="lazy">` : '<span class="ordem-foto" aria-hidden="true" style="display:grid;place-items:center;">📦</span>'}
      <span class="ordem-nome"><strong>${escapar(f.nome)}</strong><small>${f.quantidade} produto(s) · ${f.estoque} em estoque</small></span>
      <span class="ordem-setas"><button type="button" class="btn-refresh" data-mover="-1" aria-label="Subir ${escapar(f.nome)}" ${salvando || i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="btn-refresh" data-mover="1" aria-label="Descer ${escapar(f.nome)}" ${salvando || i === linhas.length - 1 ? 'disabled' : ''}>↓</button></span>
    </li>`).join('');
    controles();
  }
  function selecionarGrupo() {
    gravacaoPendente = false;
    sequencia = familias.filter(f => f.grupo === grupo).sort(comparar).map(f => f.id);
    original = [...sequencia];
    mensagem(sequencia.length ? 'Sequência salva. As mudanças só são publicadas ao clicar em Salvar ordem.' : 'Nenhuma família cadastrada.');
    desenhar();
  }
  function mover(id, destino) {
    if (salvando) return;
    const origem = sequencia.indexOf(id);
    if (origem < 0 || destino < 0 || destino >= sequencia.length || origem === destino) return;
    sequencia.splice(destino, 0, sequencia.splice(origem, 1)[0]);
    desenhar();
    mensagem('Prévia alterada. Clique em Salvar ordem para publicar no catálogo.');
  }
  el('ordem-grupo').addEventListener('change', () => {
    if (alterado() && !confirm('Descartar a ordem ainda não salva deste grupo?')) { el('ordem-grupo').value = grupo; return; }
    grupo = el('ordem-grupo').value;
    selecionarGrupo();
  });
  el('ordem-lista').addEventListener('click', e => {
    const botao = e.target.closest('[data-mover]');
    if (!botao || botao.disabled) return;
    const id = botao.closest('[data-familia]').dataset.familia;
    mover(id, sequencia.indexOf(id) + Number(botao.dataset.mover));
    el('ordem-lista').querySelector(`[data-familia="${id}"] [data-mover="${botao.dataset.mover}"]`)?.focus();
  });
  el('ordem-lista').addEventListener('dragstart', e => {
    if (salvando || !e.target.closest('.ordem-pega')) { e.preventDefault(); return; }
    const linha = e.target.closest('[data-familia]');
    arrastando = linha.dataset.familia;
    e.dataTransfer.setData('text/plain', arrastando);
    e.dataTransfer.effectAllowed = 'move';
    linha.classList.add('arrastando');
  });
  el('ordem-lista').addEventListener('dragover', e => {
    if (!arrastando || salvando) return;
    const linha = e.target.closest('[data-familia]');
    if (!linha) return;
    e.preventDefault();
    el('ordem-lista').querySelectorAll('.destino').forEach(l => l.classList.remove('destino'));
    linha.classList.add('destino');
  });
  el('ordem-lista').addEventListener('drop', e => {
    const linha = e.target.closest('[data-familia]');
    if (!linha || !arrastando || salvando) return;
    e.preventDefault();
    mover(arrastando, sequencia.indexOf(linha.dataset.familia));
    arrastando = null;
  });
  el('ordem-lista').addEventListener('dragend', () => {
    arrastando = null;
    el('ordem-lista').querySelectorAll('.arrastando,.destino').forEach(l => l.classList.remove('arrastando', 'destino'));
  });
  el('ordem-descartar').addEventListener('click', () => {
    if (salvando) return;
    selecionarGrupo();
  });
  el('ordem-salvar').addEventListener('click', async () => {
    if (salvando || !alterado()) return;
    salvando = true;
    desenhar();
    let gravados = 0;
    try {
      for (let i = 0; i < sequencia.length; i++) {
        mensagem(`Salvando ${i + 1} de ${sequencia.length} famílias…`);
        const id = sequencia[i];
        const resposta = await fetch(`/api/familias/${encodeURIComponent(id)}/ordem`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordem: i + 1 })
        });
        const j = await resposta.json();
        if (!resposta.ok || !j.ok) throw new Error(j.erro || 'Falha ao salvar a ordem.');
        familias.find(f => f.id === id).ordem = i + 1;
        gravados++;
      }
      original = [...sequencia];
      gravacaoPendente = false;
      mensagem('Ordem salva! A sequência será usada ao atualizar o catálogo do cliente.');
    } catch (e) {
      gravacaoPendente = true;
      mensagem(`${gravados} de ${sequencia.length} posições confirmadas. ${e.message} Clique em Salvar ordem para tentar novamente. Descartar alterações usa as posições já confirmadas.`);
    } finally {
      salvando = false;
      desenhar();
    }
    if (gravados === sequencia.length && typeof carregarFamiliasCriadas === 'function') {
      await carregarFamiliasCriadas();
      mensagem('Ordem salva! A sequência será usada ao atualizar o catálogo do cliente.');
    }
  });
  window.addEventListener('beforeunload', e => {
    if (alterado() || salvando) { e.preventDefault(); e.returnValue = ''; }
  });
  window.ordenacaoFamilias = {
    atualizar(cadastros, produtos) {
      if (salvando || alterado()) return;
      const porCodigo = new Map(produtos.map(p => [String(p.codigo).trim(), p]));
      familias = cadastros.map(f => {
        const codigos = listaJson(f.subgrupos || f.itens).map(c => String(c).trim());
        const itens = codigos.map(c => porCodigo.get(c)).filter(Boolean);
        const primeiro = itens[0];
        const foto = itens.find(p => /^https?:\/\//i.test(p.imagem_url || ''))?.imagem_url || '';
        return { id: String(f.id), nome: f.nome, ordem: f.ordem,
          grupo: String(primeiro?.grupo_scraping || primeiro?.grupo || f.grupo || 'OUTROS').trim().toUpperCase(),
          foto, quantidade: codigos.length, estoque: itens.reduce((n, p) => n + (Number(p.estoque) || 0), 0) };
      });
      const grupos = [...new Set(familias.map(f => f.grupo))].sort();
      if (!grupos.includes(grupo)) grupo = grupos[0] || '';
      el('ordem-grupo').innerHTML = grupos.map(g => `<option value="${escapar(g)}">${escapar(g)}</option>`).join('');
      el('ordem-grupo').value = grupo;
      selecionarGrupo();
    }
  };
  selecionarGrupo();
})();
