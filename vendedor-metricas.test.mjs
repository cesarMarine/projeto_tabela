import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';
import { limitesDiaBrasilia, resumirMetricas, registrarMetricasVendedor } from './vendedor-metricas-server.js';

const agora = new Date('2026-11-17T15:00:00Z');
const clientes = [
  { codigo: 'C1', cnpj: '11', nome_fantasia: 'Cliente A', codigo_representante: '36' },
  { codigo: 'C2', cnpj: '22', nome_fantasia: 'Cliente B', codigo_representante: '36' },
  { codigo: 'C3', cnpj: '33', nome_fantasia: 'Outra carteira', codigo_representante: '82' }
];
const pedidos = [
  { id: 1, cnpj_cliente: '11', status: 'RASCUNHO', total: 10, data_criacao: '2026-11-17T14:55:00Z', codigo_representante: '36' },
  { id: 2, cnpj_cliente: '11', status: 'RASCUNHO', total: 15, data_criacao: '2026-11-16T14:00:00Z', codigo_representante: '36' },
  { id: 3, cnpj_cliente: '22', status: 'ENVIADO', total: 100, data_criacao: '2026-11-17T03:00:00Z', codigo_representante: '36' },
  { id: 4, cnpj_cliente: '22', status: 'ENVIADO', total: 50, data_criacao: '2026-11-17T02:59:59Z', codigo_representante: '36' },
  { id: 5, cnpj_cliente: '11', status: 'CANCELADO', total: 999, data_criacao: '2026-11-17T10:00:00Z', codigo_representante: '36' },
  { id: 6, cnpj_cliente: '33', status: 'ENVIADO', total: 9999, data_criacao: '2026-11-17T10:00:00Z', codigo_representante: '82' },
  { id: 7, cnpj_cliente: '22', status: 'RASCUNHO', total: 5, data_criacao: '2026-11-18T10:00:00Z', codigo_representante: '36' }
];
const logins = [
  { cnpj: '11', data_login: '2026-11-17T02:59:59Z', dispositivo: 'celular' },
  { cnpj: '11', data_login: '2026-11-17T03:00:00Z', dispositivo: 'celular' },
  { cnpj: '11', data_login: '2026-11-17T14:00:00Z', dispositivo: 'computador' },
  { cnpj: '22', data_login: '2026-11-18T03:00:00Z', dispositivo: 'tablet' },
  { cnpj: '33', data_login: '2026-11-17T14:00:00Z', dispositivo: 'tablet' }
];
const resumo = () => resumirMetricas({ clientes: clientes.slice(0, 2), pedidos, logins, data: '2026-11-17', agora });

test('Dia e horarios seguem Brasilia e datas impossiveis sao rejeitadas', () => {
  assert.deepEqual(limitesDiaBrasilia('2026-11-17'), { inicio: '2026-11-17T03:00:00.000Z', fim: '2026-11-18T03:00:00.000Z' });
  assert.throws(() => limitesDiaBrasilia('2026-02-31'));
  assert.throws(() => limitesDiaBrasilia('17/11/2026'));
});
test('Clientes sao unicos, acessos sao eventos e aparelho pertence ao ultimo acesso', () => {
  const r = resumo();
  assert.equal(r.clientes_acessaram, 1); assert.equal(r.total_acessos, 2);
  assert.equal(r.dispositivos.celular, 1); assert.equal(r.dispositivos.computador, 1);
  assert.equal(r.acessos[0].dispositivo, 'computador');
  assert.equal(r.acessos[0].quantidade_acessos, 2);
  assert.equal(r.acessos[0].ultimo_acesso, '2026-11-17T14:00:00Z');
});
test('Valores enviados nao incluem rascunhos, cancelados, outro dia ou outra carteira', () => {
  const r = resumo();
  assert.equal(r.pedidos_enviados, 1); assert.equal(r.valor_enviado, 100);
  assert.equal(r.valor_rascunhos, 30); assert.equal(r.quantidade_rascunhos, 3);
  assert.equal(r.clientes_com_rascunho, 2); assert.equal(r.clientes_rascunho_recente, 1);
  assert.equal(r.rascunhos.filter(p => p.alterado_recentemente).length, 1);
  assert.ok(!JSON.stringify(r).includes('Outra carteira'));
});
test('Ausencia de dispositivo e data invalida nao viram presenca online', () => {
  const r = resumirMetricas({ clientes: clientes.slice(0, 1), pedidos: [{ ...pedidos[0], data_criacao: 'invalida' }],
    logins: [{ cnpj: '11', data_login: '2026-11-17T14:00:00Z' }], data: '2026-11-17', agora });
  assert.equal(r.clientes_rascunho_recente, 0);
  assert.equal(r.dispositivos.nao_identificado, 1);
});

