// ================================================================
// scraping.js — extrai produtos de CasaJapon e MarineFishing
// Uso: node scraping.js "URL"
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'fs';

const URL_PRODUTO = process.argv[2];
if (!URL_PRODUTO) {
    console.log('❌ Uso: node scraping.js "https://..."');
    process.exit(1);
}

// Detecta o site
let SITE = 'desconhecido';
if (URL_PRODUTO.includes('casajapon.com'))         SITE = 'casajapon';
else if (URL_PRODUTO.includes('marinefishing'))    SITE = 'marine';

console.log('');
console.log(`🌐 Baixando: ${URL_PRODUTO}`);
console.log(`🏪 Site detectado: ${SITE.toUpperCase()}`);
console.log('⏳ Aguarde...');
console.log('');

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
const produtos = [];

// ================================================================
// PARSER CASAJAPON
// Estrutura: Foto | Cód(+barras) | Preço | (vazio) | Modelo | Cor | Tam | Peso
// ================================================================
function parseCasaJapon($) {
    const lista = [];

    $('table tr').each((i, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 7) return;

        // Foto
        let link = '';
        const $a = $(tds[0]).find('a.fancybox');
        if ($a.length) {
            link = $a.attr('href') || '';
        } else {
            const src = $(tds[0]).find('img').attr('src') || '';
            link = src.replace('/400/', '/1500/');
        }

        // Código / Cód Barras (mesma célula com <br>)
        const codHtml = $(tds[1]).html() || '';
        const partes = codHtml
            .replace(/<br\s*\/?>/gi, '|')
            .replace(/<[^>]*>/g, '')
            .split('|')
            .map(s => s.trim())
            .filter(s => s);

        const codigo = partes[0] || '';
        const codBarras = partes[1] || '';

        // Preço USD
        const precoTexto = $(tds[2]).find('.price').text().replace(/\s+/g, ' ').trim();
        const precoMatch = precoTexto.match(/(\d+[.,]\d+)/);
        const preco = precoMatch ? precoMatch[1].replace(',', '.') : '';

        // Colunas fixas
        const modelo = $(tds[4]).text().trim();
        const cor = $(tds[5]).text().trim();
        const tamanho = $(tds[6]).text().trim();
        const peso = tds[7] ? $(tds[7]).text().trim() : '';

        if (!codigo) return;

        lista.push({
            'CODIGO': codigo,
            'COD_BARRAS': codBarras,
            'MODELO': modelo,
            'COR': cor,
            'TAMANHO': tamanho,
            'PESO': peso,
            'PRECO': preco,
            'MOEDA': 'USD',
            'DISPONIVEL': preco ? 'sim' : 'nao',
            'LINK_IMAGEM': link,
            'PAGINA': URL_PRODUTO
        });
    });

    return lista;
}

// ================================================================
// PARSER MARINEFISHING
// Estrutura: Foto | Modelo | Cor | Tam | Peso | Cód(+barras) | Preço | Qtd
// ================================================================
function parseMarine($) {
    const lista = [];

    $('table tr').each((i, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 7) return;

        // Foto
        let link = '';
        const $a = $(tds[0]).find('a.fancybox');
        if ($a.length) {
            link = $a.attr('href') || '';
        } else {
            const src = $(tds[0]).find('img').attr('src') || '';
            link = src.replace('/400/', '/1500/');
        }

        // Colunas fixas
        const modelo = $(tds[1]).text().trim();
        const cor = $(tds[2]).text().trim();
        const tamanho = $(tds[3]).text().trim();
        const peso = $(tds[4]).text().trim();

        // Código / Cód Barras (tds[5], com <br>)
        const codHtml = $(tds[5]).html() || '';
        const partes = codHtml
            .replace(/<br\s*\/?>/gi, '|')
            .replace(/<[^>]*>/g, '')
            .split('|')
            .map(s => s.trim())
            .filter(s => s);

        const codigo = partes[0] || '';
        const codBarras = partes[1] || '';

        // Preço (tds[6]) — em BRL no Marine
        const precoTexto = $(tds[6]).text().replace(/\s+/g, ' ').trim();
        const precoMatch = precoTexto.match(/(\d+[.,]\d+)/);
        const preco = precoMatch ? precoMatch[1].replace(',', '.') : '';

        if (!codigo) return;

        lista.push({
            'CODIGO': codigo,
            'COD_BARRAS': codBarras,
            'MODELO': modelo,
            'COR': cor,
            'TAMANHO': tamanho,
            'PESO': peso,
            'PRECO': preco,
            'MOEDA': 'BRL',
            'DISPONIVEL': preco ? 'sim' : 'nao',
            'LINK_IMAGEM': link,
            'PAGINA': URL_PRODUTO
        });
    });

    return lista;
}

