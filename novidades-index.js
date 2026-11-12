function renderTarjasNovidades(itens, pequena = false) {
  const textos=[];
  if(itens.some(p=>p.is_lancamento)) textos.push('✨ LANÇAMENTO');
  if(itens.some(p=>p.is_chegou)) textos.push('CHEGOU');
  return textos.length ? `<span class="${pequena ? 'tarja-novidade-sku' : 'tarja-lancamento-foto'}" style="${pequena?'display:block; border-radius:4px; padding:3px 5px; margin-bottom:4px; color:white; font-size:.5rem; font-weight:800;':''}background:${textos.length===1 && textos[0]==='CHEGOU'?'#059669':'#003366'};">${textos.join(' · ')}</span>` : '';
}
async function abrirPaginaNovidades(evento) {
  evento.preventDefault();
  if (Object.keys(carrinho).length) {
    clearTimeout(timerAutosave);
    // Aguarda o salvamento em andamento antes de navegar para outra página.
    for (let tentativa=0; isAutosaving && tentativa<100; tentativa++) await new Promise(resolve=>setTimeout(resolve,100));
    if (isAutosaving || !await autosaveCarrinho()) {
      alert('Não foi possível confirmar o salvamento do carrinho. Tente novamente antes de abrir as novidades.');
      return;
    }
  }
  location.href='novidades.html';
}
async function receberNovidadesNoCarrinho() {
  const salvo=sessionStorage.getItem('novidadesParaCarrinho');
  if(!salvo)return;
  let transferencia;
  try {
    transferencia=JSON.parse(salvo);
    if(Date.now()-transferencia.criado>3600000)throw new Error('A seleção de novidades expirou. Escolha os itens novamente.');
    if(transferencia.cnpj!==String(clienteLogado.cnpj))throw new Error('A seleção de novidades pertence a outro cliente. Volte à página de novidades.');
    for(const linha of transferencia.itens){
      const produto=mapaCatalogoCache.get(String(linha.codigo));
      if(!produto || Number(produto.estoque)<=0 || Number(produto.preco_venda)<=0)throw new Error(`Produto ${linha.codigo} não está disponível para compra.`);
      if(!Number.isSafeInteger(linha.qtd)||linha.qtd<1)throw new Error('Quantidade inválida.');
    }
    // Guarda o alvo antes de aplicar: repetir a transferência não duplica quantidades.
    transferencia.itens.forEach(linha=>{
      if(linha.alvo==null)linha.alvo=calcularQtdComLote(String(linha.codigo),(Number(carrinho[linha.codigo]?.qtd)||0)+linha.qtd);
    });
    sessionStorage.setItem('novidadesParaCarrinho',JSON.stringify(transferencia));
    transferencia.itens.forEach(linha=>setQtd(String(linha.codigo),linha.alvo));
    clearTimeout(timerAutosave);
    const salvoNoBanco=await autosaveCarrinho();
    document.getElementById('painelCarrinho').classList.add('on');
    if(salvoNoBanco){sessionStorage.removeItem('novidadesParaCarrinho');alert('Novidades adicionadas ao seu carrinho. As quantidades respeitam os lotes de venda do catálogo.');}
    else alert('Os itens estão no carrinho, mas não foi possível confirmar o salvamento. Use Salvar Rascunho antes de sair.');
  }catch(e){alert(e.message);}
}
