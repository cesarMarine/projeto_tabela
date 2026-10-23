// ================================================================
// scraping-all.js — varre TODAS as páginas do site Marine
// Extrai grupo pela breadcrumb, código/marca/imagem do produto
// Uso: node scraping-all.js --pagina-inicial 1 --pagina-final 10
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs'; // <-- IMPORTANTE: Adicionado para salvar o arquivo

// ────────────────────────────────────────────────────────────────
// PARÂMETROS
// ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (nome, def) => {
    const i = args.indexOf(nome);
    return i >= 0 ? args[i + 1] : def;
};

const PAGINA_INICIAL = parseInt(getArg('--pagina-inicial', '1'));
const PAGINA_FINAL = parseInt(getArg('--pagina-final', '10'));
const DELAY_MS = parseInt(getArg('--delay', '1000'));
const SERVIDOR = getArg('--server', 'https://projeto-tabela.onrender.com');
const URL_BASE = 'https://loja.marinefishing.com.br/produtos/filter?d=all';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ────────────────────────────────────────────────────────────────
// BREADCRUMB → GRUPO
// ────────────────────────────────────────────────────────────────
const MAPA_BREADCRUMB = {
    'acessórios': 'ACESSORIOS',
    'acessorios': 'ACESSORIOS',
    'anzol e garateia': 'ANZOIS',
    'anzol': 'ANZOIS',
    'anzóis': 'ANZOIS',
    'carretilha': 'CARRETILHAS',
    'carretilhas': 'CARRETILHAS',
    'empate, giradores e snaps': 'EMPATES',
    'empate': 'EMPATES',
    'empates': 'EMPATES',
    'isca': 'ISCAS',
    'iscas': 'ISCAS',
    'linha': 'LINHAS',
    'linhas': 'LINHAS',
    'molinete': 'MOLINETES',
    'molinetes': 'MOLINETES',
    'motor elétrico': 'MOTORES',
    'motor': 'MOTORES',
    'motores': 'MOTORES',
    'vara': 'VARAS',
    'varas': 'VARAS',
    'vara telescópica': 'VARAS',
    'varas telescópicas': 'VARAS',
    'vara telescopica': 'VARAS',
    'peças': 'PECAS',
    'peças e acessórios': 'PECAS',
    'vestuário': 'VESTUARIO',
};

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
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
// EXTRAÇÕES
// ────────────────────────────────────────────────────────────────
function extrairGrupoDoBreadcrumb($p) {
    const itens = $p('.section_breadcrumb a')
        .map((i, el) => $p(el).text().trim().toLowerCase())
        .get();

    if (!itens.length) return null;

    for (let i = itens.length - 1; i >= 0; i--) {
        const item = itens[i];
        if (item === 'home' || item === 'produtos' || !item) continue;
        if (MAPA_BREADCRUMB[item]) return MAPA_BREADCRUMB[item];
    }

    for (let i = itens.length - 1; i >= 0; i--) {
        const item = itens[i];
        if (item && item !== 'home' && item !== 'produtos') {
            return item.toUpperCase();
        }
    }

    return null;
}

function extrairMarca($p, html) {
    const match = html.match(/MARCA\s*:\s*([A-Za-zÀ-ÿ0-9\-\.\s]+?)[<\n\r]/i);
    if (match) {
        const marca = match[1].trim();
        if (marca.length > 0 && marca.length < 40) return marca;
    }

    const MARCAS = ['Megabass', 'Yo-zuri', 'Yozuri', 'Yo-Zuri', 'Marine', 'Daiwa',
                    'Shimano', 'Rapala', 'Strike Pro', 'Inna', 'Raiglon', 'Siglon',
                    'Sunline', 'Zest', 'Mustad', 'Owner', 'Gamakatsu', 'Vmc',
                    'Berkley', 'Luremax', 'Artifish'];
    for (const m of MARCAS) {
        if (html.toLowerCase().includes(m.toLowerCase())) return m;
    }
    return '';
}

function extrairCodigoPrincipal($p, html) {
    const match = html.match(/C[ÓO]DIGO\s*:\s*(\d+)/i);
    if (match) return match[1].trim();
    const match2 = html.match(/codigo[^0-9]*(\d{3,})/i);
    if (match2) return match2[1];
    return '';
}

