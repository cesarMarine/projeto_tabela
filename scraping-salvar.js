// ================================================================
// scraping-salvar.js — extrai categoria e SALVA NO BANCO
// Uso: node scraping-salvar.js "URL" --grupo "ISCAS" --server "http://localhost:3300"
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// ────────────────────────────────────────────────────────────────
// PARÂMETROS
// ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const URL_LISTAGEM = args[0];
const grupoIdx = args.indexOf('--grupo');
const GRUPO = grupoIdx >= 0 ? args[grupoIdx + 1] : 'SEM_GRUPO';
const serverIdx = args.indexOf('--server');
const SERVIDOR = serverIdx >= 0 ? args[serverIdx + 1] : 'http://localhost:3300';

if (!URL_LISTAGEM) {
    console.log('');
    console.log('❌ Uso:');
    console.log('   node scraping-salvar.js "URL" --grupo "ISCAS" --server "http://localhost:3300"');
    console.log('');
    console.log('   Ex:');
    console.log('   node scraping-salvar.js "https://loja.marinefishing.com.br/produtos/isca/filter?d=3" --grupo "ISCAS"');
    console.log('');
    process.exit(1);
}

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

// Extrai marca procurando no HTML
const MARCAS_CONHECIDAS = [
    'Megabass', 'Yo-zuri', 'Yozuri', 'Yo-Zuri', 'Marine', 'Daiwa', 'Shimano',
    'Rapala', 'Strike Pro', 'Inna', 'Raiglon', 'Siglon', 'Sunline', 'Zest',
    'Mustad', 'Owner', 'Gamakatsu', 'Vmc', 'Berkley'
];
function acharMarca(html) {
    for (const m of MARCAS_CONHECIDAS) {
        if (html.toLowerCase().includes(m.toLowerCase())) return m;
    }
    return '';
}

// ────────────────────────────────────────────────────────────────
// INÍCIO
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log(`🕷️  SCRAPING → BANCO`);
console.log(`📦 Grupo: ${GRUPO}`);
console.log(`🌐 URL: ${URL_LISTAGEM}`);
console.log(`💾 Servidor: ${SERVIDOR}`);
console.log('══════════════════════════════════════════════════════════════');
console.log('');

// 1) Baixa listagem
console.log('⏳ Baixando listagem...');
let htmlListagem;
try {
    htmlListagem = await baixar(URL_LISTAGEM);
    console.log(`✅ ${htmlListagem.length} bytes`);
} catch (e) {
    console.error('❌ Erro:', e.message);
    process.exit(1);
}

// 2) Encontra produtos
const $ = cheerio.load(htmlListagem);
const produtosUrls = new Set();
$('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('/produto/') && href.endsWith('.html')) {
        let url = href;
        if (!url.startsWith('http')) {
            const base = new URL(URL_LISTAGEM);
            url = `${base.protocol}//${base.host}${href.startsWith('/') ? '' : '/'}${href}`;
        }
        produtosUrls.add(url);
    }
});

const listaUrls = Array.from(produtosUrls);
console.log(`📋 ${listaUrls.length} produtos encontrados`);
console.log('');

// 3) Processa cada produto
const produtos = [];

