import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';

const codigo = fs.readFileSync(new URL('familias-ordem-admin.js', import.meta.url), 'utf8');
const cadastros = [
  { id: 1, nome: 'Solara', ordem: 2, subgrupos: '["001"]' },
  { id: 2, nome: 'Evolution', ordem: 1, itens: ['002'] },
  { id: 3, nome: 'Linha', ordem: 1, itens: ['003'] }
];
const produtos = [
  { codigo: '001', grupo_scraping: 'VARAS', estoque: 10, imagem_url: 'https://exemplo/foto.jpg' },
  { codigo: '002', grupo_scraping: 'VARAS', estoque: 0 },
  { codigo: '003', grupo_scraping: 'LINHAS', estoque: 2 }
];

function tela() {
  const $ = load('<div id="ordenacao-visual-familias"></div>');
  const wrappers = new WeakMap(), eventos = new WeakMap();
  function wrap(node) {
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);
    const e = $(node), handlers = {};
    eventos.set(node, handlers);
    const item = {
      addEventListener: (nome, fn) => { handlers[nome] = fn; },
      querySelector: seletor => wrap(e.find(seletor)[0]),
      querySelectorAll: seletor => e.find(seletor).toArray().map(wrap),
      closest: seletor => wrap(e.closest(seletor)[0]),
      focus() {},
      get dataset() { return Object.fromEntries(Object.entries(e.attr() || {}).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5), v])); },
      classList: { add: c => e.addClass(c), remove: (...c) => c.forEach(v => e.removeClass(v)) },
      get innerHTML() { return e.html(); }, set innerHTML(v) { e.html(v); },
      get textContent() { return e.text(); }, set textContent(v) { e.text(v); },
      get value() { return e.val(); }, set value(v) { e.val(v); },
      get disabled() { return e.attr('disabled') !== undefined; },
      set disabled(v) { if (v) e.attr('disabled', ''); else e.removeAttr('disabled'); }
    };
    wrappers.set(node, item);
    return item;
  }
  const estado = { requests: [], falhar: null, confirmar: true, eventosJanela: {}, persistidos: structuredClone(cadastros), ignorarGravacao: false };
  const window = { addEventListener: (nome, fn) => { estado.eventosJanela[nome] = fn; } };
  const c = { window, document: { getElementById: id => wrap($('#' + id)[0]) }, confirm: () => estado.confirmar,
    fetch: async (url, opcoes) => {
      if (url === '/api/familias') return { ok: true, json: async () => ({ ok: true, familias: estado.persistidos }) };
      estado.requests.push({ url, body: JSON.parse(opcoes.body), method: opcoes.method });
      const falha = estado.falhar === estado.requests.length;
      if (!falha && !estado.ignorarGravacao) {
        const id = url.split('/')[3];
        estado.persistidos.find(f => String(f.id) === id).ordem = JSON.parse(opcoes.body).ordem;
      }
      return { ok: !falha, json: async () => ({ ok: !falha, erro: falha ? 'Falha simulada' : undefined }) };
    }
  };
  vm.createContext(c);
  vm.runInContext(codigo, c);
  const selecionar = grupo => { $('#ordem-grupo').val(grupo); return disparar('#ordem-grupo', 'change'); };
  const disparar = (seletor, evento, dados = {}) => {
    const node = $(seletor)[0];
    const item = wrap(node);
    return eventos.get(node)[evento]({ target: item, preventDefault() {}, ...dados });
  };
  const mover = (id, delta) => disparar('#ordem-lista', 'click', { target: wrap($(`[data-familia="${id}"] [data-mover="${delta}"]`)[0]) });
  const ids = () => $('[data-familia]').toArray().map(n => $(n).attr('data-familia'));
  window.ordenacaoFamilias.atualizar(structuredClone(cadastros), structuredClone(produtos));
  selecionar('VARAS');
  return { $, estado, window, selecionar, disparar, mover, ids, wrap };
}

