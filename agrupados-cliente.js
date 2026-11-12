// As funções usam o estado do catálogo apenas quando chamadas após o carregamento.
let produtosAgrupados = [];
let carrinhoTemComposicao = false;
async function carregarAgrupadosCliente() {
  try {
    const resposta = await fetch('/api/produtos-agrupados');
    const dados = await resposta.json();
    if (!resposta.ok || !dados.ok) throw new Error(dados.erro || 'Falha ao consultar agrupados');
    produtosAgrupados = dados.produtos.filter(p => p.ativo);
  } catch (erro) { console.error('Agrupados:', erro); produtosAgrupados = []; }
}
function produtoComponente(codigo) {
  const bruto = mapaCatalogoCache.get(String(codigo));
  return bruto ? normalizarItem(bruto) : null;
}
function componentesAtuais(kit) {
  return kit.componentes.map(c => {
    const produto = produtoComponente(c.codigo);
    if (!produto || produto.precoBase <= 0) throw new Error(`O componente ${c.codigo} está sem cadastro ou preço. Entre em contato com o vendedor.`);
    return { ...c, precoBase: produto.precoBase, desc: produto.subgrupo || produto.descricao_longa || c.codigo, img: produto.imagem_url };
  });
}
function precoAgrupado(kit) {
  let precoOriginal = 0, precoFinal = 0;
  for (const c of componentesAtuais(kit)) {
    const preco = calcularValoresProduto(c.precoBase, c.codigo);
    precoOriginal += preco.precoOriginal * c.quantidade;
    precoFinal += preco.precoFinal * c.quantidade;
  }
  return { precoOriginal, precoFinal, temOferta: precoFinal < precoOriginal, pctDesconto: 0 };
}
function definirQtdAgrupado(chave, valor) {
  const existente = carrinho[chave];
  const kit = existente?.kit || produtosAgrupados.find(p => 'kit:' + p.id === chave);
  if (!kit) return;
  let qtd = Number(valor);
  if (!Number.isSafeInteger(qtd) || qtd < 0) { alert('Informe uma quantidade inteira válida.'); atualizarCarrinho(); return; }
  const multiplicador = kit.multiplicador || kit.minimo;
  if (qtd > 0) qtd = Math.ceil(qtd / multiplicador) * multiplicador;
  if (!qtd) delete carrinho[chave];
  else {
    try {
      const componentes = componentesAtuais(kit);
      carrinho[chave] = { qtd, precoBase: componentes.reduce((s,c) => s + c.precoBase * c.quantidade,0), desc: kit.nome,
        img: kit.imagem_url || componentes[0].img, kit: { id: kit.id, nome: kit.nome, grupo: kit.grupo, minimo: kit.minimo, multiplicador, imagem_url: kit.imagem_url, componentes } };
    } catch (e) { alert(e.message); return; }
  }
  carrinhoTemComposicao = true;
  atualizarCarrinho();
  renderizar();
}
function definirLotesAgrupado(chave, valor) {
  const kit = carrinho[chave]?.kit || produtosAgrupados.find(p => 'kit:' + p.id === chave);
  const lotes = Number(valor);
  if (!kit) return;
  const multiplicador = kit.multiplicador || kit.minimo;
  if (!Number.isSafeInteger(lotes) || lotes < 0 || !Number.isSafeInteger(lotes * multiplicador)) {
    alert('Informe uma quantidade inteira de lotes.'); atualizarCarrinho(); renderizar(); return;
  }
  definirQtdAgrupado(chave, lotes * multiplicador);
}
function dadosComposicaoAgrupados() {
  return carrinhoTemComposicao || Object.values(carrinho).some(i => i.kit)
    ? { composicao_agrupados: { versao: 1, carrinho } } : {};
}
function itensPedidoComAgrupados() {
  const somados = new Map();
  const adicionar = (codigo, item, qtd) => {
    const calc = calcularValoresProduto(item.precoBase, codigo);
    const existente = somados.get(codigo);
    if (existente) existente.qtd += qtd;
    else somados.set(codigo, { codigo, desc: descricaoCompletaCarrinho(codigo,item), qtd, precoBase: item.precoBase, precoFinal: calc.precoFinal });
  };
  for (const [codigo, item] of Object.entries(carrinho)) {
    if (item.kit) for (const c of componentesAtuais(item.kit)) adicionar(c.codigo,c,c.quantidade * item.qtd);
    else adicionar(codigo,item,item.qtd);
  }
  return [...somados.values()];
}
function restaurarComposicaoAgrupados(composicao) {
  if (!composicao || composicao.versao !== 1 || !composicao.carrinho) return false;
  const restaurado = {};
  for (const [codigo,item] of Object.entries(composicao.carrinho)) {
    if (item.kit) {
      const componentes = componentesAtuais(item.kit);
      restaurado[codigo] = { ...item, kit: { ...item.kit, componentes } };
    } else {
      const p = produtoComponente(codigo);
      restaurado[codigo] = { ...item, precoBase:p?.precoBase || 0, img:p?.imagem_url || item.img };
    }
  }
  carrinho = restaurado;
  carrinhoTemComposicao = true;
  return true;
}
function renderizarAgrupados(emBlocos = false) {
  const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const busca = normalizar(buscaAtual.trim());
  const lista = produtosAgrupados.filter(p => busca
    ? normalizar(p.nome + ' ' + p.grupo + ' ' + p.componentes.map(c => c.codigo).join(' ')).includes(busca)
    : grupoAtual === '__TODOS__' || normalizar(p.grupo) === normalizar(grupoAtual));
  const blocos = lista.map(kit => {
    let preco, componentes;
    try { componentes = componentesAtuais(kit); preco = precoAgrupado(kit); } catch { return null; }
    const chave = 'kit:' + kit.id;
    const qtd = carrinho[chave]?.qtd || 0;
    const multiplicador = carrinho[chave]?.kit.multiplicador || kit.minimo;
    const lotes = qtd / multiplicador;
    const foto = kit.imagem_url || componentes[0].img;
    const html = `<section class="familia-bloco"><div class="familia-head"><h2>${escapeHtml(kit.nome)}</h2><span class="marca-badge">Produto agrupado</span></div>
      <div class="familia-card"><div class="familia-side">${foto ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(kit.nome)}" style="width:100%; max-width:180px; object-fit:contain;">` : ''}</div>
      <div><p style="font-size:.8rem; line-height:1.8;">${componentes.map(c => `${c.quantidade} × ${escapeHtml(c.desc)} — cód. ${escapeHtml(c.codigo)}`).join('<br>')}</p>
      <p style="margin:12px 0; color:#003366; font-weight:800;">R$ ${fmtMoeda(preco.precoFinal * multiplicador)} por lote</p>
      <p style="font-size:.75rem; margin-bottom:10px;">Multiplicador: ${multiplicador}. Cada lote adiciona ${componentes.map(c => `${c.quantidade * multiplicador} unidade(s) do código ${escapeHtml(c.codigo)}`).join('; ')}. Digite o número de lotes (1, 2, 3...).</p>
      <div class="qtd-ctrl"><button type="button" onclick="definirLotesAgrupado('${chave}', ${Math.max(0,Math.ceil(lotes)-1)})">−</button>
      <input aria-label="Quantidade de lotes" type="number" min="0" step="1" value="${lotes}" onchange="definirLotesAgrupado('${chave}', this.value)">
      <button type="button" onclick="definirLotesAgrupado('${chave}', ${Math.ceil(lotes)+1})">+</button></div></div></div></section>`;
    return { nome: kit.nome, ordem: kit.ordem ?? 9999, html, agrupado: true };
  }).filter(Boolean);
  return emBlocos ? blocos : blocos.map(b => b.html).join('');
}
