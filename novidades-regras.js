// Compartilhado pelo importador e pelos testes. Marcas permanecem até remoção manual.
export const codigoNovidades = v => String(v ?? '').trim().replace(/^0+(?=\d)/,'').toUpperCase();
export function detectarDestaques(anterior, estoque, temBaseAnterior, agora) {
  const novo = !anterior && temBaseAnterior;
  const voltou = !!anterior && Number(anterior.estoque || 0) <= 0 && estoque > 0;
  return {
    is_lancamento: novo || !!anterior?.is_lancamento,
    is_chegou: voltou || !!anterior?.is_chegou,
    lancamento_em: novo ? agora : anterior?.lancamento_em || null,
    chegou_em: voltou ? agora : anterior?.chegou_em || null
  };
}
