(() => {
  const painel = document.getElementById('painelAgrupados');
  if (!painel) return;
  let catalogo = [], agrupados = [], selecionados = new Map(), editando = null, carregado = false;
  const el = id => document.getElementById(id);
  const texto = valor => String(valor ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  painel.innerHTML = `<h2>Produtos agrupados / Kits</h2>
    <p style="color:#94a3b8; line-height:1.6; margin-bottom:12px;">Escolha o grupo em que o conjunto aparecerá. Produtos individuais e famílias continuam disponíveis. O preço será a soma dos componentes, sem nova regra de estoque.</p>
    <button type="button" class="btn-primario" id="abrirCadastroAgrupado">Criar / gerenciar produtos agrupados</button>
    <div id="cadastroAgrupados" hidden style="margin-top:18px;">
      <p id="mensagemAgrupados" role="status" style="margin-bottom:12px;"></p>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <label>Nome<input id="nomeAgrupado" maxlength="160" placeholder="Ex.: Kit manivela" style="display:block;"></label>
        <label>Grupo de exibição<input id="grupoAgrupado" list="gruposAgrupados" maxlength="100" placeholder="Escolha ou digite um grupo" style="display:block;"><datalist id="gruposAgrupados"></datalist></label>
        <label>Mínimo de conjuntos<input id="minimoAgrupado" type="number" min="1" step="1" value="1" style="display:block; width:140px;"></label>
        <label>Posição no grupo<input id="ordemAgrupado" type="number" min="0" step="1" value="9999" style="display:block; width:140px;"><small>Mesma ordem das famílias: menores primeiro.</small></label>
        <label>Imagem (URL opcional)<input id="imagemAgrupado" type="url" placeholder="https://..." style="display:block;"></label>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:18px; margin-top:18px;">
        <div><label for="buscaComponenteAgrupado">Buscar em todos os produtos (com ou sem família)</label><input id="buscaComponenteAgrupado" type="search" placeholder="Código ou descrição" style="width:100%; margin:10px 0;"><div id="produtosParaAgrupar" style="max-height:340px; overflow:auto;"></div></div>
        <div><h3>Componentes do conjunto</h3><p style="font-size:.8rem; color:#94a3b8;">Quantidade de cada código para uma unidade do conjunto.</p><div id="componentesAgrupado"></div></div>
      </div>
      <div style="display:flex; gap:12px; margin:18px 0;"><button type="button" class="btn-primario" id="salvarAgrupado">Salvar produto agrupado</button><button type="button" class="btn-primario" id="limparAgrupado">Novo / cancelar edição</button></div>
      <h3>Conjuntos cadastrados</h3><div id="listaAgrupadosAdmin" style="margin-top:12px;"></div>
    </div>`;
  async function api(url, opcoes) {
    const resposta = await fetch(url,opcoes);
    const dados = await resposta.json();
    if (!resposta.ok || !dados.ok) throw new Error(dados.erro || 'Falha ao acessar agrupados.');
    return dados;
  }
  const mensagem = t => { el('mensagemAgrupados').textContent = t; };
  const nome = p => p.descricao_sistema || p.subgrupo_scraping || p.codigo;
  function desenharProdutos() {
    const busca = el('buscaComponenteAgrupado').value.trim().toLocaleLowerCase('pt-BR');
    const lista = catalogo.filter(p => `${p.codigo} ${nome(p)}`.toLocaleLowerCase('pt-BR').includes(busca));
    el('produtosParaAgrupar').innerHTML = lista.slice(0,60).map(p => `<div style="padding:8px; border-bottom:1px solid #334155; display:flex; justify-content:space-between; gap:8px;"><span>${texto(p.codigo)} — ${texto(nome(p))}</span><button type="button" data-adicionar="${texto(p.codigo)}" ${selecionados.has(String(p.codigo))?'disabled':''}>Selecionar</button></div>`).join('') + (lista.length > 60 ? '<p>Refine a busca para ver os demais produtos.</p>' : '');
  }
  function desenharSelecionados() {
    el('componentesAgrupado').innerHTML = [...selecionados].map(([codigo,quantidade]) => {
      const p = catalogo.find(p => String(p.codigo) === codigo);
      return `<div style="margin:10px 0; padding:10px; border:1px solid #334155; border-radius:8px;">${texto(codigo)} — ${texto(p ? nome(p) : 'Produto ausente do catálogo')}<div style="display:flex; gap:10px; margin-top:8px;"><input aria-label="Quantidade por conjunto" type="number" min="1" step="1" value="${quantidade}" data-quantidade="${texto(codigo)}" style="width:90px;"><button type="button" data-remover="${texto(codigo)}">Remover</button></div></div>`;
    }).join('') || '<p style="margin-top:12px;">Selecione pelo menos dois produtos.</p>';
  }
  function desenharLista() {
    el('listaAgrupadosAdmin').innerHTML = agrupados.map(p => `<div style="padding:14px; border:1px solid #334155; border-radius:8px; margin-bottom:10px;"><strong>${texto(p.nome)}</strong> · Grupo: ${texto(p.grupo)} · Posição: ${p.ordem ?? 9999} · Mínimo: ${p.minimo} · ${p.ativo?'Ativo':'Inativo'}<p style="margin:8px 0;">${p.componentes.map(c => `${c.quantidade} × ${texto(c.codigo)}`).join(' · ')}</p><button type="button" data-editar="${p.id}">Editar</button> <button type="button" data-ativo="${p.id}">${p.ativo?'Desativar':'Ativar'}</button></div>`).join('') || 'Nenhum conjunto cadastrado.';
  }
  function limpar() {
    editando=null;selecionados=new Map();
    for (const id of ['nomeAgrupado','grupoAgrupado','imagemAgrupado']) el(id).value='';
    el('minimoAgrupado').value=1;el('ordemAgrupado').value=9999;desenharProdutos();desenharSelecionados();
  }
  async function recarregar() {
    const dados=await api('/api/produtos-agrupados');
    if (!dados.configurado) throw new Error('Execute primeiro o arquivo agrupados.sql no Supabase.');
    agrupados=dados.produtos;desenharLista();
  }
  el('abrirCadastroAgrupado').addEventListener('click',async()=>{
    el('cadastroAgrupados').hidden=false;
    if (carregado) return;
    mensagem('Carregando produtos...');
    try {
      const dados=await api('/api/catalogo');catalogo=dados.itens;
      el('gruposAgrupados').innerHTML=[...new Set(catalogo.map(p=>p.grupo_scraping).filter(Boolean))].sort().map(g=>`<option value="${texto(g)}"></option>`).join('');
      await recarregar();carregado=true;desenharProdutos();desenharSelecionados();mensagem('');
    } catch(e){mensagem(e.message);}
  });
  el('buscaComponenteAgrupado').addEventListener('input',desenharProdutos);
  el('limparAgrupado').addEventListener('click',limpar);
  painel.addEventListener('click',async evento=>{
    const botao=evento.target.closest('button');if(!botao)return;
    if(botao.dataset.adicionar){selecionados.set(botao.dataset.adicionar,1);desenharProdutos();desenharSelecionados();}
    if(botao.dataset.remover){selecionados.delete(botao.dataset.remover);desenharProdutos();desenharSelecionados();}
    if(botao.dataset.editar){
      const p=agrupados.find(p=>String(p.id)===botao.dataset.editar);editando=p.id;
      el('nomeAgrupado').value=p.nome;el('grupoAgrupado').value=p.grupo;el('imagemAgrupado').value=p.imagem_url;el('minimoAgrupado').value=p.minimo;
      el('ordemAgrupado').value=p.ordem ?? 9999;
      selecionados=new Map(p.componentes.map(c=>[c.codigo,c.quantidade]));desenharProdutos();desenharSelecionados();mensagem('Editando: '+p.nome);
    }
    if(botao.dataset.ativo){
      const p=agrupados.find(p=>String(p.id)===botao.dataset.ativo);botao.disabled=true;
      try{await api(`/api/admin/produtos-agrupados/${p.id}/ativo`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ativo:!p.ativo})});await recarregar();mensagem('Situação atualizada.');}catch(e){mensagem(e.message);}finally{botao.disabled=false;}
    }
  });
  painel.addEventListener('change',evento=>{
    if(evento.target.dataset.quantidade)selecionados.set(evento.target.dataset.quantidade,Number(evento.target.value));
  });
  el('salvarAgrupado').addEventListener('click',async()=>{
    if(!carregado){mensagem('Carregue o cadastro e execute o SQL antes de salvar.');return;}
    const componentes=[...selecionados].map(([codigo,quantidade])=>({codigo,quantidade}));
    const minimo=Number(el('minimoAgrupado').value);
    const ordem=Number(el('ordemAgrupado').value);
    if (!Number.isSafeInteger(ordem) || ordem < 0) { mensagem('Informe uma posição inteira a partir de zero.'); return; }
    if(!el('nomeAgrupado').value.trim()||!el('grupoAgrupado').value.trim()||!Number.isSafeInteger(minimo)||minimo<1||componentes.length<2||componentes.some(c=>!Number.isSafeInteger(c.quantidade)||c.quantidade<1)){
      mensagem('Informe nome, grupo, mínimo positivo e pelo menos dois componentes com quantidades inteiras positivas.');return;
    }
    el('salvarAgrupado').disabled=true;
    try{
      await api('/api/admin/produtos-agrupados',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editando,nome:el('nomeAgrupado').value.trim(),grupo:el('grupoAgrupado').value.trim(),imagem_url:el('imagemAgrupado').value.trim(),minimo,ordem,componentes})});
      await recarregar();limpar();mensagem('Produto agrupado salvo.');
      await carregarDados();
    }catch(e){mensagem(e.message);}finally{el('salvarAgrupado').disabled=false;}
  });
})();