// ================================================================
// RODA O PARSER CERTO
// ================================================================
let extraidos = [];
if (SITE === 'casajapon') {
    extraidos = parseCasaJapon($);
} else if (SITE === 'marine') {
    extraidos = parseMarine($);
} else {
    console.log('⚠️  Site desconhecido. Tentando parser genérico...');
    extraidos = parseCasaJapon($);
}

produtos.push(...extraidos);

console.log(`📦 ${produtos.length} produtos encontrados`);
console.log('');

if (!produtos.length) {
    console.log('⚠️  Nenhum produto encontrado.');
    fs.writeFileSync('debug.html', html);
    console.log('   → debug.html salvo pra investigar.');
    process.exit(1);
}

// ================================================================
// PREVIEW
// ================================================================
console.log('📋 PREVIEW (primeiros 5):');
console.log('─'.repeat(140));
console.log(
    'CODIGO'.padEnd(12) +
    'COD BARRAS'.padEnd(16) +
    'MODELO'.padEnd(12) +
    'COR'.padEnd(8) +
    'TAMANHO'.padEnd(10) +
    'PESO'.padEnd(10) +
    'PRECO'.padEnd(10) +
    'MOEDA'.padEnd(8) +
    'DISP'.padEnd(6) +
    'IMG'
);
console.log('─'.repeat(140));
produtos.slice(0, 5).forEach(p => {
    console.log(
        p.CODIGO.padEnd(12) +
        p.COD_BARRAS.padEnd(16) +
        p.MODELO.padEnd(12) +
        p.COR.padEnd(8) +
        p.TAMANHO.padEnd(10) +
        p.PESO.padEnd(10) +
        p.PRECO.padEnd(10) +
        p.MOEDA.padEnd(8) +
        p.DISPONIVEL.padEnd(6) +
        (p.LINK_IMAGEM ? '✅' : '❌')
    );
});
console.log('─'.repeat(140));
console.log('');

// ================================================================
// EXCEL — nome com timestamp pra não dar EBUSY
// ================================================================
const slug = URL_PRODUTO.split('/').pop().replace('.html', '');
const agora = new Date();
const stamp = `${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}${String(agora.getSeconds()).padStart(2,'0')}`;
const arquivo = `produtos_${slug}_${stamp}.xlsx`;

const ws = XLSX.utils.json_to_sheet(produtos);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Produtos');

ws['!cols'] = [
    { wch: 12 },  // CODIGO
    { wch: 16 },  // COD_BARRAS
    { wch: 15 },  // MODELO
    { wch: 10 },  // COR
    { wch: 10 },  // TAMANHO
    { wch: 10 },  // PESO
    { wch: 10 },  // PRECO
    { wch: 8 },   // MOEDA
    { wch: 10 },  // DISPONIVEL
    { wch: 60 },  // LINK_IMAGEM
    { wch: 50 }   // PAGINA
];

XLSX.writeFile(wb, arquivo);

console.log(`💾 Excel salvo: ${arquivo}`);
console.log(`📊 Total: ${produtos.length} produtos`);
console.log('');