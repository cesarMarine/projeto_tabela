// ================================================================
// scraping-produto.js — extrai 1 produto completo (CasaJapon e Marine)
// Uso: node scraping-produto.js "URL"
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'fs';

const URL_PRODUTO = process.argv[2];
if (!URL_PRODUTO) {
    console.log('❌ Uso: node scraping-produto.js "https://..."');
    process.exit(1);
}

// Detecta o site
let SITE = 'desconhecido';
if (URL_PRODUTO.includes('casajapon.com'))         SITE = 'casajapon';
else if (URL_PRODUTO.includes('marinefishing'))    SITE = 'marine';

console.log('');
console.log(`🌐 Baixando: ${URL_PRODUTO}`);
console.log(`🏪 Site: ${SITE.toUpperCase()}`);
console.log('⏳ Aguarde...');

let html;
try {
    const resp = await fetch(URL_PRODUTO, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
} catch (e) {
    console.error('❌ Erro ao baixar:', e.message);
    process.exit(1);
}

console.log('✅ HTML baixado:', html.length, 'bytes');
console.log('');

const $ = cheerio.load(html);

// ================================================================
// 1) NOME DO PRODUTO
// ================================================================
let nomeProduto = '';
// Tenta vários seletores comuns
nomeProduto = $('h1').first().text().trim()
    || $('title').text().trim()
    || $('.product-name').text().trim();

// Limpa sufixos tipo " - Casa Japon"
nomeProduto = nomeProduto.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();

// ================================================================
// 2) DESCRIÇÃO GERAL
// ================================================================
let descricao = '';
const $desc = $('.item_product').first();
if ($desc.length) {
    // Pega cada <p> e junta com quebra de linha
    const partes = [];
    $desc.find('p').each((i, p) => {
        let txt = $(p).text().trim();
        if (txt) partes.push(txt);
    });
    descricao = partes.join('\n\n');
}

// Se não achou, tenta outro seletor
if (!descricao) {
    descricao = $('.box_descriptoin_product p').map((i, p) => $(p).text().trim()).get().join('\n\n');
}

// ================================================================
// 3) MARCA (procura na descrição ou no nome)
// ================================================================
let marca = '';
const marcasConhecidas = ['Megabass', 'Yo-zuri', 'Yozuri', 'Marine', 'Daiwa', 'Shimano', 'Rapala', 'Strike Pro', 'Inna'];
for (const m of marcasConhecidas) {
    if (html.toLowerCase().includes(m.toLowerCase())) {
        marca = m;
        break;
    }
}

// ================================================================
// 4) VARIAÇÕES (tabela #subprodutos)
// ================================================================
const variacoes = [];

$('#subprodutos tbody tr, #subprodutos tr').each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 5) return;

    // Foto
    let link = '';
    const $a = $(tds[0]).find('a.fancybox');
    if ($a.length) {
        link = $a.attr('href') || '';
    } else {
        const src = $(tds[0]).find('img').attr('src') || '';
        link = src.replace('/400/', '/1500/');
    }

    // Colunas — layout Marine: Foto | Modelo | Cor | Tam | Peso | Cód | Preço | Qtd
    // Colunas — layout CasaJapon: Foto | Cód | Preço | (vazio) | Modelo | Cor | Tam | Peso
    let modelo = '', cor = '', tamanho = '', peso = '', codigo = '', codBarras = '', preco = '';

    if (SITE === 'marine') {
        modelo   = $(tds[1]).text().trim();
        cor      = $(tds[2]).text().trim();
        tamanho  = $(tds[3]).text().trim();
        peso     = $(tds[4]).text().trim();

        const codHtml = $(tds[5]).html() || '';
        const partes = codHtml.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
        codigo   = partes[0] || '';
        codBarras = partes[1] || '';

        const precoTexto = $(tds[6]).text().replace(/\s+/g, ' ').trim();
        const m = precoTexto.match(/(\d+[.,]\d+)/);
        preco = m ? m[1].replace(',', '.') : '';
    } else {
        // CasaJapon
        const codHtml = $(tds[1]).html() || '';
        const partes = codHtml.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
        codigo   = partes[0] || '';
        codBarras = partes[1] || '';

        const precoTexto = $(tds[2]).find('.price').text().replace(/\s+/g, ' ').trim();
        const m = precoTexto.match(/(\d+[.,]\d+)/);
        preco = m ? m[1].replace(',', '.') : '';

        modelo   = $(tds[4]).text().trim();
        cor      = $(tds[5]).text().trim();
        tamanho  = $(tds[6]).text().trim();
        peso     = tds[7] ? $(tds[7]).text().trim() : '';
    }

    if (!codigo) return;

    variacoes.push({
        CODIGO: codigo,
        COD_BARRAS: codBarras,
        MODELO: modelo,
        COR: cor,
        TAMANHO: tamanho,
        PESO: peso,
        PRECO: preco,
        LINK_IMAGEM: link
    });
});

