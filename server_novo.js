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

app.post('/api/importar/sistema', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const abaGeral = wb.Sheets['GERAL'];
    if (!abaGeral) return res.status(400).json({ erro: 'Aba GERAL não encontrada.' });
    
    const linhas = XLSX.utils.sheet_to_json(abaGeral, { defval: '' });
    const mapaEstoque = new Map();
    
    if (wb.Sheets['Estoque']) {
      const estoqueRows = XLSX.utils.sheet_to_json(wb.Sheets['Estoque'], { defval: '' });
      for (const r of estoqueRows) {
        const cod = String(r['Código'] ?? r['codigo'] ?? '').trim().replace(/^0+/, '');
        if (cod) mapaEstoque.set(cod, num(r['Estoque'] ?? 0));
      }
    }

    const batch = [];
    for (const r of linhas) {
      const codigoBruto = String(r['Código'] ?? r['codigo'] ?? '').trim();
      const codigo = codigoBruto.replace(/^0+/, ''); // REMOVE ZEROS À ESQUERDA
      if (!codigo) continue;

      batch.push({
        codigo: codigo,
        cod_barras: soDigitos(r['Cod.Barra'] ?? ''),
        descricao: String(r['Descrição'] ?? r['descricao'] ?? '').trim(),
        estoque: mapaEstoque.get(codigo) ?? 0,
        preco_venda: num(r['P/Venda'] ?? r['preco_venda'] ?? 0),
        ativo: 1,
        atualizado_em: new Date().toISOString()
      });
    }

    if (batch.length > 0) {
      const { error } = await supabase.from('itens_sistema').upsert(batch, { onConflict: 'codigo' });
      if (error) throw new Error(error.message);
    }

    res.json({ ok: true, inseridos: batch.length });
  } catch (e) { 
    res.status(500).json({ erro: e.message }); 
  }
});

// ==========================================
// ROTA DE IMPORTAÇÃO DE SCRAPING CORRIGIDA
// ==========================================
app.post('/api/importar/scraping', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo.' });
    const dados = JSON.parse(req.file.buffer.toString('utf8'));
    const lista = Array.isArray(dados) ? dados : (dados.produtos || []);

    const limpaZero = (v) => String(v ?? '').trim().replace(/^0+/, '');
    
    // Usamos um Map para garantir que o mesmo código não vá duplicado no mesmo lote enviando pro Supabase
    const mapaLote = new Map();

    for (const p of lista) {
      const variacoes = (p.variacoes && p.variacoes.length > 0) ? p.variacoes : [p];

      for (const v of variacoes) {
        const codVar = limpaZero(v.codigo || p.codigo);
        if (!codVar) continue;

        const { imagem, codigo, cod_barras, ...atributos } = v;

        mapaLote.set(codVar, {
          site: p.site || 'marine',
          grupo: p.grupo || '',
          subgrupo: p.subgrupo || '',
          marca: p.marca || '',
          descricao_longa: p.descricao_longa || '',
          url_origem: p.url_origem || '',
          codigo: codVar,
          cod_barras: soDigitos(cod_barras || p.cod_barras),
          imagem_url: imagem || p.imagem_url || '',
          atributos_json: JSON.stringify(atributos || {}),
          data_scraping: new Date().toISOString()
        });
      }
    }

    const batch = Array.from(mapaLote.values());

    if (batch.length > 0) {
      const { error } = await supabase.from('scraping_produtos').upsert(batch, { onConflict: 'codigo' });
      if (error) throw new Error(error.message);
    }

    res.json({ ok: true, inseridos: batch.length });
  } catch (e) { 
    res.status(500).json({ erro: e.message }); 
  }
});