function extrairCodBarrasPrincipal($p, html) {
    const match = html.match(/C[ÓO]DIGO\s+BARRAS\s*:\s*(\d+)/i);
    if (match) return match[1].trim();
    return '';
}

function extrairImagemPrincipal($p) {
    const seletores = [
        '.box_img_produto img',
        '.box_imagens img',
        '.img_produto img',
        '.produto_imagem img',
        '.box_foto img',
        'img.img_item'
    ];
    for (const sel of seletores) {
        const img = $p(sel).first().attr('src');
        if (img) return img.replace('/400/', '/1500/').replace('/800/', '/1500/');
    }
    return '';
}

// ────────────────────────────────────────────────────────────────
// FALLBACK: GRUPO PELA URL
// ────────────────────────────────────────────────────────────────
const MAPA_URL = [
    { chave: '/isca-',       grupo: 'ISCAS' },
    { chave: '/molinete-',   grupo: 'MOLINETES' },
    { chave: '/carretilha-', grupo: 'CARRETILHAS' },
    { chave: '/vara-',       grupo: 'VARAS' },
    { chave: '/linha-',      grupo: 'LINHAS' },
    { chave: '/anzol-',      grupo: 'ANZOIS' },
    { chave: '/cabo-',       grupo: 'EMPATES' },
    { chave: '/empate-',     grupo: 'EMPATES' },
    { chave: '/girador-',    grupo: 'EMPATES' },
    { chave: '/snap-',       grupo: 'EMPATES' },
    { chave: '/alicate-',    grupo: 'ACESSORIOS' },
    { chave: '/bolsa-',      grupo: 'ACESSORIOS' },
    { chave: '/banqueta-',   grupo: 'ACESSORIOS' },
    { chave: '/motor-',      grupo: 'MOTORES' },
    { chave: '/afia-',       grupo: 'ACESSORIOS' },
    { chave: '/alca-',       grupo: 'ACESSORIOS' },
    { chave: '/al\u00e7a-',  grupo: 'ACESSORIOS' },
    { chave: '/guarda-',     grupo: 'ACESSORIOS' },
];

function grupoPelaUrl(urlProduto) {
    const urlLower = urlProduto.toLowerCase();
    for (const { chave, grupo } of MAPA_URL) {
        if (urlLower.includes(chave)) return grupo;
    }
    return null;
}

// ────────────────────────────────────────────────────────────────
// INÍCIO
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('🕷️  SCRAPING EM MASSA');
console.log(`   Páginas: ${PAGINA_INICIAL} até ${PAGINA_FINAL} (${PAGINA_FINAL - PAGINA_INICIAL + 1})`);
console.log(`   Delay:   ${DELAY_MS}ms entre requisições`);
console.log(`   Servidor: ${SERVIDOR}`);
console.log('══════════════════════════════════════════════════════════════');
console.log('');

const estatisticas = {
    paginasProcessadas: 0,
    paginasVazias: 0,
    produtosEncontrados: 0,
    produtosSalvos: 0,
    semGrupo: 0,
    porGrupo: {},
    erros: []
};

// Bloqueio de segurança
const MAX_ERROS_CONSECUTIVOS = 5;
const MAX_PAGINAS_VAZIAS = 10;
let errosConsecutivos = 0;