async function api({ senha = 'teste', faltaDispositivo = false, muitos = false, falha = false } = {}) {
  const consultas = [];
  const tabelas = {
    vendedores: [{ id: 9, codigo_representante: '36', ativo: 1 }], vendedores_acesso: [{ vendedor_id: 9, senha: 'teste' }],
    clientes: muitos ? Array.from({ length: 1001 }, (_, i) => ({ codigo: String(i), cnpj: String(i).padStart(14, '0'), codigo_representante: '36' })) : clientes,
    pedidos02: pedidos,
    logins_clientes: muitos ? Array.from({ length: 1001 }, (_, i) => ({ cnpj: '00000000000000', data_login: '2026-11-17T14:00:00Z', dispositivo: 'celular' })) : logins
  };
  const supabase = { from(tabela) {
    const consulta = { tabela, filtros: [] }; consultas.push(consulta);
    let campos = '', filtros = [];
    const executar = () => {
      if (falha && tabela === 'clientes') return { error: new Error('Falha simulada') };
      if (faltaDispositivo && tabela === 'logins_clientes' && campos.includes('dispositivo')) return { error: { code: 'PGRST204' } };
      let rows = (tabelas[tabela] || []).filter(row => filtros.every(f => f(row)));
      if (faltaDispositivo && tabela === 'logins_clientes') rows = rows.map(({ dispositivo, ...r }) => r);
      return { data: rows, error: null };
    };
    const q = {
      select(v) { campos = v; return q; }, order() { return q; },
      eq(c, v) { consulta.filtros.push([c,v]); filtros.push(row => String(row[c]) === String(v)); return q; },
      in(c, vs) { consulta.filtros.push([c,vs]); filtros.push(row => vs.includes(String(row[c]))); return q; },
      gte(c,v) { filtros.push(row => Date.parse(row[c]) >= Date.parse(v)); return q; },
      lt(c,v) { filtros.push(row => Date.parse(row[c]) < Date.parse(v)); return q; },
      async single() { const r = executar(); return { ...r, data: r.data?.[0] || null }; },
      async range(a,b) { consulta.pagina = [a,b]; const r = executar(); return { ...r, data: r.data?.slice(a,b+1) }; }
    }; return q;
  } };
  let handler, status = 200, resposta;
  registrarMetricasVendedor({ get(path, fn) { handler = fn; } }, supabase, () => agora);
  await handler({ params: { codigo: '36' }, query: { data: '2026-11-17' }, get: () => senha },
    { set() {}, status(n) { status = n; return this; }, json(v) { resposta = v; } });
  return { status, resposta, consultas };
}
test('API exige senha e nao consulta carteiras quando autenticacao falha', async () => {
  const r = await api({ senha: 'errada' });
  assert.equal(r.status, 401); assert.ok(r.consultas.every(q => ['vendedores','vendedores_acesso'].includes(q.tabela)));
  const vazio = await api({ senha: '' }); assert.equal(vazio.consultas.length, 0);
});
test('API limita clientes e pedidos ao representante e logins aos documentos da carteira', async () => {
  const r = await api(); assert.equal(r.status, 200);
  assert.equal(r.resposta.metricas.total_clientes, 2); assert.equal(r.resposta.metricas.valor_enviado, 100);
  assert.ok(r.consultas.filter(q => ['clientes','pedidos02'].includes(q.tabela)).every(q => q.filtros.some(([c,v]) => c === 'codigo_representante' && v === '36')));
  assert.deepEqual(r.consultas.find(q => q.tabela === 'logins_clientes').filtros[0], ['cnpj', ['11','22']]);
});
test('API pagina carteiras e acessos acima de mil registros sem truncar indicadores', async () => {
  const r = await api({ muitos: true });
  assert.equal(r.resposta.metricas.total_clientes, 1001);
  assert.equal(r.resposta.metricas.total_acessos, 1001);
  assert.ok(r.consultas.some(q => q.tabela === 'clientes' && q.pagina?.[0] === 1000));
});
test('Coluna de aparelho ausente tem fallback e falha de consulta nao mostra zeros falsos', async () => {
  const r = await api({ faltaDispositivo: true });
  assert.equal(r.resposta.metricas.aparelho_disponivel, false);
  assert.equal(r.resposta.metricas.dispositivos.nao_identificado, 2);
  const erro = await api({ falha: true }); assert.equal(erro.status, 500); assert.equal(erro.resposta.ok, false);
});

