(() => {
  const el=id=>document.getElementById(id);
  const seguro=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const moeda=v=>(Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let produtos=[],ofertas={},cliente=null,taxa=0,filtro='todos';
  const selecao=new Map();
  try {cliente=JSON.parse(localStorage.getItem('clienteLogadoB2B')||'null');taxa=Number(localStorage.getItem('acrescimoB2B'))||Number(cliente?.acrescimo)||0;}catch{}
  function mostrarConta(){el('botaoConta').textContent=cliente?'Trocar cliente':'Entrar com CNPJ';el('contaAtual').textContent=cliente?`Olá, ${cliente.nome || 'cliente'} · Valores com IPI incluso`:'Entre com seu CNPJ para consultar preços.';}
  function desenhar(){
    const normalizar=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const busca=normalizar(el('buscaNovidades').value.trim());
    const lista=produtos.filter(p=>(filtro==='todos'||(filtro==='chegou'?p.is_chegou:p.is_lancamento))&&normalizar([p.codigo,p.subgrupo_scraping,p.descricao_sistema,p.marca].join(' ')).includes(busca));
    el('statusNovidades').textContent=`${lista.length} produto(s) · Atualizações selecionadas pela Marine Sports`;
    el('gradeNovidades').innerHTML=lista.map(p=>{
      const base=Number(p.preco_venda)||0,preco=base*(1+taxa/100)*(1-(Number(ofertas[p.codigo])||0)/100);
      let atributos={};try{atributos=JSON.parse(p.atributos_json||'{}')}catch{}
      const espec=Object.entries(atributos).filter(([k,v])=>v && typeof v!=='object').slice(0,5).map(([k,v])=>`${seguro(k)}: ${seguro(v)}`).join(' · ');
      return `<article class="produto ${p.is_lancamento ? 'novidade' : ''} ${p.is_chegou ? 'chegou' : ''}"><div class="foto"><div class="tarjas">${p.is_lancamento?'<span class="tarja">LANÇAMENTO</span>':''}${p.is_chegou?'<span class="tarja chegou">CHEGOU</span>':''}</div>${p.imagem_url?`<img src="${seguro(p.imagem_url)}" alt="${seguro(p.subgrupo_scraping||p.descricao_sistema)}" loading="lazy">`:'<span>Marine Sports</span>'}</div><div class="dados"><span class="codigo">Cód. ${seguro(p.codigo)} · ${seguro(p.marca)}</span><h2>${seguro(p.subgrupo_scraping||p.descricao_sistema||p.codigo)}</h2><p class="spec">${espec}</p><div class="preco">${cliente?moeda(preco):'Consulte seu preço'}</div><label class="qtd">Quantidade <input type="number" min="0" step="1" value="${selecao.get(String(p.codigo))||0}" data-codigo="${seguro(p.codigo)}" aria-label="Quantidade do produto ${seguro(p.codigo)}"></label><small class="spec">Lotes mínimos serão aplicados no catálogo.</small></div></article>`;
    }).join('')||'<p class="vazio">Nenhuma novidade encontrada neste filtro.</p>';
  }
  el('gradeNovidades').addEventListener('change',e=>{
    if(!e.target.dataset.codigo)return;const qtd=Number(e.target.value);
    if(!Number.isSafeInteger(qtd)||qtd<0){e.target.value=selecao.get(e.target.dataset.codigo)||0;return;}
    if(qtd)selecao.set(e.target.dataset.codigo,qtd);else selecao.delete(e.target.dataset.codigo);
    el('resumoSelecao').textContent=`${selecao.size} produto(s) selecionado(s)`;
  });
  document.querySelectorAll('[data-filtro]').forEach(b=>b.addEventListener('click',()=>{filtro=b.dataset.filtro;document.querySelectorAll('[data-filtro]').forEach(c=>c.classList.toggle('ativo',c===b));desenhar();}));
  el('buscaNovidades').addEventListener('input',desenhar);
  el('botaoConta').addEventListener('click',()=>el('loginNovidades').showModal());
  el('fecharLogin').addEventListener('click',()=>el('loginNovidades').close());
  el('formLoginNovidades').addEventListener('submit',async e=>{
    e.preventDefault();const cnpj=el('cnpjNovidades').value.replace(/\D/g,'');el('erroLogin').textContent='';
    try{
      if(cnpj.length!==14)throw new Error('Informe um CNPJ com 14 dígitos.');
      const r=await fetch('/api/login/'+cnpj);const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.erro||'CNPJ não encontrado.');
      cliente=j.cliente;taxa=Number(j.regra_acrescimo?.porcentagem??j.regra_acrescimo?.acrescimo??cliente.acrescimo??0)||0;
      localStorage.setItem('clienteLogadoB2B',JSON.stringify(cliente));localStorage.setItem('acrescimoB2B',String(taxa));mostrarConta();desenhar();el('loginNovidades').close();
    }catch(erro){el('erroLogin').textContent=erro.message;}
  });
  el('adicionarCarrinho').addEventListener('click',()=>{
    if(!cliente){el('loginNovidades').showModal();return;}
    if(!selecao.size){alert('Selecione a quantidade de pelo menos um produto.');return;}
    sessionStorage.setItem('novidadesParaCarrinho',JSON.stringify({cnpj:String(cliente.cnpj),criado:Date.now(),itens:[...selecao].map(([codigo,qtd])=>({codigo,qtd}))}));
    location.href='index.html';
  });
  async function carregar(){
    try{
      const [r,o]=await Promise.all([fetch('/api/catalogo'),fetch('/api/ofertas')]);const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.erro||'Falha ao carregar catálogo.');
      if(o.ok){const d=await o.json();(d.ofertas||[]).forEach(p=>ofertas[p.codigo]=p.desconto_porcentagem);}
      produtos=j.itens.filter(p=>(p.is_lancamento||p.is_chegou)&&Number(p.estoque)>0&&Number(p.preco_venda)>0).sort((a,b)=>Math.max(Date.parse(b.chegou_em)||0,Date.parse(b.lancamento_em)||0)-Math.max(Date.parse(a.chegou_em)||0,Date.parse(a.lancamento_em)||0));
      mostrarConta();desenhar();
    }catch(e){el('statusNovidades').textContent=e.message;}
  }
  carregar();
})();
