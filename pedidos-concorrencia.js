// Serializa gravacoes do mesmo cliente nesta instancia do servidor.
// Nao impede clientes diferentes de salvar ao mesmo tempo.
export function criarFilaPedidos() {
  const filas = new Map();
  return async (cliente, operacao) => {
    const chave = String(cliente || '').replace(/\D/g, '');
    const anterior = filas.get(chave) || Promise.resolve();
    const atual = anterior.catch(() => {}).then(operacao);
    filas.set(chave, atual);
    try { return await atual; }
    finally { if (filas.get(chave) === atual) filas.delete(chave); }
  };
}
