import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';

const index = load(fs.readFileSync(new URL('index.html', import.meta.url), 'utf8'));
const clientScript = index('script:not([src])').map((_, element) => index(element).html()).get().find(text => text.includes('let todosItens'));
const adminHtml = fs.readFileSync(new URL('admin_novo.html', import.meta.url), 'utf8');
const admin = load(adminHtml);
const adminScript = admin('script:not([src])').map((_, element) => admin(element).html()).get().find(text => text.includes('const selecionadosAuditoria'));
const auditoria = adminScript.slice(adminScript.indexOf('const selecionadosAuditoria'), adminScript.indexOf('\nasync function carregarDados'));

function clientFunction(name) {
    const start = clientScript.indexOf(`function ${name}(`);
    return clientScript.slice(start, clientScript.indexOf('\nfunction ', start + 1));
}

test('busca ignora acentos nos dois sentidos, caixa e formato Unicode', () => {
    const context = vm.createContext({
        todosItens: [
            { codigo: '001', subgrupo: 'Óculos', marca: 'MARINÉ', grupo: 'Acessórios' },
            { codigo: '002', subgrupo: 'Peças de reposição', marca: 'Teste', grupo: 'Acessórios' },
            { codigo: 123, descricao_sistema: 'Linha de ação rápida', grupo: 'Linhas' },
        ], buscaAtual: '', grupoAtual: '__TODOS__', marcaAtual: '',
    });
    vm.runInContext(clientFunction('normalizarBuscaProdutos') + '\n' + clientFunction('filtrar'), context);
    for (const [query, expected] of [
        ['pecas', ['002']], ['PEÇAS', ['002']], ['pec\u0327as', ['002']],
        ['oculos', ['001']], ['ÓCULOS', ['001']], ['marine', ['001']],
        ['acessorios', ['001', '002']], ['acao rapida', [123]], ['123', [123]], ['001', ['001']],
    ]) {
        context.buscaAtual = query;
        assert.deepEqual(Array.from(context.filtrar(), product => product.codigo), expected, query);
    }
    context.buscaAtual = '';
    context.grupoAtual = 'Acessórios';
    context.marcaAtual = 'mariné';
    assert.deepEqual(Array.from(context.filtrar(), product => product.codigo), ['001']);
});

test('busca também recebe a descrição do sistema após normalizar o catálogo real', () => {
    const context = vm.createContext({ parseAtributos: () => ({}), todosItens: [], buscaAtual: 'protecao', grupoAtual: '__TODOS__', marcaAtual: '' });
    vm.runInContext(clientFunction('normalizarItem') + '\n' + clientFunction('normalizarBuscaProdutos') + '\n' + clientFunction('filtrar'), context);
    context.todosItens = [context.normalizarItem({ codigo: '0001', descricao_sistema: 'Óculos de proteção', subgrupo_scraping: 'Linha especial' })];
    assert.deepEqual(Array.from(context.filtrar(), product => product.codigo), ['0001']);
});

function screen() {
    const $ = load(adminHtml);
    const wrappers = new WeakMap();
    function wrap(node) {
        if (!node) return null;
        if (wrappers.has(node)) return wrappers.get(node);
        const el = $(node);
        const item = {
            style: {}, indeterminate: false,
            get dataset() { return Object.fromEntries(Object.entries(el.attr() || {}).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])); },
            get checked() { return el.attr('checked') !== undefined; },
            set checked(value) { if (value) el.attr('checked', ''); else el.removeAttr('checked'); },
            get disabled() { return el.attr('disabled') !== undefined; },
            set disabled(value) { if (value) el.attr('disabled', ''); else el.removeAttr('disabled'); },
            get hidden() { return el.attr('hidden') !== undefined; },
            set hidden(value) { if (value) el.attr('hidden', ''); else el.removeAttr('hidden'); },
            get textContent() { return el.text(); },
            set textContent(value) { el.text(value); },
            get innerHTML() { return el.html(); },
            set innerHTML(value) { el.html(value); },
        };
        wrappers.set(node, item);
        return item;
    }
    const document = {
        getElementById: id => wrap($(`[id="${id}"]`)[0]),
        querySelector: selector => wrap($(selector)[0]),
        querySelectorAll: selector => $(selector).toArray().map(wrap),
    };
    const state = {
        products: [
            { codigo: '0001', descricao: 'Peça primeira', estoque: 2, preco: 10 },
            { codigo: '0002', descricao: 'Óculos', estoque: 3, preco: 20 },
            { codigo: '0003', descricao: 'Produto "especial" \' <img src=x onerror=alert(1)>', estoque: 4, preco: 30 },
        ], requests: [], confirmations: [], confirm: true, failures: new Set(), statusReloads: 0, modal: null,
    };
    const context = vm.createContext({
        document,
        escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        confirm: message => { state.confirmations.push(message); return state.confirm; },
        abrirModalManual: (...args) => { state.modal = args; },
        carregarStatus: async () => { state.statusReloads++; },
        fetch: async (url, options = {}) => {
            state.requests.push({ url, ...options });
            if (options.method === 'DELETE') {
                const code = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
                if (state.failures.has(code)) return { ok: false, json: async () => ({ ok: false, erro: 'Falha simulada' }) };
                state.products = state.products.filter(product => product.codigo !== code);
                return { ok: true, json: async () => ({ ok: true, codigo: code }) };
            }
            assert.equal(url, '/api/admin/auditoria-scraping');
            return { ok: true, json: async () => ({ ok: true, total_estoque: state.products.length, com_match: 0, sem_match_qtd: state.products.length, produtos_sem_match: state.products }) };
        },
    });
    vm.runInContext(auditoria, context);
    const boxes = () => document.querySelectorAll('#tabelaAuditoria .auditoria-selecao');
    const select = index => { const box = boxes()[index]; box.checked = true; context.selecionarProdutoAuditoria(box); };
    return { $, document, context, state, boxes, select };
}

