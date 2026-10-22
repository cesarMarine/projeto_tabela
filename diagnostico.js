// ================================================================
// diagnostico.js — descobre as COLUNAS da tabela de cada categoria
// Uso: node diagnostico.js
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';

const CATEGORIAS = [
    { nome: 'ACESSORIOS', url: 'https://loja.marinefishing.com.br/produtos/acessarios/filter?d=4' },
    { nome: 'ANZOL_E_GARATEIA', url: 'https://loja.marinefishing.com.br/produtos/anzol-e-garateia/filter?d=23' },
    { nome: 'CARRETILHA', url: 'https://loja.marinefishing.com.br/produtos/carretilha/filter?d=27' },
    { nome: 'EMPATE_GIRADORES_SNAPS', url: 'https://loja.marinefishing.com.br/produtos/empate-giradores-e-snaps/filter?d=24' },
    { nome: 'ISCA', url: 'https://loja.marinefishing.com.br/produtos/isca/filter?d=3' },
    { nome: 'LINHA', url: 'https://loja.marinefishing.com.br/produtos/linha/filter?d=31' },
    { nome: 'MOLINETE', url: 'https://loja.marinefishing.com.br/produtos/molinete/filter?d=1' },
    { nome: 'MOTOR_ELETRICO', url: 'https://loja.marinefishing.com.br/produtos/motor-elatrico/filter?d=32' }
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function baixar(url) {
    const resp = await fetch(url, {
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('🔍 DIAGNÓSTICO — Colunas de cada categoria');
console.log('══════════════════════════════════════════════════════════════');
console.log('');

const resultado = []; // { categoria, subgrupo, colunas[] }

for (const cat of CATEGORIAS) {
    console.log(`📦 [${cat.nome}]`);
    console.log(`   ${cat.url}`);

    let html;
    try {
        html = await baixar(cat.url);
    } catch (e) {
        console.log(`   ❌ Erro: ${e.message}`);
        console.log('');
        continue;
    }

    const $ = cheerio.load(html);

    // Pega as primeiras 3 URLs de produto da listagem
    const produtosUrls = [];
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/produto/') && href.endsWith('.html')) {
            let url = href;
            if (!url.startsWith('http')) {
                const base = new URL(cat.url);
                url = `${base.protocol}//${base.host}${href.startsWith('/') ? '' : '/'}${href}`;
            }
            if (!produtosUrls.includes(url) && produtosUrls.length < 3) {
                produtosUrls.push(url);
            }
        }
    });

    console.log(`   → Analisando ${produtosUrls.length} produtos:`);

    for (const urlProduto of produtosUrls) {
        try {
            await sleep(800);
            const htmlProduto = await baixar(urlProduto);
            const $p = cheerio.load(htmlProduto);

            // Nome do produto (h1)
            let nomeProduto = $p('h1').first().text().trim() || $p('title').text().trim();
            nomeProduto = nomeProduto.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();

            // 🔍 LÊ O CABEÇALHO DA TABELA
            const colunasCabecalho = [];
            $p('#subprodutos thead tr th').each((i, th) => {
                const nome = $p(th).text().trim().replace(/\s+/g, ' ');
                if (nome) colunasCabecalho.push(nome);
            });

            // Conta linhas de variação
            let totalLinhas = 0;
            $p('#subprodutos tbody tr, #subprodutos tr').each((i, tr) => {
                const tds = $p(tr).find('td');
                if (tds.length >= 5) totalLinhas++;
            });

            console.log(`      ✅ ${urlProduto.split('/').pop()}`);
            console.log(`         ${nomeProduto}`);
            console.log(`         Colunas: [${colunasCabecalho.join(' | ')}]`);
            console.log(`         Variações: ${totalLinhas}`);

            resultado.push({
                categoria: cat.nome,
                urlProduto: urlProduto,
                subgrupo: nomeProduto,
                colunas: colunasCabecalho.join(' | '),
                qtd_colunas: colunasCabecalho.length,
                qtd_variacoes: totalLinhas
            });

        } catch (e) {
            console.log(`      ❌ Erro: ${e.message}`);
        }
    }

    console.log('');
}

// ================================================================
// AGRUPA RESULTADO POR CATEGORIA (pra ver o padrão)
// ================================================================
console.log('══════════════════════════════════════════════════════════════');
console.log('📊 RESUMO — Colunas por categoria');
console.log('══════════════════════════════════════════════════════════════');
console.log('');

const porCategoria = {};
for (const r of resultado) {
    if (!porCategoria[r.categoria]) porCategoria[r.categoria] = new Set();
    for (const col of r.colunas.split(' | ')) {
        if (col.trim()) porCategoria[r.categoria].add(col.trim());
    }
}

for (const [cat, colsSet] of Object.entries(porCategoria)) {
    console.log(`📦 ${cat}`);
    console.log(`   Colunas: [${Array.from(colsSet).join(' | ')}]`);
    console.log('');
}

// ================================================================
// GERA EXCEL
// ================================================================
const wb = XLSX.utils.book_new();

const ws = XLSX.utils.json_to_sheet(resultado);
ws['!cols'] = [
    { wch: 22 },  // categoria
    { wch: 60 },  // urlProduto
    { wch: 45 },  // subgrupo
    { wch: 60 },  // colunas
    { wch: 12 },  // qtd_colunas
    { wch: 12 }   // qtd_variacoes
];
XLSX.utils.book_append_sheet(wb, ws, 'Detalhes');

const resumoFinal = Object.entries(porCategoria).map(([cat, colsSet]) => ({
    CATEGORIA: cat,
    COLUNAS: Array.from(colsSet).join(' | '),
    QTD_COLUNAS: colsSet.size
}));
const wsResumo = XLSX.utils.json_to_sheet(resumoFinal);
wsResumo['!cols'] = [{ wch: 25 }, { wch: 80 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

XLSX.writeFile(wb, 'diagnostico_colunas.xlsx');

console.log('💾 Arquivo salvo: diagnostico_colunas.xlsx');
console.log('   Aba 1: Detalhes (cada produto analisado)');
console.log('   Aba 2: Resumo (colunas por categoria)');
console.log('');