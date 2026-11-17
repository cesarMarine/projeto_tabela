import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';
import { registrarSecoesFamilias, validarSecoes } from './familias-secoes-server.js';

const ler = nome => fs.readFileSync(new URL(nome, import.meta.url), 'utf8');
const compartilhado = ler('familias-secoes.js');
const familia = (id, nome, codigo, ordem = id) => ({ id, nome, itens: [codigo], ordem });
const familias = [familia(1, 'Carretilha A', '01'), familia(2, 'Carretilha B', '02'), familia(3, 'Carretilha C', '03')];
const produtos = ['01', '02', '03'].map(codigo => ({ codigo, grupo: 'CARRETILHAS', grupo_scraping: 'CARRETILHAS', estoque: 10, atributos: {} }));
const config = { grupo: 'CARRETILHAS', ativo: true, secoes: [
  { id: 'perfil-baixo', nome: 'Perfil baixo', familias: ['1', '2'] },
  { id: 'pesqueiro', nome: 'Pesqueiro', familias: ['3'] }
] };
function regras() {
  const c = { window: {} }; vm.createContext(c); vm.runInContext(compartilhado, c);
  return c.window.CatalogoSecoes;
}
test('Sem configuracao ou com secoes ocultas a ordem original e preservada', () => {
  const r = regras();
  const entradas = [familias[0], { agrupado: true, html: 'Kit' }, familias[1]];
  assert.equal(r.organizar(entradas, produtos, []), entradas);
  assert.equal(r.organizar(entradas, produtos, [{ ...config, ativo: false }]), entradas);
});
test('Titulos seguem a ordem das secoes e familias seguem sua ordem dentro delas', () => {
  const r = regras();
  const resultado = r.organizar([familias[2], familias[1], familias[0]], produtos, [config]);
  assert.deepEqual(Array.from(resultado, f => f.cabecalhoSecao ? f.nome : f.id), ['Perfil baixo', 2, 1, 'Pesqueiro', 3]);
  const invertida = { ...config, secoes: [...config.secoes].reverse() };
  assert.deepEqual(Array.from(r.organizar(familias, produtos, [invertida]), f => f.cabecalhoSecao ? f.nome : f.id), ['Pesqueiro', 3, 'Perfil baixo', 1, 2]);
});
test('Busca e falta de estoque nao geram titulos vazios; familias restantes continuam disponiveis', () => {
  const r = regras();
  const parcial = r.organizar(familias, produtos.filter(p => p.codigo === '03'), [config]);
  assert.deepEqual(Array.from(parcial.filter(f => f.cabecalhoSecao), f => f.nome), ['Pesqueiro']);
  const semSecao = { ...config, secoes: [config.secoes[0]] };
  assert.deepEqual(Array.from(r.organizar(familias, produtos, [semSecao]), f => f.cabecalhoSecao ? f.nome : f.id), ['Perfil baixo', 1, 2, 'Outras famílias', 3]);
});
test('Outra categoria e kits nao desaparecem nem duplicam', () => {
  const r = regras();
  const linha = familia(4, 'Linha', '04');
  const kit = { agrupado: true, nome: 'Kit', html: '<div>Kit</div>' };
  const resultado = r.organizar([familias[0], kit, linha, familias[1], familias[2]], [...produtos, { codigo: '04', grupo: 'LINHAS' }], [config]);
  for (const entrada of [...familias, linha, kit]) assert.equal(resultado.filter(f => f === entrada).length, 1);
});
test('Index real exibe titulo escapado e mantem os controles de quantidade', () => {
  const $ = load(ler('index.html'));
  const script = $('script:not([src])').map((_, e) => $(e).html()).get().find(s => s.includes('let todosItens'));
  const a = script.indexOf('function renderizar()');
  let html = '';
  const c = { window: {}, document: { querySelectorAll: () => [], getElementById: () => ({ set innerHTML(v) { html = v; } }) },
    todasFamilias: familias, grupoAtual: 'CARRETILHAS', buscaAtual: '', modelosIscaSelecionados: {},
    filtrar: () => produtos, renderizarAgrupados: () => [],
    renderFamiliaCarretilha: f => `<h3>${f.nome}</h3><input type="number" value="10">`,
    escapeHtml: v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  };
  vm.createContext(c); vm.runInContext(compartilhado, c);
  c.window.secoesCatalogo = [{ ...config, secoes: [{ ...config.secoes[0], nome: 'Perfil <baixo>' }, config.secoes[1]] }];
  vm.runInContext(script.slice(a, script.indexOf('\nfunction renderOfertas()', a)), c);
  c.renderizar();
  const dom = load(html);
  assert.deepEqual(dom('.catalogo-secao h2').map((_, e) => dom(e).text()).get(), ['Perfil <baixo>', 'Pesqueiro']);
  assert.equal(dom('baixo').length, 0);
  assert.equal(dom('input[value="10"]').length, 3);
  c.window.secoesCatalogo[0].ativo = false; c.renderizar();
  assert.equal(load(html)('.catalogo-secao').length, 0);
  assert.equal(load(html)('input[value="10"]').length, 3);
});

