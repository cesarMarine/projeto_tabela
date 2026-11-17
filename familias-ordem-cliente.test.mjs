import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';

const index = load(fs.readFileSync(new URL('index.html', import.meta.url), 'utf8'));
const script = index('script:not([src])').map((_, e) => index(e).html()).get().find(s => s.includes('let todosItens'));
const inicio = script.indexOf('function renderizar()');
const renderer = script.slice(inicio, script.indexOf('\nfunction renderOfertas()', inicio));
const atualizador = fs.readFileSync(new URL('familias-ordem-cliente.js', import.meta.url), 'utf8');

function tela() {
  const eventos = {}, eventosDocumento = {}, chamadas = [];
  const estado = { html: '', erro: false, dados: [
    { id: 1, nome: 'Vara A', ordem: 2, itens: ['01'] },
    { id: 2, nome: 'Vara B', ordem: 1, itens: ['02'] }
  ] };
  const document = {
    hidden: false, activeElement: null,
    addEventListener(nome, fn) { eventosDocumento[nome] = fn; },
    querySelectorAll: () => [],
    getElementById: () => ({ get innerHTML() { return estado.html; }, set innerHTML(v) { estado.html = v; } })
  };
  const window = { addEventListener(nome, fn) { eventos[nome] = fn; } };
  const carrinho = { '01': { qtd: 10 } };
  const c = { document, window, carrinho, todasFamilias: structuredClone(estado.dados),
    grupoAtual: 'VARAS', buscaAtual: '', modelosIscaSelecionados: {},
    filtrar: () => ['01','02'].map(codigo => ({ codigo, grupo: 'VARAS', atributos: {} })),
    renderizarAgrupados: () => [], renderFamiliaVara: f => `<h2>${f.nome}</h2>`,
    console: { warn() {} }, setTimeout: fn => fn(),
    fetch: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      if (estado.erro) throw new Error('Sem rede');
      return { ok: true, json: async () => ({ ok: true, familias: structuredClone(estado.dados) }) };
    }
  };
  vm.createContext(c);
  vm.runInContext(renderer + '\n' + atualizador, c);
  c.renderizar();
  return { c, estado, eventos, eventosDocumento, chamadas, document, window, carrinho,
    nomes: () => load(estado.html)('h2').map((_, n) => load(estado.html)(n).text()).get()
  };
}

test('Index aberto aplica a ordem nova ao voltar a aba, usando o renderer real', async () => {
  const t = tela();
  assert.deepEqual(t.nomes(), ['Vara B', 'Vara A']);
  t.estado.dados[0].ordem = 1; t.estado.dados[1].ordem = 2;
  await t.eventos.focus();
  assert.deepEqual(t.nomes(), ['Vara A', 'Vara B']);
  assert.equal(t.chamadas[0].opcoes.cache, 'no-store');
  assert.equal(t.carrinho['01'].qtd, 10);
});
test('Aviso de outra aba recarrega somente as familias', async () => {
  const t = tela();
  t.estado.dados[0].ordem = 1; t.estado.dados[1].ordem = 2;
  t.eventos.storage({ key: 'catalogo_familias_ordem_atualizada' });
  await t.window.atualizarOrdemFamilias();
  assert.deepEqual(t.nomes(), ['Vara A', 'Vara B']);
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.chamadas[0].url, '/api/familias');
});
test('Atualizacao preserva campo de quantidade em foco e aplica ao sair dele', async () => {
  const t = tela();
  t.document.activeElement = { matches: () => true };
  t.estado.dados[0].ordem = 1; t.estado.dados[1].ordem = 2;
  await t.eventos.focus();
  assert.deepEqual(t.nomes(), ['Vara B', 'Vara A']);
  t.document.activeElement = null;
  t.eventosDocumento.focusout();
  assert.deepEqual(t.nomes(), ['Vara A', 'Vara B']);
  assert.equal(t.carrinho['01'].qtd, 10);
});
test('Sem rede preserva catalogo e carrinho existentes', async () => {
  const t = tela(); t.estado.erro = true;
  await t.eventos.focus();
  assert.deepEqual(t.nomes(), ['Vara B', 'Vara A']);
  assert.equal(t.carrinho['01'].qtd, 10);
});
test('Nao consulta em segundo plano e troca de grupo solicita ordem atualizada', async () => {
  const t = tela(); t.document.hidden = true;
  await t.window.atualizarOrdemFamilias();
  assert.equal(t.chamadas.length, 0);
  const a = script.indexOf('function trocarGrupo(');
  const trocarGrupo = script.slice(a, script.indexOf('\nfunction ', a + 1));
  assert.ok(trocarGrupo.includes('window.atualizarOrdemFamilias?.()'));
});
test('Secoes atualizam mesmo sem mudar a ordem das familias e podem voltar ao visual anterior', async () => {
  const t = tela();
  vm.runInContext(fs.readFileSync(new URL('familias-secoes.js', import.meta.url), 'utf8'), t.c);
  t.c.escapeHtml = v => String(v);
  let ativo = true;
  t.window.CatalogoSecoes.carregar = async () => ({ grupos: [{ grupo: 'VARAS', ativo, secoes: [
    { id: 'primeira', nome: 'Primeira seção', familias: ['1'] },
    { id: 'segunda', nome: 'Segunda seção', familias: ['2'] }
  ] }] });
  await t.eventos.focus();
  assert.deepEqual(t.nomes(), ['Primeira seção', 'Vara A', 'Segunda seção', 'Vara B']);
  ativo = false;
  await t.eventos.focus();
  assert.deepEqual(t.nomes(), ['Vara B', 'Vara A']);
  assert.equal(t.carrinho['01'].qtd, 10);
});