// ==========================================
// ROTA DE STATUS COM PARSE DE CÓDIGO MELHORADO
// ==========================================
app.get('/api/status', async (req, res) => {
  try {
    // 1. Contagens totais (utiliza exact count para não sofrer limitação de tabela)
    const { count: sisCount, error: errSisCount } = await supabase
      .from('itens_sistema')
      .select('*', { count: 'exact', head: true });

    const { count: scrCount, error: errScrCount } = await supabase
      .from('scraping_produtos')
      .select('*', { count: 'exact', head: true });

    if (errSisCount || errScrCount) {
      throw new Error(errSisCount?.message || errScrCount?.message);
    }

    // 2. Busca paginada de TODOS os códigos do Sistema ERP
    let todosSisData = [];
    let de = 0;
    let temMais = true;

    while (temMais) {
      const { data, error } = await supabase
        .from('itens_sistema')
        .select('codigo')
        .range(de, de + 999);

      if (error) throw error;
      if (data && data.length > 0) {
        todosSisData.push(...data);
        de += 1000;
      } else {
        temMais = false;
      }
    }

    // 3. Busca paginada de TODOS os códigos do Scraping
    let todosScrData = [];
    de = 0;
    temMais = true;

    while (temMais) {
      const { data, error } = await supabase
        .from('scraping_produtos')
        .select('codigo')
        .range(de, de + 999);

      if (error) throw error;
      if (data && data.length > 0) {
        todosScrData.push(...data);
        de += 1000;
      } else {
        temMais = false;
      }
    }

    // 4. Normalização consistente (limpa espaços e zeros à esquerda, preservando caracteres)
    const norm = c => String(c ?? '').trim().replace(/^0+/, '').toLowerCase();

    const scrCodigosSet = new Set(
      todosScrData.map(s => norm(s.codigo)).filter(Boolean)
    );

    // Conta o cruzamento real da base inteira
    let cruzados = 0;
    todosSisData.forEach(s => {
      const cod = norm(s.codigo);
      if (cod && scrCodigosSet.has(cod)) {
        cruzados++;
      }
    });

    res.json({
      ok: true,
      itens_sistema: sisCount || 0,
      scraping_produtos: scrCount || 0,
      cruzados: cruzados
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
// ==========================================
// ROTA DO CATÁLOGO COM PARSE DE CÓDIGO MELHORADO
// ==========================================
// Manter APENAS UMA declaração da rota no arquivo (Substitua na Linha 148 e APAGUE a da Linha 225)
app.get('/api/catalogo', async (req, res) => {
  try {
    // 1. Busca TODOS os itens do sistema ERP (contornando o limite de 1000 do Supabase)
    let todosItensSis = [];
    let de = 0;
    const tamanhoPagina = 1000;
    let temMais = true;

    while (temMais) {
      const { data, error } = await supabase
        .from('itens_sistema')
        .select('*')
        .range(de, de + tamanhoPagina - 1);

      if (error) throw error;
      
      if (data && data.length > 0) {
        todosItensSis.push(...data);
        de += tamanhoPagina;
      } else {
        temMais = false;
      }
    }

    // 2. Busca TODOS os produtos do scraping (também com paginação por garantia)
    let todosItensScr = [];
    de = 0;
    temMais = true;

    while (temMais) {
      const { data, error } = await supabase
        .from('scraping_produtos')
        .select('*')
        .range(de, de + tamanhoPagina - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        todosItensScr.push(...data);
        de += tamanhoPagina;
      } else {
        temMais = false;
      }
    }

    // Função para normalizar códigos (remover zeros à esquerda)
    const norm = c => String(c ?? '').trim().replace(/^0+/, '').toLowerCase();

    // Mapeia os produtos do scraping
    const mapaScr = {};
    todosItensScr.forEach(s => {
      const chave = norm(s.codigo);
      if (chave) mapaScr[chave] = s;
    });

    // Junta com os produtos do ERP
    const linhas = todosItensSis.map(s => {
      const chaveSis = norm(s.codigo);
      const scr = mapaScr[chaveSis] || {};

      return {
        codigo: s.codigo,
        cod_barras: s.cod_barras,
        descricao_sistema: s.descricao,
        estoque: s.estoque,
        preco_venda: s.preco_venda,
        subgrupo_scraping: scr.subgrupo || s.subgrupo || scr.grupo || '',
        grupo_scraping: scr.grupo || '',
        marca: scr.marca || '',
        descricao_longa: scr.descricao_longa || '',
        imagem_url: scr.imagem_url || '',
        url_origem: scr.url_origem || '',
        atributos_json: scr.atributos_json || '{}'
      };
    });

    res.json({ ok: true, total: linhas.length, itens: linhas });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.post('/api/importar/clientes', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const aba = wb.SheetNames[0]; 
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '' });

    let inseridos = 0;
    for (const r of linhas) {
      const cnpjRaw = r['CPF/CNPJ'] ?? r['CNPJ'] ?? r['cnpj'] ?? '';
      const cnpj = String(cnpjRaw).replace(/\D/g, ''); 
      const codigo = String(r['CÓDIGO'] ?? r['codigo'] ?? '').trim();
      if (!cnpj || !codigo) continue; 

      const rep = r['Representante'] ?? r['REPRESENTANTE'] ?? r['representante'] ?? r['COD REP'] ?? r['Cód. Rep'] ?? r['codigo_representante'] ?? '';

      const item = {
        codigo: codigo, cnpj: cnpj,
        nome_fantasia: String(r['NOME'] ?? r['Nome'] ?? '').trim(),
        razao_social: String(r['RAZÃO SOCIAL'] ?? r['Razão Social'] ?? r['Razao'] ?? '').trim(),
        cidade: String(r['CIDADE'] ?? r['Cidade'] ?? '').trim(),
        uf: String(r['ESTADO'] ?? r['Estado'] ?? r['UF'] ?? r['uf'] ?? '').trim().toUpperCase(),
        codigo_representante: String(rep).trim(),
        ativo: 1
      };
      
      const { error } = await supabase.from('clientes').upsert(item, { onConflict: 'cnpj' });
      if (!error) inseridos++;
    }
    res.json({ ok: true, inseridos });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ==========================================
// CATÁLOGO E STATUS
// ==========================================





// ==========================================
// FAMÍLIAS
// ==========================================

app.get('/api/familias', async (req, res) => {
  try {
    const { data, error } = await supabase.from('catalogo_familias').select('*').order('id', { ascending: false });
    if (error) throw error;
    const familias = (data || []).map(f => ({ 
      ...f, itens: JSON.parse(f.subgrupos || '[]'), subdivisoes: JSON.parse(f.subdivisoes || '[]') 
    }));
    res.json({ ok: true, familias });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/familias', async (req, res) => {
  try {
    const { nome, itens, subdivisoes } = req.body;
    const { data, error } = await supabase.from('catalogo_familias').insert({
      nome, subgrupos: JSON.stringify(itens), subdivisoes: JSON.stringify(subdivisoes || [])
    }).select();
    if (error) throw error;
    res.json({ ok: true, id: data[0].id });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/familias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, itens, subdivisoes } = req.body;
    await supabase.from('catalogo_familias').update({
      nome, subgrupos: JSON.stringify(itens), subdivisoes: JSON.stringify(subdivisoes || [])
    }).eq('id', id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/familias/:id', async (req, res) => {
  await supabase.from('catalogo_familias').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ==========================================
// CLIENTES
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
// ACRÉSCIMOS E LOGIN DO CLIENTE
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

app.get('/api/login/:cnpj', async (req, res) => {
  try {
    const cnpjLimpo = String(req.params.cnpj).replace(/\D/g, '');
    
    const { data: cliente, error: errCli } = await supabase.from('clientes').select('*').eq('cnpj', cnpjLimpo).single();
    if (errCli || !cliente) return res.status(404).json({ ok: false, erro: 'CNPJ não encontrado em nossa base.' });

    if (cliente.acesso_liberado !== 1) {
      return res.status(403).json({ ok: false, erro: 'Seu acesso à tabela de preços está bloqueado. Por favor, solicite a liberação ao seu vendedor.' });
    }

    let acrescimo = 0;
    let grupoNome = 'Padrão (Sem Grupo)';
    if (cliente.uf) {
      const { data: ufData } = await supabase.from('uf_acrescimo').select('grupo_id').eq('uf', cliente.uf).single();
      if (ufData && ufData.grupo_id) {
        const { data: grupoData } = await supabase.from('grupos_acrescimo').select('nome, acrescimo').eq('id', ufData.grupo_id).single();
        if (grupoData) { acrescimo = grupoData.acrescimo; grupoNome = grupoData.nome; }
      }
    }

    res.json({ 
      ok: true, 
      cliente: { codigo: cliente.codigo, nome: cliente.nome_fantasia || cliente.razao_social, cnpj: cliente.cnpj, uf: cliente.uf, representante: cliente.codigo_representante },
      regra_acrescimo: { grupo: grupoNome, porcentagem: acrescimo }
    });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
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

app.post('/api/vendedores', async (req, res) => {
  try {
    const { nome, codigo_representante, senha } = req.body;
    const { data, error } = await supabase.from('vendedores').insert({ nome, codigo_representante, ativo: 1 }).select();
    if (error) {
      if (error.code === '23505') return res.status(400).json({ ok: false, erro: 'Este código de representante já está em uso.' });
      throw error;
    }
    await supabase.from('vendedores_acesso').insert({ vendedor_id: data[0].id, senha });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
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

app.post('/api/pedidos', async (req, res) => {
  try {
    const { cnpj_cliente, codigo_representante, total, itens } = req.body;
    if (!cnpj_cliente || !itens || itens.length === 0) return res.status(400).json({ ok: false, erro: 'Dados do pedido incompletos.' });

    const { data: pedidoData, error: errP } = await supabase.from('pedidos02').insert({
      cnpj_cliente, codigo_representante, total, status: 'Recebido'
    }).select();
    if (errP) throw errP;

    const pedidoId = pedidoData[0].id;
    const itensInsert = itens.map(it => ({
      pedido_id: pedidoId, codigo_produto: it.codigo, descricao: it.desc,
      quantidade: it.qtd, preco_base: it.precoBase, preco_final: it.precoFinal
    }));

    await supabase.from('pedidos02_itens').insert(itensInsert);
    res.json({ ok: true, mensagem: 'Pedido enviado com sucesso!' });
  } catch (e) { 
    console.error("ERRO AO SALVAR PEDIDO:", e.message);
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
      const { data: cli } = await supabase.from('clientes').select('nome_fantasia, razao_social, uf').eq('cnpj', p.cnpj_cliente).single();
      if (cli) { p.nome_fantasia = cli.nome_fantasia; p.razao_social = cli.razao_social; p.uf = cli.uf; }
    }
    res.json({ ok: true, pedidos });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ROTA PARA PROCESSAR VINCULAÇÃO E MATCH MANUALMENTE
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

app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));