for (let pagina = PAGINA_INICIAL; pagina <= PAGINA_FINAL; pagina++) {
    const urlPagina = pagina === 1 ? URL_BASE : `${URL_BASE}&pagina=${pagina}`;
    console.log(`📄 [Página ${pagina}/${PAGINA_FINAL}]`);

    let htmlListagem;
    try {
        htmlListagem = await baixar(urlPagina);
        errosConsecutivos = 0;
    } catch (e) {
        console.log(`   ❌ Erro ao baixar: ${e.message}`);
        estatisticas.erros.push({ pagina, erro: e.message });

        errosConsecutivos++;
        if (errosConsecutivos >= MAX_ERROS_CONSECUTIVOS) {
            console.log('');
            console.log('══════════════════════════════════════════════════════════════');
            console.log(`🛑 BLOQUEADO! ${MAX_ERROS_CONSECUTIVOS} erros seguidos.`);
            console.log(`   Última página OK: ${pagina - MAX_ERROS_CONSECUTIVOS}`);
            console.log(`   Última tentativa: ${pagina}`);
            console.log('');
            console.log(`💡 Espera 30-60min e retoma da página ${pagina - MAX_ERROS_CONSECUTIVOS + 1}`);
            console.log('');
            break;
        }
        continue;
    }

    const $ = cheerio.load(htmlListagem);

    // Encontra produtos
    const produtosUrls = new Set();
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/produto/') && href.endsWith('.html')) {
            let url = href;
            if (!url.startsWith('http')) {
                const base = new URL(urlPagina);
                url = `${base.protocol}//${base.host}${href.startsWith('/') ? '' : '/'}${href}`;
            }
            produtosUrls.add(url);
        }
    });

    const listaUrls = Array.from(produtosUrls);
    console.log(`   → ${listaUrls.length} produtos`);
    estatisticas.produtosEncontrados += listaUrls.length;

    // Detecta muitas páginas vazias (provável bloqueio silencioso)
    if (!listaUrls.length) {
        console.log('   ⚠️  Nenhum produto — pulando\n');
        estatisticas.paginasVazias++;

        if (estatisticas.paginasVazias >= MAX_PAGINAS_VAZIAS) {
            console.log('');
            console.log('══════════════════════════════════════════════════════════════');
            console.log(`🛑 ${MAX_PAGINAS_VAZIAS} páginas vazias seguidas — provavelmente bloqueado!`);
            console.log(`   Última página com produtos: ${pagina - MAX_PAGINAS_VAZIAS}`);
            console.log('');
            console.log(`💡 Espera 30-60min e retoma da página ${pagina - MAX_PAGINAS_VAZIAS + 1}`);
            console.log('');
            break;
        }
        continue;
    }
    estatisticas.paginasVazias = 0; // resetou

    const produtos = [];

    for (let i = 0; i < listaUrls.length; i++) {
        const urlProduto = listaUrls[i];
        process.stdout.write(`   [${i + 1}/${listaUrls.length}] `);

        try {
            await sleep(DELAY_MS);
            const htmlProduto = await baixar(urlProduto);
            const $p = cheerio.load(htmlProduto);

            // GRUPO
            let grupo = extrairGrupoDoBreadcrumb($p);
            if (!grupo) grupo = grupoPelaUrl(urlProduto);
            if (!grupo) grupo = 'OUTROS';

            // NOME
            let nomeProduto = $p('h1').first().text().trim() || $p('title').text().trim();
            nomeProduto = nomeProduto.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();

            // MARCA
            const marca = extrairMarca($p, htmlProduto);

            // CÓDIGO PRINCIPAL
            const codigoPrincipal = extrairCodigoPrincipal($p, htmlProduto);
            const codBarrasPrincipal = extrairCodBarrasPrincipal($p, htmlProduto);
            const imagemPrincipal = extrairImagemPrincipal($p);

            // DESCRIÇÃO LONGA
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
                descricao = $p('.box_descriptoin_product p')
                    .map((k, p) => $p(p).text().trim())
                    .get()
                    .join('\n\n');
            }

            // COLUNAS DO CABEÇALHO
            const colunasCabecalho = [];
            $p('#subprodutos thead tr th').each((k, th) => {
                const nome = $p(th).text().trim().replace(/\s+/g, ' ');
                if (nome) colunasCabecalho.push(nome);
            });

            // VARIAÇÕES (EXTRAÇÃO INTELIGENTE PARA A NOVA TABELA)
            const variacoes = [];
            const linhasTabela = $p('#subprodutos tbody tr').toArray();

            linhasTabela.forEach(tr => {
                const tds = $p(tr).find('td');
                if (tds.length < 5) return;

                // 1. Imagem
                let link = '';
                const $a = $p(tds[0]).find('a.fancybox');
                if ($a.length) link = $a.attr('href') || '';
                else {
                    const src = $p(tds[0]).find('img').attr('src') || '';
                    link = src.replace('/400/', '/1500/').replace('/800/', '/1500/');
                }

                // 2. Tamanho e QTD
                const tamanho = $p(tds[3]).text().trim();
                const qtd = $p(tds[4]).text().trim();

                // 3. Código
                let codigoVar = '';
                let codBarrasVar = '';
                const htmlCod = $p(tds[5]).html() || '';
                const partesCod = htmlCod
                    .replace(/<br\s*\/?>/gi, '|')
                    .replace(/<[^>]*>/g, '')
                    .split('|')
                    .map(s => s.trim())
                    .filter(s => s);
                
                codigoVar = partesCod[0] || '';
                codBarrasVar = partesCod[1] || '';

                if (codigoVar) {
                    variacoes.push({
                        imagem: link,
                        Tamanho: tamanho,
                        QTD: qtd,
                        codigo: codigoVar,
                        cod_barras: codBarrasVar,
                        'CX/CT': 'CX'
                    });
                }
            });

            // Se não achou tabela mas achou código principal → cria variação única
            if (!variacoes.length && codigoPrincipal) {
                variacoes.push({
                    imagem: imagemPrincipal,
                    codigo: codigoPrincipal,
                    cod_barras: codBarrasPrincipal
                });
            }

            const codigoFinal = codigoPrincipal || variacoes[0]?.codigo || '';
            const codBarrasFinal = codBarrasPrincipal || variacoes[0]?.cod_barras || '';
            const imagemFinal = imagemPrincipal || variacoes[0]?.imagem || '';

            if (codigoFinal) {
                produtos.push({
                    site: 'marine',
                    grupo,
                    subgrupo: nomeProduto,
                    codigo: codigoFinal,
                    cod_barras: codBarrasFinal,
                    marca,
                    descricao_longa: descricao,
                    imagem_url: imagemFinal,
                    url_origem: urlProduto,
                    colunas: colunasCabecalho,
                    variacoes
                });

                if (grupo === 'OUTROS') estatisticas.semGrupo++;
            }

            console.log(`✅ ${grupo.padEnd(15)} (${variacoes.length} var)`);

        } catch (e) {
            console.log(`❌ ${e.message}`);
        }
    }

    // Envia o lote pro servidor E salva localmente
    if (produtos.length) {
        const caminhoArquivo = 'backup_scraping.json';
        
        let dadosAntigos = [];
        if (fs.existsSync(caminhoArquivo)) {
            try {
                dadosAntigos = JSON.parse(fs.readFileSync(caminhoArquivo, 'utf8'));
            } catch (e) { dadosAntigos = []; }
        }
        
        const todos = [...dadosAntigos, ...produtos];
        const unicos = Array.from(new Map(todos.map(p => [p.codigo, p])).values());
        fs.writeFileSync(caminhoArquivo, JSON.stringify(unicos, null, 2));
        console.log(`   📁 Backup local atualizado (${unicos.length} produtos)`);

        try {
            const resp = await fetch(`${SERVIDOR}/api/importar/scraping`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ produtos })
            });
            const r = await resp.json();

            if (r.success) {
                estatisticas.produtosSalvos += r.inseridos;
                produtos.forEach(p => {
                    estatisticas.porGrupo[p.grupo] = (estatisticas.porGrupo[p.grupo] || 0) + 1;
                });
                console.log(`   💾 ${r.inseridos} novos (Enviado ao Render)`);
            } else {
                console.log(`   ⚠️ Erro no servidor: ${r.error} (Salvo localmente)`);
            }
        } catch (e) {
            console.log(`   ⚠️ Falha de conexão (Salvo localmente)`);
        }
    }

    estatisticas.paginasProcessadas++;
    console.log('');
}

// ────────────────────────────────────────────────────────────────
// RESUMO FINAL
// ────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════');
console.log('📊 RESUMO FINAL');
console.log('══════════════════════════════════════════════════════════════');
console.log(`   Páginas processadas:  ${estatisticas.paginasProcessadas}`);
console.log(`   Produtos encontrados: ${estatisticas.produtosEncontrados}`);
console.log(`   Produtos salvos:      ${estatisticas.produtosSalvos}`);
console.log(`   Sem grupo definido:   ${estatisticas.semGrupo}`);
console.log('');
console.log('📦 Por grupo:');
for (const [grupo, qtd] of Object.entries(estatisticas.porGrupo).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${grupo.padEnd(20)} ${qtd}`);
}
console.log('');
console.log('✅ Concluído!');
console.log('');