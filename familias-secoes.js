// Regras compartilhadas pelo catalogo e admin; nao alteram cadastros nem estoque.
(() => {
  const grupo = v => String(v || '').trim().toUpperCase();
  function lista(v) {
    for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  }
  function organizar(ordenadas, produtos, configuracoes) {
    const itens = new Map(produtos.map(p => [String(p.codigo).trim(), p]));
    const configs = new Map((configuracoes || []).filter(c => c.ativo && lista(c.secoes).length).map(c => [grupo(c.grupo), c]));
    if (!configs.size) return ordenadas;
    const grupoFamilia = f => {
      if (f.agrupado) return '';
      const primeiro = lista(f.itens || f.subgrupos).map(c => itens.get(String(c).trim())).find(Boolean);
      return primeiro ? grupo(primeiro.grupo || primeiro.grupo_scraping) : '';
    };
    const gruposEmitidos = new Set(), resultado = [];
    for (const f of ordenadas) {
      const g = grupoFamilia(f), config = configs.get(g);
      if (!config) { resultado.push(f); continue; }
      if (gruposEmitidos.has(g)) continue;
      gruposEmitidos.add(g);
      const familias = ordenadas.filter(c => grupoFamilia(c) === g);
      const usadas = new Set();
      let temSecao = false;
      for (const s of lista(config.secoes)) {
        const membros = new Set(lista(s.familias).map(String));
        const visiveis = familias.filter(c => membros.has(String(c.id)) && !usadas.has(String(c.id)));
        if (!visiveis.length) continue;
        temSecao = true;
        resultado.push({ cabecalhoSecao: true, nome: String(s.nome || ''), grupo: g, secaoId: s.id });
        visiveis.forEach(c => { usadas.add(String(c.id)); resultado.push(c); });
      }
      const restantes = familias.filter(c => !usadas.has(String(c.id)));
      if (temSecao && restantes.length) resultado.push({ cabecalhoSecao: true, nome: 'Outras famílias', grupo: g, secaoId: 'outras' });
      resultado.push(...restantes);
    }
    return resultado;
  }
  async function carregar() {
    const resposta = await fetch('/api/catalogo/secoes-familias', { cache: 'no-store' });
    const dados = await resposta.json();
    if (!resposta.ok || !dados.ok || !Array.isArray(dados.grupos)) throw new Error(dados.erro || 'Não foi possível consultar as seções.');
    return dados;
  }
  window.CatalogoSecoes = { organizar, carregar, lista, grupo };
})();