async function servidor({ body = config, erro = null, ids = ['1','2','3'] } = {}) {
  const rotas = {}, escritas = [];
  registrarSecoesFamilias({ get(p, fn) { rotas.get = fn; }, put(p, fn) { rotas.put = fn; } }, {
    from(tabela) {
      const q = { select() { return q; }, order: async () => ({ data: [config], error: erro }),
        in: async (campo, lote) => ({ data: ids.filter(id => lote.includes(id)).map(id => ({ id })), error: null }),
        upsert(payload) { escritas.push({ tabela, payload }); return q; },
        single: async () => ({ data: body, error: erro })
      }; return q;
    }
  });
  let status = 200, resposta;
  const res = { set() {}, status(n) { status = n; return this; }, json(v) { resposta = v; } };
  await rotas.put({ body }, res);
  const gravacao = { status, resposta };
  status = 200; await rotas.get({}, res);
  return { gravacao, leitura: { status, resposta }, escritas };
}
test('Servidor salva somente a configuracao do grupo em uma gravacao separada', async () => {
  const r = await servidor();
  assert.equal(r.gravacao.resposta.ok, true);
  assert.equal(r.escritas.length, 1);
  assert.equal(r.escritas[0].tabela, 'catalogo_secoes_familias');
  assert.deepEqual(r.escritas[0].payload.secoes, config.secoes);
});
test('Servidor rejeita familias repetidas entre secoes, nomes vazios e exibicao invalida', () => {
  assert.throws(() => validarSecoes({ ...config, secoes: [config.secoes[0], { ...config.secoes[1], familias: ['1'] }] }), /apenas uma/);
  assert.throws(() => validarSecoes({ ...config, secoes: [{ ...config.secoes[0], nome: '' }] }), /nome/);
  assert.throws(() => validarSecoes({ ...config, ativo: 'sim' }), /exibição/);
});
test('Familia ausente impede qualquer gravacao; erro do banco nao confirma sucesso', async () => {
  const ausente = await servidor({ ids: ['1', '2'] });
  assert.equal(ausente.gravacao.status, 409); assert.equal(ausente.escritas.length, 0);
  const falha = await servidor({ erro: { code: 'XX000', message: 'Falha simulada' } });
  assert.equal(falha.gravacao.status, 500); assert.equal(falha.leitura.status, 500);
});
test('Sem migracao catalogo recebe lista vazia e admin recebe instrucao sem apagar dados', async () => {
  const r = await servidor({ erro: { code: 'PGRST205' } });
  assert.equal(r.gravacao.status, 503);
  assert.equal(r.leitura.resposta.configurado, false);
  assert.deepEqual(r.leitura.resposta.grupos, []);
});

