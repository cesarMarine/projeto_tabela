import { createHash as monitorPedidosHash, randomUUID as monitorPedidosUUID } from 'node:crypto';
import { identificarDispositivo } from './acessos-dispositivo.js';
import { detectarDestaques, codigoNovidades } from './novidades-regras.js';
import { registrarAgrupados, composicaoPedido } from './agrupados-server.js';
import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(express.json({ limit: '100mb' }));
app.use(express.static('.'));
registrarAgrupados(app, supabase);

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  return Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
};
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// IMPORTAÇÕES
// ==========================================

// IMPORTAR PLANILHA DO SISTEMA
// Salva ordem_excel = posição da linha na planilha (linha 2 = 1, linha 3 = 2, ...)
app.post('/api/importar/sistema', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    
    // 1. Encontra a aba GERAL
    const nomeAbaGeral = wb.SheetNames.find(n => n.trim().toUpperCase() === 'GERAL');
    if (!nomeAbaGeral) return res.status(400).json({ erro: 'Aba GERAL não encontrada.' });
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAbaGeral], { defval: '' });
    
    // 2. Encontra a aba ESTOQUE (opcional)
    const nomeAbaEstoque = wb.SheetNames.find(n => n.trim().toUpperCase() === 'ESTOQUE');
    const mapaEstoque = new Map();
    
    if (nomeAbaEstoque) {
      const estoqueRows = XLSX.utils.sheet_to_json(wb.Sheets[nomeAbaEstoque], { defval: '' });
      
      if (estoqueRows.length > 0) {
        console.log('📋 Colunas da aba Estoque:', Object.keys(estoqueRows[0]));
      }
      
      for (const r of estoqueRows) {
        const codOriginal = String(r['Cod. Produto'] ?? r['Código'] ?? r['codigo'] ?? '').trim();
        const codNormalizado = String(parseInt(codOriginal));
        const qtd = r['QTD'] ?? r['Qtd'] ?? r['Estoque'] ?? r['ESTOQUE'] ?? 0;
        
        if (codOriginal) {
          mapaEstoque.set(codNormalizado, num(qtd));
        }
      }
      console.log(`✅ Aba de estoque encontrada. ${mapaEstoque.size} produtos com saldo.`);
    } else {
      console.log(`⚠️ Aba "Estoque" não encontrada. Usando coluna "Estoque" da aba GERAL.`);
    }

    // Compara com o cadastro ANTES da importação; nunca com o saldo já atualizado.
    const anteriores = new Map();
    for (let inicio = 0; ; inicio += 200) {
      const { data, error } = await supabase.from('itens_sistema')
        .select('codigo,estoque,is_lancamento,is_chegou,lancamento_em,chegou_em')
        .order('codigo', { ascending: true }).range(inicio, inicio + 199);
      if (error) throw error;
      (data || []).forEach(item => anteriores.set(codigoNovidades(item.codigo), item));
      if (!data || data.length < 200) break;
    }
    const agoraImportacao = new Date().toISOString();
    let novos = 0, chegaram = 0;
    let inseridos = 0;
    let comEstoque = 0;
    let ordem = 0;

    // Pega a data de hoje no formato YYYY-MM-DD (Fuso de Brasília)
    const dataHoje = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).toISOString().split('T')[0];

    for (const r of linhas) {
      ordem++; // 👈 posição da linha no Excel: 1, 2, 3...
      
      const codigoOriginal = String(r['Código'] ?? r['codigo'] ?? '').trim();
      if (!codigoOriginal) continue;
      
      const codigoNormalizado = String(parseInt(codigoOriginal));
      
      // Estoque: prioriza aba ESTOQUE; se não existir, usa coluna "Estoque" da GERAL
      let estoque = mapaEstoque.get(codigoNormalizado);
      if (estoque === undefined) {
        estoque = num(r['Estoque'] ?? r['ESTOQUE'] ?? r['estoque'] ?? 0);
      }
      
      if (estoque > 0) comEstoque++;
      
      const item = {
        codigo: anteriores.get(codigoNovidades(codigoOriginal))?.codigo || codigoOriginal,
        cod_barras: soDigitos(r['Cod.Barra'] ?? r['cod_barras'] ?? ''),
        descricao: String(r['Descrição'] ?? r['descricao'] ?? '').trim(),
        estoque: estoque,
        preco_venda: num(r['P/Venda'] ?? r['preco_venda'] ?? 0),
        ordem_excel: ordem, // 👈 ordem da linha no Excel
        ativo: 1,
        atualizado_em: new Date().toISOString(),
        ...detectarDestaques(anteriores.get(codigoNovidades(codigoOriginal)), estoque, anteriores.size > 0, agoraImportacao)
      };
      
      // Atualiza a tabela principal (itens_sistema)
      const { error } = await supabase.from('itens_sistema').upsert(item, { onConflict: 'codigo' });
      if (error) throw error;
      inseridos++;
      if (item.lancamento_em === agoraImportacao) novos++;
      if (item.chegou_em === agoraImportacao) chegaram++;

      // 👇 SALVA NO HISTÓRICO 👇
      // Usa UPSERT para o caso de importar duas planilhas no mesmo dia (não duplica, apenas atualiza)
      await supabase.from('historico_estoque').upsert({
        data_importacao: dataHoje,
        codigo_produto: item.codigo,
        estoque: item.estoque,
        preco_venda: item.preco_venda
      }, { onConflict: 'data_importacao,codigo_produto' });
      // 👆 FIM DO HISTÓRICO 👆
    }
    
    res.json({ ok: true, inseridos, comEstoque, novos, chegaram });
  } catch (e) { 
    console.error("Erro importação sistema:", e);
    res.status(500).json({ erro: e.message }); 
  }
});

