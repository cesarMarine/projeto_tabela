// Cache somente de leituras. Gravacoes, autenticacao e respostas de erro nao sao armazenadas.
export function criarCacheConsultas({ agora = Date.now, limite = 150 } = {}) {
  const entradas = new Map();
  const contadores = { acertos: 0, cargas: 0, compartilhadas: 0, invalidacoes: 0 };
  return {
    async obter(chave, duracao, carregar) {
      for (const [key, item] of entradas) if (!item.pendente && item.ate <= agora()) entradas.delete(key);
      const atual = entradas.get(chave);
      if (atual && (atual.pendente || atual.ate > agora())) {
        if (atual.pendente) contadores.compartilhadas++; else contadores.acertos++;
        return atual.promessa;
      }
      entradas.delete(chave);
      while (entradas.size >= limite) entradas.delete(entradas.keys().next().value);
      const entrada = { pendente: true, ate: 0 };
      entradas.set(chave, entrada);
      contadores.cargas++;
      entrada.promessa = Promise.resolve().then(carregar).then(valor => {
        entrada.pendente = false; entrada.ate = agora() + duracao;
        return valor;
      }, erro => {
        if (entradas.get(chave) === entrada) entradas.delete(chave);
        throw erro;
      });
      return entrada.promessa;
    },
    invalidarPrefixo(prefixo) {
      for (const chave of entradas.keys()) if (chave.startsWith(prefixo)) { entradas.delete(chave); contadores.invalidacoes++; }
    },
    estatisticas() { return { ...contadores, entradas: entradas.size }; }
  };
}

export function registrarInvalidacaoConsultas(app, cache) {
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.once('finish', () => {
        // Inclusive falhas: uma operacao parcial pode ter gravado dados antes do erro.
        const rota = req.path;
        if (/^\/api\/(importar\/(sistema|scraping)|familias(?:\/|$)|ofertas(?:\/|$)|acrescimos(?:\/|$)|admin\/(produtos|scraping-produtos|auditoria-produtos)(?:\/|$)|regras(?:\/|$))/.test(rota)) cache.invalidarPrefixo('publico:');
        if (/^\/api\/(pedidos(?:\/|$)|cliente\/[^/]+\/rascunhos\/|vendedor\/[^/]+\/pedidos\/|vincular(?:\/|$))/.test(rota)) {
          const codigo = req.body?.codigo_representante;
          cache.invalidarPrefixo(codigo ? `vendedor:${codigo}:` : 'vendedor:');
          cache.invalidarPrefixo(codigo ? `metricas:${codigo}:` : 'metricas:');
        }
        if (/^\/api\/(importar\/clientes|vendedor\/cliente(?:\/|$)|vendedores(?:\/|$))/.test(rota)) {
          cache.invalidarPrefixo('metricas:'); cache.invalidarPrefixo('vendedor:');
        }
      });
    }
    next();
  });
}