// ================================================================
// RESULTADO
// ================================================================
console.log('═══════════════════════════════════════════════════════');
console.log('📦 PRODUTO');
console.log('═══════════════════════════════════════════════════════');
console.log('Nome:      ', nomeProduto);
console.log('Marca:     ', marca);
console.log('URL:       ', URL_PRODUTO);
console.log('');
console.log('📝 DESCRIÇÃO:');
console.log(descricao.substring(0, 500) + (descricao.length > 500 ? '...' : ''));
console.log('');
console.log(`🎨 VARIAÇÕES: ${variacoes.length} encontradas`);
console.log('');

if (variacoes.length) {
    console.log('CÓDIGO    CÓD BARRAS      COR     TAM     PESO     PRECO    IMG');
    console.log('─'.repeat(100));
    variacoes.slice(0, 10).forEach(v => {
        console.log(
            v.CODIGO.padEnd(10) +
            v.COD_BARRAS.padEnd(16) +
            v.COR.padEnd(8) +
            v.TAMANHO.padEnd(8) +
            v.PESO.padEnd(9) +
            v.PRECO.padEnd(9) +
            (v.LINK_IMAGEM ? '✅' : '❌')
        );
    });
    if (variacoes.length > 10) console.log(`... e mais ${variacoes.length - 10}`);
}
console.log('');

// ================================================================
// EXCEL com 2 ABAS
// ================================================================
const agora = new Date();
const stamp = `${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}`;

const slug = URL_PRODUTO.split('/').pop().replace('.html', '');
const arquivo = `produto_${slug}_${stamp}.xlsx`;

const wb = XLSX.utils.book_new();

// Aba 1 — Produto
const produtoData = [{
    NOME: nomeProduto,
    MARCA: marca,
    DESCRICAO: descricao,
    URL: URL_PRODUTO,
    TOTAL_VARIACOES: variacoes.length
}];
const ws1 = XLSX.utils.json_to_sheet(produtoData);
ws1['!cols'] = [
    { wch: 40 },
    { wch: 15 },
    { wch: 100 },
    { wch: 60 },
    { wch: 15 }
];
XLSX.utils.book_append_sheet(wb, ws1, 'Produto');

// Aba 2 — Variações
const ws2 = XLSX.utils.json_to_sheet(variacoes);
ws2['!cols'] = [
    { wch: 12 },  // CODIGO
    { wch: 16 },  // COD_BARRAS
    { wch: 15 },  // MODELO
    { wch: 10 },  // COR
    { wch: 10 },  // TAMANHO
    { wch: 10 },  // PESO
    { wch: 10 },  // PRECO
    { wch: 60 }   // LINK_IMAGEM
];
XLSX.utils.book_append_sheet(wb, ws2, 'Variacoes');

XLSX.writeFile(wb, arquivo);

console.log(`💾 Excel salvo: ${arquivo}`);
console.log(`   Aba 1: Produto (nome, marca, descrição)`);
console.log(`   Aba 2: Variações (${variacoes.length} cores)`);
console.log('');