function tela() {
  const $ = load('<div id="painelMetricasVendedor"></div>');
  const wrappers = new WeakMap(), eventos = new WeakMap();
  function wrap(node) {
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);
    const e = $(node), handlers = {}; eventos.set(node, handlers);
    const w = {
      addEventListener: (nome, fn) => { handlers[nome] = fn; }, querySelector: s => wrap(e.find(s)[0]), closest: s => wrap(e.closest(s)[0]),
      get innerHTML() { return e.html(); }, set innerHTML(v) { e.html(v); },
      get textContent() { return e.text(); }, set textContent(v) { e.text(v); },
      get value() { return e.val(); }, set value(v) { e.val(v); },
      get disabled() { return e.attr('disabled') !== undefined; }, set disabled(v) { if (v) e.attr('disabled',''); else e.removeAttr('disabled'); },
      get dataset() { return Object.fromEntries(Object.entries(e.attr() || {}).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5),v])); }
    }; wrappers.set(node,w); return w;
  }
  const estado = { requests: [], falhar: false, timers: [], metricas: resumo() };
  const docEventos = {};
  const document = { hidden: false, getElementById: id => wrap($('#'+id)[0]), addEventListener: (nome, fn) => { docEventos[nome] = fn; } };
  const c = { window: {}, document, setInterval: fn => { estado.timers.push(fn); return estado.timers.length; }, clearInterval() {},
    fetch: async (url, opcoes) => { estado.requests.push({ url,opcoes });
      if (estado.falhar) throw new Error('Sem conexão');
      return { ok: true, json: async () => ({ ok: true, metricas: estado.metricas }) };
    }
  };
  vm.createContext(c); vm.runInContext(fs.readFileSync(new URL('vendedor-metricas.js',import.meta.url),'utf8'),c);
  return { $, estado, document, c, wrap,
    iniciar: () => c.window.painelVendedorMetricas.iniciar({ codigo: '36' },'teste'),
    atualizar: () => c.window.painelVendedorMetricas.atualizar(),
    proxima: () => eventos.get($('#painelMetricasVendedor')[0]).click({ target: wrap($('#met-paginas-acessos [data-delta="1"]')[0]) }) };
}
test('Painel mostra indicadores, hora de Brasilia e aparelho sem expor senha na URL', async () => {
  const t = tela(); await t.iniciar();
  assert.equal(t.$('#met-acessaram').text(),'1'); assert.equal(t.$('#met-recentes').text(),'1');
  assert.ok(t.$('#met-valor-enviado').text().includes('100,00'));
  assert.ok(t.$('#met-lista-acessos').text().includes('11:00:00'));
  assert.ok(t.$('#met-lista-acessos').text().includes('Computador'));
  assert.ok(!t.estado.requests[0].url.includes('teste'));
  assert.equal(t.estado.requests[0].opcoes.headers['x-vendedor-senha'],'teste');
});
test('Listas paginam, escapam nomes e falhas mantem os dados anteriores identificados', async () => {
  const t = tela();
  t.estado.metricas.acessos = Array.from({length:11},(_,i)=>({ ...resumo().acessos[0], codigo_cliente:String(i), nome_cliente:'<img src=x onerror=alert(1)>' }));
  await t.iniciar(); assert.equal(t.$('#met-lista-acessos tr').length,10); assert.equal(t.$('#met-lista-acessos img').length,0);
  t.proxima(); assert.equal(t.$('#met-lista-acessos tr').length,1);
  t.estado.falhar=true; await t.atualizar();
  assert.equal(t.$('#met-acessaram').text(),'1'); assert.ok(t.$('#met-status').text().includes('Mantidos os dados'));
});
test('Atualizacao automatica ignora aba oculta', async () => {
  const t = tela(); await t.iniciar(); t.document.hidden=true;
  await t.estado.timers[0](); assert.equal(t.estado.requests.length,1);
});