test('Agrupa e ordena como o catalogo, com foto e familia sem estoque', () => {
  const t = tela();
  assert.deepEqual(t.ids(), ['2', '1']);
  assert.equal(t.$('.ordem-foto[src]').length, 1);
  assert.ok(t.$('[data-familia="2"]').text().includes('0 em estoque'));
  assert.notEqual(t.$('#ordem-salvar').attr('disabled'), undefined);
});
test('Setas mudam a previa sem gravar; descartar volta a sequencia salva', () => {
  const t = tela();
  t.mover('1', '-1');
  assert.deepEqual(t.ids(), ['1', '2']);
  assert.equal(t.estado.requests.length, 0);
  t.disparar('#ordem-descartar', 'click');
  assert.deepEqual(t.ids(), ['2', '1']);
});
test('Arrastar muda a mesma sequencia, sem publicar automaticamente', () => {
  const t = tela();
  t.disparar('#ordem-lista', 'dragstart', { target: t.wrap(t.$('[data-familia="1"] .ordem-pega')[0]), dataTransfer: { setData() {} } });
  t.disparar('#ordem-lista', 'drop', { target: t.wrap(t.$('[data-familia="2"]')[0]) });
  assert.deepEqual(t.ids(), ['1', '2']);
  assert.equal(t.estado.requests.length, 0);
});
test('Numero azul reposiciona carretilhas e renumera as demais antes de salvar', async () => {
  const t = tela();
  const itens = structuredClone(produtos).map(p => ({ ...p, grupo_scraping: 'CARRETILHAS' }));
  t.window.ordenacaoFamilias.atualizar(cadastros, itens);
  t.selecionar('CARRETILHAS');
  const campo = t.wrap(t.$('[data-familia="1"] [data-posicao]')[0]);
  campo.value = '1';
  t.disparar('#ordem-lista', 'change', { target: campo });
  assert.deepEqual(t.ids(), ['1', '2', '3']);
  assert.deepEqual(t.$('[data-posicao]').toArray().map(n => t.$(n).val()), ['1', '2', '3']);
  assert.equal(t.estado.requests.length, 0);
  await t.disparar('#ordem-salvar', 'click');
  assert.deepEqual(t.estado.requests.map(r => r.body.ordem), [1, 2, 3]);
  assert.deepEqual(t.estado.requests.map(r => r.url), ['/api/familias/1/ordem', '/api/familias/2/ordem', '/api/familias/3/ordem']);
});
test('Enter aplica a posicao digitada', () => {
  const t = tela();
  const campo = t.wrap(t.$('[data-familia="1"] [data-posicao]')[0]);
  campo.value = '1';
  t.disparar('#ordem-lista', 'keydown', { target: campo, key: 'Enter' });
  assert.deepEqual(t.ids(), ['1', '2']);
});
test('Posicao vazia, fracionaria ou fora da lista nao altera a sequencia', () => {
  const t = tela();
  for (const valor of ['', '0', '-1', '1.5', '99']) {
    const campo = t.wrap(t.$('[data-familia="1"] [data-posicao]')[0]);
    campo.value = valor;
    t.disparar('#ordem-lista', 'change', { target: campo });
    assert.deepEqual(t.ids(), ['2', '1']);
    assert.equal(String(campo.value), '2');
  }
  assert.equal(t.estado.requests.length, 0);
});
test('Salvar envia somente IDs e posicoes do grupo selecionado', async () => {
  const t = tela(); t.mover('1', '-1');
  await t.disparar('#ordem-salvar', 'click');
  assert.deepEqual(t.estado.requests, [
    { url: '/api/familias/1/ordem', body: { ordem: 1 }, method: 'PUT' },
    { url: '/api/familias/2/ordem', body: { ordem: 2 }, method: 'PUT' }
  ]);
  assert.ok(t.$('#ordem-mensagem').text().includes('Ordem salva'));
  assert.notEqual(t.$('#ordem-salvar').attr('disabled'), undefined);
});
test('Falha parcial preserva previa e permite repetir ate salvar tudo', async () => {
  const t = tela(); t.mover('1', '-1'); t.estado.falhar = 2;
  await t.disparar('#ordem-salvar', 'click');
  assert.ok(t.$('#ordem-mensagem').text().includes('1 de 2'));
  assert.equal(t.$('#ordem-salvar').attr('disabled'), undefined);
  assert.deepEqual(t.ids(), ['1', '2']);
  t.estado.falhar = null;
  await t.disparar('#ordem-salvar', 'click');
  assert.notEqual(t.$('#ordem-salvar').attr('disabled'), undefined);
});
test('Admin nao confirma sucesso quando o servidor responde OK sem persistir a ordem', async () => {
  const t = tela(); t.estado.ignorarGravacao = true; t.mover('1', '-1');
  await t.disparar('#ordem-salvar', 'click');
  assert.ok(t.$('#ordem-mensagem').text().includes('não devolveu a ordem solicitada'));
  assert.equal(t.$('#ordem-salvar').attr('disabled'), undefined);
  assert.ok(!t.$('#ordem-mensagem').text().includes('Ordem salva!'));
});
test('Troca de grupo pede descarte e atualizacao nao elimina previa pendente', () => {
  const t = tela(); t.mover('1', '-1'); t.estado.confirmar = false;
  t.selecionar('LINHAS');
  assert.equal(t.$('#ordem-grupo').val(), 'VARAS');
  t.window.ordenacaoFamilias.atualizar([], []);
  assert.deepEqual(t.ids(), ['1', '2']);
  t.estado.confirmar = true; t.selecionar('LINHAS');
  assert.deepEqual(t.ids(), ['3']);
});
test('Apos falha parcial voltar a previa inicial ainda permite salvar', async () => {
  const t = tela(); t.mover('1', '-1'); t.estado.falhar = 2;
  await t.disparar('#ordem-salvar', 'click');
  t.mover('1', '1');
  assert.deepEqual(t.ids(), ['2', '1']);
  assert.equal(t.$('#ordem-salvar').attr('disabled'), undefined);
  t.estado.falhar = null;
  await t.disparar('#ordem-salvar', 'click');
  assert.notEqual(t.$('#ordem-salvar').attr('disabled'), undefined);
});
test('Nomes com HTML e aspas sao exibidos como texto', () => {
  const t = tela();
  const familias = structuredClone(cadastros);
  familias[0].nome = 'Vara <img src=x onerror=alert(1)> "Especial"';
  t.window.ordenacaoFamilias.atualizar(familias, produtos);
  assert.equal(t.$('img[onerror]').length, 0);
  assert.ok(t.$('.ordem-nome').text().includes('<img src=x'));
});

