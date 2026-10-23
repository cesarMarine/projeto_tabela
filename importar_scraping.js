// ================================================================
// importar_scraping.js — Versão Compatível com Servidor & Pedidos03
// ================================================================
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import readline from 'readline';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function perguntar(texto) { return new Promise(resolve => rl.question(texto, resolve)); }

function limparTexto(txt) {
    if (!txt) return '';
    const limpo = txt.trim().replace(/\s+/g, ' ');
    if (limpo.toLowerCase().includes('login') || limpo.toLowerCase().includes('faça login')) {
        return '';
    }
    return limpo;
}

function extrairManivelaTexto(texto) {
    if (!texto) return '';
    const matchRotulo = texto.match(/(?:MANIVELA|LADO)\s*[:\-]?\s*(DIREITA|ESQUERDA|DIR|ESQ)/i);
    if (matchRotulo) {
        const lado = matchRotulo[1].toUpperCase();
        return lado.startsWith('DIR') ? 'DIREITA' : 'ESQUERDA';
    }
    const txtUpper = texto.toUpperCase();
    const temDireita = /\b(DIREITA|DIR|RH)\b/.test(txtUpper);
    const temEsquerda = /\b(ESQUERDA|ESQ|LH)\b/.test(txtUpper);
    if (temDireita && !temEsquerda) return 'DIREITA';
    if (temEsquerda && !temDireita) return 'ESQUERDA';
    return '';
}