function admin({ configurado = true } = {}) {
  const $ = load('<div id="secoes-visuais-familias"></div>');
  const wrappers = new WeakMap(), handlers = new WeakMap();
  function wrap(node) {
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);
    const e = $(node), eventos = {};
    handlers.set(node, eventos);
    const campo = {
      addEventListener: (tipo, fn) => { eventos[tipo] = fn; },
      querySelector: seletor => wrap(e.find(seletor)[0]), querySelectorAll: seletor => e.find(seletor).toArray().map(wrap),
      closest: seletor => wrap(e.closest(seletor)[0]), hasAttribute: atributo => e.attr(atributo) !== undefined,
      get innerHTML() { return e.html(); }, set innerHTML(v) { e.html(v); },
      get textContent() { return e.text(); }, set textContent(v) { e.text(v); },
      get value() { return e.val(); }, set value(v) { e.val(v); },
      get checked() { return e.attr('checked') !== undefined; }, set checked(v) { if (v) e.attr('checked', ''); else e.removeAttr('checked'); },
      get disabled() { return e.attr('disabled') !== undefined; }, set disabled(v) { if (v) e.attr('disabled', ''); else e.removeAttr('disabled'); },
      get dataset() { return Object.fromEntries(Object.entries(e.attr() || {}).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5), v])); }
    };
    wrappers.set(node, campo); return campo;
  }
  const estado = { grupos: [], escritas: [], falhar: false };
  const window = { addEventListener() {} };
  const c = { window, document: { getElementById: id => wrap($('#'+id)[0]) }, confirm: () => true,
    crypto: { randomUUID: () => 'secao-' + (estado.escritas.length + $('.sec-card').length + 1) },
    fetch: async (url, opcoes) => {
      if (opcoes.method === 'PUT') {
        const body = JSON.parse(opcoes.body); estado.escritas.push(body);
        if (estado.falhar) return { ok: false, json: async () => ({ ok: false, erro: 'Falha simulada' }) };
        estado.grupos = [structuredClone(body)];
        return { ok: true, json: async () => ({ ok: true, configuracao: body }) };
      }
      return { ok: true, json: async () => ({ ok: true, configurado, grupos: estado.grupos }) };
    }
  };
  vm.createContext(c); vm.runInContext(compartilhado + '\n' + ler('familias-secoes-admin.js'), c);
  const disparar = (seletor, evento, target = null) => handlers.get($(seletor)[0])[evento]({ target: target || wrap($(seletor)[0]) });
  const selecionar = id => {
    const campo = wrap($(`[data-familia="${id}"]`)[0]); campo.checked = true;
    disparar('#sec-familias', 'change', campo);
  };
  const criar = (nome, ids) => { ids.forEach(selecionar); $('#sec-nome').val(nome); disparar('#sec-criar', 'click'); };
  return { $, estado, window, disparar, selecionar, criar, wrap,
    carregar: () => window.secoesFamilias.atualizar(familias, produtos) };
}
test('Admin cria secoes por familias e salva sem alterar cadastro ou ordem', async () => {
  const t = admin(); await t.carregar();
  t.criar('Perfil baixo', ['1','2']); t.criar('Pesqueiro', ['3']);
  assert.equal(t.estado.escritas.length, 0);
  assert.equal(t.$('.sec-card').length, 2);
  await t.disparar('#sec-salvar', 'click');
  assert.equal(t.estado.escritas.length, 1);
  assert.deepEqual(t.estado.escritas[0].secoes.map(s => s.familias), [['1','2'], ['3']]);
});
test('Faixa de posicoes seleciona familias por ID e secoes podem mudar de ordem', async () => {
  const t = admin(); await t.carregar();
  t.$('#sec-de').val('1'); t.$('#sec-ate').val('2'); t.disparar('#sec-faixa', 'click');
  t.$('#sec-nome').val('Perfil baixo'); t.disparar('#sec-criar', 'click');
  t.criar('Pesqueiro', ['3']);
  t.disparar('#sec-lista', 'click', t.wrap(t.$('.sec-card').last().find('[data-subir]')[0]));
  await t.disparar('#sec-salvar', 'click');
  assert.deepEqual(t.estado.escritas[0].secoes.map(s => s.nome), ['Pesqueiro', 'Perfil baixo']);
  assert.deepEqual(t.estado.escritas[0].secoes[1].familias, ['1','2']);
});
test('Admin move uma familia entre secoes sem duplicar e pode descartar', async () => {
  const t = admin(); await t.carregar();
  t.criar('Perfil baixo', ['1','2']); t.criar('Pesqueiro', ['3']);
  await t.disparar('#sec-salvar', 'click');
  t.selecionar('2'); t.$('#sec-destino').val(t.$('.sec-card').last().attr('data-secao'));
  t.disparar('#sec-mover', 'click');
  await t.disparar('#sec-salvar', 'click');
  assert.deepEqual(t.estado.escritas[1].secoes.map(s => s.familias), [['1'], ['3','2']]);
  t.criar('Temporaria', ['1']); t.disparar('#sec-descartar', 'click');
  assert.equal(t.$('.sec-card input[value="Temporaria"]').length, 0);
});
test('Admin pode ocultar secoes mantendo seus membros e nomes', async () => {
  const t = admin(); await t.carregar(); t.criar('Perfil baixo', ['1','2']);
  await t.disparar('#sec-salvar', 'click');
  t.$('#sec-ativo').removeAttr('checked'); t.disparar('#sec-ativo', 'change');
  await t.disparar('#sec-salvar', 'click');
  assert.equal(t.estado.escritas[1].ativo, false);
  assert.deepEqual(t.estado.escritas[1].secoes[0].familias, ['1','2']);
});
test('Admin preserva previa em falhas e bloqueia salvamento sem migracao', async () => {
  const t = admin(); await t.carregar(); t.criar('Perfil baixo', ['1']); t.estado.falhar = true;
  await t.disparar('#sec-salvar', 'click');
  assert.equal(t.$('.sec-card').length, 1);
  assert.equal(t.$('#sec-salvar').attr('disabled'), undefined);
  assert.ok(t.$('#sec-mensagem').text().includes('prévia foi mantida'));
  const vazio = admin({ configurado: false }); await vazio.carregar();
  assert.notEqual(vazio.$('#sec-salvar').attr('disabled'), undefined);
  assert.ok(vazio.$('#sec-mensagem').text().includes('familias-secoes.sql'));
});