app.get('/api/admin/historico-estoque', async (req, res) => {
  try {
    const busca = String(req.query.busca || '').trim().toLocaleLowerCase('pt-BR');
    const paginaSolicitada = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const porPagina = 50;
    // Pagina também as leituras do Supabase para não perder linhas no limite padrão.
    async function lerTodos(tabela, campos, ordenar) {
      const resultado = [];
      const lote = 200;
      for (let inicio = 0; ; inicio += lote) {
        let consulta = supabase.from(tabela).select(campos);
        for (const campo of ordenar) consulta = consulta.order(campo, { ascending: true });
        const { data, error } = await consulta.range(inicio, inicio + lote - 1);
        if (error) throw error;
        resultado.push(...(data || []));
        if (!data || data.length < lote) break;
      }
      return resultado;
    }
    const [registros, itens] = await Promise.all([
      lerTodos('historico_estoque', 'codigo_produto,data_importacao,estoque', ['data_importacao', 'codigo_produto']),
      lerTodos('itens_sistema', 'codigo,descricao', ['codigo'])
    ]);
    const descricoes = new Map(itens.map(item => [String(item.codigo), item.descricao || '']));
    const datas = [...new Set(registros.map(reg => reg.data_importacao))].sort();
    const produtos = new Map();
    for (const reg of registros) {
      const codigo = String(reg.codigo_produto);
      const descricao = descricoes.get(codigo) || '';
      if (busca && !codigo.toLowerCase().includes(busca) && !descricao.toLocaleLowerCase('pt-BR').includes(busca)) continue;
      if (!produtos.has(codigo)) produtos.set(codigo, { codigo, descricao, historico: {} });
      const valor = reg.estoque == null || String(reg.estoque).trim() === '' ? null : Number(reg.estoque);
      produtos.get(codigo).historico[reg.data_importacao] = Number.isFinite(valor) ? valor : null;
    }
    let lista = [...produtos.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
    if (req.query.apenas_zerados === '1') {
      lista = lista.filter(prod => {
        const ultimaData = Object.keys(prod.historico).sort().pop();
        return prod.historico[ultimaData] === 0;
      });
    }
    const total = lista.length;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(paginaSolicitada, paginas);
    const selecionados = lista.slice((pagina - 1) * porPagina, pagina * porPagina);
    return res.json({ ok: true, datas, produtos: selecionados, total, pagina, paginas,
      historico: selecionados.flatMap(prod => Object.entries(prod.historico).map(([data_importacao, estoque]) => ({ codigo_produto: prod.codigo, data_importacao, estoque }))) });
    
  } catch (e) {
    console.error('Erro no histórico:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// IMPORTAÇÃO DE SCRAPING
// ==========================================
app.post('/api/importar/scraping', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    
    const dados = JSON.parse(req.file.buffer.toString('utf8'));
    const lista = Array.isArray(dados) ? dados : (dados.produtos || []);

    const limpaZero = (v) => String(v ?? '').trim().replace(/^0+/, '');
    const mapaLote = new Map();

    for (const p of lista) {
      const variacoes = (p.variacoes && p.variacoes.length > 0) ? p.variacoes : [p];

      // Tenta inferir o grupo caso 'p.grupo' venha vazio no JSON
      let grupoDetectado = (p.grupo || '').trim();
      let subgrupoDetectado = (p.subgrupo || p.categoria || '').trim();

      if (!grupoDetectado) {
        const descUpper = (p.descricao_longa || p.titulo || p.nome || '').toUpperCase();
        if (descUpper.includes('ALICATE')) grupoDetectado = 'ALICATES';
        else if (descUpper.includes('CAMISA') || descUpper.includes('VESTUARIO') || descUpper.includes('BONÉ')) grupoDetectado = 'VESTUARIO E ACESSORIOS';
        else if (descUpper.includes('ANZOL')) grupoDetectado = 'ANZOIS';
        else if (descUpper.includes('ISCA')) grupoDetectado = 'ISCAS ARTIFICIAIS';
      }

      for (const v of variacoes) {
        const codVar = limpaZero(v.codigo || p.codigo);
        if (!codVar) continue;

        const { imagem, codigo, cod_barras, ...atributos } = v;

        const payload = {
          site: p.site || 'marine',
          marca: p.marca || '',
          descricao_longa: p.descricao_longa || p.nome || '',
          url_origem: p.url_origem || '',
          codigo: codVar,
          cod_barras: typeof soDigitos === 'function' ? soDigitos(cod_barras || p.cod_barras) : String(cod_barras || p.cod_barras || '').replace(/\D/g, ''),
          imagem_url: imagem || p.imagem_url || '',
          atributos_json: JSON.stringify(atributos || {}),
          data_scraping: new Date().toISOString()
        };

        // APENAS ATUALIZA GRUPO/SUBGRUPO SE ELES VIEREM PREENCHIDOS
        // (Evita sobrescrever categorias existentes no banco com valores vazios)
        if (grupoDetectado) payload.grupo = grupoDetectado;
        if (subgrupoDetectado) payload.subgrupo = subgrupoDetectado;

        mapaLote.set(codVar, payload);
      }
    }

    const batch = Array.from(mapaLote.values());

    if (batch.length > 0) {
      const { error } = await supabase
        .from('scraping_produtos')
        .upsert(batch, { onConflict: 'codigo' });
        
      if (error) throw new Error(error.message);
    }

    res.json({ ok: true, inseridos: batch.length });
  } catch (e) { 
    console.error('Erro na importação do scraping:', e);
    res.status(500).json({ erro: e.message }); 
  }
});
// ==========================================
// STATUS
// ==========================================
app.get('/api/status', async (req, res) => {
  try {
    const { count: sisCount, error: errSisCount } = await supabase
      .from('itens_sistema')
      .select('*', { count: 'exact', head: true });

    const { count: scrCount, error: errScrCount } = await supabase
      .from('scraping_produtos')
      .select('*', { count: 'exact', head: true });

    if (errSisCount || errScrCount) {
      throw new Error(errSisCount?.message || errScrCount?.message);
    }

    let todosSisData = [];
    let de = 0;
    let temMais = true;
    while (temMais) {
      const { data, error } = await supabase.from('itens_sistema').select('codigo').range(de, de + 999);
      if (error) throw error;
      if (data && data.length > 0) { todosSisData.push(...data); de += 1000; }
      else { temMais = false; }
    }

    let todosScrData = [];
    de = 0;
    temMais = true;
    while (temMais) {
      const { data, error } = await supabase.from('scraping_produtos').select('codigo').range(de, de + 999);
      if (error) throw error;
      if (data && data.length > 0) { todosScrData.push(...data); de += 1000; }
      else { temMais = false; }
    }

    const norm = c => String(c ?? '').trim().replace(/^0+/, '').toLowerCase();
    const scrCodigosSet = new Set(todosScrData.map(s => norm(s.codigo)).filter(Boolean));

    let cruzados = 0;
    todosSisData.forEach(s => {
      const cod = norm(s.codigo);
      if (cod && scrCodigosSet.has(cod)) cruzados++;
    });

    res.json({
      ok: true,
      itens_sistema: sisCount || 0,
      scraping_produtos: scrCount || 0,
      cruzados
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ESTOQUE POR SUBGRUPO / FAMÍLIA + ORDEM
// ==========================================
app.get('/api/estoque-subgrupos', async (req, res) => {
  try {
    // 👇 agora traz ordem_excel
    const { data: itens } = await supabase
      .from('itens_sistema')
      .select('codigo, estoque, ordem_excel')
      .eq('ativo', 1);
    
    const mapaEstoque = {};
    const mapaOrdem = {};
    if (itens) {
      itens.forEach(it => {
        const cod = String(parseInt(it.codigo));
        mapaEstoque[cod] = Number(it.estoque) || 0;
        mapaOrdem[cod] = Number(it.ordem_excel) || 999999;
      });
    }

    const { data: familias } = await supabase.from('catalogo_familias').select('id, itens, subgrupos');
    
    const estoquePorFamilia = {};
    const estoquePorSubgrupo = {};
    const ordemPorSubgrupo = {}; // 👈 NOVO

    if (familias) {
      familias.forEach(fam => {
        const codigosFam = JSON.parse(fam.itens || '[]');
        let totalFam = 0;
        codigosFam.forEach(cod => {
          const codNormalizado = String(parseInt(cod));
          totalFam += mapaEstoque[codNormalizado] || 0;
        });
        estoquePorFamilia[fam.id] = totalFam;
      });
    }

    const { data: scraping } = await supabase.from('scraping_produtos').select('codigo, subgrupo');
    if (scraping && itens) {
      scraping.forEach(s => {
        const codNormalizado = String(parseInt(s.codigo));
        const estoqueItem = mapaEstoque[codNormalizado] || 0;
        const ordemItem = mapaOrdem[codNormalizado] ?? 999999;
        
        if (s.subgrupo) {
          if (!estoquePorSubgrupo[s.subgrupo]) estoquePorSubgrupo[s.subgrupo] = 0;
          estoquePorSubgrupo[s.subgrupo] += estoqueItem;

          // 👇 menor ordem_excel de cada subgrupo
          if (ordemPorSubgrupo[s.subgrupo] === undefined || ordemItem < ordemPorSubgrupo[s.subgrupo]) {
            ordemPorSubgrupo[s.subgrupo] = ordemItem;
          }
        }
      });
    }

    res.json({ 
      ok: true, 
      estoquePorSub: estoquePorSubgrupo, 
      estoquePorFamilia,
      ordemPorSubgrupo // 👈 o admin usa isso
    });
  } catch (e) { 
    console.error("Erro estoque-subgrupos:", e);
    res.status(500).json({ ok: false, erro: e.message }); 
  }
});

// ==========================================
// CATÁLOGO (item + scraping)
// ==========================================
app.get('/api/catalogo', async (req, res) => {
  try {
    let todosItensSis = [];
    let de = 0;
    const tamanhoPagina = 1000;
    let temMais = true;

    while (temMais) {
      const { data, error } = await supabase.from('itens_sistema').select('*').range(de, de + tamanhoPagina - 1);
      if (error) throw error;
      if (data && data.length > 0) { todosItensSis.push(...data); de += tamanhoPagina; }
      else { temMais = false; }
    }

    let todosItensScr = [];
    de = 0;
    temMais = true;

    while (temMais) {
      const { data, error } = await supabase.from('scraping_produtos').select('*').range(de, de + tamanhoPagina - 1);
      if (error) throw error;
      if (data && data.length > 0) { todosItensScr.push(...data); de += tamanhoPagina; }
      else { temMais = false; }
    }

    const norm = c => String(c ?? '').trim().replace(/^0+/, '').toLowerCase();

    const mapaScr = {};
    todosItensScr.forEach(s => {
      const chave = norm(s.codigo);
      if (chave) mapaScr[chave] = s;
    });

    const linhas = todosItensSis.map(s => {
      const chaveSis = norm(s.codigo);
      const scr = mapaScr[chaveSis] || {};

      // 👇 ordem_excel: se for 0/vazio, joga pro fim (999999)
      const ordemExcel = (s.ordem_excel && Number(s.ordem_excel) > 0)
        ? Number(s.ordem_excel)
        : 999999;

      return {
        codigo: s.codigo,
        cod_barras: s.cod_barras,
        descricao_sistema: s.descricao,
        estoque: s.estoque,
        preco_venda: s.preco_venda,
        ordem_excel: ordemExcel,
        ordem_scraping: scr.ordem_excel ?? 0,
        subgrupo_scraping: scr.subgrupo || s.subgrupo || scr.grupo || '',
        grupo_scraping: scr.grupo || '',
        marca: scr.marca || '',
        descricao_longa: scr.descricao_longa || '',
        imagem_url: scr.imagem_url || '',
        url_origem: scr.url_origem || '',
        atributos_json: scr.atributos_json || '{}',
        is_chegou: Boolean(s.is_chegou),
        lancamento_em: s.lancamento_em || null,
        chegou_em: s.chegou_em || null,
        is_lancamento: Boolean(s.is_lancamento) // 👈 ADICIONADO AQUI!
      };
    });

    res.json({ ok: true, total: linhas.length, itens: linhas });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.put('/api/familias/:id/ordem', async (req, res) => {
  const { id } = req.params;
  const { ordem } = req.body;

  const { error } = await supabase
    .from('familias')
    .update({ ordem: Number(ordem) })
    .eq('id', id);

  if (error) return res.json({ ok: false, erro: error.message });
  return res.json({ ok: true });
});

// ==========================================
// CLIENTES (importar)
// ==========================================
app.post('/api/importar/clientes', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const aba = wb.SheetNames[0]; 
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '' });

    let inseridos = 0;
    let errosSuapbase = [];

    for (const r of linhas) {
      const cnpjRaw = r['CPF/CNPJ'] ?? r['CPF_CNPJ'] ?? r['CNPJ'] ?? r['cnpj'] ?? '';
      const cnpj = String(cnpjRaw).replace(/\D/g, ''); 
      const codigo = String(r['CODIGO'] ?? r['CÓDIGO'] ?? r['codigo'] ?? '').trim();
      
      if (!cnpj || !codigo) continue; 

      const rep = r['VENDEDOR'] ?? r['Vendedor'] ?? r['vendedor'] ?? 
                  r['Representante'] ?? r['REPRESENTANTE'] ?? r['representante'] ?? 
                  r['COD REP'] ?? r['Cód. Rep'] ?? r['codigo_representante'] ?? '';

      const item = {
        codigo: codigo,
        cnpj: cnpj,
        nome_fantasia: String(r['NOME_FANTASIA'] ?? r['Nome Fantasia'] ?? r['NOME'] ?? r['Nome'] ?? '').trim(),
        razao_social: String(r['RAZAO_SOCIAL'] ?? r['RAZÃO SOCIAL'] ?? r['Razão Social'] ?? r['Razao'] ?? '').trim(),
        cidade: String(r['CIDADE'] ?? r['Cidade'] ?? '').trim(),
        uf: String(r['ESTADO'] ?? r['Estado'] ?? r['UF'] ?? r['uf'] ?? '').trim().toUpperCase(),
        codigo_representante: String(rep).trim(),
        ativo: 1
      };
      
      // UPSERT SEM FORÇAR ONCONFLICT SE NÃO HOUVER CONSTRAINT UNIQUE
      const { error } = await supabase.from('clientes').upsert(item, { onConflict: 'cnpj' });
      
      if (error) {
        if (errosSuapbase.length < 3) errosSuapbase.push(error.message);
      } else {
        inseridos++;
      }
    }

    if (errosSuapbase.length > 0) {
      console.log('❌ Erros do Supabase ao importar:', errosSuapbase);
    }

    res.json({ ok: true, inseridos, erroExemplo: errosSuapbase[0] || null });
  } catch (e) { 
    res.status(500).json({ erro: e.message }); 
  }
});

app.post('/api/admin/produtos/lancamento', async (req, res) => {
  try {
    const { codigo, is_lancamento, is_chegou } = req.body || {};
    if (!codigo || (typeof is_lancamento !== 'boolean' && typeof is_chegou !== 'boolean')) return res.status(400).json({ ok:false, erro:'Informe código e marcação.' });
    const alteracoes = {};
    if (typeof is_lancamento === 'boolean') {
      alteracoes.is_lancamento = is_lancamento;
      alteracoes.lancamento_em = is_lancamento ? new Date().toISOString() : null;
    }
    if (typeof is_chegou === 'boolean') {
      alteracoes.is_chegou = is_chegou;
      alteracoes.chegou_em = is_chegou ? new Date().toISOString() : null;
    }
    const { data, error } = await supabase.from('itens_sistema').update(alteracoes).eq('codigo',codigo).select('codigo').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ok:false,erro:'Produto não encontrado.'});
    res.json({ok:true});
  } catch(e) {res.status(500).json({ok:false,erro:e.message});}
});

// ==========================================
// FAMÍLIAS
// ==========================================
app.get('/api/familias', async (req, res) => {
  try {
    const { data, error } = await supabase.from('catalogo_familias').select('*').order('id', { ascending: false });
    if (error) throw error;
    const familias = (data || []).map(f => ({ 
      ...f, 
      itens: JSON.parse(f.subgrupos || '[]'), 
      subdivisoes: JSON.parse(f.subdivisoes || '[]'),
      ordem_customizada: JSON.parse(f.ordem_customizada || '[]') // 👈 NOVO
    }));
    res.json({ ok: true, familias });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/familias', async (req, res) => {
  try {
    const { nome, itens, subdivisoes, ordem_customizada } = req.body;
    const { data, error } = await supabase.from('catalogo_familias').insert({
      nome, 
      subgrupos: JSON.stringify(itens), 
      subdivisoes: JSON.stringify(subdivisoes || []),
      ordem_customizada: JSON.stringify(ordem_customizada || []) // 👈 NOVO
    }).select();
    if (error) throw error;
    res.json({ ok: true, id: data[0].id });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/familias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, itens, subgrupos, subdivisoes, ordem_customizada, ordem } = req.body;
    
    // Pega a lista enviada
    let listaSubgrupos = subgrupos || itens || [];
    
    // Se por acaso já vier como String JSON, faz parse antes para não sanitizar 2x
    if (typeof listaSubgrupos === 'string') {
      try { listaSubgrupos = JSON.parse(listaSubgrupos); } catch(e) {}
    }

    let listaSubs = subdivisoes || [];
    if (typeof listaSubs === 'string') {
      try { listaSubs = JSON.parse(listaSubs); } catch(e) {}
    }

    let listaOrdemCust = ordem_customizada || [];
    if (typeof listaOrdemCust === 'string') {
      try { listaOrdemCust = JSON.parse(listaOrdemCust); } catch(e) {}
    }

    const payload = {
      nome, 
      subgrupos: listaSubgrupos, // 👈 Envia o array direto (sem JSON.stringify duplo)
      subdivisoes: listaSubs,
      ordem_customizada: listaOrdemCust
    };

    if (ordem !== undefined && ordem !== null) {
      payload.ordem = Number(ordem);
    }

    const { error } = await supabase
      .from('catalogo_familias')
      .update(payload)
      .eq('id', id);

    if (error) return res.status(400).json({ ok: false, erro: error.message });

    res.json({ ok: true });
  } catch (e) { 
    res.status(500).json({ ok: false, erro: e.message }); 
  }
});

// ==========================================
// OFERTAS
// ==========================================

// 1. Listar todas as ofertas ativas
app.get('/api/ofertas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ofertas')
      .select('*');
    if (error) throw error;
    res.json({ ok: true, ofertas: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 2. Adicionar ou atualizar uma oferta
app.post('/api/ofertas', async (req, res) => {
  try {
    const { codigo, desconto_porcentagem } = req.body;
    if (!codigo || !desconto_porcentagem) {
      return res.status(400).json({ ok: false, erro: 'Código e porcentagem são obrigatórios.' });
    }

    const { error } = await supabase
      .from('ofertas')
      .upsert({ codigo, desconto_porcentagem: Number(desconto_porcentagem) }, { onConflict: 'codigo' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 3. Remover produto das ofertas
app.delete('/api/ofertas/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { error } = await supabase
      .from('ofertas')
      .delete()
      .eq('codigo', codigo);

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// CLIENTES (listar)
// ==========================================
app.get('/api/clientes', async (req, res) => {
  try {
    const { busca, pagina = 1, limite = 50 } = req.query;
    const offset = (pagina - 1) * limite;
    
    let query = supabase.from('clientes').select('*', { count: 'exact' });
    if (busca) query = query.or(`cnpj.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%,razao_social.ilike.%${busca}%`);
    
    const { data, count, error } = await query.order('nome_fantasia', { ascending: true }).range(offset, offset + limite - 1);
    if (error) throw error;

    res.json({ ok: true, total: count || 0, pagina: Number(pagina), totalPaginas: Math.ceil((count || 0) / limite), clientes: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ==========================================
// ACRÉSCIMOS
// ==========================================
app.get('/api/acrescimos/grupos', async (req, res) => {
  try {
    const { data: grupos, error } = await supabase.from('grupos_acrescimo').select('*').order('nome');
    if (error) throw error;
    for (let g of grupos) {
      const { count } = await supabase.from('uf_acrescimo').select('*', { count: 'exact', head: true }).eq('grupo_id', g.id);
      g.total_ufs = count || 0;
    }
    res.json({ ok: true, grupos });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.post('/api/acrescimos/grupos', async (req, res) => {
  try {
    const { id, nome, acrescimo } = req.body;
    if (id) {
      await supabase.from('grupos_acrescimo').update({ nome, acrescimo }).eq('id', id);
    } else {
      await supabase.from('grupos_acrescimo').insert({ nome, acrescimo, ordem: 0 });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/api/acrescimos/ufs', async (req, res) => {
  try {
    const { data } = await supabase.from('uf_acrescimo').select('*');
    res.json({ ok: true, ufs: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.post('/api/acrescimos/uf', async (req, res) => {
  try {
    const { uf, grupo_id } = req.body;
    if (!grupo_id) {
      await supabase.from('uf_acrescimo').delete().eq('uf', uf);
    } else {
      await supabase.from('uf_acrescimo').upsert({ uf, grupo_id }, { onConflict: 'uf' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ==========================================
// LOGIN DO CLIENTE
// ==========================================
app.get('/api/login/:cnpj', async (req, res) => {
  const { cnpj } = req.params;

  try {
    // 1. Busca cliente
    const { data: cliente, error: errCli } = await supabase
      .from('clientes')
      .select('*')
      .eq('cnpj', cnpj)
      .single();

    if (errCli || !cliente) return res.status(404).json({ ok: false, erro: "CNPJ não encontrado." });

    // 2. Busca o vendedor vinculado ao representante do cliente
    let vendedorInfo = null;
    if (cliente.codigo_representante) {
      const { data: vendedor } = await supabase
        .from('vendedores')
        .select('nome, whatsapp')
        .eq('codigo_representante', cliente.codigo_representante)
        .single();

      if (vendedor) vendedorInfo = vendedor;
    }

    // 3. BUSCA A REGRA DE ACRÉSCIMO BASEADA NA UF DO CLIENTE
    let acrescimoFinal = 0; // Padrão se não achar grupo
    
    if (cliente.uf) {
      // Procura qual grupo está atrelado à UF do cliente (ex: SP, PR, etc)
      // 👇 CORRIGIDO: Nome da tabela igual ao do Admin (uf_acrescimo) e maybeSingle()
      const { data: ufConfig, error: errUf } = await supabase
        .from('uf_acrescimo') 
        .select('grupo_id')
        .eq('uf', cliente.uf.toUpperCase())
        .maybeSingle(); 

      // Se achou o grupo da UF, busca a porcentagem desse grupo
      if (ufConfig && ufConfig.grupo_id) {
        const { data: grupoInfo } = await supabase
          .from('grupos_acrescimo')
          .select('acrescimo')
          .eq('id', ufConfig.grupo_id)
          .maybeSingle();

        if (grupoInfo && grupoInfo.acrescimo) {
          acrescimoFinal = Number(grupoInfo.acrescimo);
        }
      }
    }

    // Retorna a regra de acréscimo + dados do cliente e do vendedor
    res.json({
      ok: true,
      cliente: {
        cnpj: cliente.cnpj,
        nome: cliente.nome_fantasia || cliente.razao_social,
        uf: cliente.uf,
        representante: cliente.codigo_representante,
        vendedor: vendedorInfo
      },
      regra_acrescimo: { porcentagem: acrescimoFinal } // <-- Agora vai com o valor correto!
    });

  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ROTA: AUDITORIA DE PRODUTOS (SEM SCRAPING)
// ==========================================
app.delete('/api/admin/auditoria-produtos/:codigo', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo || req.body?.confirmar !== codigo) {
      return res.status(400).json({ ok: false, erro: 'Confirme o código do produto para excluir.' });
    }
    // Exclui somente o cadastro comercial indicado; não apaga pedidos nem histórico.
    const { data, error } = await supabase.from('itens_sistema').delete()
      .eq('codigo', codigo).select('codigo');
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ ok: false, erro: 'Produto não encontrado.' });
    res.json({ ok: true, codigo });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.get('/api/admin/auditoria-scraping', async (req, res) => {
  try {
    // 1. Puxa todos os produtos com estoque > 0
    let itensSistema = [];
    let de = 0;
    let temMais = true;
    while (temMais) {
      const { data, error } = await supabase
        .from('itens_sistema')
        .select('codigo, descricao, estoque, preco_venda')
        .gt('estoque', 0)
        .range(de, de + 999);
      if (error) throw error;
      if (data && data.length > 0) { itensSistema.push(...data); de += 1000; } 
      else { temMais = false; }
    }

    // 2. Puxa todos os códigos do scraping
    let itensScraping = [];
    de = 0;
    temMais = true;
    while (temMais) {
      const { data, error } = await supabase
        .from('scraping_produtos')
        .select('codigo')
        .range(de, de + 999);
      if (error) throw error;
      if (data && data.length > 0) { itensScraping.push(...data); de += 1000; } 
      else { temMais = false; }
    }

    // 3. Normaliza os códigos para comparação (ex: "0123" vira "123")
    const normalizar = (c) => String(c ?? '').trim().replace(/^0+/, '').toLowerCase();
    
    // Cria uma "lista negra" com todos os códigos que existem no scraping
    const codigosScrapingSet = new Set(itensScraping.map(s => normalizar(s.codigo)));
    // Componentes de agrupados já estão organizados, mesmo sem scraping próprio.
    const codigosAgrupados = new Set();
    for (let inicio = 0; ; inicio += 200) {
      const { data, error } = await supabase.from('produtos_agrupados').select('componentes')
        .order('id', { ascending: true }).range(inicio, inicio + 199);
      if (error) {
        if (['42P01', 'PGRST205'].includes(error.code)) break;
        throw error;
      }
      (data || []).forEach(p => (p.componentes || []).forEach(c => codigosAgrupados.add(normalizar(c.codigo))));
      if (!data || data.length < 200) break;
    }

    // 4. Separa o que deu match e o que não deu
    let comMatch = 0;
    let semMatch = [];

    itensSistema.forEach(item => {
      const codNorm = normalizar(item.codigo);
      if (codigosScrapingSet.has(codNorm) || codigosAgrupados.has(codNorm)) {
        comMatch++;
      } else {
        // Adiciona na lista de "órfãos"
        semMatch.push({
          codigo: item.codigo,
          descricao: item.descricao,
          estoque: item.estoque,
          preco: item.preco_venda
        });
      }
    });

    // 5. Retorna o relatório completo
    res.json({
      ok: true,
      total_estoque: itensSistema.length,
      com_match: comMatch,
      sem_match_qtd: semMatch.length,
      produtos_sem_match: semMatch.sort((a, b) => a.descricao.localeCompare(b.descricao))
    });

  } catch (e) {
    console.error("Erro na auditoria:", e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// POST: Criar / Atualizar Oferta por Grupo/Família
// POST: Criar / Atualizar Oferta por Subgrupo/Família
// POST: Criar / Atualizar Oferta por Subgrupo/Família
app.post('/api/ofertas/grupo', async (req, res) => {
  const { grupo, desconto_porcentagem, data_fim } = req.body;

  if (!grupo || !desconto_porcentagem) {
    return res.status(400).json({ ok: false, erro: "Informe o grupo e a porcentagem de desconto." });
  }

  try {
    // 1. Busca todos os produtos do subgrupo informado
    const { data: produtos, error: errProd } = await supabase
      .from('scraping_produtos')
      .select('codigo')
      .eq('subgrupo', grupo);

    if (errProd) throw errProd;

    if (!produtos || produtos.length === 0) {
      return res.status(404).json({ ok: false, erro: "Nenhum produto encontrado para este grupo." });
    }

    // 2. Prepara os registros para salvar na tabela 'ofertas'
    const registrosOferta = produtos.map(p => ({
      codigo: String(p.codigo).trim(),
      desconto_porcentagem: parseFloat(desconto_porcentagem),
      data_fim: data_fim || null
    }));

    // 3. Insere / atualiza os descontos
    const { error: errOferta } = await supabase
      .from('ofertas')
      .upsert(registrosOferta, { onConflict: 'codigo' });

    if (errOferta) throw errOferta;

    res.json({ 
      ok: true, 
      mensagem: `Desconto de ${desconto_porcentagem}% aplicado com sucesso a ${produtos.length} produto(s) do grupo "${grupo}"!` 
    });

  } catch (e) {
    console.error("Erro ao aplicar oferta por grupo:", e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// GET: Buscar todas as ofertas ativas com os dados do produto
app.get('/api/ofertas/detalhadas', async (req, res) => {
  try {
    const { data: ofertas, error: errOf } = await supabase.from('ofertas').select('*');
    if (errOf) throw errOf;

    const { data: produtos, error: errProd } = await supabase.from('scraping_produtos').select('*');
    if (errProd) throw errProd;

    // Cruza ofertas com dados dos produtos
    const lista = ofertas.map(o => {
      const prod = produtos.find(p => String(p.codigo) === String(o.codigo));
      return {
        ...o,
        subgrupo: prod?.subgrupo || prod?.subgrupo_scraping || 'Geral',
        descricao: prod?.descricao_longa || prod?.descricao_sistema || '',
        preco_venda: prod?.preco_venda || 0,
        imagem_url: prod?.imagem_url || ''
      };
    });

    res.json({ ok: true, ofertas: lista });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 1. GET: Retorna as ofertas agrupadas por Grupo/Subgrupo
app.get('/api/admin/ofertas-agrupadas', async (req, res) => {
  try {
    const { data: ofertas, error } = await supabase.from('ofertas').select('*');
    if (error) throw error;

    const { data: produtos } = await supabase.from('scraping_produtos').select('codigo, subgrupo');

    const ofertasComGrupo = ofertas.map(o => {
      const prod = produtos?.find(p => String(p.codigo) === String(o.codigo));
      return { ...o, grupo: prod?.subgrupo || 'Individual' };
    });

    const gruposMap = {};
    ofertasComGrupo.forEach(o => {
      const chave = `${o.grupo}_${o.desconto_porcentagem}`;
      if (!gruposMap[chave]) {
        gruposMap[chave] = {
          grupo: o.grupo,
          desconto: o.desconto_porcentagem,
          data_fim: o.data_fim,
          total_itens: 0,
          codigos: []
        };
      }
      gruposMap[chave].total_itens++;
      gruposMap[chave].codigos.push(o.codigo);
    });

    res.json({ ok: true, ofertas_agrupadas: Object.values(gruposMap) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 2. DELETE: Remove todas as ofertas pertencentes a um determinado Grupo/Subgrupo
// ROTA PARA REMOVER OFERTAS POR GRUPO / FAMÍLIA OU INDIVIDUAL
// ROTA PARA REMOVER OFERTAS POR GRUPO / FAMÍLIA / DESCONTO
// ROTA PARA REMOVER OFERTAS POR GRUPO / INDIVIDUAL
app.delete('/api/ofertas/grupo/:nomeGrupo', async (req, res) => {
  try {
    const { nomeGrupo } = req.params;
    const { desconto } = req.query;
    const grupoDecodificado = decodeURIComponent(nomeGrupo);

    let query = supabase.from('ofertas').delete();

    if (grupoDecodificado === 'Individual') {
      // Se for Individual, remove filtrando pela porcentagem de desconto informada
      if (desconto) {
        query = query.eq('desconto_porcentagem', Number(desconto));
      } else {
        // Se não passou desconto, limpa todas as ofertas sem grupo
        query = query.or('grupo.is.null,grupo.eq.Individual,grupo.eq.');
      }
    } else {
      // Tenta filtrar pela coluna 'grupo' ou 'nome_grupo' (se existir)
      query = query.eq('grupo', grupoDecodificado);
    }

    const { error } = await query;
    if (error) throw error;

    res.json({ ok: true, mensagem: `Oferta(s) removida(s) com sucesso!` });
  } catch (e) {
    console.error("ERRO AO DELETAR OFERTAS:", e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});
// POST: Importar Ofertas em Lote via Excel
app.post('/api/ofertas/lote', async (req, res) => {
  const { ofertas } = req.body;

  if (!Array.isArray(ofertas) || !ofertas.length) {
    return res.status(400).json({ ok: false, erro: "Nenhuma oferta enviada para importação." });
  }

  try {
    const registros = ofertas.map(o => ({
      codigo: String(o.codigo).trim(),
      desconto_porcentagem: parseFloat(o.desc) || 0
    })).filter(o => o.codigo && o.desconto_porcentagem > 0);

    const { error } = await supabase
      .from('ofertas')
      .upsert(registros, { onConflict: 'codigo' });

    if (error) throw error;

    res.json({ ok: true, mensagem: `${registros.length} ofertas importadas com sucesso!` });
  } catch (e) {
    console.error("Erro ao importar lote de ofertas:", e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// VENDEDORES
// ==========================================
app.get('/api/vendedores', async (req, res) => {
  try {
    const { data: vendedores, error } = await supabase.from('vendedores').select('*').order('nome');
    if (error) throw error;
    for (let v of vendedores) {
      const { data: acesso } = await supabase.from('vendedores_acesso').select('senha').eq('vendedor_id', v.id).single();
      v.senha = acesso ? acesso.senha : null;
      v.vendedor_id = v.id;
    }
    res.json({ ok: true, vendedores });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// POST: Criar Vendedor (Salva dados em 'vendedores' e a senha em 'vendedores_acesso')
// POST: Criar Vendedor
// POST: Criar Vendedor
app.post('/api/vendedores', async (req, res) => {
  const { nome, codigo_representante, senha, whatsapp } = req.body;

  // Limpa o WhatsApp mantendo apenas números
  const whatsappLimpo = whatsapp ? whatsapp.replace(/\D/g, '') : null;

  try {
    // 1. Insere na tabela 'vendedores' pegando o 'id' retornado
    const { data: vendedor, error: errVendedor } = await supabase
      .from('vendedores')
      .insert([{ 
        nome, 
        codigo_representante, 
        whatsapp: whatsappLimpo,
        ativo: 1 
      }])
      .select('id')
      .single();

    if (errVendedor) throw errVendedor;

    // 2. Grava a senha em 'vendedores_acesso' relacionando com 'vendedor_id'
    if (senha && vendedor?.id) {
      const { error: errAcesso } = await supabase
        .from('vendedores_acesso')
        .upsert({ vendedor_id: vendedor.id, senha }, { onConflict: 'vendedor_id' });

      if (errAcesso) throw errAcesso;
    }

    res.json({ ok: true, mensagem: "Vendedor cadastrado com sucesso!" });
  } catch (e) {
    console.error("Erro ao cadastrar vendedor:", e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// GET: Listar Vendedores (Removida a referência inválida a 'vendedores.vendedor_id')
app.get('/api/vendedores', async (req, res) => {
  try {
    const { data: vendedores, error } = await supabase
      .from('vendedores')
      .select(`
        id,
        nome,
        codigo_representante,
        ativo,
        whatsapp,
        vendedores_acesso ( senha )
      `);

    if (error) throw error;

    // Mapeia 'id' da tabela para 'vendedor_id' esperado pelo frontend
    const listaFormatada = vendedores.map(v => {
      const senhaEncontrada = Array.isArray(v.vendedores_acesso) && v.vendedores_acesso.length > 0 
        ? v.vendedores_acesso[0].senha 
        : (v.vendedores_acesso?.senha || null);

      return {
        vendedor_id: v.id,
        nome: v.nome,
        codigo_representante: v.codigo_representante,
        ativo: v.ativo,
        whatsapp: v.whatsapp,
        senha: senhaEncontrada
      };
    });

    res.json({ ok: true, vendedores: listaFormatada });
  } catch (e) {
    console.error("Erro ao listar vendedores:", e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});
app.post('/api/vendedores/senha', async (req, res) => {
  try {
    const { vendedor_id, senha } = req.body;
    await supabase.from('vendedores_acesso').upsert({ vendedor_id, senha }, { onConflict: 'vendedor_id' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.post('/api/vendedor/login', async (req, res) => {
  try {
    const { codigo, senha } = req.body;
    const { data: vendedor, error: errV } = await supabase.from('vendedores').select('*').eq('codigo_representante', codigo).eq('ativo', 1).single();
    if (errV || !vendedor) return res.status(401).json({ ok: false, erro: 'Código ou senha inválidos.' });

    const { data: acesso } = await supabase.from('vendedores_acesso').select('senha').eq('vendedor_id', vendedor.id).single();
    if (!acesso || acesso.senha !== senha) {
      return res.status(401).json({ ok: false, erro: 'Código ou senha inválidos.' });
    }
    res.json({ ok: true, vendedor: { id: vendedor.id, nome: vendedor.nome, codigo: vendedor.codigo_representante } });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/api/vendedor/:codigo/clientes', async (req, res) => {
  try {
    const { data } = await supabase.from('clientes').select('*').eq('codigo_representante', req.params.codigo).order('nome_fantasia');
    res.json({ ok: true, clientes: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.put('/api/vendedor/cliente/:cnpj/acesso', async (req, res) => {
  try {
    const { cnpj } = req.params;
    const { liberado } = req.body;
    await supabase.from('clientes').update({ acesso_liberado: liberado ? 1 : 0 }).eq('cnpj', cnpj);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ==========================================
// PEDIDOS
// ==========================================


// Diagnóstico apenas: não consulta nem altera dados e não interfere na resposta.
function iniciarMonitoramentoPedido(req, operacao) {
  const monitor = { etapa:'recebido', pedido_id:req.params?.id ?? req.body?.id ?? null };
  try {
    const cliente=String(req.body?.cnpj_cliente || '').replace(/\D/g,'');
    let pagina='nao_informada';
    try { pagina=new URL(req.get('referer') || '').pathname; } catch {}
    const contexto={ requisicao:monitorPedidosUUID(), operacao,
      id_recebido:monitor.pedido_id,
      cliente_ref:cliente ? monitorPedidosHash('sha256').update(cliente).digest('hex').slice(0,16) : null,
      quantidade_itens:Array.isArray(req.body?.itens) ? req.body.itens.length : null,
      status_solicitado:req.body?.status || (operacao==='autosave'?'RASCUNHO':null),
      pagina_informada:pagina, dispositivo:identificarDispositivo(req.get('user-agent'),req.body?.touch_points) };
    const inicio=Date.now();
    monitor.registrar=(evento,extra={})=>{
      try { console.log('[PEDIDO_MONITOR]',JSON.stringify({...contexto,evento,etapa:monitor.etapa,
        pedido_id:monitor.pedido_id,duracao_ms:Date.now()-inicio,...extra})); } catch {}
    };
    monitor.registrar('inicio');
  } catch {}
  if (!monitor.registrar) monitor.registrar=()=>{};
  return monitor;
}

// DELETAR RASCUNHO/PEDIDO
app.delete('/api/pedidos/:id', async (req, res) => {
  const monitor = iniciarMonitoramentoPedido(req, 'exclusao');
  try {
    const { id } = req.params;

    // Remove primeiro os itens por conta da integridade/referência
    monitor.etapa='excluir_itens';
    await supabase.from('pedidos02_itens').delete().eq('pedido_id', id);
    
    // Remove o cabeçalho do pedido
    monitor.etapa='excluir_cabecalho';
    const { error } = await supabase.from('pedidos02').delete().eq('id', id);
    if (error) throw error;

    monitor.registrar('concluido');
    res.json({ ok: true, mensagem: 'Rascunho excluído com sucesso!' });
  } catch (e) {
    monitor.registrar('erro', { codigo_erro:e?.code || null, mensagem:String(e?.message || 'Erro').slice(0,400) });
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.patch('/api/vendedor/:codigo/pedidos/:id/finalizacao', async (req, res) => {
  try {
    const { finalizado, senha } = req.body || {};
    if (typeof finalizado !== 'boolean' || !/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ ok: false, erro: 'Pedido ou marcação inválida.' });
    }
    const { data: vendedor, error: erroVendedor } = await supabase.from('vendedores')
      .select('id').eq('codigo_representante', req.params.codigo).eq('ativo', 1).single();
    if (erroVendedor || !vendedor) return res.status(401).json({ ok: false, erro: 'Acesso inválido.' });
    const { data: acesso, error: erroAcesso } = await supabase.from('vendedores_acesso')
      .select('senha').eq('vendedor_id', vendedor.id).single();
    if (erroAcesso || !acesso || typeof senha !== 'string' || !senha || acesso.senha !== senha) {
      return res.status(401).json({ ok: false, erro: 'Acesso inválido. Entre novamente.' });
    }
    const { data: pedido, error: erroPedido } = await supabase.from('pedidos02')
      .select('id,status').eq('id', req.params.id).eq('codigo_representante', req.params.codigo).maybeSingle();
    if (erroPedido) throw erroPedido;
    if (!pedido) return res.status(404).json({ ok: false, erro: 'Pedido não encontrado para este vendedor.' });
    if (String(pedido.status || '').toUpperCase() === 'RASCUNHO') {
      return res.status(400).json({ ok: false, erro: 'Rascunhos ainda não podem ser finalizados.' });
    }
    const { data, error } = await supabase.from('pedidos02').update({
      finalizado_vendedor: finalizado,
      finalizado_vendedor_em: finalizado ? new Date().toISOString() : null
    }).eq('id', req.params.id).eq('codigo_representante', req.params.codigo)
      .eq('status', pedido.status).select('id,finalizado_vendedor,finalizado_vendedor_em').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ ok: false, erro: 'O pedido mudou. Atualize a lista e tente novamente.' });
    res.json({ ok: true, pedido: data });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.get('/api/vendedor/:codigo/pedidos', async (req, res) => {
  try {
    const { data: pedidos, error } = await supabase.from('pedidos02').select('*').eq('codigo_representante', req.params.codigo).order('id', { ascending: false });
    if (error) throw error;

    for (let p of pedidos) {
      const { data: itens } = await supabase.from('pedidos02_itens').select('*').eq('pedido_id', p.id);
      p.itens = itens || [];
const { data: cli } = await supabase.from('clientes').select('codigo, nome_fantasia, razao_social, uf').eq('cnpj', p.cnpj_cliente).single();
if (cli) { 
  p.codigo_cliente = cli.codigo; // 👈 Adicionando o código aqui
  p.nome_fantasia = cli.nome_fantasia; 
  p.razao_social = cli.razao_social; 
  p.uf = cli.uf; 
}
    }
    res.json({ ok: true, pedidos });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// 1. Rota para o cliente registrar a ação (Chamada silenciosa do index.html)
app.post('/api/log-acao', async (req, res) => {
  try {
    const { cnpj, codigo, descricao, acao, qtd_anterior } = req.body;
    
    await supabase.from('log_acoes_cliente').insert({
      cnpj_cliente: String(cnpj).replace(/\D/g, ''),
      codigo_produto: String(codigo),
      descricao_produto: descricao,
      acao: acao, // 'REMOVEU' ou 'DIMINUIU'
      quantidade_anterior: qtd_anterior
    });
    
    res.json({ ok: true });
  } catch (e) {
    // Retorna 200 mesmo se der erro, para não travar a tela do cliente
    res.json({ ok: false, erro: e.message }); 
  }
});

// 2. Rota para o vendedor buscar as ações do cliente
app.get('/api/vendedor/acoes/:cnpj', async (req, res) => {
  try {
    const { cnpj } = req.params;
    
    const { data, error } = await supabase
      .from('log_acoes_cliente')
      .select('*')
      .eq('cnpj_cliente', String(cnpj).replace(/\D/g, ''))
      .order('data_acao', { ascending: false })
      .limit(50);
      
    if (error) throw error;
    res.json({ ok: true, acoes: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// VINCULAÇÃO MANUAL
app.post('/api/vincular', async (req, res) => {
  try {
    const { data: sisData, error: err1 } = await supabase.from('itens_sistema').select('codigo');
    const { data: scrData, error: err2 } = await supabase.from('scraping_produtos').select('codigo');

    if (err1 || err2) throw new Error((err1 || err2).message);

    const norm = c => String(c ?? '').trim().replace(/^0+/, '').toLowerCase();
    const scrCodigos = new Set((scrData || []).map(s => norm(s.codigo)));

    let cruzados = 0;
    if (sisData) {
      cruzados = sisData.filter(s => {
        const c = norm(s.codigo);
        return c !== '' && scrCodigos.has(c);
      }).length;
    }

    res.json({ ok: true, cruzados });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// OFERTAS (Com suporte a fotos extras)
// ==========================================

// Listar ofertas com dados do produto e fotos
app.get('/api/ofertas', async (req, res) => {
  try {
    const { data: ofertas, error: errOf } = await supabase
      .from('ofertas')
      .select('*');

    if (errOf) throw errOf;
    if (!ofertas || ofertas.length === 0) {
      return res.json({ ok: true, ofertas: [] });
    }

    // Busca detalhes dos produtos cadastrados como oferta
    const codigos = ofertas.map(o => o.codigo);
    
    const { data: itensSis } = await supabase
      .from('itens_sistema')
      .select('codigo, descricao, preco_venda, estoque')
      .in('codigo', codigos);

    const { data: itensScr } = await supabase
      .from('scraping_produtos')
      .select('codigo, subgrupo, marca, imagem_url, atributos_json')
      .in('codigo', codigos);

    const mapaSis = new Map((itensSis || []).map(i => [String(i.codigo), i]));
    const mapaScr = new Map((itensScr || []).map(i => [String(i.codigo), i]));

    const resultado = ofertas.map(of => {
      const sis = mapaSis.get(String(of.codigo)) || {};
      const scr = mapaScr.get(String(of.codigo)) || {};

      return {
        id: of.id,
        codigo: of.codigo,
        desconto_porcentagem: Number(of.desconto_porcentagem),
        imagem_oferta: of.imagem_oferta || scr.imagem_url || '', // Prioriza a imagem especial da oferta
        subgrupo: scr.subgrupo || sis.descricao || 'Produto em Oferta',
        marca: scr.marca || '',
        preco_base: Number(sis.preco_venda || 0),
        estoque: Number(sis.estoque || 0)
      };
    });

    res.json({ ok: true, ofertas: resultado });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Cadastrar / Atualizar Oferta (Permite imagem_oferta personalizada)
app.post('/api/ofertas', async (req, res) => {
  try {
    const { codigo, desconto_porcentagem, imagem_oferta } = req.body;
    if (!codigo || !desconto_porcentagem) {
      return res.status(400).json({ ok: false, erro: 'Código e porcentagem são obrigatórios.' });
    }

    const payload = { 
      codigo, 
      desconto_porcentagem: Number(desconto_porcentagem) 
    };
    if (imagem_oferta) payload.imagem_oferta = imagem_oferta;

    const { error } = await supabase
      .from('ofertas')
      .upsert(payload, { onConflict: 'codigo' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ROTA: VENDEDOR CADASTRAR NOVO CLIENTE (Com código S1, S2...)
// ==========================================
// ==========================================
// ROTA: VENDEDOR CADASTRAR NOVO CLIENTE (Corrigida)
// ==========================================
app.post('/api/vendedor/cliente', async (req, res) => {
  try {
    const { cnpj, razao_social, uf, codigo_representante } = req.body;

    if (!cnpj || !razao_social || !codigo_representante) {
      return res.status(400).json({ ok: false, erro: 'CNPJ, Razão Social e Código de Vendedor são obrigatórios.' });
    }

    const cnpjLimpo = cnpj.replace(/\D/g, '');

    // 1. Verifica se o CNPJ já existe na base de dados
    const { data: clienteExiste } = await supabase
      .from('clientes')
      .select('cnpj, razao_social')
      .eq('cnpj', cnpjLimpo)
      .maybeSingle();

    if (clienteExiste) {
      return res.status(400).json({ 
        ok: false, 
        erro: `O CNPJ ${cnpj} já está cadastrado para: "${clienteExiste.razao_social}".` 
      });
    }

    // 2. Busca o último código com prefixo 'S' para gerar a sequência S1, S2, S3...
    const { data: ultimosClientes } = await supabase
      .from('clientes')
      .select('codigo')
      .ilike('codigo', 'S%');

    let maiorNumero = 0;
    if (ultimosClientes && ultimosClientes.length > 0) {
      ultimosClientes.forEach(c => {
        const num = parseInt(String(c.codigo).replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maiorNumero) {
          maiorNumero = num;
        }
      });
    }

    const novoCodigo = `S${maiorNumero + 1}`;

    // 3. Monta o objeto tentando os nomes de colunas comuns do banco
    const dadosInserir = {
      codigo: novoCodigo,
      cnpj: cnpjLimpo,
      razao_social: razao_social.trim().toUpperCase(),
      uf: (uf || 'PR').trim().toUpperCase(),
      acesso_liberado: 1
    };

    // Tenta salvar no campo representante/codigo_representante
    try {
      dadosInserir.codigo_representante = codigo_representante;
    } catch(e) {}

    const { error: errIns } = await supabase
      .from('clientes')
      .insert(dadosInserir);

    // Se falhar por causa da coluna 'codigo_representante', tenta com 'representante'
    if (errIns && errIns.message.includes('codigo_representante')) {
      delete dadosInserir.codigo_representante;
      dadosInserir.representante = codigo_representante;
      const { error: errRetry } = await supabase.from('clientes').insert(dadosInserir);
      if (errRetry) throw errRetry;
    } else if (errIns) {
      throw errIns;
    }

    res.json({ 
      ok: true, 
      mensagem: `Cliente cadastrado com sucesso! Código gerado: ${novoCodigo}`,
      codigo: novoCodigo 
    });

  } catch (e) {
    console.error('Erro ao cadastrar cliente:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ROTA: PRODUTOS COM ESTOQUE (Admin)
// ==========================================
app.get('/api/admin/produtos-estoque', async (req, res) => {
  try {
    const itens = [];
    for (let inicio = 0; ; inicio += 200) {
      const { data, error } = await supabase.from('itens_sistema')
        .select('id,codigo,cod_barras,descricao,estoque,preco_venda,ativo,atualizado_em,is_lancamento,is_chegou')
        .gt('estoque', 0).order('descricao', { ascending: true }).order('codigo', { ascending:true })
        .range(inicio, inicio + 199);
      if (error) throw error;
      itens.push(...(data || []));
      if (!data || data.length < 200) break;
    }
    res.json({ ok: true, total: itens.length, itens });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ROTA: PEDIDOS DO CLIENTE LOGADO
// ==========================================
// ROTA: PEDIDOS DO CLIENTE (Corrigida)
// ==========================================
app.get('/api/cliente/:cnpj/pedidos', async (req, res) => {
  try {
    const { cnpj } = req.params;
    const { data: pedidos, error } = await supabase
      .from('pedidos02')
      .select('*, itens:pedidos02_itens(*)')
      .eq('cnpj_cliente', cnpj)
      .order('id', { ascending: false });

    if (error) throw error;
    res.json({ ok: true, pedidos: pedidos || [] });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Rota exclusiva para Autosave (Salvamento automático em segundo plano)
app.post('/api/pedidos/autosave', async (req, res) => {
  const monitor = iniciarMonitoramentoPedido(req, 'autosave');
  try {
    const { id, cnpj_cliente, codigo_representante, total, itens } = req.body;

    if (!cnpj_cliente || !itens || itens.length === 0) {
      monitor.registrar('rejeitado', { motivo:'dados_incompletos' });
      return res.status(400).json({ ok: false, erro: 'Carrinho vazio.' });
    }

    const composicao = composicaoPedido(req.body);
    let pedidoId = id;

    monitor.etapa=pedidoId ? 'atualizar_cabecalho' : 'criar_cabecalho';
    if (pedidoId) {
      // Atualiza o rascunho existente
      const { error: erroCabecalho } = await supabase.from('pedidos02').update({ ...composicao, total, status: 'RASCUNHO', data_criacao: new Date().toISOString() }).eq('id', pedidoId);
      if (erroCabecalho) throw erroCabecalho;
      const { error: erroRemocao } = await supabase.from('pedidos02_itens').delete().eq('pedido_id', pedidoId);
      if (erroRemocao) throw erroRemocao;
    } else {
      // Cria um rascunho novo
      const { data: novoPed, error: errInsert } = await supabase
        .from('pedidos02')
        .insert([{ ...composicao, cnpj_cliente, codigo_representante, status: 'RASCUNHO', total, data_criacao: new Date().toISOString() }])
        .select().single();
      if (errInsert) throw errInsert;
      pedidoId = novoPed.id;
    }

    monitor.pedido_id=pedidoId;
    monitor.etapa='gravar_itens';
    monitor.registrar('cabecalho_processado');
    const itensFormatados = itens.map(it => ({
      pedido_id: pedidoId,
      codigo_produto: String(it.codigo),
      descricao: it.desc,
      quantidade: Number(it.qtd),
      preco_base: Number(it.precoBase),
      preco_final: Number(it.precoFinal)
    }));

    // Salva em lotes de 50 para nunca dar timeout
    const TAMANHO_LOTE = 50;
    for (let i = 0; i < itensFormatados.length; i += TAMANHO_LOTE) {
      const lote = itensFormatados.slice(i, i + TAMANHO_LOTE);
      monitor.etapa='gravar_itens_lote_' + Math.floor(i / TAMANHO_LOTE + 1);
      const { error: erroItens } = await supabase.from('pedidos02_itens').insert(lote);
      if (erroItens) throw erroItens;
    }

    monitor.registrar('concluido');
    res.json({ ok: true, id: pedidoId });
  } catch (e) {
    monitor.registrar('erro', { codigo_erro:e?.code || null, mensagem:String(e?.message || 'Erro').slice(0,400) });
    console.error("Erro no autosave:", e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ROTAS PARA O SCRAPING (Admin)
// ==========================================

// 1. Listar e Buscar Scraping
app.get('/api/admin/scraping-produtos', async (req, res) => {
  try {
    const { busca, pagina = 1, limite = 50 } = req.query;
    const offset = (pagina - 1) * limite;
    
    let query = supabase.from('scraping_produtos').select('*', { count: 'exact' });
    
    if (busca) {
      query = query.or(`codigo.ilike.%${busca}%,subgrupo.ilike.%${busca}%,marca.ilike.%${busca}%`);
    }
    
    const { data, count, error } = await query
      .order('id', { ascending: false })
      .range(offset, offset + limite - 1);
      
    if (error) throw error;
    
    res.json({ 
      ok: true, 
      total: count || 0, 
      pagina: Number(pagina), 
      totalPaginas: Math.ceil((count || 0) / limite), 
      produtos: data 
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 2. Editar ou Deletar Scraping
app.put('/api/admin/scraping-produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { grupo, subgrupo, marca, descricao_longa } = req.body;
    
    const { error } = await supabase
      .from('scraping_produtos')
      .update({ grupo, subgrupo, marca, descricao_longa })
      .eq('id', id);
      
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ROTA: CADASTRAR PRODUTO MANUAL NO SCRAPING
// ==========================================
app.post('/api/admin/scraping-produtos', async (req, res) => {
  try {
    const { codigo, cod_barras, grupo, subgrupo, marca, descricao_longa, imagem_url, atributos_json } = req.body;

    if (!codigo || !subgrupo) {
      return res.status(400).json({ ok: false, erro: 'Código e Nome do Produto são obrigatórios.' });
    }

    // Verifica se o produto já existe para não duplicar
    const { data: existente } = await supabase
      .from('scraping_produtos')
      .select('id')
      .eq('codigo', codigo)
      .maybeSingle();

    if (existente) {
      return res.status(400).json({ ok: false, erro: 'Já existe um produto com este código no Scraping.' });
    }

    // Insere o novo produto
    const { error } = await supabase.from('scraping_produtos').insert([{
      site: 'manual', // Identifica que foi cadastrado à mão
      codigo: String(codigo).trim(),
      cod_barras: String(cod_barras || '').trim(),
      grupo: grupo || 'OUTROS',
      subgrupo: subgrupo,
      marca: marca || '',
      descricao_longa: descricao_longa || '',
      imagem_url: imagem_url || '',
      atributos_json: typeof atributos_json === 'string' ? atributos_json : JSON.stringify(atributos_json || {}),
      data_scraping: new Date().toISOString()
    }]);

    if (error) throw error;

    res.json({ ok: true, mensagem: 'Produto cadastrado com sucesso no Scraping!' });
  } catch (e) {
    console.error('Erro ao cadastrar produto manual:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 1. Registra o login do cliente (chamado pelo index.html)
app.post('/api/registrar-login', async (req, res) => {
  try {
    const { cnpj, nome } = req.body;
    // Limpa o CNPJ (apenas números)
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    
    if (!cnpjLimpo) return res.status(400).json({ok:false,erro:'CNPJ obrigatório.'});
    const { error } = await supabase.from('logins_clientes').insert({
      cnpj: cnpjLimpo, nome_cliente: nome,
      dispositivo: identificarDispositivo(req.get('user-agent'), req.body.touch_points)
    });
    if (error) throw error;
    
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao registrar login:", e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});
// 2. Retorna a lista de clientes com o último acesso (chamado pelo vendedor.html)
app.get('/api/vendedor/:codigo/clientes-logins', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    // 1. Busca os clientes do vendedor
    const { data: clientes, error: errCli } = await supabase
      .from('clientes')
      .select('*')
      .eq('codigo_representante', codigo);
      
    if (errCli) throw errCli;

    // 2. Busca logins dos últimos 7 dias
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - 7);
    
    const { data: logins, error: errLogins } = await supabase
      .from('logins_clientes')
      .select('cnpj, data_login')
      .gte('data_login', dataLimite.toISOString())
      .order('data_login', { ascending: false });

    if (errLogins) throw errLogins;

    // 3. Cria um mapa de logins com CNPJ limpo (só números)
    const ultimosLoginsMap = {};
    (logins || []).forEach(l => {
      const cnpjLimpo = String(l.cnpj || '').replace(/\D/g, '');
      if (!ultimosLoginsMap[cnpjLimpo]) {
        ultimosLoginsMap[cnpjLimpo] = l.data_login;
      }
    });

    // 4. Cruza os dados limpando o CNPJ do cliente também
    const clientesComLogins = (clientes || []).map(c => {
      const cnpjLimpoCliente = String(c.cnpj || '').replace(/\D/g, '');
      return {
        ...c,
        ultimo_login: ultimosLoginsMap[cnpjLimpoCliente] || null
      };
    });

    res.json({ ok: true, clientes: clientesComLogins });
  } catch (e) {
    console.error('Erro na rota clientes-logins:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ==========================================
// ROTAS DO DASHBOARD EXECUTIVO (MÉTRICAS)
// ==========================================

app.get('/api/admin/metricas-pedidos', async (req, res) => {
  try {
    // Lê todas as páginas para não omitir pedidos pelo limite do Supabase.
    const pedidos = [];
    for (let inicio = 0; ; inicio += 200) {
      const { data, error } = await supabase.from('pedidos02')
        .select('id, total, status, data_criacao, cnpj_cliente, codigo_representante')
        .order('id', { ascending: false }).range(inicio, inicio + 199);
      if (error) throw error;
      pedidos.push(...(data || []));
      if (!data || data.length < 200) break;
    }
    const { data: vendedores, error: erroVendedores } = await supabase.from('vendedores').select('codigo_representante,nome');
    if (erroVendedores) throw erroVendedores;
    const nomesVendedores = new Map((vendedores || []).map(v => [String(v.codigo_representante), v.nome]));

    // 2. Extrai apenas os CNPJs únicos dos pedidos
    const cnpjsParaBuscar = [...new Set((pedidos || []).map(p => String(p.cnpj_cliente || '').replace(/\D/g, '')))];
    
    // 3. Busca no banco APENAS os clientes que estão nessa lista de pedidos
    const clientes = [];
    for (let inicio = 0; inicio < cnpjsParaBuscar.length; inicio += 200) {
      const { data, error } = await supabase.from('clientes')
        .select('codigo, cnpj, nome_fantasia, razao_social, uf')
        .in('cnpj', cnpjsParaBuscar.slice(inicio, inicio + 200));
      if (error) throw error;
      clientes.push(...(data || []));
    }

    // 4. Cria o mapa
    const mapaClientes = {};
    (clientes || []).forEach(c => {
      const cnpjLimpo = String(c.cnpj || '').replace(/\D/g, '');
      mapaClientes[cnpjLimpo] = c;
    });

    // 5. Junta os dados
    const formatados = (pedidos || []).map(p => {
      const cnpjLimpoPedido = String(p.cnpj_cliente || '').replace(/\D/g, '');
      const cli = mapaClientes[cnpjLimpoPedido] || {};
      
      return {
        id: p.id,
        total: p.total,
        status: p.status,
        data_criacao: p.data_criacao,
        cnpj_cliente: p.cnpj_cliente,
        codigo_representante: p.codigo_representante,
        nome_vendedor: nomesVendedores.get(String(p.codigo_representante)) || '',
        codigo_cliente: cli.codigo || '',
        razao_social: cli.razao_social || '',
        nome_cliente: cli.nome_fantasia || cli.razao_social || 'Não encontrado',
        uf: cli.uf || 'N/A'
      };
    });

    res.json({ ok: true, pedidos: formatados });
  } catch (e) {
    console.error('Erro em metricas-pedidos:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.get('/api/admin/metricas-logins', async (req, res) => {
  try {
    const todos = [];
    for(let inicio=0; ;inicio+=200){
      const {data,error}=await supabase.from('logins_clientes').select('cnpj,data_login,dispositivo')
        .order('data_login',{ascending:false}).order('cnpj',{ascending:true}).range(inicio,inicio+199);
      if(error)throw error;
      todos.push(...(data||[]));if(!data||data.length<200)break;
    }
    const recentes=todos.slice(0,50);
    const limite=Date.now()-30*24*60*60*1000;
    const historico=todos.filter(l=>new Date(l.data_login).getTime()>=limite);
    const dispositivos={celular:0,computador:0,tablet:0,nao_identificado:0};
    historico.forEach(l=>{const tipo=Object.hasOwn(dispositivos,l.dispositivo)?l.dispositivo:'nao_identificado';dispositivos[tipo]++;});
    const limpar=v=>String(v||'').replace(/\D/g,'');
    const unicos=new Set(todos.map(l=>limpar(l.cnpj)).filter(Boolean));
    const codigos=[...new Set(recentes.map(l=>limpar(l.cnpj)).filter(Boolean))];
    const mapa=new Map();
    if(codigos.length){
      const {data,error}=await supabase.from('clientes').select('cnpj,nome_fantasia,razao_social,uf').in('cnpj',codigos);
      if(error)throw error;
      (data||[]).forEach(c=>mapa.set(limpar(c.cnpj),c));
    }
    const logins=recentes.map(l=>{const c=mapa.get(limpar(l.cnpj))||{};return {
      cnpj:l.cnpj,data_login:l.data_login,dispositivo:l.dispositivo||'nao_identificado',
      nome_cliente:c.nome_fantasia||c.razao_social||l.cnpj,uf:c.uf||'—'
    }});
    res.json({ok:true,total_logins:unicos.size,total_acessos:todos.length,logins,logins_historico:historico,
      dispositivos,dispositivos_periodo_dias:30});
  }catch(e){res.status(500).json({ok:false,erro:e.message});}
});

// ROTA: Top Produtos Removidos/Diminuídos do Carrinho
app.get('/api/admin/metricas-intencoes', async (req, res) => {
  try {
    const { data: acoes, error } = await supabase
      .from('log_acoes_cliente')
      .select('*');

    if (error) throw error;

    const contagem = {};
    (acoes || []).forEach(a => {
      const chave = `${a.codigo_produto}__${a.descricao_produto}`;
      if (!contagem[chave]) {
        contagem[chave] = { codigo: a.codigo_produto, descricao: a.descricao_produto, total: 0 };
      }
      contagem[chave].total++;
    });

    // Ordena do mais removido para o menos
    const ranking = Object.values(contagem)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10); // Pega os Top 10

    res.json({ ok: true, ranking });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
// Enviar mensagem
app.post('/api/mensagens', async (req, res) => {
  try {
    const { cnpj_cliente, codigo_representante, remetente, texto } = req.body;
    const { error } = await supabase.from('mensagens').insert({
      cnpj_cliente, codigo_representante, remetente, texto
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// Buscar mensagens do vendedor com o cliente
app.get('/api/mensagens/:cnpj/:codigoRep', async (req, res) => {
  try {
    const { cnpj, codigoRep } = req.params;
    const { data, error } = await supabase
      .from('mensagens')
      .select('*')
      .eq('cnpj_cliente', cnpj)
      .eq('codigo_representante', codigoRep)
      .order('data_criacao', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, mensagens: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.delete('/api/admin/scraping-produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('scraping_produtos').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 2. ROTA PARA CRIAR OU ATUALIZAR PEDIDO (RASCUNHO OU ENVIADO)
// 2. SALVAR RASCUNHO OU FINALIZAR PEDIDO
app.post('/api/pedidos', async (req, res) => {
  const monitor = iniciarMonitoramentoPedido(req, 'salvar');
  try {
    const { id, cnpj_cliente, codigo_representante, status = 'ENVIADO', total, itens } = req.body;

    if (!cnpj_cliente || !itens || itens.length === 0) {
      monitor.registrar('rejeitado', { motivo:'dados_incompletos' });
      return res.status(400).json({ ok: false, erro: 'Dados do pedido incompletos.' });
    }

    const composicao = composicaoPedido(req.body);
    let pedidoId = id;

    monitor.etapa=pedidoId ? 'atualizar_cabecalho' : 'criar_cabecalho';
    if (pedidoId) {
      // Atualiza o rascunho / pedido existente
      const { error: errUpdate } = await supabase
        .from('pedidos02')
        .update({ ...composicao, total, status, data_criacao: new Date().toISOString() })
        .eq('id', pedidoId);

      if (errUpdate) throw errUpdate;

      // Substitui os itens antigos pelos novos do carrinho
      await supabase.from('pedidos02_itens').delete().eq('pedido_id', pedidoId);
    } else {
      // Cria um novo pedido
      const { data: novoPed, error: errInsert } = await supabase
        .from('pedidos02')
        .insert([{ 
          ...composicao,
          cnpj_cliente, 
          codigo_representante, 
          status, 
          total,
          data_criacao: new Date().toISOString()
        }])
        .select()
        .single();

      if (errInsert) throw errInsert;
      pedidoId = novoPed.id;
    }

    // Grava os itens vinculados ao ID do pedido
    monitor.pedido_id=pedidoId;
    monitor.etapa='gravar_itens';
    monitor.registrar('cabecalho_processado');
    const itensFormatados = itens.map(it => ({
      pedido_id: pedidoId,
      codigo_produto: String(it.codigo),
      descricao: it.desc,
      quantidade: Number(it.qtd),
      preco_base: Number(it.precoBase),
      preco_final: Number(it.precoFinal)
    }));

    // 👇 MÁGICA PARA PEDIDOS GRANDES: Salva de 50 em 50
    const TAMANHO_LOTE = 50;
    for (let i = 0; i < itensFormatados.length; i += TAMANHO_LOTE) {
      const lote = itensFormatados.slice(i, i + TAMANHO_LOTE);
      monitor.etapa='gravar_itens_lote_' + Math.floor(i / TAMANHO_LOTE + 1);
      const { error: errItens } = await supabase.from('pedidos02_itens').insert(lote);
      if (errItens) throw errItens;
    }

    monitor.registrar('concluido');
    res.json({ ok: true, id: pedidoId, mensagem: 'Gravado com sucesso!' });
  } catch (e) {
    monitor.registrar('erro', { codigo_erro:e?.code || null, mensagem:String(e?.message || 'Erro').slice(0,400) });
    console.error("ERRO AO SALVAR PEDIDO:", e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Objeto em memória ou persistido no teu banco de dados/JSON
let configuracoesRegras = {
  ofertas_data_inicio: "",
  ofertas_data_fim: "",
  tabela_data_inicio: "",
  tabela_data_fim: ""
};

// GET: Retorna as regras cadastradas
app.get('/api/regras', (req, res) => {
  res.json({ ok: true, regras: configuracoesRegras });
});

// POST: Salva as regras vindas do painel Admin
app.post('/api/regras', (req, res) => {
  const { ofertas_data_inicio, ofertas_data_fim, tabela_data_inicio, tabela_data_fim } = req.body;
  configuracoesRegras = { ofertas_data_inicio, ofertas_data_fim, tabela_data_inicio, tabela_data_fim };
  
  res.json({ ok: true, mensagem: "Regras salvas com sucesso!" });
});



// ROTA DELETAR FAMÍLIA CORRIGIDA
app.delete('/api/familias/:id', async (req, res) => {
  const idFamilia = parseInt(req.params.id, 10);

  if (isNaN(idFamilia)) {
    return res.status(400).json({ ok: false, erro: "ID da família inválido." });
  }

  try {
    // Apaga a família da tabela correta no Supabase
    const { error } = await supabase
      .from('catalogo_familias')
      .delete()
      .eq('id', idFamilia);

    if (error) {
      console.error("Erro Supabase ao deletar família:", error);
      throw error;
    }

    return res.json({ ok: true, mensagem: "Família excluída e produtos liberados!" });

  } catch (error) {
    console.error("Erro interno ao deletar família:", error);
    return res.status(500).json({ ok: false, erro: error.message || "Erro ao deletar família." });
  }
});


app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
