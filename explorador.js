// ================================================================
// explorador.js — extrai 1 página de CADA categoria e gera 1 Excel
// Uso: node explorador.js
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'fs';

// ────────────────────────────────────────────────────────────────
// LISTA DE CATEGORIAS
// ────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────
// PROCESSAMENTO
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('🕷️  EXPLORADOR DE CATEGORIAS');
console.log('══════════════════════════════════════════════════════════════');
console.log('');

const resumoGeral = [];

for (const cat of CATEGORIAS) {
    console.log(`📦 [${cat.nome}] ${cat.url}`);

    let html;
    try {
        html = await baixar(cat.url);
    } catch (e) {
        console.log(`   ❌ Erro ao baixar: ${e.message}`);
        resumoGeral.push({ categoria: cat.nome, url: cat.url, produtos: 0, erro: e.message });
        continue;
    }

    const $ = cheerio.load(html);

    // Conta quantos produtos vêm na listagem
    const produtosEncontrados = new Set();
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/produto/') && href.endsWith('.html')) {
            let url = href;
            if (!url.startsWith('http')) {
                const base = new URL(cat.url);
                url = `${base.protocol}//${base.host}${href.startsWith('/') ? '' : '/'}${href}`;
            }
            produtosEncontrados.add(url);
        }
    });

    const listaUrls = Array.from(produtosEncontrados);
    console.log(`   ✅ ${listaUrls.length} produtos na página`);

    if (!listaUrls.length) {
        resumoGeral.push({ categoria: cat.nome, url: cat.url, produtos: 0, variacoes: 0, erro: 'nenhum produto' });
        continue;
    }

    // Processa cada produto
    const produtos = [];
    let totalVariacoes = 0;
    let contador = 0;

    for (const urlProduto of listaUrls) {
        contador++;
        process.stdout.write(`   [${contador}/${listaUrls.length}] ${urlProduto.split('/').pop().slice(0, 50)}... `);

        try {
            await sleep(800); // 800ms entre requisições
            const htmlProduto = await baixar(urlProduto);
            const $p = cheerio.load(htmlProduto);

            // Nome
            let nomeProduto = $p('h1').first().text().trim() || $p('title').text().trim();
            nomeProduto = nomeProduto.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();

            // Marca
            let marca = '';
            const marcas = ['Megabass', 'Yo-zuri', 'Yozuri', 'Marine', 'Daiwa', 'Shimano', 'Rapala', 'Strike Pro', 'Inna', 'Raiglon', 'Siglon', 'Sunline', 'Zest'];
            for (const m of marcas) {
                if (htmlProduto.toLowerCase().includes(m.toLowerCase())) { marca = m; break; }
            }

            // Descrição longa
            let descricao = '';
            const $desc = $p('.item_product').first();
            if ($desc.length) {
                const partes = [];
                $desc.find('p').each((i, p) => {
                    const txt = $p(p).text().trim();
                    if (txt) partes.push(txt);
                });
                descricao = partes.join('\n\n');
            }

            // Variações
            const variacoes = [];
            $p('#subprodutos tbody tr, #subprodutos tr').each((i, tr) => {
                const tds = $p(tr).find('td');
                if (tds.length < 5) return;

                // Foto
                let link = '';
                const $a = $p(tds[0]).find('a.fancybox');
                if ($a.length) link = $a.attr('href') || '';
                else {
                    const src = $p(tds[0]).find('img').attr('src') || '';
                    link = src.replace('/400/', '/1500/');
                }

                // Colunas
                const modelo = $p(tds[1]).text().trim();
                const cor = $p(tds[2]).text().trim();
                const tamanho = $p(tds[3]).text().trim();
                const peso = $p(tds[4]).text().trim();

                const codHtml = $p(tds[5]).html() || '';
                const partes = codHtml.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
                const codigo = partes[0] || '';
                const codBarras = partes[1] || '';

                if (!codigo) return;

                variacoes.push({
                    modelo,
                    cor,
                    tamanho,
                    peso,
                    codigo,
                    cod_barras: codBarras,
                    imagem: link
                });
            });

            produtos.push({
                subgrupo: nomeProduto,
                marca,
                descricao: descricao.replace(/\n+/g, ' ').slice(0, 200) + (descricao.length > 200 ? '...' : ''),
                url: urlProduto,
                qtd_variacoes: variacoes.length,
                variacoes
            });

            totalVariacoes += variacoes.length;
            console.log(`✅ (${variacoes.length} var)`);

        } catch (e) {
            console.log(`❌ ${e.message}`);
        }
    }

    // ---- GERA EXCEL DA CATEGORIA ----
    const aba1 = produtos.map(p => ({
        SUBGRUPO: p.subgrupo,
        MARCA: p.marca,
        QTD_VARIACOES: p.qtd_variacoes,
        URL: p.url,
        DESCRICAO_PREVIEW: p.descricao
    }));

    // Achata as variações em 1 linha cada
    const aba2 = [];
    for (const p of produtos) {
        for (const v of p.variacoes) {
            aba2.push({
                SUBGRUPO: p.subgrupo,
                MARCA: p.marca,
                MODELO: v.modelo,
                COR: v.cor,
                TAMANHO: v.tamanho,
                PESO: v.peso,
                CODIGO: v.codigo,
                COD_BARRAS: v.cod_barras,
                LINK_IMAGEM: v.imagem
            });
        }
    }

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(aba1);
    ws1['!cols'] = [
        { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 50 }, { wch: 60 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Produtos');

    const ws2 = XLSX.utils.json_to_sheet(aba2);
    ws2['!cols'] = [
        { wch: 40 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 60 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Variacoes');

    const arquivo = `explorador_${cat.nome}.xlsx`;
    XLSX.writeFile(wb, arquivo);

    console.log(`   💾 ${arquivo} — ${produtos.length} produtos, ${totalVariacoes} variações`);
    console.log('');

    resumoGeral.push({
        categoria: cat.nome,
        url: cat.url,
        produtos: produtos.length,
        variacoes: totalVariacoes,
        arquivo
    });
}

// ────────────────────────────────────────────────────────────────
// RESUMO FINAL
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('📊 RESUMO GERAL');
console.log('══════════════════════════════════════════════════════════════');
console.log('');
console.log('CATEGORIA'.padEnd(28) + 'PRODUTOS'.padEnd(12) + 'VARIACOES'.padEnd(12) + 'ARQUIVO');
console.log('─'.repeat(100));

let totalProd = 0, totalVar = 0;
for (const r of resumoGeral) {
    const nome = (r.categoria || '?').padEnd(28);
    const prod = String(r.produtos || 0).padEnd(12);
    const varQ = String(r.variacoes || 0).padEnd(12);
    const arq = r.arquivo || r.erro || '—';
    console.log(nome + prod + varQ + arq);
    totalProd += r.produtos || 0;
    totalVar += r.variacoes || 0;
}
console.log('─'.repeat(100));
console.log('TOTAL'.padEnd(28) + String(totalProd).padEnd(12) + String(totalVar).padEnd(12));
console.log('');

// Resumo consolidado em 1 Excel
const resumoFinal = resumoGeral.map(r => ({
    CATEGORIA: r.categoria,
    URL: r.url,
    PRODUTOS: r.produtos,
    VARIACOES: r.variacoes,
    ARQUIVO: r.arquivo || '',
    ERRO: r.erro || ''
}));

const wbFinal = XLSX.utils.book_new();
const wsFinal = XLSX.utils.json_to_sheet(resumoFinal);
wsFinal['!cols'] = [
    { wch: 25 }, { wch: 60 }, { wch: 12 }, { wch: 12 }, { wch: 35 }, { wch: 25 }
];
XLSX.utils.book_append_sheet(wbFinal, wsFinal, 'Resumo');
XLSX.writeFile(wbFinal, 'explorador_RESUMO_GERAL.xlsx');

console.log('💾 Arquivo consolidado: explorador_RESUMO_GERAL.xlsx');
console.log('');
console.log('✅ Exploração concluída!');
console.log('');