const server = fs.readFileSync(new URL('server_novo.js', import.meta.url), 'utf8');
const inicio = server.indexOf("app.put('/api/familias/:id/ordem'");
const rota = server.slice(inicio, server.indexOf('\n});', inicio) + 4);
async function gravar({ id = '1', ordem = 2, encontrado = true, falha = false } = {}) {
  const consultas = []; let handler, status = 200, resposta;
  const supabase = { from(tabela) {
    const q = { update(payload) { consultas.push({ tabela, payload }); return q; },
      eq(campo, valor) { consultas.at(-1).filtro = [campo, valor]; return q; },
      async select() { return { data: encontrado ? [{ id, ordem }] : [], error: falha ? new Error('Falha simulada') : null }; }
    }; return q;
  } };
  const c = { supabase, app: { put: (path, fn) => { handler = fn; } } };
  vm.createContext(c); vm.runInContext(rota, c);
  await handler({ params: { id }, body: { ordem, nome: 'NAO ALTERAR', itens: [] } }, { status(n) { status = n; return this; }, json(v) { resposta = v; } });
  return { consultas: JSON.parse(JSON.stringify(consultas)), status, resposta };
}
test('Servidor altera somente ordem na tabela correta, preservando a familia', async () => {
  const r = await gravar();
  assert.equal(r.resposta.ok, true);
  assert.deepEqual(r.consultas, [{ tabela: 'catalogo_familias', payload: { ordem: 2 }, filtro: ['id', '1'] }]);
});
test('Servidor rejeita posicoes invalidas antes de consultar o banco', async () => {
  for (const ordem of [-1, 0, 1.5, '2', null]) {
    const r = await gravar({ ordem });
    assert.equal(r.status, 400); assert.equal(r.consultas.length, 0);
  }
});
test('Servidor nao confirma familia ausente nem falha de gravacao', async () => {
  assert.equal((await gravar({ encontrado: false })).status, 404);
  assert.equal((await gravar({ falha: true })).status, 500);
});
