// ================================================================
// scraping-categoria.js
// Extrai TODOS os produtos de uma listagem (CasaJapon e Marine)
// Uso: node scraping-categoria.js "URL_DA_LISTAGEM" --grupo "ISCAS"
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'fs';

// ────────────────────────────────────────────────────────────────
// PARÂMETROS
// ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const URL_LISTAGEM = args[0];
const grupoIdx = args.indexOf('--grupo');
const GRUPO = grupoIdx >= 0 ? args[grupoIdx + 1] : 'SEM GRUPO';

if (!URL_LISTAGEM) {
    console.log('');
    console.log('❌ Uso: node scraping-categoria.js "URL_LISTAGEM" --grupo "NOME"');
    console.log('   Ex: node scraping-categoria.js "https://.../produtos/isca/filter?d=3" --grupo "ISCAS"');
    console.log('');
    process.exit(1);
}

// Detecta o site
let SITE = 'desconhecido';
if (URL_LISTAGEM.includes('casajapon.com'))       SITE = 'casajapon';
else if (URL_LISTAGEM.includes('marinefishing'))  SITE = 'marine';

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
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

const marcasConhecidas = ['Megabass', 'Yo-zuri', 'Yozuri', 'Marine', 'Daiwa', 'Shimano', 'Rapala', 'Strike Pro', 'Inna', 'Kastking', 'Duck'];

function acharMarca(html) {
    for (const m of marcasConhecidas) {
        if (html.toLowerCase().includes(m.toLowerCase())) return m;
    }
    return '';
}

// ────────────────────────────────────────────────────────────────
// PASSO 1 — BAIXA A LISTAGEM
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('🌐 Baixando listagem:', URL_LISTAGEM);
console.log('🏪 Site:', SITE.toUpperCase());
console.log('📦 Grupo:', GRUPO);
console.log('⏳ Aguarde...');
console.log('');

let htmlListagem;
try {
    htmlListagem = await baixar(URL_LISTAGEM);
} catch (e) {
    console.error('❌ Erro ao baixar listagem:', e.message);
    process.exit(1);
}

console.log('✅ Listagem baixada:', htmlListagem.length, 'bytes');
console.log('');

// ────────────────────────────────────────────────────────────────
// PASSO 2 — ENCONTRA OS PRODUTOS NA LISTAGEM
// ────────────────────────────────────────────────────────────────
const $ = cheerio.load(htmlListagem);
const produtosUrls = new Set();

// Padrão de URL de produto: /produto/xxx.html
$('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('/produto/') && href.endsWith('.html')) {
        // Normaliza URL
        let url = href;
        if (!url.startsWith('http')) {
            const base = new URL(URL_LISTAGEM);
            url = `${base.protocol}//${base.host}${href.startsWith('/') ? '' : '/'}${href}`;
        }
        produtosUrls.add(url);
    }
});

const listaUrls = Array.from(produtosUrls);
console.log(`📋 ${listaUrls.length} produtos encontrados na listagem`);
console.log('');

if (!listaUrls.length) {
    console.log('⚠️  Nenhum produto encontrado. Salvando HTML pra debug...');
    fs.writeFileSync('debug-listagem.html', htmlListagem);
    console.log('   → debug-listagem.html salvo.');
    process.exit(1);
}

// ────────────────────────────────────────────────────────────────
// PASSO 3 — PARA CADA PRODUTO, EXTRAI TUDO
// ────────────────────────────────────────────────────────────────
const tudo = [];
const resumo = [];
let contador = 0;