async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('🕷️  IMPORTAR SCRAPING (Marine) - Padrão Sistema Pedidos03');
    console.log('══════════════════════════════════════════════════════════════');

    const link = await perguntar('Cole o link da página (ex: https://loja.marinefishing.com.br/produtos/filter?d=all ou link do produto): ');
    const nomeGrupo = await perguntar('Nome do Grupo (ex: CARRETILHAS): ');
    const pagIni = parseInt(await perguntar('Página Inicial (ex: 1): ')) || 1;
    const pagFim = parseInt(await perguntar('Página Final (ex: 1): ')) || 1;
    const delayMs = parseInt(await perguntar('Delay entre produtos (ms, ex: 1000): ')) || 1000;

    console.log('\n⏳ Iniciando o scraping...');
    const todosProdutos = [];

    for (let pagina = pagIni; pagina <= pagFim; pagina++) {
        let urlPagina = link;
        if (pagina > 1) {
            urlPagina = link.includes('?') ? `${link}&pagina=${pagina}` : `${link}?pagina=${pagina}`;
        }
        
        console.log(`\n📄 Buscando página ${pagina}...`);
        try {
            const html = await baixar(urlPagina);
            const $ = cheerio.load(html);
            const links = new Set();
            
            if (link.includes('/produto/') && link.endsWith('.html')) {
                links.add(link);
            } else {
                $('a').each((i, el) => {
                    const href = $(el).attr('href') || '';
                    if (href.includes('/produto/') && href.endsWith('.html')) {
                        links.add(href.startsWith('http') ? href : 'https://loja.marinefishing.com.br' + (href.startsWith('/') ? '' : '/') + href);
                    }
                });
            }
            
            const lista = Array.from(links);
            console.log(`   → ${lista.length} produtos encontrados`);
            
            for (let i = 0; i < lista.length; i++) {
                const urlProduto = lista[i];
                process.stdout.write(`   [${i + 1}/${lista.length}] `);
                
                try {
                    await sleep(delayMs);
                    const htmlProd = await baixar(urlProduto);
                    const $p = cheerio.load(htmlProd);
                    
                    let nome = $p('h1').first().text().trim() || $p('.name').first().text().trim() || $p('title').text().split('-')[0].trim();
                    nome = nome.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();
                    
                    const marcaMatch = htmlProd.match(/MARCA\s*:\s*([A-Za-zÀ-ÿ0-9\-\.\s]+?)[<\n\r]/i);
                    const marca = marcaMatch ? marcaMatch[1].trim() : 'MARINE';
                    
                    let descricao = '';
                    $p('.item_product p, #item_product1 p').each((k, p) => {
                        const txt = $p(p).text().trim();
                        if (txt.length > 20 && !txt.toLowerCase().includes('login')) descricao += txt + '\n\n';
                    });

                    let imagemPrincipal = '';
                    $p('img').each((k, img) => {
                        const src = $p(img).attr('src') || '';
                        if (src.includes('/produtos/') && src.includes('/400/')) {
                            imagemPrincipal = src.replace('/400/', '/1500/');
                        }
                    });

                    const manivelaNoTitulo = extrairManivelaTexto(nome);
                    const variacoes = [];
                    const tabela = $p('#subprodutos');

                    // --- EXTRAÇÃO ROBUSTA DE TABELA ---
                    if (tabela.length > 0) {
                        const colunas = [];
                        let linhas = tabela.find('tr').toArray();

                        let $primeiraLinha = $p(linhas[0]);
                        let celulasCabecalho = $primeiraLinha.find('th, td');
                        
                        celulasCabecalho.each((idx, cel) => {
                            colunas.push($p(cel).text().trim().replace(/\s+/g, ' '));
                        });

                        linhas.forEach((tr, indexLinha) => {
                            const tds = $p(tr).find('td');
                            if (tds.length === 0) return;

                            const textoLinhaCompleta = $p(tr).text().trim();
                            if (textoLinhaCompleta.toUpperCase().includes('CÓDIGO BARRAS') && indexLinha === 0) return;

                            const atributosRow = {};
                            let codigoVar = '';
                            let codBarrasVar = '';
                            let imagemVar = '';

                            tds.each((colIdx, td) => {
                                const htmlTd = $p(td).html() || '';
                                const textoTd = limparTexto($p(td).text());
                                const nomeColuna = colunas[colIdx] || `Coluna_${colIdx}`;

                                const imgSrc = $p(td).find('img').attr('src');
                                if (imgSrc && !imagemVar) {
                                    imagemVar = imgSrc.replace('/400/', '/1500/').replace('/800/', '/1500/');
                                }

                                const matchCod = htmlTd.match(/(\d{4,8})\s*<br\s*\/?>\s*(\d{10,14})/i);
                                if (matchCod) {
                                    codigoVar = matchCod[1];
                                    codBarrasVar = matchCod[2];
                                }

                                if (textoTd && !textoTd.includes('html') && !textoTd.includes('function')) {
                                    atributosRow[nomeColuna] = textoTd;
                                }
                            });

                            const manivelaNaLinha = extrairManivelaTexto(textoLinhaCompleta) || manivelaNoTitulo;
                            if (manivelaNaLinha) {
                                atributosRow['Lado Manivela'] = manivelaNaLinha;
                            }

                            if (!codigoVar) {
                                const matchSoCodigo = $p(tr).text().match(/\b\d{5,8}\b/);
                                if (matchSoCodigo) codigoVar = matchSoCodigo[0];
                            }

                            if (codigoVar || manivelaNaLinha) {
                                variacoes.push({
                                    imagem: imagemVar || imagemPrincipal,
                                    codigo: codigoVar,
                                    cod_barras: codBarrasVar,
                                    ...atributosRow
                                });
                            }
                        });
                    }

                    // --- FALLBACK ---
                    if (variacoes.length === 0) {
                        const matchCod = htmlProd.match(/C[ÓO]DIGO\s*:\s*(\d+)/i);
                        const codPrincipal = matchCod ? matchCod[1].trim() : '';

                        const matchBarras = htmlProd.match(/C[ÓO]DIGO\s+BARRAS\s*:\s*(\d+)/i);
                        const codBarrasPrincipal = matchBarras ? matchBarras[1].trim() : '';

                        const atributosFallback = {};
                        const manivelaDetectada = manivelaNoTitulo || extrairManivelaTexto(descricao) || extrairManivelaTexto(htmlProd);
                        if (manivelaDetectada) atributosFallback['Lado Manivela'] = manivelaDetectada;

                        if (codPrincipal || manivelaDetectada) {
                            variacoes.push({
                                imagem: imagemPrincipal,
                                codigo: codPrincipal,
                                cod_barras: codBarrasPrincipal,
                                ...atributosFallback
                            });
                        }
                    }

                    todosProdutos.push({
                        site: 'marine',
                        grupo: nomeGrupo.toUpperCase() || 'OUTROS',
                        subgrupo: nome,
                        marca: marca,
                        descricao_longa: descricao.trim(),
                        url_origem: urlProduto,
                        codigo: variacoes[0]?.codigo || '',
                        cod_barras: variacoes[0]?.cod_barras || '',
                        imagem_url: imagemPrincipal,
                        variacoes: variacoes
                    });
                    
                    console.log(`✅ ${nome} (${variacoes.length} var)`);
                } catch (e) {
                    console.log(`❌ ${e.message}`);
                }
            }
        } catch (e) {
            console.log(`   ❌ Erro: ${e.message}`);
        }
    }

    if (todosProdutos.length > 0) {
        const dataHora = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const nomeArquivo = `scraping_${nomeGrupo.toUpperCase().replace(/\s/g, '_')}_${dataHora}.json`;
        fs.writeFileSync(nomeArquivo, JSON.stringify(todosProdutos, null, 2));
        console.log(`\n✅ Concluído! Arquivo "${nomeArquivo}" gerado com ${todosProdutos.length} itens.`);
    } else {
        console.log('\n❌ Nenhum produto foi salvo.');
    }

    rl.close();
}

main();