import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import readline from 'readline';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function baixar(url) {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function perguntar(texto) { return new Promise(resolve => rl.question(texto, resolve)); }

async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('🕷️  IMPORTAR SCRAPING (Marine) - Interativo');
    console.log('══════════════════════════════════════════════════════════════');

    const link = await perguntar('Cole o link da página (ex: https://loja.marinefishing.com.br/produtos/carretilha/filter?d=27): ');
    const nomeGrupo = await perguntar('Nome do Grupo (ex: CARRETILHAS): ');
    const pagIni = parseInt(await perguntar('Página Inicial (ex: 1): ')) || 1;
    const pagFim = parseInt(await perguntar('Página Final (ex: 6): ')) || 6;
    const delayMs = parseInt(await perguntar('Delay entre produtos (ms, ex: 2000): ')) || 2000;

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
            $('a').each((i, el) => {
                const href = $(el).attr('href') || '';
                if (href.includes('/produto/') && href.endsWith('.html')) {
                    links.add(href.startsWith('http') ? href : 'https://loja.marinefishing.com.br' + (href.startsWith('/') ? '' : '/') + href);
                }
            });
            
            const lista = Array.from(links);
            console.log(`   → ${lista.length} produtos encontrados`);
            
            for (let i = 0; i < lista.length; i++) {
                const urlProduto = lista[i];
                process.stdout.write(`   [${i + 1}/${lista.length}] `);
                
                try {
                    await sleep(delayMs);
                    const htmlProd = await baixar(urlProduto);
                    const $p = cheerio.load(htmlProd);
                    
                    // Nome
                    let nome = $p('h1').first().text().trim() || $p('title').text().split('-')[0].trim();
                    nome = nome.replace(/\s*[-|]\s*(Casa ?Japon|Marine).*$/i, '').trim();
                    
                    // Marca
                    const marca = (htmlProd.match(/MARCA\s*:\s*([A-Za-zÀ-ÿ0-9\-\.\s]+?)[<\n\r]/i) || [])[1] || 'MARINE';
                    
                    // Descrição
                    let descricao = '';
                    $p('p').each((k, p) => {
                        const txt = $p(p).text().trim();
                        if (txt.length > 20 && !txt.includes('login')) descricao += txt + '\n\n';
                    });

                    // Imagem
                    let imagemPrincipal = '';
                    $p('img').each((k, img) => {
                        const src = $p(img).attr('src') || '';
                        if (src.includes('/produtos/')) imagemPrincipal = src.replace('/400/', '/1500/').replace('/800/', '/1500/');
                    });

                    // Variações (Tamanho e Manivela)
                    // --- INÍCIO DA EXTRAÇÃO DE VARIAÇÕES (CASA JAPÃO / MARINE) ---
                    const variacoes = [];
                    
                    // 1. Tenta achar a tabela da Casa Japão (que tem a coluna "LADO DA MANIV")
                    const tabelaCasaJapao = $p('table').filter((i, el) => {
                        return $p(el).text().toUpperCase().includes('LADO DA MANIV');
                    });

                    if (tabelaCasaJapao.length > 0) {
                        tabelaCasaJapao.find('tbody tr').each((idx, tr) => {
                            const tds = $p(tr).find('td').toArray();
                            if (tds.length < 3) return;

                            const txtTds = tds.map(td => $p(td).text().trim());
                            
                            // Na Casa Japão, o código vem no final (com o código de barras na linha de baixo)
                            let codigoVar = '';
                            let codBarrasVar = '';
                            let manivela = '';

                            // A manivela é a palavra DIREITA ou ESQUERDA
                            const idxMan = txtTds.findIndex(t => t.includes('DIREITA') || t.includes('ESQUERDA') || t.includes('DIREITO') || t.includes('ESQUERDO'));
                            if (idxMan >= 0) manivela = txtTds[idxMan];

                            // O código está na última célula, separado por quebra de linha (<br>)
                            const htmlCod = $p(tds[tds.length - 1]).html() || '';
                            const partes = htmlCod.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
                            codigoVar = partes[0] || '';
                            codBarrasVar = partes[1] || '';

                            if (codigoVar) {
                                variacoes.push({ 
                                    imagem: imagemPrincipal, 
                                    Manivela: manivela, 
                                    codigo: codigoVar, 
                                    cod_barras: codBarrasVar
                                });
                            }
                        });
                    } 
                    // 2. Se não for Casa Japão, tenta o layout da Marine (Tamanho)
                    else {
                        $p('table').each((k, table) => {
                            const thTexts = $p(table).find('th').map((i, el) => $p(el).text().trim().toUpperCase()).get();
                            const temTamanho = thTexts.some(t => t.includes('TAMANHO'));
                            const temManivela = thTexts.some(t => t.includes('MANIVELA'));

                            if (temTamanho || temManivela) {
                                $p(table).find('tbody tr').each((idx, tr) => {
                                    const tds = $p(tr).find('td').toArray();
                                    if (tds.length < 3) return;

                                    let codigoVar = '', codBarrasVar = '', tamanho = '', manivela = '', qtd = '';
                                    const txtTds = tds.map(td => $p(td).text().trim());

                                    const idxCod = txtTds.findIndex(t => t.match(/\d{5,6}/));
                                    if (idxCod >= 0) {
                                        const htmlCod = $p(tds[idxCod]).html() || '';
                                        const partes = htmlCod.replace(/<br\s*\/?>/gi, '|').replace(/<[^>]*>/g, '').split('|').map(s => s.trim()).filter(s => s);
                                        codigoVar = partes[0] || '';
                                        codBarrasVar = partes[1] || '';
                                    }

                                    if (temTamanho) {
                                        const idxTam = txtTds.findIndex(t => t.match(/^(\d+\/\d+|\d+)$/));
                                        if (idxTam >= 0) tamanho = txtTds[idxTam];
                                    }
                                    if (temManivela) {
                                        const idxMan = txtTds.findIndex(t => t.includes('DIREITA') || t.includes('ESQUERDA') || t.includes('DIREITO') || t.includes('ESQUERDO'));
                                        if (idxMan >= 0) manivela = txtTds[idxMan];
                                    }

                                    const idxVar = Math.max(txtTds.indexOf(tamanho), txtTds.indexOf(manivela));
                                    const idxQtd = txtTds.findIndex((t, idx) => idx > idxVar && t.match(/^\d+$/));
                                    if (idxQtd >= 0) qtd = txtTds[idxQtd];

                                    if (codigoVar) {
                                        variacoes.push({ imagem: imagemPrincipal, Tamanho: tamanho, Manivela: manivela, QTD: qtd, codigo: codigoVar, cod_barras: codBarrasVar, 'CX/CT': 'CX' });
                                    }
                                });
                            }
                        });
                    }

                    // Fallback
                    if (variacoes.length === 0) {
                        const matchCod = htmlProd.match(/C[ÓO]DIGO\s*:\s*(\d+)/i);
                        const codPrincipal = matchCod ? matchCod[1].trim() : '';
                        const matchBarras = htmlProd.match(/C[ÓO]DIGO\s+BARRAS\s*:\s*(\d+)/i);
                        const codBarrasPrincipal = matchBarras ? matchBarras[1].trim() : '';
                        if (codPrincipal) variacoes.push({ imagem: imagemPrincipal, codigo: codPrincipal, cod_barras: codBarrasPrincipal });
                    }
                    // --- FIM DA EXTRAÇÃO ---

                    for (const v of variacoes) {
                        if (!v.codigo) continue;
                        const attrs = { ...v };
                        delete attrs.codigo; delete attrs.cod_barras; delete attrs.imagem;

                        todosProdutos.push({
                            site: 'marine', grupo: nomeGrupo.toUpperCase() || 'OUTROS',
                            subgrupo: nome, marca: marca, descricao_longa: descricao,
                            url_origem: urlProduto, codigo: v.codigo, cod_barras: v.cod_barras || '',
                            imagem_url: v.imagem || imagemPrincipal, atributos_json: JSON.stringify(attrs)
                        });
                    }
                    
                    console.log(`✅ ${nome} (${variacoes.length} var)`);
                } catch (e) {
                    console.log(`❌ ${e.message}`);
                }
            }
        } catch (e) {
            console.log(`   ❌ Erro: ${e.message}`);
        }
    }

    // Salva o arquivo JSON
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