test('auditoria permite selecionar todos, limpar e mostra seleção parcial', async () => {
    const s = screen();
    assert.equal(s.$('#selecionarTodosAuditoria').closest('table').attr('id'), 'tabelaAuditoria');
    assert.equal(s.$('#tabelaAuditoria thead th').length, 6);
    await s.context.carregarAuditoria();
    assert.equal(s.boxes().length, 3);
    assert.equal(s.document.getElementById('btnExcluirSelecionadosAuditoria').disabled, true);
    s.select(0);
    const all = s.document.getElementById('selecionarTodosAuditoria');
    assert.equal(all.indeterminate, true);
    all.checked = true;
    s.context.selecionarTodosAuditoria(all);
    assert.equal(s.boxes().every(box => box.checked), true);
    assert.equal(s.document.getElementById('auditoriaSelecionados').textContent, '3 selecionado(s)');
    s.context.limparSelecaoAuditoria();
    assert.equal(s.boxes().some(box => box.checked), false);
    assert.equal(all.indeterminate, false);
});

test('exclui somente selecionados, com uma confirmação e mantendo zeros dos códigos', async () => {
    const s = screen();
    await s.context.carregarAuditoria();
    s.select(0); s.select(2);
    await s.context.excluirSelecionadosAuditoria();
    const deletes = s.state.requests.filter(request => request.method === 'DELETE');
    assert.equal(s.state.confirmations.length, 1);
    assert.deepEqual(deletes.map(request => JSON.parse(request.body).confirmar), ['0001', '0003']);
    assert.equal(deletes[0].url, '/api/admin/auditoria-produtos/0001');
    assert.deepEqual(s.state.products.map(product => product.codigo), ['0002']);
    assert.equal(s.state.statusReloads, 1);
    assert.match(s.document.getElementById('auditoriaProgresso').textContent, /2 exclusão/);
    assert.equal(s.document.getElementById('btnExcluirSelecionadosAuditoria').disabled, true);
});

test('cancelamento ou seleção vazia não enviam exclusão', async () => {
    const s = screen();
    await s.context.carregarAuditoria();
    await s.context.excluirSelecionadosAuditoria();
    assert.equal(s.state.confirmations.length, 0);
    s.select(0); s.state.confirm = false;
    await s.context.excluirSelecionadosAuditoria();
    assert.equal(s.state.requests.filter(request => request.method === 'DELETE').length, 0);
    assert.equal(s.boxes()[0].checked, true);
});

test('falha parcial mantém item restante selecionado para tentar novamente', async () => {
    const s = screen();
    await s.context.carregarAuditoria();
    s.select(0); s.select(1);
    s.state.failures.add('0002');
    await s.context.excluirSelecionadosAuditoria();
    assert.deepEqual(s.state.products.map(product => product.codigo), ['0002', '0003']);
    assert.equal(s.boxes()[0].dataset.codigo, '0002');
    assert.equal(s.boxes()[0].checked, true);
    assert.equal(s.document.getElementById('btnExcluirSelecionadosAuditoria').disabled, false);
    assert.match(s.document.getElementById('auditoriaProgresso').textContent, /1 falha/);
});

test('descrições com aspas e HTML não quebram seleção ou cadastro', async () => {
    const s = screen();
    await s.context.carregarAuditoria();
    assert.equal(s.$('#tabelaAuditoria tbody img').length, 0);
    const button = s.document.querySelector('#tabelaAuditoria button[data-codigo="0003"][data-descricao]');
    s.context.abrirCadastroProdutoAuditoria(button);
    assert.deepEqual(s.state.modal, ['0003', s.state.products[2].descricao]);
});