for (let i = 0; i < listaUrls.length; i++) {
    const urlProduto = listaUrls[i];
    const prefixo = `[${i + 1}/${listaUrls.length}]`;
    process.stdout.write(`${prefixo} ${urlProduto.split('/').pop().slice(0, 45)}... `);

    try {
        await sleep(800);
        const htmlProduto = await baixar(urlProduto);
        const $p = cheerio.load(htmlProduto);

        // NOME
        let nomeProduto = $p('h1').first().text().trim() || $p('title').text().trim();
        nomeProduto = nomeProduto.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();

        // MARCA
        const marca = acharMarca(htmlProduto);

        // DESCRIÇÃO
        let descricao = '';
        const $desc = $p('.item_product').first();
        if ($desc.length) {
            const partes = [];
            $desc.find('p').each((k, p) => {
                const txt = $p(p).text().trim();
                if (txt) partes.push(txt);
            });
            descricao = partes.join('\n\n');
        }
        if (!descricao) {
            descricao = $p('.box_descriptoin_product p').map((k, p) => $p(p).text().trim()).get().join('\n\n');
        }

        // COLUNAS DO CABEÇALHO
        const colunasCabecalho = [];
        $p('#subprodutos thead tr th').each((k, th) => {
            const nome = $p(th).text().trim().replace(/\s+/g, ' ');
            if (nome) colunasCabecalho.push(nome);
        });

        // VARIAÇÕES
        const variacoes = [];
        $p('#subprodutos tbody tr, #subprodutos tr').each((k, tr) => {
            const tds = $p(tr).find('td');
            if (tds.length < 4) return;

            // Foto (col 0)
            let link = '';
            const $a = $p(tds[0]).find('a.fancybox');
            if ($a.length) link = $a.attr('href') || '';
            else {
                const src = $p(tds[0]).find('img').attr('src') || '';
                link = src.replace('/400/', '/1500/');
            }

            const variacao = { imagem: link };

            // Percorre colunas dinamicamente
            colunasCabecalho.forEach((nomeCol, idx) => {
                if (idx === 0) return; // Foto já tratada
                const td = tds[idx];
                if (!td) return;

                const texto = $p(td).text().trim();
                const nomeUpper = nomeCol.toUpperCase();

                // Cód / Cód Barras (contém <br>)
                if (nomeUpper.includes('CÓD') || nomeUpper.includes('COD')) {
                    const html = $p(td).html() || '';
                    const partes = html.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '')
                        .split('|').map(s => s.trim()).filter(s => s);
                    variacao['codigo'] = partes[0] || '';
                    variacao['cod_barras'] = partes[1] || '';
                }
                // Quantidade — ignora
                else if (nomeUpper.includes('QUANTIDADE') && nomeUpper.length < 15) {
                    // pula
                }
                // Preço — ignora (não interessa agora)
                else if (nomeUpper.includes('PRECO') || nomeUpper.includes('PREÇO')) {
                    // pula
                }
                // Outras colunas — usa nome EXATO como chave
                else {
                    variacao[nomeCol] = texto;
                }
            });

            if (variacao.codigo) variacoes.push(variacao);
        });

        // Se não achou nada em #subprodutos, tenta pegar 1 linha simples
        if (!variacoes.length && colunasCabecalho.length) {
            // Código de barras pode estar em outro lugar
        }

        // Pega código da 1ª variação (pro produto principal)
        const codigoPrincipal = variacoes[0]?.codigo || '';
        const codBarrasPrincipal = variacoes[0]?.cod_barras || '';
        const imagemPrincipal = variacoes[0]?.imagem || '';

        produtos.push({
            site: URL_LISTAGEM.includes('casajapon') ? 'casajapon' : 'marine',
            grupo: GRUPO,
            subgrupo: nomeProduto,
            codigo: codigoPrincipal,
            cod_barras: codBarrasPrincipal,
            marca,
            descricao_longa: descricao,
            imagem_url: imagemPrincipal,
            url_origem: urlProduto,
            colunas: colunasCabecalho,
            variacoes: variacoes
        });

        console.log(`✅ ${variacoes.length} var`);

    } catch (e) {
        console.log(`❌ ${e.message}`);
    }
}

console.log('');
console.log(`📦 Total extraído: ${produtos.length} produtos`);

if (!produtos.length) {
    console.log('⚠️  Nada pra salvar. Encerrando.');
    process.exit(0);
}

// 4) Envia pro servidor
console.log('');
console.log('📤 Enviando pro servidor...');

try {
    const resp = await fetch(`${SERVIDOR}/api/tabela/importar-scraping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtos })
    });
    const r = await resp.json();

    if (r.success) {
        console.log('');
        console.log('══════════════════════════════════════════════════════════════');
        console.log('✅ SUCESSO!');
        console.log('══════════════════════════════════════════════════════════════');
        console.log(`   Inseridos:   ${r.inseridos}`);
        console.log(`   Atualizados: ${r.atualizados}`);
        console.log(`   Ignorados:   ${r.ignorados}`);
        console.log(`   Total:       ${r.total}`);
        console.log('');
    } else {
        console.log('❌ Erro do servidor:', r.error);
    }
} catch (e) {
    console.log('❌ Erro ao enviar:', e.message);
    console.log('   Confere se o servidor está rodando em', SERVIDOR);
}