(() => {
  let pendente = null;
  let precisaRenderizar = false;
  const editandoQuantidade = () => document.activeElement?.matches('input[type="number"]');
  const assinatura = lista => JSON.stringify(lista);
  function renderizarSePossivel() {
    if (!precisaRenderizar || document.hidden || editandoQuantidade()) return;
    precisaRenderizar = false;
    renderizar();
  }
  window.atualizarOrdemFamilias = () => {
    if (pendente) return pendente;
    if (document.hidden || typeof todasFamilias === 'undefined' || !todasFamilias.length) return Promise.resolve();
    pendente = (async () => {
      try {
        const resposta = await fetch('/api/familias', { cache: 'no-store' });
        const dados = await resposta.json();
        if (!resposta.ok || !dados.ok || !Array.isArray(dados.familias)) throw new Error('Não foi possível atualizar a ordem das famílias.');
        if (assinatura(dados.familias) !== assinatura(todasFamilias)) {
          todasFamilias = dados.familias;
          precisaRenderizar = true;
        }
        renderizarSePossivel();
      } catch (e) {
        console.warn('Ordem das famílias mantida: atualização indisponível.');
      } finally {
        pendente = null;
      }
    })();
    return pendente;
  };
  window.addEventListener('focus', window.atualizarOrdemFamilias);
  window.addEventListener('storage', e => {
    if (e.key === 'catalogo_familias_ordem_atualizada') window.atualizarOrdemFamilias();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) window.atualizarOrdemFamilias();
  });
  // A nova sequência é aplicada após sair da quantidade, sem recriar o campo durante a digitação.
  document.addEventListener('focusout', () => { setTimeout(renderizarSePossivel, 0); });
})();