for (const urlProduto of listaUrls) {
    contador++;
    const prefixo = `[${contador}/${listaUrls.length}]`;

    try {
        process.stdout.write(`${prefixo} 🎣 ${urlProduto.split('/').pop()}...`);

        const htmlProduto = await baixar(urlProduto);
        const $p = cheerio.load(htmlProduto);

        // ----- NOME -----
        let nomeProduto = $p('h1').first().text().trim()
            || $p('title').text().trim();
        nomeProduto = nomeProduto.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();

        // ----- MARCA -----
        const marca = acharMarca(htmlProduto);

        // ----- DESCRIÇÃO -----
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
        if (!descricao) {
            descricao = $p('.box_descriptoin_product p').map((i, p) => $p(p).text().trim()).get().join('\n\n');
        }

        // ----- VARIAÇÕES -----
        const variacoes = [];
        $p('#subprodutos tbody tr, #subprodutos tr').each((i, tr) => {
            const tds = $p(tr).find('td');
            if (tds.length < 5) return;

            let link = '';
            const $a = $p(tds[0]).find('a.fancybox');
            if ($a.length) link = $a.attr('href') || '';
            else {
                const src = $p(tds[0]).find('img').attr('src') || '';
                link = src.replace('/400/', '/1500/');
            }

            let modelo = '', cor = '', tamanho = '', peso = '', codigo = '', codBarras = '', preco = '';

            if (SITE === 'marine') {
                modelo  = $p(tds[1]).text().trim();
                cor     = $p(tds[2]).text().trim();
                tamanho = $p(tds[3]).text().trim();
                peso    = $p(tds[4]).text().trim();

                const codHtml = $p(tds[5]).html() || '';
                const partes = codHtml.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
                codigo = partes[0] || '';
                codBarras = partes[1] || '';

                const precoTexto = $p(tds[6]).text().replace(/\s+/g, ' ').trim();
                const m = precoTexto.match(/(\d+[.,]\d+)/);
                preco = m ? m[1].replace(',', '.') : '';
            } else {
                // CasaJapon
                const codHtml = $p(tds[1]).html() || '';
                const partes = codHtml.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
                codigo = partes[0] || '';
                codBarras = partes[1] || '';

                const precoTexto = $p(tds[2]).find('.price').text().replace(/\s+/g, ' ').trim();
                const m = precoTexto.match(/(\d+[.,]\d+)/);
                preco = m ? m[1].replace('.', '.') : '';

                modelo  = $p(tds[4]).text().trim();
                cor     = $p(tds[5]).text().trim();
                tamanho = $p(tds[6]).text().trim();
                peso    = tds[7] ? $p(tds[7]).text().trim() : '';
            }

            if (!codigo) return;

            variacoes.push({
                CODIGO: codigo,
                COD_BARRAS: codBarras,
                COR: cor,
                TAMANHO: tamanho,
                PESO: peso,
                PRECO: preco,
                LINK_IMAGEM: link
            });
        });

        // Adiciona tudo com produto + variação
        variacoes.forEach(v => {
            tudo.push({
                GRUPO: GRUPO,
                SUBGRUPO: nomeProduto,
                PRODUTO: nomeProduto,
                MARCA: marca,
                DESCRICAO: descricao,
                URL_PRODUTO: urlProduto,
                CODIGO: v.CODIGO,
                COD_BARRAS: v.COD_BARRAS,
                COR: v.COR,
                TAMANHO: v.TAMANHO,
                PESO: v.PESO,
                PRECO: v.PRECO,
                MOEDA: SITE === 'marine' ? 'BRL' : 'USD',
                LINK_IMAGEM: v.LINK_IMAGEM
            });
        });

        resumo.push({
            produto: nomeProduto,
            url: urlProduto,
            variacoes: variacoes.length,
            status: '✅'
        });

        console.log(` ✅ ${variacoes.length} cores`);

        // Espera 1s entre requisições (exceto depois do último)
        if (contador < listaUrls.length) await sleep(1000);

    } catch (e) {
        console.log(` ❌ ERRO: ${e.message}`);
        resumo.push({
            produto: urlProduto.split('/').pop(),
            url: urlProduto,
            variacoes: 0,
            status: '❌ ' + e.message
        });

        // Se der erro, SALVA o que já tem e PARA
        console.log('');
        console.log('⚠️  Erro detectado. Salvando o que já foi extraído...');
        salvarExcel(tudo, resumo, GRUPO);
        console.log('❌ Script interrompido por erro.');
        process.exit(1);
    }
}

// ────────────────────────────────────────────────────────────────
// PASSO 4 — SALVA O EXCEL
// ────────────────────────────────────────────────────────────────
salvarExcel(tudo, resumo, GRUPO);

function salvarExcel(dados, resumoDados, grupo) {
    const agora = new Date();
    const stamp = `${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}`;
    const nomeGrupoLimpo = grupo.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const arquivo = `${nomeGrupoLimpo}_${stamp}.xlsx`;

    const wb = XLSX.utils.book_new();

    // Aba principal
    const ws = XLSX.utils.json_to_sheet(dados);
    ws['!cols'] = [
        { wch: 12 },  // GRUPO
        { wch: 30 },  // SUBGRUPO
        { wch: 30 },  // PRODUTO
        { wch: 12 },  // MARCA
        { wch: 80 },  // DESCRICAO
        { wch: 50 },  // URL_PRODUTO
        { wch: 10 },  // CODIGO
        { wch: 16 },  // COD_BARRAS
        { wch: 12 },  // COR
        { wch: 10 },  // TAMANHO
        { wch: 10 },  // PESO
        { wch: 10 },  // PRECO
        { wch: 6 },   // MOEDA
        { wch: 60 }   // LINK_IMAGEM
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');

    // Aba resumo
    const wsResumo = XLSX.utils.json_to_sheet(resumoDados);
    wsResumo['!cols'] = [
        { wch: 40 },
        { wch: 50 },
        { wch: 12 },
        { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    XLSX.writeFile(wb, arquivo);

    // ---- RESUMO NO TERMINAL ----
    const totalVariacoes = dados.length;
    const produtosOk = resumoDados.filter(r => r.status === '✅').length;
    const produtosErro = resumoDados.filter(r => r.status !== '✅').length;

    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('📊 RESUMO');
    console.log('════════════════════════════════════════════════════════');
    console.log(`Produtos processados:  ${resumoDados.length}`);
    console.log(`  ✅ Sucesso:          ${produtosOk}`);
    console.log(`  ❌ Falha:            ${produtosErro}`);
    console.log(`Total de variações:    ${totalVariacoes}`);
    console.log('');
    console.log(`💾 Arquivo salvo: ${arquivo}`);
    console.log(`   Aba 1: Dados (${totalVariacoes} linhas)`);
    console.log(`   Aba 2: Resumo (${resumoDados.length} produtos)`);
    console.log('');
}