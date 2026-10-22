// server_tabela.js  — vive em public/tabela/
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import openTabela from './database_tabela.js';

//import openTabela from './database_tabela.js';

// Força a criação das tabelas de família ao iniciar
// ================================================================
// FORÇA A CRIAÇÃO DAS TABELAS DE FAMÍLIA (VERSÃO CORRIGIDA)
// ================================================================
(async () => {
    try {
        const db = await openTabela();
        
        // 🚨 REMOVE AS TABELAS ANTIGAS (se existirem) para evitar conflito
        await db.run(`DROP TABLE IF EXISTS familias_itens`);
        await db.run(`DROP TABLE IF EXISTS familias`);
        
        // Cria as novas tabelas com a estrutura correta
        await db.run(`CREATE TABLE IF NOT EXISTS familias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            descricao TEXT DEFAULT '',
            item_principal TEXT
        )`);
        
        await db.run(`CREATE TABLE IF NOT EXISTS familias_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            familia_id INTEGER NOT NULL,
            cod_produto TEXT NOT NULL,
            rotulo TEXT DEFAULT '',
            ordem INTEGER DEFAULT 0,
            FOREIGN KEY(familia_id) REFERENCES familias(id) ON DELETE CASCADE
        )`);
        
        console.log('✅ Tabelas de Famílias recriadas com sucesso.');
    } catch (e) { 
        console.error('❌ Erro ao criar tabelas:', e.message); 
    }
})();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3300;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ================================================================
// HELPERS
// ================================================================


function txt(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}


function normalizarCodigo(valor) {
    if (valor === null || valor === undefined) return null;
    let s = String(valor).trim();
    if (!s) return null;
    s = s.replace(/^0+/, '');
    if (s === '') s = '0';
    return s;
}

function normalizarCNPJ(v) {
    if (v === null || v === undefined) return '';
    let s = String(v).replace(/\D/g, '');
    if (s.length === 13) s = '0' + s;   // CNPJ com zero à esquerda comido pelo Excel
    return s;
}

function parseNumero(valor) {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'number') return isNaN(valor) ? null : valor;
    let s = String(valor).trim();
    if (!s) return null;
    s = s.replace(/[R$\s]/g, '');
    if (s.includes(',') && s.includes('.')) {
        const posV = s.lastIndexOf(',');
        const posP = s.lastIndexOf('.');
        if (posV > posP) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

// ================================================================
// PÁGINAS
// ================================================================
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin',      (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/vendedor',   (req, res) => res.sendFile(path.join(__dirname, 'vendedor.html')));
app.get('/apresentacao', (req, res) => res.sendFile(path.join(__dirname, 'apresentacao.html')));
app.get('/teste',      (req, res) => res.sendFile(path.join(__dirname, 'teste.html')));

// ================================================================
// HEALTH
// ================================================================
app.get('/api/tabela/teste', (req, res) => {
    res.json({ success: true, mensagem: 'OK', timestamp: new Date().toISOString() });
});

// ================================================================
// UPLOAD
// ================================================================
app.post('/api/tabela/upload', upload.single('imagem'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
});

// ================================================================
// GRUPOS
// ================================================================
app.get('/api/tabela/grupos', async (req, res) => {
    try {
        const db = await openTabela();
        const grupos = await db.all(`
            SELECT g.*,
                   (SELECT COUNT(*) FROM subgrupos s WHERE s.grupo_id = g.id) as total_subgrupos,
                   (SELECT COUNT(*) FROM itens i
                        JOIN subgrupos s2 ON s2.id = i.subgrupo_id
                        WHERE s2.grupo_id = g.id) as total_itens
            FROM grupos g ORDER BY g.ordem, g.nome
        `);
        res.json({ success: true, grupos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/grupos', async (req, res) => {
    try {
        const { nome, ordem } = req.body;
        if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });
        const db = await openTabela();
        const r = await db.run('INSERT INTO grupos (nome, ordem) VALUES (?, ?)',
            [nome.toUpperCase(), ordem || 0]);
        res.json({ success: true, id: r.lastID });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/grupos/:id', async (req, res) => {
    try {
        const { nome, ordem } = req.body;
        const db = await openTabela();
        await db.run('UPDATE grupos SET nome = COALESCE(?, nome), ordem = COALESCE(?, ordem) WHERE id = ?',
            [nome ? nome.toUpperCase() : null, ordem, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/grupos/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM grupos WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// SUBGRUPOS
// ================================================================
app.get('/api/tabela/subgrupos', async (req, res) => {
    try {
        const db = await openTabela();
        const { grupo_id } = req.query;
        let sql = `
            SELECT s.*, g.nome as grupo_nome,
                   (SELECT COUNT(*) FROM itens i WHERE i.subgrupo_id = s.id) as total_itens
            FROM subgrupos s JOIN grupos g ON g.id = s.grupo_id
        `;
        const params = [];
        if (grupo_id) { sql += ' WHERE s.grupo_id = ?'; params.push(grupo_id); }
        sql += ' ORDER BY s.ordem, s.nome';
        const subgrupos = await db.all(sql, params);
        res.json({ success: true, subgrupos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/subgrupos/:id', async (req, res) => {
    try {
        const db = await openTabela();
        const s = await db.get(`
            SELECT s.*, g.nome as grupo_nome
            FROM subgrupos s JOIN grupos g ON g.id = s.grupo_id
            WHERE s.id = ?
        `, [req.params.id]);
        if (!s) return res.status(404).json({ success: false, error: 'Subgrupo não encontrado' });
        const itens = await db.all(
            'SELECT * FROM itens WHERE subgrupo_id = ? ORDER BY CAST(cod_produto AS INTEGER), cod_produto',
            [s.id]);
        res.json({ success: true, subgrupo: s, itens });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/subgrupos', async (req, res) => {
    try {
        const {
            grupo_id, nome, imagem_url, imagem_lateral_1, imagem_lateral_2,
            legenda_1, legenda_2, legenda_3,
            descricao_longa, ordem
        } = req.body;
        if (!grupo_id || !nome) return res.status(400).json({ success: false, error: 'Grupo e nome obrigatórios' });
        const db = await openTabela();
        const r = await db.run(`
            INSERT INTO subgrupos
                (grupo_id, nome, imagem_url, imagem_lateral_1, imagem_lateral_2,
                 legenda_1, legenda_2, legenda_3,
                 descricao_longa, ordem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            grupo_id, nome,
            imagem_url || '', imagem_lateral_1 || '', imagem_lateral_2 || '',
            legenda_1 || '', legenda_2 || '', legenda_3 || '',
            descricao_longa || '', ordem || 0
        ]);
        res.json({ success: true, id: r.lastID });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/subgrupos/:id', async (req, res) => {
    try {
        const {
            nome, imagem_url, imagem_lateral_1, imagem_lateral_2,
            legenda_1, legenda_2, legenda_3,
            descricao_longa, ordem
        } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE subgrupos SET
                nome = COALESCE(?, nome),
                imagem_url = COALESCE(?, imagem_url),
                imagem_lateral_1 = COALESCE(?, imagem_lateral_1),
                imagem_lateral_2 = COALESCE(?, imagem_lateral_2),
                legenda_1 = COALESCE(?, legenda_1),
                legenda_2 = COALESCE(?, legenda_2),
                legenda_3 = COALESCE(?, legenda_3),
                descricao_longa = COALESCE(?, descricao_longa),
                ordem = COALESCE(?, ordem)
            WHERE id = ?
        `, [
            nome, imagem_url, imagem_lateral_1, imagem_lateral_2,
            legenda_1, legenda_2, legenda_3,
            descricao_longa, ordem, req.params.id
        ]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/subgrupos/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('UPDATE itens SET subgrupo_id = NULL WHERE subgrupo_id = ?', [req.params.id]);
        await db.run('DELETE FROM subgrupos WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/subgrupos/:id/vincular-itens', async (req, res) => {
    try {
        const subgrupoId = parseInt(req.params.id, 10);
        const { codigos, forcar } = req.body;

        if (!subgrupoId || !Array.isArray(codigos) || !codigos.length) {
            return res.status(400).json({ success: false, error: 'Parâmetros inválidos' });
        }

        const db = await openTabela();
        const sg = await db.get('SELECT id, nome FROM subgrupos WHERE id = ?', [subgrupoId]);
        if (!sg) return res.status(404).json({ success: false, error: 'Subgrupo não existe' });

        // 🛡️ Verifica conflitos
        const conflitos = [];
        for (const codRaw of codigos) {
            const cod = normalizarCodigo(codRaw);
            if (!cod) continue;
            const itemAtual = await db.get(`
                SELECT i.cod_produto, i.subgrupo_id, s.nome AS subgrupo_nome
                FROM itens i
                LEFT JOIN subgrupos s ON s.id = i.subgrupo_id
                WHERE i.cod_produto = ?
            `, [cod]);
            if (itemAtual && itemAtual.subgrupo_id && itemAtual.subgrupo_id !== subgrupoId) {
                conflitos.push({
                    cod_produto: cod,
                    subgrupo_atual: itemAtual.subgrupo_nome
                });
            }
        }

        // 🛡️ Se tem conflito e não foi forçado, recusa
        if (conflitos.length > 0 && !forcar) {
            return res.json({
                success: false,
                error: `⚠️ ${conflitos.length} item(ns) já pertencem a outros subgrupos.`,
                conflitos: conflitos.slice(0, 20),
                total_conflitos: conflitos.length,
                precisa_confirmar: true
            });
        }

        // Executa vinculação
        let vinculados = 0;
        await db.run('BEGIN TRANSACTION');
        try {
            for (const codRaw of codigos) {
                const cod = normalizarCodigo(codRaw);
                if (!cod) continue;
                const r = await db.run(
                    'UPDATE itens SET subgrupo_id = ? WHERE CAST(cod_produto AS TEXT) = ?',
                    [subgrupoId, String(cod)]
                );
                if (r && r.changes > 0) vinculados++;
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        res.json({ success: true, vinculados, conflitos_resolvidos: conflitos.length });
    } catch (e) {
        console.error('❌ [vincular-itens] ERRO:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/tabela/subgrupos/:id/desvincular-itens', async (req, res) => {
    try {
        const { codigos } = req.body;
        if (!Array.isArray(codigos)) return res.status(400).json({ success: false, error: 'Envie {codigos: []}' });
        const db = await openTabela();
        let removidos = 0;
        await db.run('BEGIN TRANSACTION');
        try {
            const stmt = await db.prepare('UPDATE itens SET subgrupo_id = NULL WHERE cod_produto = ? AND subgrupo_id = ?');
            for (const cod of codigos) {
                const r = await stmt.run([normalizarCodigo(cod), req.params.id]);
                if (r.changes > 0) removidos++;
            }
            await stmt.finalize();
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }
        res.json({ success: true, removidos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// ITENS
// ================================================================
app.get('/api/tabela/itens', async (req, res) => {
    try {
        const db = await openTabela();
        const { busca = '', pagina = 1, limite = 50, filtro = 'todos' } = req.query;
        const offset = (parseInt(pagina) - 1) * parseInt(limite);
        const wheres = ['s.estoque > 0'];
        const params = [];

        if (busca.trim()) {
            wheres.push('(s.codigo LIKE ? OR s.descricao LIKE ?)');
            params.push('%' + busca.trim() + '%', '%' + busca.trim() + '%');
        }
        
        if (filtro === 'com-preco') wheres.push('s.preco_venda > 0');
        if (filtro === 'sem-preco') wheres.push('s.preco_venda = 0');
        if (filtro === 'sem-grupo') wheres.push('(sc.grupo IS NULL OR sc.grupo = "")');
        if (filtro === 'com-grupo') wheres.push('sc.grupo IS NOT NULL AND sc.grupo != ""');

        const whereSql = ' WHERE ' + wheres.join(' AND ');

        const totalRow = await db.get(`
            SELECT COUNT(*) as c 
            FROM itens_sistema s 
            LEFT JOIN scraping_produtos sc ON s.codigo = sc.codigo
            ${whereSql}
        `, params);
        
        const itens = await db.all(`
            SELECT 
                s.codigo AS cod_produto,
                s.cod_barras,
                s.descricao,
                s.preco_venda AS preco,
                s.estoque AS saldo,
                sc.grupo AS grupo_nome,
                sc.subgrupo AS subgrupo_nome,
                sc.imagem_url
            FROM itens_sistema s
            LEFT JOIN scraping_produtos sc ON s.codigo = sc.codigo
            ${whereSql}
            ORDER BY s.codigo ASC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limite), offset]);

        res.json({
            success: true, itens, total: totalRow.c,
            pagina: parseInt(pagina), limite: parseInt(limite),
            totalPaginas: Math.ceil(totalRow.c / parseInt(limite))
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/tabela/itens/:cod', async (req, res) => {
    try {
        const db = await openTabela();
        const item = await db.get('SELECT * FROM itens WHERE cod_produto = ?', [normalizarCodigo(req.params.cod)]);
        if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });
        res.json({ success: true, item });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/itens/:cod', async (req, res) => {
    try {
        const db = await openTabela();
        const { descricao, preco, saldo } = req.body;
        await db.run(`
            UPDATE itens SET descricao = COALESCE(?, descricao),
                             preco = COALESCE(?, preco),
                             saldo = COALESCE(?, saldo)
            WHERE cod_produto = ?
        `, [descricao, preco, saldo, normalizarCodigo(req.params.cod)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/itens/:cod/imagem', async (req, res) => {
    try {
        const { imagem_url } = req.body;
        const db = await openTabela();
        await db.run('UPDATE itens SET imagem_url = ? WHERE cod_produto = ?',
            [imagem_url || '', normalizarCodigo(req.params.cod)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// IMPORTAÇÃO DE PREÇOS
// ================================================================
// ================================================================
// IMPORTAÇÃO DE PREÇOS — cria grupos/subgrupos automaticamente
// ================================================================
// ================================================================
// IMPORTAÇÃO DE PREÇOS — cria grupos/subgrupos + galeria de imagens
// ================================================================
app.post('/api/tabela/importar-precos', async (req, res) => {
    try {
        const { linhas } = req.body;
        if (!Array.isArray(linhas) || !linhas.length)
            return res.status(400).json({ success: false, error: 'Nenhuma linha' });

        const db = await openTabela();
        const preparadas = [];
        let ignorados = 0;

        // ============================================================
        // MAPAS DE GRUPOS E SUBGRUPOS
        // ============================================================
        const mapaGrupos = {};
        const mapaSubgrupos = {};

        const gruposExistentes = await db.all('SELECT id, nome FROM grupos');
        for (const g of gruposExistentes) {
            mapaGrupos[g.nome.toUpperCase().trim()] = g.id;
        }

        const subgruposExistentes = await db.all(`
            SELECT s.id, s.nome, g.nome AS grupo_nome
            FROM subgrupos s JOIN grupos g ON g.id = s.grupo_id
        `);
        for (const s of subgruposExistentes) {
            const chave = `${s.grupo_nome.toUpperCase().trim()}|${s.nome.toUpperCase().trim()}`;
            mapaSubgrupos[chave] = s.id;
        }

        // ============================================================
        // CRIA GRUPOS NOVOS
        // ============================================================
        const gruposNecessarios = new Set();
        for (const l of linhas) {
            const g = txt(l.grupo).toUpperCase().trim();
            if (g) gruposNecessarios.add(g);
        }
        let gruposCriados = 0;
        for (const nomeGrupo of gruposNecessarios) {
            if (!mapaGrupos[nomeGrupo]) {
                const r = await db.run(
                    'INSERT INTO grupos (nome, ordem) VALUES (?, 999)',
                    [nomeGrupo]
                );
                mapaGrupos[nomeGrupo] = r.lastID;
                gruposCriados++;
                console.log(`✅ Grupo criado: "${nomeGrupo}" (id ${r.lastID})`);
            }
        }

        // ============================================================
        // CRIA SUBGRUPOS NOVOS
        // ============================================================
        let subgruposCriados = 0;
        for (const l of linhas) {
            const g = txt(l.grupo).toUpperCase().trim();
            const s = txt(l.subgrupo).toUpperCase().trim();
            if (!g || !s) continue;
            const chave = `${g}|${s}`;
            if (!mapaSubgrupos[chave]) {
                const grupoId = mapaGrupos[g];
                if (!grupoId) continue;
                const r = await db.run(
                    'INSERT INTO subgrupos (grupo_id, nome, ordem) VALUES (?, ?, 999)',
                    [grupoId, txt(l.subgrupo).trim()]
                );
                mapaSubgrupos[chave] = r.lastID;
                subgruposCriados++;
                console.log(`✅ Subgrupo criado: "${g} / ${s}" (id ${r.lastID})`);
            }
        }

        // ============================================================
        // 🖼️ ATUALIZA GALERIA DE IMAGENS DOS SUBGRUPOS
        // Pega as linhas com LINK preenchido, agrupadas por (GRUPO + SUBGRUPO),
        // na ORDEM do Excel.
        //   1ª linha com LINK → imagem_url + legenda_1
        //   2ª linha com LINK → imagem_lateral_1 + legenda_2
        //   3ª linha com LINK → imagem_lateral_2 + legenda_3
        //   4ª+ linhas com LINK → IGNORADAS
        // ============================================================
        const galerias = {}; // { 'CARRETILHAS|AVENGER': [ { url, rotulo }, ... ] }
        for (const l of linhas) {
            const g = txt(l.grupo).toUpperCase().trim();
            const s = txt(l.subgrupo).toUpperCase().trim();
            const url = txt(l.imagem_url);
            if (!g || !s || !url) continue;

            const chave = `${g}|${s}`;
            if (!galerias[chave]) galerias[chave] = [];
            galerias[chave].push({
                url,
                rotulo: txt(l.rotulo)
            });
        }

        let galeriasAtualizadas = 0;
        for (const [chave, imagens] of Object.entries(galerias)) {
            const subgrupoId = mapaSubgrupos[chave];
            if (!subgrupoId) continue;

            const principal     = imagens[0] || { url: '', rotulo: '' };
            const lateral1      = imagens[1] || { url: '', rotulo: '' };
            const lateral2      = imagens[2] || { url: '', rotulo: '' };

            await db.run(`
                UPDATE subgrupos SET
                    imagem_url        = ?,
                    legenda_1         = ?,
                    imagem_lateral_1  = ?,
                    legenda_2         = ?,
                    imagem_lateral_2  = ?,
                    legenda_3         = ?
                WHERE id = ?
            `, [
                principal.url, principal.rotulo,
                lateral1.url,  lateral1.rotulo,
                lateral2.url,  lateral2.rotulo,
                subgrupoId
            ]);

            galeriasAtualizadas++;
            console.log(`🖼️  Galeria atualizada: "${chave}" → ${imagens.length} imagem(ns)`);
        }

        // ============================================================
        // PREPARA AS LINHAS
        let posicaoExcel = 0;
for (const l of linhas) {
    posicaoExcel++;   // ← cada linha ganha uma posição sequencial

    const cod = normalizarCodigo(l.cod_produto);
    const preco = parseNumero(l.preco);
    const descricao = txt(l.descricao);
    if (!cod || preco === null) { ignorados++; continue; }

    const atributos = {};
    const camposAtributos = ['ORDEM', 'CX/CT', 'MODELO', 'COR', 'TAMANHO', 'QTD',
                              'MANIVELA', 'QTD ROLAM.', 'RECOLHIMENTO', 'PESO',
                              'FREIO MAX', 'IPT', 'CAP. LINHA MONO', 'CAP. LINHA MULTI'];
    for (const campo of camposAtributos) {
        const valor = txt(l[campo]);
        if (valor) atributos[campo] = valor;
    }

    const grupoNome = txt(l.grupo).toUpperCase().trim();
    const subgrupoNome = txt(l.subgrupo).toUpperCase().trim();
    const chaveSG = `${grupoNome}|${subgrupoNome}`;
    const subgrupoId = mapaSubgrupos[chaveSG] || null;

    preparadas.push({
        cod,
        preco,
        descricao,
        atributos,
        subgrupo_id: subgrupoId,
        imagem_url: txt(l.imagem_url) || null,
        ordem_excel: posicaoExcel   // ← NOVO
    });
}

        if (!preparadas.length) {
            return res.json({
                success: true,
                inseridos: 0, atualizados: 0, ignorados,
                total: linhas.length,
                grupos_criados: gruposCriados,
                subgrupos_criados: subgruposCriados,
                galerias_atualizadas: galeriasAtualizadas
            });
        }

        // ============================================================
        // INSERE / ATUALIZA ITENS
        // ============================================================
        await db.run('BEGIN TRANSACTION');
        let inseridos = 0, atualizados = 0, vinculados = 0;
        try {
            for (const p of preparadas) {
                const existe = await db.get('SELECT id FROM itens WHERE cod_produto = ?', [p.cod]);

                if (existe) {
                    await db.run(`
                        UPDATE itens SET
                            preco = ?,
                            descricao = COALESCE(NULLIF(?, ''), descricao),
                            subgrupo_id = COALESCE(?, subgrupo_id),
                            imagem_url = COALESCE(?, imagem_url),
                            atualizado_preco = CURRENT_TIMESTAMP
                        WHERE cod_produto = ?
                    `, [p.preco, p.descricao, p.subgrupo_id, p.imagem_url, p.cod]);
                    atualizados++;
                } else {
                    await db.run(`
                        INSERT INTO itens (cod_produto, descricao, preco, saldo, subgrupo_id, imagem_url, atualizado_preco)
                        VALUES (?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)
                    `, [p.cod, p.descricao, p.preco, p.subgrupo_id, p.imagem_url]);
                    inseridos++;
                }

                if (p.subgrupo_id) vinculados++;

                // Atributos (protege ORDEM_SUBGRUPO)
                // Atributos (protege ORDEM_SUBGRUPO e ORDEM_EXCEL do usuário)
const ATRIBUTOS_PROTEGIDOS = ['ORDEM_SUBGRUPO'];
for (const atributo of Object.keys(p.atributos)) {
    if (ATRIBUTOS_PROTEGIDOS.includes(atributo)) continue;
    await db.run(
        'DELETE FROM itens_atributos WHERE cod_produto = ? AND atributo = ?',
        [p.cod, atributo]
    );
}
for (const [atributo, valor] of Object.entries(p.atributos)) {
    if (ATRIBUTOS_PROTEGIDOS.includes(atributo)) continue;
    const existeAtrib = await db.get(
        'SELECT 1 FROM itens_atributos WHERE cod_produto = ? AND atributo = ?',
        [p.cod, atributo]
    );
    if (existeAtrib) {
        await db.run(
            'UPDATE itens_atributos SET valor = ? WHERE cod_produto = ? AND atributo = ?',
            [valor, p.cod, atributo]
        );
    } else {
        await db.run(
            'INSERT INTO itens_atributos (cod_produto, atributo, valor, ordem) VALUES (?, ?, ?, 0)',
            [p.cod, atributo, valor]
        );
    }
}

// ✅ Salva a POSIÇÃO no Excel
await db.run(
    "DELETE FROM itens_atributos WHERE cod_produto = ? AND atributo = 'ORDEM_EXCEL'",
    [p.cod]
);
await db.run(
    "INSERT INTO itens_atributos (cod_produto, atributo, valor, ordem) VALUES (?, 'ORDEM_EXCEL', ?, 0)",
    [p.cod, String(p.ordem_excel)]
);
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        await db.run(`INSERT INTO importacoes_log (tipo, inseridos, atualizados, ignorados, total)
                      VALUES ('precos', ?, ?, ?, ?)`,
                     [inseridos, atualizados, ignorados, linhas.length]);

        res.json({
            success: true,
            inseridos, atualizados, ignorados,
            total: linhas.length,
            vinculados,
            grupos_criados: gruposCriados,
            subgrupos_criados: subgruposCriados,
            galerias_atualizadas: galeriasAtualizadas
        });
    } catch (e) {
        console.error('❌ Erro importar-precos:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});
// ================================================================
// DEBUG — ver atributos de um item
// ================================================================
app.get('/api/tabela/debug-atributos/:cod', async (req, res) => {
    try {
        const db = await openTabela();
        const cod = normalizarCodigo(req.params.cod);
        const item = await db.get('SELECT cod_produto, descricao, preco FROM itens WHERE cod_produto = ?', [cod]);
        if (!item) return res.json({ success: false, error: 'Item não encontrado: ' + cod });

        const atributos = await db.all(
            'SELECT atributo, valor FROM itens_atributos WHERE cod_produto = ? ORDER BY ordem',
            [cod]
        );

        res.json({ success: true, item, atributos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// ================================================================
// IMPORTAÇÃO DE ESTOQUE
// ================================================================
app.post('/api/tabela/importar-estoque', async (req, res) => {
    try {
        const { linhas } = req.body;
        if (!Array.isArray(linhas) || !linhas.length)
            return res.status(400).json({ success: false, error: 'Nenhuma linha' });

        const db = await openTabela();
        const preparadas = [];
        let ignorados = 0;

        for (const l of linhas) {
            const cod = normalizarCodigo(l.cod_produto);
            const saldo = parseNumero(l.saldo);
            const descricao = (l.descricao || '').trim();
            if (!cod || saldo === null) { ignorados++; continue; }
            preparadas.push({ cod, saldo, descricao });
        }
        if (!preparadas.length)
            return res.json({ success: true, inseridos: 0, atualizados: 0, ignorados, total: linhas.length });

        await db.run('BEGIN TRANSACTION');
        let inseridos = 0, atualizados = 0;
        try {
            const stmtGet = await db.prepare('SELECT id FROM itens WHERE cod_produto = ?');
            const stmtIns = await db.prepare(`
                INSERT INTO itens (cod_produto, descricao, preco, saldo, atualizado_estoque)
                VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)
            `);
            const stmtUpd = await db.prepare(`
                UPDATE itens SET saldo = ?, descricao = COALESCE(NULLIF(?, ''), descricao),
                                 atualizado_estoque = CURRENT_TIMESTAMP
                WHERE cod_produto = ?
            `);
            for (const p of preparadas) {
                const existe = await stmtGet.get(p.cod);
                if (existe) { await stmtUpd.run([p.saldo, p.descricao, p.cod]); atualizados++; }
                else { await stmtIns.run([p.cod, p.descricao, p.saldo]); inseridos++; }
            }
            await stmtGet.finalize(); await stmtIns.finalize(); await stmtUpd.finalize();
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        await db.run(`INSERT INTO importacoes_log (tipo, inseridos, atualizados, ignorados, total)
                      VALUES ('estoque', ?, ?, ?, ?)`,
                     [inseridos, atualizados, ignorados, linhas.length]);
        res.json({ success: true, inseridos, atualizados, ignorados, total: linhas.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// IMPORTAÇÃO DE CLIENTES
// ================================================================
app.post('/api/tabela/importar-clientes', async (req, res) => {
    try {
        const { linhas } = req.body;
        if (!Array.isArray(linhas) || !linhas.length)
            return res.status(400).json({ success: false, error: 'Nenhuma linha' });

        const db = await openTabela();

        const vendedores = await db.all(
            'SELECT id, codigo_representante FROM vendedores WHERE codigo_representante IS NOT NULL'
        );
        const mapaVend = {};
        for (const v of vendedores)
            mapaVend[String(v.codigo_representante).trim()] = v.id;

        const preparadas = [];
        let ignorados = 0;

        for (const l of linhas) {
            const codigoRaw = txt(l.codigo || l['CÓDIGO']);
            if (!/^\d+$/.test(codigoRaw)) { ignorados++; continue; }

            const cnpj = normalizarCNPJ(l.cnpj || l['CPF/CNPJ']);
            if (!cnpj) { ignorados++; continue; }

            const rep = txt(l.codigo_representante || l['Representante'] || l['REPRESENTANTE']);

            preparadas.push({
                codigo: codigoRaw,
                cnpj,
                nome_fantasia: txt(l.nome_fantasia || l['NOME']),
                razao_social:  txt(l.razao_social  || l['RAZÃO SOCIAL']) || txt(l.nome_fantasia || l['NOME']),
                cidade:        txt(l.cidade  || l['CIDADE']),
                uf:            txt(l.uf || l['ESTADO']).toUpperCase(),
                contato:       txt(l.contato || l['CONTATO']),
                telefone:      txt(l.telefone || l['TELEFONE']),
                celular:       txt(l.celular  || l['CELULAR']),
                email:         txt(l.email    || l['E-MAIL']),
                email_nfe:     txt(l.email_nfe || l['E-MAIL NFe']),
                codigo_representante: rep,
                vendedor_id: mapaVend[rep] || null
            });
        }

        if (!preparadas.length)
            return res.json({ success: true, inseridos: 0, atualizados: 0, ignorados, total: linhas.length });

        console.log(`📥 Importando ${preparadas.length} clientes (${ignorados} ignorados)...`);

        await db.run('BEGIN TRANSACTION');
        let inseridos = 0, atualizados = 0;
        const erros = [];

        try {
            for (const c of preparadas) {
                try {
                    const existe = await db.get('SELECT id FROM clientes WHERE codigo = ?', [c.codigo]);

                    if (existe) {
                        await db.run(`
                            UPDATE clientes SET
                                cnpj = ?, nome_fantasia = ?, razao_social = ?, cidade = ?, uf = ?,
                                contato = ?, telefone = ?, celular = ?, email = ?, email_nfe = ?,
                                codigo_representante = ?, vendedor_id = ?
                            WHERE codigo = ?
                        `, [c.cnpj, c.nome_fantasia, c.razao_social, c.cidade, c.uf,
                            c.contato, c.telefone, c.celular, c.email, c.email_nfe,
                            c.codigo_representante, c.vendedor_id, c.codigo]);
                        atualizados++;
                    } else {
                        await db.run(`
                            INSERT INTO clientes
                                (codigo, cnpj, nome_fantasia, razao_social, cidade, uf, contato,
                                 telefone, celular, email, email_nfe, codigo_representante, vendedor_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [c.codigo, c.cnpj, c.nome_fantasia, c.razao_social, c.cidade, c.uf,
                            c.contato, c.telefone, c.celular, c.email, c.email_nfe,
                            c.codigo_representante, c.vendedor_id]);
                        inseridos++;
                    }
                } catch (errLinha) {
                    console.error(`⚠️  Falha no cliente ${c.codigo} (CNPJ ${c.cnpj}):`, errLinha.message);
                    erros.push({ codigo: c.codigo, cnpj: c.cnpj, erro: errLinha.message });
                    ignorados++;
                }
            }
            await db.run('COMMIT');
        } catch (errTx) {
            await db.run('ROLLBACK');
            console.error('❌ Erro na transação:', errTx);
            throw errTx;
        }

        await db.run(`
            INSERT INTO importacoes_log (tipo, inseridos, atualizados, ignorados, total)
            VALUES ('clientes', ?, ?, ?, ?)
        `, [inseridos, atualizados, ignorados, linhas.length]);

        console.log(`✅ Clientes: ${inseridos} inseridos, ${atualizados} atualizados, ${ignorados} ignorados.`);

        res.json({
            success: true,
            inseridos,
            atualizados,
            ignorados,
            total: linhas.length,
            erros: erros.length ? erros : undefined
        });

    } catch (e) {
        console.error('❌ Erro importar-clientes:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
// VENDEDORES
// ================================================================
app.get('/api/tabela/vendedores', async (req, res) => {
    try {
        const db = await openTabela();
        const v = await db.all(`
            SELECT v.*, (SELECT COUNT(*) FROM clientes c WHERE c.vendedor_id = v.id) as total_clientes
            FROM vendedores v ORDER BY v.nome
        `);
        res.json({ success: true, vendedores: v });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/vendedores', async (req, res) => {
    try {
        const { nome, codigo_representante } = req.body;
        if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });
        const db = await openTabela();
        const r = await db.run('INSERT INTO vendedores (nome, codigo_representante) VALUES (?, ?)',
            [nome.toUpperCase(), codigo_representante ? String(codigo_representante).trim() : null]);

        // Religa clientes que tinham esse código de representante
        if (codigo_representante) {
            await db.run('UPDATE clientes SET vendedor_id = ? WHERE codigo_representante = ?',
                [r.lastID, String(codigo_representante).trim()]);
        }
        res.json({ success: true, id: r.lastID });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/vendedores/:id', async (req, res) => {
    try {
        const { nome, codigo_representante, ativo } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE vendedores SET
                nome = COALESCE(?, nome),
                codigo_representante = COALESCE(?, codigo_representante),
                ativo = COALESCE(?, ativo)
            WHERE id = ?
        `, [nome, codigo_representante, ativo, req.params.id]);

        // Religa clientes
        if (codigo_representante) {
            await db.run('UPDATE clientes SET vendedor_id = ? WHERE codigo_representante = ?',
                [req.params.id, String(codigo_representante).trim()]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/vendedores/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM vendedores WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// CLIENTES (listagem e edição)
// ================================================================
app.get('/api/tabela/clientes', async (req, res) => {
    try {
        const db = await openTabela();
        const { busca = '', vendedor_id, pagina = 1, limite = 50 } = req.query;
        const offset = (parseInt(pagina) - 1) * parseInt(limite);
        const wheres = [];
        const params = [];

        if (busca.trim()) {
            wheres.push('(codigo LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR razao_social LIKE ?)');
            const t = '%' + busca.trim() + '%';
            params.push(t, t, t, t);
        }
        if (vendedor_id) { wheres.push('vendedor_id = ?'); params.push(vendedor_id); }

        const whereSql = wheres.length ? ' WHERE ' + wheres.join(' AND ') : '';
        const totalRow = await db.get('SELECT COUNT(*) as c FROM clientes' + whereSql, params);
        const clientes = await db.all(`
            SELECT c.*, v.nome as vendedor_nome
            FROM clientes c
            LEFT JOIN vendedores v ON v.id = c.vendedor_id
            ${whereSql}
            ORDER BY c.nome_fantasia LIMIT ? OFFSET ?
        `, [...params, parseInt(limite), offset]);

        res.json({
            success: true, clientes, total: totalRow.c,
            pagina: parseInt(pagina), limite: parseInt(limite),
            totalPaginas: Math.ceil(totalRow.c / parseInt(limite))
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/clientes/:codigo', async (req, res) => {
    try {
        const db = await openTabela();
        const c = await db.get(`
            SELECT c.*, v.nome as vendedor_nome
            FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id
            WHERE c.codigo = ?
        `, [req.params.codigo]);
        if (!c) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
        res.json({ success: true, cliente: c });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/clientes/:codigo', async (req, res) => {
    try {
        const { nome_fantasia, razao_social, cidade, uf, contato, telefone, celular,
                email, email_nfe, cnpj, vendedor_id, codigo_representante, ativo } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE clientes SET
                nome_fantasia = COALESCE(?, nome_fantasia),
                razao_social = COALESCE(?, razao_social),
                cidade = COALESCE(?, cidade),
                uf = COALESCE(?, uf),
                contato = COALESCE(?, contato),
                telefone = COALESCE(?, telefone),
                celular = COALESCE(?, celular),
                email = COALESCE(?, email),
                email_nfe = COALESCE(?, email_nfe),
                cnpj = COALESCE(?, cnpj),
                vendedor_id = COALESCE(?, vendedor_id),
                codigo_representante = COALESCE(?, codigo_representante),
                ativo = COALESCE(?, ativo)
            WHERE codigo = ?
        `, [nome_fantasia, razao_social, cidade, uf, contato, telefone, celular,
            email, email_nfe, cnpj ? normalizarCNPJ(cnpj) : null,
            vendedor_id, codigo_representante, ativo, req.params.codigo]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// CAMPANHAS
// ================================================================
app.get('/api/tabela/campanhas', async (req, res) => {
    try {
        const db = await openTabela();
        const { vendedor_id } = req.query;
        let sql = `
            SELECT c.*, v.nome as vendedor_nome,
                   (SELECT COUNT(*) FROM ofertas_campanha oc WHERE oc.campanha_id = c.id AND oc.ativo = 1) as total_ofertas
            FROM campanhas c
            LEFT JOIN vendedores v ON v.id = c.vendedor_id
        `;
        const params = [];
        if (vendedor_id) { sql += ' WHERE c.vendedor_id = ?'; params.push(vendedor_id); }
        sql += ' ORDER BY c.id DESC';
        const campanhas = await db.all(sql, params);
        res.json({ success: true, campanhas });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/campanhas/:id', async (req, res) => {
    try {
        const db = await openTabela();
        const c = await db.get(`
            SELECT c.*, v.nome as vendedor_nome
            FROM campanhas c LEFT JOIN vendedores v ON v.id = c.vendedor_id
            WHERE c.id = ?
        `, [req.params.id]);
        if (!c) return res.status(404).json({ success: false, error: 'Campanha não encontrada' });
        const ofertas = await db.all(`
            SELECT oc.*, i.descricao, i.preco
            FROM ofertas_campanha oc
            LEFT JOIN itens i ON i.cod_produto = oc.cod_produto
            WHERE oc.campanha_id = ?
        `, [c.id]);
        res.json({ success: true, campanha: c, ofertas });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/campanhas', async (req, res) => {
    try {
        const { nome, subtitulo, banner_url, vendedor_id, senha, exigir_senha, ativa,
                data_inicio, data_fim } = req.body;
        if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });
        const db = await openTabela();
        const r = await db.run(`
            INSERT INTO campanhas (nome, subtitulo, banner_url, vendedor_id, senha, exigir_senha, ativa, data_inicio, data_fim)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [nome, subtitulo || '', banner_url || '', vendedor_id || null,
            senha || '', exigir_senha ? 1 : 0, ativa ? 1 : 0,
            data_inicio || null, data_fim || null]);
        res.json({ success: true, id: r.lastID });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/campanhas/:id', async (req, res) => {
    try {
        const { nome, subtitulo, banner_url, senha, exigir_senha, ativa, data_inicio, data_fim } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE campanhas SET
                nome = COALESCE(?, nome),
                subtitulo = COALESCE(?, subtitulo),
                banner_url = COALESCE(?, banner_url),
                senha = COALESCE(?, senha),
                exigir_senha = COALESCE(?, exigir_senha),
                ativa = COALESCE(?, ativa),
                data_inicio = COALESCE(?, data_inicio),
                data_fim = COALESCE(?, data_fim)
            WHERE id = ?
        `, [nome, subtitulo, banner_url, senha,
            exigir_senha === undefined ? null : (exigir_senha ? 1 : 0),
            ativa === undefined ? null : (ativa ? 1 : 0),
            data_inicio, data_fim, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/campanhas/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM campanhas WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Ofertas da campanha
app.post('/api/tabela/campanhas/:id/ofertas', async (req, res) => {
    try {
        const { codigos, desconto_pct } = req.body;
        if (!Array.isArray(codigos) || !desconto_pct)
            return res.status(400).json({ success: false, error: 'Envie {codigos: [], desconto_pct: number}' });
        const db = await openTabela();
        let inseridos = 0;
        await db.run('BEGIN TRANSACTION');
        try {
            const stmt = await db.prepare(`
                INSERT INTO ofertas_campanha (campanha_id, cod_produto, desconto_pct, ativo)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(campanha_id, cod_produto) DO UPDATE SET desconto_pct = excluded.desconto_pct, ativo = 1
            `);
            for (const cod of codigos) {
                const r = await stmt.run([req.params.id, normalizarCodigo(cod), desconto_pct]);
                if (r.changes > 0) inseridos++;
            }
            await stmt.finalize();
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }
        res.json({ success: true, inseridos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/campanhas/:id/ofertas/:cod', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM ofertas_campanha WHERE campanha_id = ? AND cod_produto = ?',
            [req.params.id, normalizarCodigo(req.params.cod)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// ENTRAR (login do cliente)
// ================================================================
app.post('/api/tabela/entrar', async (req, res) => {
    try {
        const { cnpj, senha, campanha_id } = req.body;
        const cnpjLimpo = normalizarCNPJ(cnpj);
        if (!cnpjLimpo) return res.status(400).json({ success: false, error: 'CNPJ obrigatório' });

        const db = await openTabela();
        const cliente = await db.get(`
            SELECT c.*, v.nome as vendedor_nome
            FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id
            WHERE c.cnpj = ?
        `, [cnpjLimpo]);

        if (!cliente) {
            return res.json({ success: false, error: 'CNPJ não cadastrado. Fale com seu vendedor.' });
        }

        // Busca campanha ativa (a do vendedor do cliente, ou global)
        let campanha;
        if (campanha_id) {
            campanha = await db.get('SELECT * FROM campanhas WHERE id = ? AND ativa = 1', [campanha_id]);
        } else {
            campanha = await db.get(`
                SELECT * FROM campanhas
                WHERE ativa = 1
                  AND (vendedor_id = ? OR vendedor_id IS NULL)
                ORDER BY id DESC LIMIT 1
            `, [cliente.vendedor_id || -1]);
        }

        if (!campanha) {
            return res.json({ success: false, error: 'Nenhuma campanha ativa no momento.' });
        }

        // Verifica senha se a campanha exigir
        if (campanha.exigir_senha) {
            if (!senha) return res.json({ success: false, error: 'Senha obrigatória.', precisa_senha: true });
            if (String(senha).trim() !== String(campanha.senha || '').trim()) {
                return res.json({ success: false, error: 'Senha incorreta.', precisa_senha: true });
            }
        }

        // Registra no histórico que o cliente entrou (opcional — pode virar "último acesso")
        // Aqui só retornamos os dados
        res.json({
            success: true,
            cliente: {
                codigo: cliente.codigo,
                cnpj: cliente.cnpj,
                nome_fantasia: cliente.nome_fantasia,
                razao_social: cliente.razao_social,
                cidade: cliente.cidade,
                uf: cliente.uf,
                vendedor_nome: cliente.vendedor_nome
            },
            campanha: {
                id: campanha.id,
                nome: campanha.nome,
                subtitulo: campanha.subtitulo,
                banner_url: campanha.banner_url
            }
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// CATÁLOGO (o que o cliente vê)
// ================================================================

// ================================================================
// PEDIDOS
// ================================================================
app.post('/api/tabela/pedidos', async (req, res) => {
    try {
        const { campanha_id, cliente_codigo, observacao, itens } = req.body;
        if (!cliente_codigo || !Array.isArray(itens) || !itens.length)
            return res.status(400).json({ success: false, error: 'Cliente e itens obrigatórios' });

        const db = await openTabela();
        const cliente = await db.get('SELECT * FROM clientes WHERE codigo = ?', [cliente_codigo]);
        if (!cliente) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });

        let total = 0;
        let qtd = 0;
        for (const it of itens) {
            const subtotal = (it.valor_unitario || 0) * (it.quantidade || 0);
            total += subtotal;
            qtd += 1;
        }
        total = +total.toFixed(2);

        await db.run('BEGIN TRANSACTION');
        let pedidoId;
        try {
            const r = await db.run(`
                INSERT INTO pedidos (campanha_id, cliente_id, vendedor_id, total, qtd_itens, observacao, status)
                VALUES (?, ?, ?, ?, ?, ?, 'Recebido')
            `, [campanha_id || null, cliente.id, cliente.vendedor_id, total, qtd, observacao || '']);
            pedidoId = r.lastID;

            const stmt = await db.prepare(`
                INSERT INTO pedido_itens
                    (pedido_id, cod_produto, descricao, quantidade, valor_unitario, valor_com_desconto, subtotal)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            for (const it of itens) {
                const subtotal = +((it.valor_unitario || 0) * (it.quantidade || 0)).toFixed(2);
                await stmt.run([pedidoId, it.cod_produto, it.descricao || '',
                    it.quantidade, it.valor_unitario, it.valor_com_desconto || null, subtotal]);
            }
            await stmt.finalize();
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        res.json({ success: true, pedido_id: pedidoId, total });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/pedidos/vendedor/:id', async (req, res) => {
    try {
        const db = await openTabela();
        const pedidos = await db.all(`
            SELECT p.*,
                   c.nome_fantasia, c.razao_social, c.cidade, c.uf, c.cnpj,
                   v.nome AS vendedor_nome,
                   v.codigo_representante AS vendedor_rep
            FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            LEFT JOIN vendedores v ON v.id = p.vendedor_id
            WHERE p.vendedor_id = ?
            ORDER BY p.id DESC
        `, [req.params.id]);
        for (const p of pedidos) {
            p.itens = await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ?', [p.id]);
        }
        res.json({ success: true, pedidos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/tabela/pedidos/cliente/:codigo', async (req, res) => {
    try {
        const db = await openTabela();
        const pedidos = await db.all(`
            SELECT p.* FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            WHERE c.codigo = ?
            ORDER BY p.id DESC
        `, [req.params.codigo]);
        for (const p of pedidos) {
            p.itens = await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ?', [p.id]);
        }
        res.json({ success: true, pedidos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/pedidos/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const db = await openTabela();
        await db.run('UPDATE pedidos SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// STATS / LOG
// ================================================================
app.get('/api/tabela/stats', async (req, res) => {
    try {
        const db = await openTabela();
        const total       = await db.get('SELECT COUNT(*) as c FROM itens');
        const comPreco    = await db.get('SELECT COUNT(*) as c FROM itens WHERE preco > 0');
        const comSaldo    = await db.get('SELECT COUNT(*) as c FROM itens WHERE saldo > 0');
        const comSaldoEPreco = await db.get('SELECT COUNT(*) as c FROM itens WHERE saldo > 0 AND preco > 0');
        const somaSaldo   = await db.get('SELECT COALESCE(SUM(saldo),0) as s FROM itens');
        const clientes    = await db.get('SELECT COUNT(*) as c FROM clientes');
        const pedidos     = await db.get('SELECT COUNT(*) as c FROM pedidos');
        const ultimaPreco = await db.get("SELECT * FROM importacoes_log WHERE tipo='precos' ORDER BY id DESC LIMIT 1");
        const ultimaEstoque = await db.get("SELECT * FROM importacoes_log WHERE tipo='estoque' ORDER BY id DESC LIMIT 1");
        const ultimaClientes = await db.get("SELECT * FROM importacoes_log WHERE tipo='clientes' ORDER BY id DESC LIMIT 1");
        res.json({
            success: true,
            total: total.c,
            comPreco: comPreco.c,
            comSaldo: comSaldo.c,
            comSaldoEPreco: comSaldoEPreco.c,
            somaSaldo: somaSaldo.s,
            clientes: clientes.c,
            pedidos: pedidos.c,
            ultimaPreco, ultimaEstoque, ultimaClientes
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/log-importacoes', async (req, res) => {
    try {
        const db = await openTabela();
        const logs = await db.all('SELECT * FROM importacoes_log ORDER BY id DESC LIMIT 20');
        res.json({ success: true, logs });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/itens', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM itens');
        await db.run('DELETE FROM importacoes_log');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// ================================================================
// ACRÉSCIMOS POR UF
// ================================================================

// ---------- GRUPOS ----------
app.get('/api/tabela/grupos-acrescimo', async (req, res) => {
    try {
        const db = await openTabela();
        const grupos = await db.all(`
            SELECT g.*,
                   (SELECT COUNT(*) FROM uf_acrescimo u WHERE u.grupo_id = g.id) as total_ufs
            FROM grupos_acrescimo g
            ORDER BY g.ordem, g.nome
        `);
        res.json({ success: true, grupos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/grupos-acrescimo', async (req, res) => {
    try {
        const { nome, acrescimo, ordem } = req.body;
        if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });
        const db = await openTabela();
        const r = await db.run(
            'INSERT INTO grupos_acrescimo (nome, acrescimo, ordem) VALUES (?, ?, ?)',
            [nome.toUpperCase().trim(), parseFloat(acrescimo) || 0, parseInt(ordem) || 0]
        );
        res.json({ success: true, id: r.lastID });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/tabela/grupos-acrescimo/:id', async (req, res) => {
    try {
        const { nome, acrescimo, ordem } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE grupos_acrescimo SET
                nome = COALESCE(?, nome),
                acrescimo = COALESCE(?, acrescimo),
                ordem = COALESCE(?, ordem)
            WHERE id = ?
        `, [
            nome ? nome.toUpperCase().trim() : null,
            acrescimo !== undefined ? parseFloat(acrescimo) : null,
            ordem !== undefined ? parseInt(ordem) : null,
            req.params.id
        ]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tabela/grupos-acrescimo/:id', async (req, res) => {
    try {
        const db = await openTabela();
        // Desassocia UFs antes de excluir
        await db.run('UPDATE uf_acrescimo SET grupo_id = NULL WHERE grupo_id = ?', [req.params.id]);
        await db.run('DELETE FROM grupos_acrescimo WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ---------- UFs ----------
app.get('/api/tabela/uf-acrescimo', async (req, res) => {
    try {
        const db = await openTabela();
        const ufs = await db.all(`
            SELECT u.uf, u.grupo_id, g.nome as grupo_nome, g.acrescimo as grupo_acrescimo
            FROM uf_acrescimo u
            LEFT JOIN grupos_acrescimo g ON g.id = u.grupo_id
            ORDER BY u.uf
        `);
        res.json({ success: true, ufs });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Salva todas de uma vez — recebe { ufs: [{ uf, grupo_id }, ...] }
app.post('/api/tabela/uf-acrescimo', async (req, res) => {
    try {
        const { ufs } = req.body;
        if (!Array.isArray(ufs)) return res.status(400).json({ success: false, error: 'Envie {ufs: []}' });
        const db = await openTabela();

        await db.run('BEGIN TRANSACTION');
        try {
            for (const item of ufs) {
                const grupoId = item.grupo_id === '' || item.grupo_id === null || item.grupo_id === undefined
                    ? null
                    : parseInt(item.grupo_id);
                await db.run(
                    'UPDATE uf_acrescimo SET grupo_id = ? WHERE uf = ?',
                    [grupoId, item.uf]
                );
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// ================================================================
// DEBUG — ver estado dos acréscimos por UF
// ================================================================
app.get('/api/tabela/debug-ufs', async (req, res) => {
    try {
        const db = await openTabela();
        const ufs = await db.all(`
            SELECT u.uf, u.grupo_id, g.nome as grupo_nome, g.acrescimo
            FROM uf_acrescimo u
            LEFT JOIN grupos_acrescimo g ON g.id = u.grupo_id
            ORDER BY u.uf
        `);
        const grupos = await db.all(`
            SELECT g.id, g.nome, g.acrescimo,
                   (SELECT COUNT(*) FROM uf_acrescimo u WHERE u.grupo_id = g.id) as total_ufs
            FROM grupos_acrescimo g
            ORDER BY g.ordem, g.nome
        `);
        res.json({ success: true, grupos, ufs });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/entrar', async (req, res) => {
    try {
        const { cnpj, senha, campanha_id } = req.body;
        const cnpjLimpo = normalizarCNPJ(cnpj);
        if (!cnpjLimpo) return res.status(400).json({ success: false, error: 'CNPJ obrigatório' });

        const db = await openTabela();
        const cliente = await db.get(`
            SELECT c.*, v.nome as vendedor_nome
            FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id
            WHERE c.cnpj = ?
        `, [cnpjLimpo]);

        if (!cliente) {
            return res.json({ success: false, error: 'CNPJ não cadastrado. Fale com seu vendedor.' });
        }

        // Busca o acréscimo da UF do cliente
        let acrescimoUf = 0;
        let grupoAcrescimoNome = null;
        if (cliente.uf) {
            const row = await db.get(`
                SELECT g.id as grupo_id, g.nome as grupo_nome, g.acrescimo
                FROM uf_acrescimo u
                LEFT JOIN grupos_acrescimo g ON g.id = u.grupo_id
                WHERE u.uf = ?
            `, [String(cliente.uf).toUpperCase()]);
            if (row && row.acrescimo !== null && row.acrescimo !== undefined) {
                acrescimoUf = Number(row.acrescimo);
                grupoAcrescimoNome = row.grupo_nome;
            }
        }

        // Busca campanha ativa
        let campanha;
        if (campanha_id) {
            campanha = await db.get('SELECT * FROM campanhas WHERE id = ? AND ativa = 1', [campanha_id]);
        } else {
            campanha = await db.get(`
                SELECT * FROM campanhas
                WHERE ativa = 1 AND (vendedor_id = ? OR vendedor_id IS NULL)
                ORDER BY id DESC LIMIT 1
            `, [cliente.vendedor_id || -1]);
        }

        if (!campanha) {
            return res.json({ success: false, error: 'Nenhuma campanha ativa no momento.' });
        }

        if (campanha.exigir_senha) {
            if (!senha) return res.json({ success: false, error: 'Senha obrigatória.', precisa_senha: true });
            if (String(senha).trim() !== String(campanha.senha || '').trim()) {
                return res.json({ success: false, error: 'Senha incorreta.', precisa_senha: true });
            }
        }

        res.json({
            success: true,
            cliente: {
                codigo: cliente.codigo,
                cnpj: cliente.cnpj,
                nome_fantasia: cliente.nome_fantasia,
                razao_social: cliente.razao_social,
                cidade: cliente.cidade,
                uf: cliente.uf,
                vendedor_nome: cliente.vendedor_nome,
                acrescimo_uf: acrescimoUf,
                grupo_acrescimo: grupoAcrescimoNome
            },
            campanha: {
                id: campanha.id,
                nome: campanha.nome,
                subtitulo: campanha.subtitulo,
                banner_url: campanha.banner_url
            }
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/catalogo/:grupo_id', async (req, res) => {
    try {
        const db = await openTabela();
        const { campanha_id, uf } = req.query;

        const grupo = await db.get('SELECT * FROM grupos WHERE id = ?', [req.params.grupo_id]);
        if (!grupo) return res.status(404).json({ success: false, error: 'Grupo não encontrado' });

        // 1) Acréscimo da UF
        let acrescimoUf = 0;
        if (uf) {
            const row = await db.get(`
                SELECT g.acrescimo FROM uf_acrescimo u
                LEFT JOIN grupos_acrescimo g ON g.id = u.grupo_id
                WHERE u.uf = ?
            `, [String(uf).toUpperCase()]);
            if (row && row.acrescimo !== null && row.acrescimo !== undefined) {
                acrescimoUf = Number(row.acrescimo);
            }
        }
        const fatorAcrescimo = 1 + (acrescimoUf / 100);

        // 2) Ofertas
        let ofertas = {};
        if (campanha_id) {
            const lista = await db.all(
                'SELECT cod_produto, desconto_pct FROM ofertas_campanha WHERE campanha_id = ? AND ativo = 1',
                [campanha_id]);
            for (const o of lista) ofertas[o.cod_produto] = Number(o.desconto_pct);
        }

        // 3) Subgrupos
    // 3) Subgrupos — SÓ os que têm pelo menos 1 item com estoque
const subgrupos = await db.all(`
    SELECT s.* FROM subgrupos s
    WHERE s.grupo_id = ?
      AND EXISTS (
        SELECT 1 FROM itens i
        WHERE i.subgrupo_id = s.id AND i.saldo > 0
      )
    ORDER BY s.ordem, s.nome
`, [grupo.id]);

for (const s of subgrupos) {
s.itens = await db.all(`
    SELECT i.cod_produto, i.descricao, i.preco, i.saldo, i.imagem_url, i.cor_nome, i.id,
           COALESCE(
             (SELECT CAST(a.valor AS INTEGER) FROM itens_atributos a 
              WHERE a.cod_produto = i.cod_produto 
                AND a.atributo = 'ORDEM_SUBGRUPO' LIMIT 1),
             999999
           ) AS ordem_manual,
           COALESCE(
             (SELECT CAST(a.valor AS INTEGER) FROM itens_atributos a 
              WHERE a.cod_produto = i.cod_produto 
                AND a.atributo = 'ORDEM_EXCEL' LIMIT 1),
             999999
           ) AS ordem_excel
    FROM itens i
    WHERE i.subgrupo_id = ? AND i.saldo > 0
    ORDER BY ordem_manual ASC, ordem_excel ASC, i.id ASC
`, [s.id]);

// Adiciona TAMANHO, QTD, CX/CT, MODELO em cada item
for (const it of s.itens) {
    const attrs = await db.all(
        "SELECT atributo, valor FROM itens_atributos WHERE cod_produto = ? AND atributo IN ('TAMANHO','QTD','CX/CT','MODELO','COR')",
        [it.cod_produto]
    );
    it.tamanho_anzol = '';
    it.qtd_embalagem = '';
    it.tipo_embalagem = '';
    it.modelo_anzol = '';
    it.cor_anzol = '';
    for (const a of attrs) {
        if (a.atributo === 'TAMANHO') it.tamanho_anzol = a.valor;
        if (a.atributo === 'QTD') it.qtd_embalagem = a.valor;
        if (a.atributo === 'CX/CT') it.tipo_embalagem = a.valor;
        if (a.atributo === 'MODELO') it.modelo_anzol = a.valor;
        if (a.atributo === 'COR') it.cor_anzol = a.valor;
    }
}

            // Busca atributos de cada item (se tiver)
            for (const it of s.itens) {
                const attrs = await db.all(
                    'SELECT atributo, valor FROM itens_atributos WHERE cod_produto = ? ORDER BY ordem',
                    [it.cod_produto]
                );
                if (attrs.length) {
                    it.atributos = {};
                    for (const a of attrs) it.atributos[a.atributo] = a.valor;
                } else {
                    it.atributos = null;
                }

                // Aplica preço (acréscimo + desconto)
                const precoBase = Number(it.preco) || 0;
                let precoFinal = precoBase * fatorAcrescimo;
                const desc = ofertas[it.cod_produto];
                if (desc) {
                    precoFinal = precoFinal * (1 - desc/100);
                    it.desconto_pct = desc;
                }
                it.preco = Number(precoFinal.toFixed(2));
                it.preco_base_original = precoBase;
            }
        }

        res.json({ success: true, grupo, subgrupos, acrescimo_uf: acrescimoUf });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// ORDEM DENTRO DO SUBGRUPO
// ================================================================

// 1) Listar itens de um subgrupo JÁ COM a ordem atual
app.get('/api/tabela/subgrupos/:id/itens-ordem', async (req, res) => {
    try {
        const db = await openTabela();
        const subgrupoId = req.params.id;

        const itens = await db.all(`
            SELECT i.cod_produto, i.descricao, i.cor_nome, i.imagem_url, i.saldo, i.preco,
                   COALESCE(
                     (SELECT CAST(a.valor AS INTEGER) FROM itens_atributos a 
                      WHERE a.cod_produto = i.cod_produto 
                        AND a.atributo = 'ORDEM_SUBGRUPO' LIMIT 1),
                     999999
                   ) AS ordem_manual
            FROM itens i
            WHERE i.subgrupo_id = ?
            ORDER BY ordem_manual ASC, CAST(i.cod_produto AS INTEGER), i.cod_produto
        `, [subgrupoId]);

        res.json({ success: true, itens });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2) Salvar a ordem (recebe array de { cod_produto, ordem })
app.post('/api/tabela/subgrupos/:id/itens-ordem', async (req, res) => {
    try {
        const db = await openTabela();
        const { itens } = req.body;

        if (!Array.isArray(itens)) {
            return res.status(400).json({ success: false, error: 'Envie {itens: []}' });
        }

        await db.run('BEGIN TRANSACTION');
        try {
            for (const it of itens) {
                const cod = normalizarCodigo(it.cod_produto);
                if (!cod) continue;

                const ordem = parseInt(it.ordem, 10);
                if (isNaN(ordem)) continue;

                // Remove antigo (se existir)
                await db.run(
                    "DELETE FROM itens_atributos WHERE cod_produto = ? AND atributo = 'ORDEM_SUBGRUPO'",
                    [cod]
                );

                // Insere novo
                await db.run(
                    "INSERT INTO itens_atributos (cod_produto, atributo, valor, ordem) VALUES (?, 'ORDEM_SUBGRUPO', ?, 0)",
                    [cod, String(ordem)]
                );
            }
            await db.run('COMMIT');
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }

        console.log(`🔢 Ordem salva para subgrupo ${req.params.id}: ${itens.length} itens`);
        res.json({ success: true, salvos: itens.length });
    } catch (e) {
        console.error('❌ Erro ao salvar ordem:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
// SALVAR COR DO ITEM (nome + imagem)
// ================================================================
// ================================================================
// SALVAR COR DO ITEM (nome + imagem) — modo isca
// ================================================================
app.post('/api/tabela/itens/:cod/cor', async (req, res) => {
    try {
        const { cor_nome, imagem_url } = req.body;
        console.log('💾 Salvando cor:', req.params.cod, { cor_nome, imagem_url });

        const db = await openTabela();

        // Só atualiza o que veio preenchido (não sobrescreve com null)
        if (cor_nome !== undefined && cor_nome !== null) {
            await db.run('UPDATE itens SET cor_nome = ? WHERE cod_produto = ?',
                [cor_nome, normalizarCodigo(req.params.cod)]);
        }
        if (imagem_url !== undefined && imagem_url !== null) {
            await db.run('UPDATE itens SET imagem_url = ? WHERE cod_produto = ?',
                [imagem_url, normalizarCodigo(req.params.cod)]);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('❌ Erro salvar cor:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
// LISTAR SUBGRUPOS QUE TÊM CORES CADASTRADAS
// ================================================================
app.get('/api/tabela/subgrupos-com-cores', async (req, res) => {
    try {
        const db = await openTabela();
        const rows = await db.all(`
            SELECT s.id, s.nome, COUNT(i.cod_produto) AS qtd_cores
            FROM subgrupos s
            INNER JOIN itens i ON i.subgrupo_id = s.id
            WHERE i.cor_nome IS NOT NULL AND i.cor_nome != ''
            GROUP BY s.id
            ORDER BY s.nome
        `);
        res.json({ success: true, subgrupos: rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
// LISTAR CORES (nome + foto) DE UM SUBGRUPO
// ================================================================
app.get('/api/tabela/subgrupos/:id/cores', async (req, res) => {
    try {
        const db = await openTabela();
        const rows = await db.all(`
            SELECT cod_produto, cor_nome, imagem_url
            FROM itens
            WHERE subgrupo_id = ?
              AND cor_nome IS NOT NULL AND cor_nome != ''
            ORDER BY cor_nome
        `, [req.params.id]);
        res.json({ success: true, cores: rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
// COPIAR CORES DE UM SUBGRUPO PARA VÁRIOS ITENS DE DESTINO
// Estratégia: casa pela ORDEM (1ª cor → 1º item, 2ª cor → 2º item, ...)
// Se a origem tiver 22 cores e destino 22 itens, casa 1:1.
// Se quantidade diferente, casa até o mínimo e avisa.
// ================================================================
app.post('/api/tabela/copiar-cores', async (req, res) => {
    try {
        const { origem_subgrupo_id, destino_codigos } = req.body;
        if (!origem_subgrupo_id || !Array.isArray(destino_codigos) || !destino_codigos.length) {
            return res.status(400).json({ success: false, error: 'Parâmetros inválidos' });
        }

        const db = await openTabela();

        // Pega as cores da origem (ordenadas por cor_nome)
        const cores = await db.all(`
            SELECT cor_nome, imagem_url
            FROM itens
            WHERE subgrupo_id = ?
              AND cor_nome IS NOT NULL AND cor_nome != ''
            ORDER BY cor_nome
        `, [origem_subgrupo_id]);

        if (!cores.length) {
            return res.status(400).json({ success: false, error: 'Subgrupo de origem não tem cores' });
        }

        // Ordena os destinos (importante: mesma ordem estável)
        const destinos = destino_codigos
            .map(c => normalizarCodigo(c))
            .sort();

        const total = Math.min(cores.length, destinos.length);
        let copiadas = 0;

        for (let k = 0; k < total; k++) {
            await db.run(`
                UPDATE itens
                SET cor_nome = ?,
                    imagem_url = COALESCE(?, imagem_url)
                WHERE cod_produto = ?
            `, [cores[k].cor_nome, cores[k].imagem_url || null, destinos[k]]);
            copiadas++;
        }

        res.json({
            success: true,
            copiadas,
            origem_total: cores.length,
            destino_total: destinos.length,
            aviso: cores.length !== destinos.length
                ? `Origem tem ${cores.length} cores, destino tem ${destinos.length} itens. Copiei ${copiadas}.`
                : null
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/api/tabela/itens-com-atributos', async (req, res) => {
    try {
        const db = await openTabela();
        const { busca = '', filtro = 'todos', limite = 9999 } = req.query;
        const wheres = [];
        const params = [];

        if (busca.trim()) {
            wheres.push('(cod_produto LIKE ? OR descricao LIKE ?)');
            params.push('%'+busca.trim()+'%', '%'+busca.trim()+'%');
        }
        if (filtro === 'nao-vinculados') wheres.push('subgrupo_id IS NULL');
        else if (filtro === 'com-atributos') wheres.push('id IN (SELECT DISTINCT cod_produto FROM itens_atributos)');

        const whereSql = wheres.length ? ' WHERE ' + wheres.join(' AND ') : '';

        const itens = await db.all(`
            SELECT * FROM itens${whereSql}
            ORDER BY CAST(cod_produto AS INTEGER), cod_produto
            LIMIT ?
        `, [...params, parseInt(limite)]);

        for (const it of itens) {
            const attrs = await db.all(
                'SELECT atributo, valor FROM itens_atributos WHERE cod_produto = ? ORDER BY ordem',
                [it.cod_produto]
            );
            it.atributos = {};
            for (const a of attrs) it.atributos[a.atributo] = a.valor;
        }

        res.json({ success: true, itens });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// DEBUG — testar salvamento de cor
// ================================================================
app.get('/api/tabela/debug-cor/:cod', async (req, res) => {
    try {
        const db = await openTabela();
        const cod = normalizarCodigo(req.params.cod);

        // 1) Ver o item ANTES
        const antes = await db.get('SELECT cod_produto, cor_nome, imagem_url FROM itens WHERE cod_produto = ?', [cod]);

        // 2) Fazer um UPDATE de teste
        await db.run('UPDATE itens SET cor_nome = ? WHERE cod_produto = ?', ['TESTE DEBUG', cod]);

        // 3) Ver o item DEPOIS
        const depois = await db.get('SELECT cod_produto, cor_nome, imagem_url FROM itens WHERE cod_produto = ?', [cod]);

        res.json({
            success: true,
            antes,
            depois,
            salvou: antes.cor_nome !== depois.cor_nome
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ================================================================
// DEBUG — testar cálculo de acréscimo por cliente
// ================================================================
app.get('/api/tabela/debug-preco/:cnpj/:cod', async (req, res) => {
    try {
        const db = await openTabela();
        const cnpjLimpo = normalizarCNPJ(req.params.cnpj);
        const cod = normalizarCodigo(req.params.cod);

        // 1) Cliente
        const cliente = await db.get('SELECT codigo, nome_fantasia, uf FROM clientes WHERE cnpj = ?', [cnpjLimpo]);
        if (!cliente) return res.json({ success: false, error: 'Cliente não encontrado com CNPJ ' + cnpjLimpo });

        // 2) Acréscimo da UF
        let acrescimoUf = 0;
        let grupoNome = null;
        let grupoId = null;
        if (cliente.uf) {
            const row = await db.get(`
                SELECT u.uf, u.grupo_id, g.nome as grupo_nome, g.acrescimo
                FROM uf_acrescimo u
                LEFT JOIN grupos_acrescimo g ON g.id = u.grupo_id
                WHERE u.uf = ?
            `, [String(cliente.uf).toUpperCase()]);
            if (row) {
                grupoId = row.grupo_id;
                grupoNome = row.grupo_nome;
                acrescimoUf = row.acrescimo !== null && row.acrescimo !== undefined ? Number(row.acrescimo) : 0;
            }
        }

        // 3) Item
        const item = await db.get('SELECT cod_produto, descricao, preco FROM itens WHERE cod_produto = ?', [cod]);
        if (!item) return res.json({ success: false, error: 'Item não encontrado com código ' + cod });

        // 4) Cálculo
        const precoBase = Number(item.preco) || 0;
        const fatorAcrescimo = 1 + (acrescimoUf / 100);
        const precoFinal = precoBase * fatorAcrescimo;

        res.json({
            success: true,
            cliente: {
                codigo: cliente.codigo,
                nome: cliente.nome_fantasia,
                uf: cliente.uf
            },
            uf_vinculo: {
                uf: cliente.uf,
                grupo_id: grupoId,
                grupo_nome: grupoNome,
                acrescimo_pct: acrescimoUf
            },
            item: {
                cod_produto: item.cod_produto,
                descricao: item.descricao,
                preco_base: precoBase
            },
            calculo: {
                fator: fatorAcrescimo,
                preco_base: precoBase,
                preco_final: Number(precoFinal.toFixed(2)),
                formula: `${precoBase} × ${fatorAcrescimo} = ${Number(precoFinal.toFixed(2))}`
            }
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// ================================================================
// FAMÍLIAS DE PRODUTOS
// ================================================================

// Lista todas as famílias
app.get('/api/tabela/familias', async (req, res) => {
    try {
        const db = await openTabela();
        const { grupo_id } = req.query;
        let sql = `
            SELECT f.*, g.nome as grupo_nome,
                   (SELECT COUNT(*) FROM itens i WHERE i.familia_id = f.id) as total_itens
            FROM familias f
            LEFT JOIN grupos g ON g.id = f.grupo_id
        `;
        const params = [];
        if (grupo_id) { sql += ' WHERE f.grupo_id = ?'; params.push(grupo_id); }
        sql += ' ORDER BY f.ordem, f.nome';
        const familias = await db.all(sql, params);
        res.json({ success: true, familias });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Detalhe de uma família + seus itens + atributos
app.put('/api/tabela/familias/:id', async (req, res) => {
    try {
        const { nome, imagem_url, descricao_longa, ordem, grupo_id } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE familias SET
                nome = COALESCE(?, nome),
                imagem_url = COALESCE(?, imagem_url),
                descricao_longa = COALESCE(?, descricao_longa),
                ordem = COALESCE(?, ordem),
                grupo_id = ?
            WHERE id = ?
        `, [nome, imagem_url, descricao_longa, ordem,
            (grupo_id === null || grupo_id === '' || grupo_id === undefined) ? null : parseInt(grupo_id),
            req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// ================================================================
// COPIAR CORES - via PARES EXPLÍCITOS (admin manda o que casar com o quê)
// ================================================================
app.post('/api/tabela/copiar-cores-pares', async (req, res) => {
    try {
        const { pares } = req.body;
        if (!Array.isArray(pares) || !pares.length) {
            return res.status(400).json({ success: false, error: 'Nenhum par enviado' });
        }

        const db = await openTabela();
        let copiadas = 0;

        for (const p of pares) {
            if (!p.destino_cod) continue;

            await db.run(`
                UPDATE itens
                SET cor_nome = ?,
                    imagem_url = COALESCE(?, imagem_url)
                WHERE cod_produto = ?
            `, [p.cor_nome || null, p.imagem_url || null, normalizarCodigo(p.destino_cod)]);
            copiadas++;
        }

        res.json({ success: true, copiadas });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ================================================================
// FAMÍLIAS DE PRODUTOS (ROTA DEFINITIVA)
// ================================================================

app.get('/api/tabela/familias', async (req, res) => {
    try {
        const db = await openTabela();
        const familias = await db.all(`
            SELECT f.*, i.descricao as principal_descricao, i.imagem_url as principal_imagem
            FROM familias f
            LEFT JOIN itens i ON i.cod_produto = f.item_principal
            ORDER BY f.id DESC
        `);
        for (const f of familias) {
            f.itens = await db.all(`
                SELECT fi.*, i.descricao, i.preco, i.imagem_url, i.saldo
                FROM familias_itens fi
                JOIN itens i ON i.cod_produto = fi.cod_produto
                WHERE fi.familia_id = ?
                ORDER BY fi.ordem
            `, [f.id]);
        }
        res.json({ success: true, familias });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tabela/familias', async (req, res) => {
    try {
        const { nome, descricao, item_principal, itens } = req.body;
        
        if (!nome || !itens || !itens.length) {
            return res.status(400).json({ success: false, error: 'Nome e itens são obrigatórios.' });
        }

        const db = await openTabela();

        // 1. Cria a família
        const r = await db.run(
            'INSERT INTO familias (nome, descricao, item_principal) VALUES (?, ?, ?)', 
            [nome, descricao || '', item_principal]
        );
        const familiaId = r.lastID;

        // 2. Insere os itens e rótulos
        await db.run('BEGIN TRANSACTION');
        try {
            for (let i = 0; i < itens.length; i++) {
                const it = itens[i];
                await db.run(
                    'INSERT INTO familias_itens (familia_id, cod_produto, rotulo, ordem) VALUES (?, ?, ?, ?)', 
                    [familiaId, it.cod_produto, it.rotulo || '', i + 1]
                );
            }
            await db.run('COMMIT');
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }

        res.json({ success: true, id: familiaId });
    } catch (e) { 
        console.error('❌ Erro ao criar família:', e);
        res.status(500).json({ success: false, error: e.message }); 
    }
});
// Atualiza família
app.put('/api/tabela/familias/:id', async (req, res) => {
    try {
        const { nome, imagem_url, descricao_longa, ordem } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE familias SET
                nome = COALESCE(?, nome),
                imagem_url = COALESCE(?, imagem_url),
                descricao_longa = COALESCE(?, descricao_longa),
                ordem = COALESCE(?, ordem)
            WHERE id = ?
        `, [nome, imagem_url, descricao_longa, ordem, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Exclui família (desvincula itens, não apaga)
app.delete('/api/tabela/familias/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('UPDATE itens SET familia_id = NULL WHERE familia_id = ?', [req.params.id]);
        await db.run('DELETE FROM familias WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Vincula itens a uma família
// Body: { codigos: ["008797", "008798"] }
app.post('/api/tabela/familias/:id/vincular', async (req, res) => {
    try {
        const { codigos } = req.body;
        if (!Array.isArray(codigos)) return res.status(400).json({ success: false, error: 'Envie {codigos: []}' });
        const db = await openTabela();

        await db.run('BEGIN TRANSACTION');
        try {
            for (let i = 0; i < codigos.length; i++) {
                const cod = normalizarCodigo(codigos[i]);
                if (!cod) continue;
                await db.run(
                    'UPDATE itens SET familia_id = ?, familia_ordem = ? WHERE cod_produto = ?',
                    [req.params.id, i, cod]
                );
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        res.json({ success: true, vinculados: codigos.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Desvincula itens de uma família
app.post('/api/tabela/familias/:id/desvincular', async (req, res) => {
    try {
        const { codigos } = req.body;
        if (!Array.isArray(codigos)) return res.status(400).json({ success: false, error: 'Envie {codigos: []}' });
        const db = await openTabela();

        await db.run('BEGIN TRANSACTION');
        try {
            for (const cod of codigos) {
                const c = normalizarCodigo(cod);
                if (!c) continue;
                await db.run(
                    'UPDATE itens SET familia_id = NULL WHERE cod_produto = ? AND familia_id = ?',
                    [c, req.params.id]
                );
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// DELETAR ITEM INDIVIDUAL
// ================================================================
app.delete('/api/tabela/itens/:cod', async (req, res) => {
    try {
        const cod = normalizarCodigo(req.params.cod);
        if (!cod) return res.status(400).json({ success: false, error: 'Código inválido' });

        const db = await openTabela();

        // Confere se existe
        const item = await db.get('SELECT cod_produto FROM itens WHERE cod_produto = ?', [cod]);
        if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });

        // Apaga atributos primeiro (FK)
        await db.run('DELETE FROM itens_atributos WHERE cod_produto = ?', [cod]);
        // Apaga do carrinho de ofertas
        await db.run('DELETE FROM ofertas_campanha WHERE cod_produto = ?', [cod]);
        // Apaga o item
        await db.run('DELETE FROM itens WHERE cod_produto = ?', [cod]);

        console.log('🗑️ Item deletado:', cod);
        res.json({ success: true, deletado: cod });
    } catch (e) {
        console.error('❌ Erro ao deletar item:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
// DELETAR EM LOTE
// ================================================================
app.post('/api/tabela/itens-deletar-lote', async (req, res) => {
    try {
        const { codigos } = req.body;
        if (!Array.isArray(codigos) || !codigos.length) {
            return res.status(400).json({ success: false, error: 'Nenhum código enviado' });
        }

        const db = await openTabela();
        let deletados = 0;

        await db.run('BEGIN TRANSACTION');
        try {
            for (const codRaw of codigos) {
                const cod = normalizarCodigo(codRaw);
                if (!cod) continue;

                await db.run('DELETE FROM itens_atributos WHERE cod_produto = ?', [cod]);
                await db.run('DELETE FROM ofertas_campanha WHERE cod_produto = ?', [cod]);
                const r = await db.run('DELETE FROM itens WHERE cod_produto = ?', [cod]);
                if (r && r.changes > 0) deletados++;
            }
            await db.run('COMMIT');
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }

        console.log(`🗑️ Deletados em lote: ${deletados}/${codigos.length}`);
        res.json({ success: true, deletados });
    } catch (e) {
        console.error('❌ Erro ao deletar em lote:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});


// ================================================================
// 🛡️ BACKUP AUTOMÁTICO DO BANCO
// ================================================================
// ================================================================
// 🛡️ BACKUP AUTOMÁTICO DO BANCO
// ================================================================
const BACKUP_DIR = path.join(__dirname, 'backups');
const DB_BACKUP_PATH = path.join(__dirname, 'tabela.db');

// Cria pasta de backups se não existir
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function fazerBackup() {
    try {
        if (!fs.existsSync(DB_BACKUP_PATH)) return;
        const agora = new Date();
        const stamp = `${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}`;
        const destino = path.join(BACKUP_DIR, `tabela_${stamp}.db`);

        fs.copyFileSync(DB_BACKUP_PATH, destino);
        console.log(`💾 Backup criado: backups/tabela_${stamp}.db`);

        // Mantém apenas os 24 backups mais recentes
        const arquivos = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('tabela_') && f.endsWith('.db'))
            .map(f => ({
                nome: f,
                path: path.join(BACKUP_DIR, f),
                mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        for (let i = 24; i < arquivos.length; i++) {
            fs.unlinkSync(arquivos[i].path);
            console.log(`🗑️ Backup antigo removido: ${arquivos[i].nome}`);
        }
    } catch (e) {
        console.error('❌ Erro ao fazer backup:', e.message);
    }
}

// Faz backup agora
fazerBackup();

// E depois a cada 1 hora (3600000 ms)
setInterval(fazerBackup, 60 * 60 * 1000);
// START
// ================================================================
// ================================================================
// STATS DETALHADOS DOS ITENS (pra aba 📦 Itens)
// ================================================================

// ================================================================
// IMPORTAR ITENS DO SISTEMA (tabela itens_sistema)
// ================================================================
app.post('/api/tabela/importar-itens-sistema', async (req, res) => {
    try {
        const { linhas } = req.body;
        if (!Array.isArray(linhas) || !linhas.length)
            return res.status(400).json({ success: false, error: 'Nenhuma linha' });

        const db = await openTabela();

        // Garante que a tabela existe
        await db.run(`
            CREATE TABLE IF NOT EXISTS itens_sistema (
                codigo        TEXT PRIMARY KEY,
                cod_barras    TEXT,
                descricao     TEXT,
                estoque       REAL DEFAULT 0,
                preco_venda   REAL DEFAULT 0,
                ativo         INTEGER DEFAULT 1,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        let inseridos = 0;
        let atualizados = 0;
        let ignorados = 0;

        await db.run('BEGIN TRANSACTION');
        try {
            for (const l of linhas) {
                // Normaliza código (tira zeros à esquerda)
                const codigo = String(l.codigo || '').trim().replace(/^0+/, '') || '';
                if (!codigo) { ignorados++; continue; }

                const cod_barras = String(l.cod_barras || '').trim();
                const descricao  = String(l.descricao || '').trim();

                // Converte valores tipo "R$1,00" pra número
                const parseNum = (v) => {
                    if (v === null || v === undefined || v === '') return 0;
                    if (typeof v === 'number') return v;
                    let s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
                    const n = parseFloat(s);
                    return isNaN(n) ? 0 : n;
                };

                const estoque     = parseNum(l.estoque);
                const preco_venda = parseNum(l.preco_venda);

                // Já existe?
                const existe = await db.get('SELECT codigo FROM itens_sistema WHERE codigo = ?', [codigo]);

                if (existe) {
                    await db.run(`
                        UPDATE itens_sistema SET
                            cod_barras = COALESCE(NULLIF(?, ''), cod_barras),
                            descricao = COALESCE(NULLIF(?, ''), descricao),
                            estoque = ?,
                            preco_venda = ?,
                            atualizado_em = CURRENT_TIMESTAMP
                        WHERE codigo = ?
                    `, [cod_barras, descricao, estoque, preco_venda, codigo]);
                    atualizados++;
                } else {
                    await db.run(`
                        INSERT INTO itens_sistema (codigo, cod_barras, descricao, estoque, preco_venda)
                        VALUES (?, ?, ?, ?, ?)
                    `, [codigo, cod_barras, descricao, estoque, preco_venda]);
                    inseridos++;
                }
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        // Log da importação
        await db.run(`
            INSERT INTO importacoes_log (tipo, inseridos, atualizados, ignorados, total)
            VALUES ('sistema', ?, ?, ?, ?)
        `, [inseridos, atualizados, ignorados, linhas.length]);

        console.log(`📊 Importar SISTEMA: ${inseridos} inseridos, ${atualizados} atualizados, ${ignorados} ignorados`);

        res.json({
            success: true,
            inseridos,
            atualizados,
            ignorados,
            total: linhas.length
        });
    } catch (e) {
        console.error('❌ Erro importar-itens-sistema:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});


// ================================================================
// IMPORTAR SCRAPING (tabela scraping_produtos)
// ================================================================
// ================================================================
// IMPORTAR SCRAPING — 1 linha por VARIAÇÃO + atributos_json
// ================================================================
app.post('/api/tabela/importar-scraping', async (req, res) => {
    try {
        const { produtos } = req.body;
        if (!Array.isArray(produtos) || !produtos.length)
            return res.status(400).json({ success: false, error: 'Nenhum produto' });

        const db = await openTabela();

        // Garante as tabelas
        await db.run(`
            CREATE TABLE IF NOT EXISTS scraping_produtos (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                site            TEXT,
                grupo           TEXT,
                subgrupo        TEXT,
                marca           TEXT,
                descricao_longa TEXT,
                url_origem      TEXT,
                codigo          TEXT,
                cod_barras      TEXT,
                imagem_url      TEXT,
                atributos_json  TEXT,
                data_scraping   DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        let inseridos = 0, atualizados = 0, ignorados = 0;

        await db.run('BEGIN TRANSACTION');
        try {
            for (const p of produtos) {
                // Se não tem variações, cria 1 linha com o principal
                if (!p.variacoes || !p.variacoes.length) {
                    if (!p.codigo) { ignorados++; continue; }

                    const existe = await db.get(
                        'SELECT id FROM scraping_produtos WHERE site = ? AND codigo = ?',
                        [p.site, p.codigo]
                    );

                    if (existe) {
                        await db.run(`UPDATE scraping_produtos SET
                            grupo = ?, subgrupo = ?, marca = ?, descricao_longa = ?,
                            url_origem = ?, cod_barras = ?, imagem_url = ?,
                            atributos_json = ?, data_scraping = CURRENT_TIMESTAMP
                            WHERE id = ?`,
                            [p.grupo, p.subgrupo, p.marca, p.descricao_longa,
                             p.url_origem, p.cod_barras || '', p.imagem_url || '',
                             '{}', existe.id]);
                        atualizados++;
                    } else {
                        await db.run(`INSERT INTO scraping_produtos
                            (site, grupo, subgrupo, marca, descricao_longa, url_origem,
                             codigo, cod_barras, imagem_url, atributos_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [p.site, p.grupo, p.subgrupo, p.marca, p.descricao_longa,
                             p.url_origem, p.codigo, p.cod_barras || '',
                             p.imagem_url || '', '{}']);
                        inseridos++;
                    }
                    continue;
                }

                // Com variações — 1 LINHA POR VARIAÇÃO
                for (const v of p.variacoes) {
                    if (!v.codigo) { ignorados++; continue; }

                    // Monta o JSON de atributos (tudo menos codigo/cod_barras/imagem)
                    const atributos = {};
                    for (const [chave, valor] of Object.entries(v)) {
                        if (['codigo', 'cod_barras', 'imagem'].includes(chave)) continue;
                        if (valor) atributos[chave] = valor;
                    }

                    const existe = await db.get(
                        'SELECT id FROM scraping_produtos WHERE site = ? AND codigo = ?',
                        [p.site, v.codigo]
                    );

                    if (existe) {
                        await db.run(`UPDATE scraping_produtos SET
                            grupo = ?, subgrupo = ?, marca = ?, descricao_longa = ?,
                            url_origem = ?, cod_barras = ?, imagem_url = ?,
                            atributos_json = ?, data_scraping = CURRENT_TIMESTAMP
                            WHERE id = ?`,
                            [p.grupo, p.subgrupo, p.marca, p.descricao_longa,
                             p.url_origem, v.cod_barras || '', v.imagem || '',
                             JSON.stringify(atributos), existe.id]);
                        atualizados++;
                    } else {
                        await db.run(`INSERT INTO scraping_produtos
                            (site, grupo, subgrupo, marca, descricao_longa, url_origem,
                             codigo, cod_barras, imagem_url, atributos_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [p.site, p.grupo, p.subgrupo, p.marca, p.descricao_longa,
                             p.url_origem, v.codigo, v.cod_barras || '',
                             v.imagem || '', JSON.stringify(atributos)]);
                        inseridos++;
                    }
                }
            }
            await db.run('COMMIT');
        } catch (err) { await db.run('ROLLBACK'); throw err; }

        console.log(`🕷️  Scraping: ${inseridos} inseridos, ${atualizados} atualizados, ${ignorados} ignorados`);
        res.json({ success: true, inseridos, atualizados, ignorados, total: produtos.length });
    } catch (e) {
        console.error('❌ Erro importar-scraping:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});


// ================================================================
// CATÁLOGO NOVO — lê da view v_catalogo
// ================================================================
app.get('/api/tabela/catalogo-novo/:grupo', async (req, res) => {
    try {
        const db = await openTabela();
        const { grupo } = req.params;

        // 1. Busca os produtos do grupo
        const itens = await db.all(`
            SELECT codigo, cod_barras, grupo, subgrupo, marca, imagem_url, descricao_longa, atributos_json, preco_venda, estoque
            FROM v_catalogo
            WHERE grupo = ? AND estoque > 0
            ORDER BY subgrupo, codigo
        `, [grupo]);

        // 2. Busca as famílias
        const familiasDb = await db.all(`
            SELECT f.id as familia_id, f.nome as familia_nome, f.descricao as familia_descricao, 
                   fi.cod_produto, fi.rotulo, fi.ordem
            FROM familias f
            JOIN familias_itens fi ON fi.familia_id = f.id
        `);

        // 3. Cria o mapa de família por código do produto
        const mapFamilia = {};
        for (const f of familiasDb) {
            // Normaliza o código para evitar espaços ou zeros à esquerda
            const codNormalizado = String(f.cod_produto).trim().replace(/^0+/, '');
            mapFamilia[codNormalizado] = f;
        }

        // 4. Agrupa por subgrupo
        const subgrupos = {};
        for (const it of itens) {
            const sub = it.subgrupo || 'SEM SUBGRUPO';
            if (!subgrupos[sub]) {
                subgrupos[sub] = {
                    nome: sub,
                    grupo: it.grupo,
                    marca: it.marca,
                    descricao_longa: it.descricao_longa,
                    itens: []
                };
            }

            let atributos = {};
            try { atributos = JSON.parse(it.atributos_json || '{}'); } catch (e) {}

            const atributosLimpos = {};
            for (const [k, v] of Object.entries(atributos)) {
                const val = String(v).trim();
                if (val.includes('Faça login') || val.includes('http')) continue;
                if (val) atributosLimpos[k] = val;
            }

            const precoItem = Number(it.preco_venda) || 0;
            if (precoItem <= 0) continue; // Pula item sem preço

            // Verifica se o item pertence a uma família
            const codNormalizado = String(it.codigo).trim().replace(/^0+/, '');
            const fam = mapFamilia[codNormalizado] || null;

            subgrupos[sub].itens.push({
                cod_produto: it.codigo,
                cod_barras: it.cod_barras,
                preco: precoItem,
                saldo: it.estoque,
                imagem_url: it.imagem_url,
                atributos: atributosLimpos,
                cor_nome: atributosLimpos.Cores || atributosLimpos.Cor || atributosLimpos.COR || '',
                tamanho_anzol: atributosLimpos.Tamanho || atributosLimpos.TAMANHO || '',
                qtd_embalagem: atributosLimpos.Quantidade || atributosLimpos.QTD || '',
                tipo_embalagem: atributosLimpos['CX/CT'] || '',
                modelo: atributosLimpos.Modelo || atributosLimpos.MODELO || '',
                
                // Dados da família
                familia_id: fam ? fam.familia_id : null,
                familia_nome: fam ? fam.familia_nome : null,
                familia_descricao: fam ? fam.familia_descricao : null,
                rotulo: fam ? fam.rotulo : null,
                rotulo_ordem: fam ? fam.ordem : 0
            });
        }

        // Define imagem principal do subgrupo
        for (const sub of Object.values(subgrupos)) {
            const primeiroComImagem = sub.itens.find(i => i.imagem_url);
            sub.imagem_url = primeiroComImagem ? primeiroComImagem.imagem_url : '';
        }

        res.json({ success: true, grupo, subgrupos: Object.values(subgrupos) });
    } catch (e) {
        console.error('❌ Erro catalogo-novo:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});
// ================================================================
// LISTAR GRUPOS (da view v_catalogo)
// ================================================================
app.get('/api/tabela/grupos-catalogo', async (req, res) => {
    try {
        const db = await openTabela();
        const grupos = await db.all(`
            SELECT 
                grupo as nome,
                COUNT(*) as total_itens
            FROM v_catalogo
            WHERE estoque > 0
            GROUP BY grupo
            ORDER BY grupo
        `);
        res.json({ success: true, grupos });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// Stats do scraping
app.get('/api/tabela/stats-scraping', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run(`
            CREATE TABLE IF NOT EXISTS scraping_produtos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site TEXT, grupo TEXT, subgrupo TEXT, codigo TEXT, cod_barras TEXT,
                marca TEXT, descricao_longa TEXT, imagem_url TEXT, url_origem TEXT,
                colunas TEXT, variacoes_json TEXT,
                data_scraping DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        const t = await db.get('SELECT COUNT(*) as c FROM scraping_produtos');
        const porGrupo = await db.all(`
            SELECT grupo, COUNT(*) as qtd
            FROM scraping_produtos
            GROUP BY grupo
            ORDER BY qtd DESC
        `);
        res.json({ success: true, total: t.c, porGrupo });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// Rota pra testar: conta itens do sistema
app.get('/api/tabela/stats-itens-sistema', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run(`
            CREATE TABLE IF NOT EXISTS itens_sistema (
                codigo        TEXT PRIMARY KEY,
                cod_barras    TEXT,
                descricao     TEXT,
                estoque       REAL DEFAULT 0,
                preco_venda   REAL DEFAULT 0,
                ativo         INTEGER DEFAULT 1,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        const t = await db.get('SELECT COUNT(*) as c FROM itens_sistema');
        const comEstoque = await db.get('SELECT COUNT(*) as c FROM itens_sistema WHERE estoque > 0');
        const comBarras = await db.get('SELECT COUNT(*) as c FROM itens_sistema WHERE cod_barras IS NOT NULL AND cod_barras != ""');
        res.json({
            success: true,
            total: t.c,
            comEstoque: comEstoque.c,
            comBarras: comBarras.c
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/api/tabela/stats-itens', async (req, res) => {
    try {
        const db = await openTabela();
        
        const total = await db.get(`SELECT COUNT(*) as c FROM itens_sistema WHERE estoque > 0`);
        
        const orfaos = await db.get(`
            SELECT COUNT(*) as c 
            FROM itens_sistema s
            LEFT JOIN scraping_produtos sc ON LTRIM(s.codigo, '0') = LTRIM(sc.codigo, '0')
            WHERE s.estoque > 0 AND (sc.grupo IS NULL OR sc.grupo = '')
        `);
        
        res.json({
            success: true,
            total: total.c || 0,
            orfaos: orfaos.c || 0
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// 🚀 NOVAS ROTAS DEFINITIVAS — ITENS E SCRAPING (V3)
// ================================================================

// 1) Nova Rota da Aba ITENS (Foco total em v_catalogo)

// 2) Nova Rota de STATS (Para os 2 Cards de Cima)
app.get('/api/tabela/stats-itens-v3', async (req, res) => {
    try {
        const db = await openTabela();
        const total = await db.get(`SELECT COUNT(*) as c FROM v_catalogo WHERE estoque > 0`);
        const orfaos = await db.get(`SELECT COUNT(*) as c FROM v_catalogo WHERE estoque > 0 AND (grupo IS NULL OR grupo = '')`);
        
        res.json({
            success: true,
            total: total.c || 0,
            orfaos: orfaos.c || 0
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 3) Nova Rota do SCRAPING (Para os cards de grupo do scraping)
app.get('/api/tabela/scraping-stats-v3', async (req, res) => {
    try {
        const db = await openTabela();
        const total = await db.get('SELECT COUNT(*) as c FROM scraping_produtos');
        const porGrupo = await db.all(`
            SELECT grupo, COUNT(*) as qtd
            FROM scraping_produtos
            WHERE grupo IS NOT NULL AND grupo != ''
            GROUP BY grupo
            ORDER BY qtd DESC
        `);
        const semImagem = await db.get("SELECT COUNT(*) as c FROM scraping_produtos WHERE imagem_url IS NULL OR imagem_url = ''");
        
        res.json({
            success: true,
            total: total.c,
            semImagem: semImagem.c,
            porGrupo: porGrupo
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// ================================================================
// 🕷️ SCRAPING — ADMIN (listar, editar, deletar)
// ================================================================

// 1) Estatísticas gerais
app.get('/api/tabela/scraping-stats', async (req, res) => {
    try {
        const db = await openTabela();
        
        const total = await db.get('SELECT COUNT(*) as c FROM scraping_produtos');
        const semImagem = await db.get("SELECT COUNT(*) as c FROM scraping_produtos WHERE imagem_url IS NULL OR imagem_url = ''");
        
        // Busca os grupos (ignora nulos ou vazios)
        const porGrupo = await db.all(`
            SELECT grupo, COUNT(*) as qtd
            FROM scraping_produtos
            WHERE grupo IS NOT NULL AND grupo != ''
            GROUP BY grupo
            ORDER BY qtd DESC
        `);
        
        res.json({
            success: true,
            total: total.c || 0,
            semImagem: semImagem.c || 0,
            porGrupo: porGrupo
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// 2) Listar subgrupos de um grupo
app.get('/api/tabela/scraping-subgrupos/:grupo', async (req, res) => {
    try {
        const db = await openTabela();
        const subgrupos = await db.all(`
            SELECT 
                subgrupo,
                grupo,
                marca,
                COUNT(*) as total_itens,
                MAX(descricao_longa) as descricao_longa,
                MIN(imagem_url) as imagem_principal
            FROM scraping_produtos
            WHERE grupo = ?
            GROUP BY subgrupo
            ORDER BY subgrupo
        `, [req.params.grupo]);
        res.json({ success: true, subgrupos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 3) Listar itens de um subgrupo (com preço/estoque do sistema)
app.get('/api/tabela/scraping-itens/:grupo/:subgrupo', async (req, res) => {
    try {
        const db = await openTabela();
        const itens = await db.all(`
            SELECT 
                sc.id,
                sc.codigo,
                sc.cod_barras,
                sc.grupo,
                sc.subgrupo,
                sc.marca,
                sc.imagem_url,
                sc.descricao_longa,
                sc.atributos_json,
                s.descricao as desc_sistema,
                s.preco_venda,
                s.estoque
            FROM scraping_produtos sc
            LEFT JOIN itens_sistema s ON LTRIM(sc.codigo, '0') = s.codigo
            WHERE sc.grupo = ? AND sc.subgrupo = ?
            ORDER BY sc.codigo
        `, [req.params.grupo, req.params.subgrupo]);
        res.json({ success: true, itens });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 4) Editar item do scraping
app.put('/api/tabela/scraping-item/:id', async (req, res) => {
    try {
        const { subgrupo, marca, imagem_url, atributos_json } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE scraping_produtos SET
                subgrupo = COALESCE(?, subgrupo),
                marca = COALESCE(?, marca),
                imagem_url = COALESCE(?, imagem_url),
                atributos_json = COALESCE(?, atributos_json)
            WHERE id = ?
        `, [subgrupo, marca, imagem_url, atributos_json, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 5) Deletar item do scraping
app.delete('/api/tabela/scraping-item/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM scraping_produtos WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 6) Editar TODOS os itens de um subgrupo (nome, marca, imagem, descrição)
app.put('/api/tabela/scraping-subgrupo-lote', async (req, res) => {
    try {
        const { grupo, subgrupo_antigo, novo_nome, nova_marca, nova_descricao } = req.body;
        const db = await openTabela();
        await db.run(`
            UPDATE scraping_produtos SET
                subgrupo = COALESCE(?, subgrupo),
                marca = COALESCE(?, marca),
                descricao_longa = COALESCE(?, descricao_longa)
            WHERE grupo = ? AND subgrupo = ?
        `, [novo_nome, nova_marca, nova_descricao, grupo, subgrupo_antigo]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tabela/pedido-grupos', async (req, res) => {
    try {
        const db = await openTabela();
        // Pega apenas os grupos que têm itens com estoque
        const grupos = await db.all(`
            SELECT DISTINCT sc.grupo AS nome, COUNT(sc.codigo) AS total
            FROM scraping_produtos sc
            JOIN itens_sistema s ON sc.codigo = s.codigo
            WHERE s.estoque > 0 AND sc.grupo IS NOT NULL AND sc.grupo != ''
            GROUP BY sc.grupo
            ORDER BY sc.grupo
        `);
        res.json({ success: true, grupos });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// FAMÍLIAS DE PRODUTOS (AGRUPAMENTO NO ADMIN)
// ================================================================
app.get('/api/tabela/familias', async (req, res) => {
    try {
        const db = await openTabela();
        // Busca as famílias e traz o item principal (o primeiro) para pegar a descrição
        const familias = await db.all(`
            SELECT f.*, i.descricao as principal_descricao, i.imagem_url as principal_imagem
            FROM familias f
            LEFT JOIN itens i ON i.cod_produto = f.item_principal
            ORDER BY f.id DESC
        `);
        
        // Para cada família, busca os seus itens
        for (const f of familias) {
            f.itens = await db.all(`
                SELECT fi.*, i.descricao, i.preco, i.imagem_url, i.saldo
                FROM familias_itens fi
                JOIN itens i ON i.cod_produto = fi.cod_produto
                WHERE fi.familia_id = ?
                ORDER BY fi.ordem
            `, [f.id]);
        }
        res.json({ success: true, familias });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


app.get('/api/tabela/pedido-subgrupo', async (req, res) => {
    try {
        const db = await openTabela();
        const { grupo, subgrupo } = req.query;
        
        if (!grupo || !subgrupo) {
            return res.status(400).json({ success: false, error: 'Informe grupo e subgrupo' });
        }

        const itens = await db.all(`
            SELECT 
                s.codigo AS cod_produto,
                s.descricao,
                s.preco_venda AS preco,
                s.estoque AS saldo,
                sc.imagem_url,
                sc.atributos_json
            FROM scraping_produtos sc
            JOIN itens_sistema s ON sc.codigo = s.codigo
            WHERE sc.grupo = ? AND sc.subgrupo = ? AND s.estoque > 0
            ORDER BY CAST(s.codigo AS INTEGER), s.codigo
        `, [grupo, subgrupo]);

        res.json({ success: true, itens });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
// FAMÍLIAS DE PRODUTOS
// ================================================================

// 1. Cria as tabelas automaticamente se não existirem (roda 1 vez ao iniciar)
async function garantirTabelasFamilia() {
    try {
        const db = await openTabela();
        await db.run(`CREATE TABLE IF NOT EXISTS familias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            descricao TEXT,
            item_principal TEXT
        )`);
        await db.run(`CREATE TABLE IF NOT EXISTS familias_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            familia_id INTEGER,
            cod_produto TEXT,
            rotulo TEXT,
            ordem INTEGER,
            FOREIGN KEY(familia_id) REFERENCES familias(id)
        )`);
        console.log('✅ Tabelas de Famílias verificadas/criadas.');
    } catch (e) {
        console.error('❌ Erro ao criar tabelas de família:', e.message);
    }
}
garantirTabelasFamilia();

// 2. Rota para listar famílias
app.get('/api/tabela/familias', async (req, res) => {
    try {
        const db = await openTabela();
        const familias = await db.all(`
            SELECT f.*, i.descricao as principal_descricao, i.imagem_url as principal_imagem
            FROM familias f
            LEFT JOIN itens i ON i.cod_produto = f.item_principal
            ORDER BY f.id DESC
        `);
        for (const f of familias) {
            f.itens = await db.all(`
                SELECT fi.*, i.descricao, i.preco, i.imagem_url, i.saldo
                FROM familias_itens fi
                JOIN itens i ON i.cod_produto = fi.cod_produto
                WHERE fi.familia_id = ?
                ORDER BY fi.ordem
            `, [f.id]);
        }
        res.json({ success: true, familias });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// 4. Rota para deletar uma família
app.delete('/api/tabela/familias/:id', async (req, res) => {
    try {
        const db = await openTabela();
        await db.run('DELETE FROM familias_itens WHERE familia_id = ?', [req.params.id]);
        await db.run('DELETE FROM familias WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 7) Deletar subgrupo inteiro
app.delete('/api/tabela/scraping-subgrupo', async (req, res) => {
    try {
        const { grupo, subgrupo } = req.body;
        const db = await openTabela();
        const r = await db.run(
            'DELETE FROM scraping_produtos WHERE grupo = ? AND subgrupo = ?',
            [grupo, subgrupo]
        );
        res.json({ success: true, deletados: r.changes });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ROTA PARA AGRUPAR ITENS DO SUBGRUPO EM UM CARD
app.post('/api/tabela/agrupar-itens', async (req, res) => {
    try {
        const { grupo, subgrupo, itens } = req.body;
        const db = await openTabela();

        // 🚨 DESATIVA A CHECAGEM DE CHAVE ESTRANGEIRA
        await db.run('PRAGMA foreign_keys = OFF');

        const familiaId = Date.now();

        // 1. Insere a família (tabela pai)
        await db.run(
            'INSERT INTO familias (id, nome, descricao, item_principal) VALUES (?, ?, ?, ?)',
            [familiaId, subgrupo, 'Grupo do catálogo', String(itens[0].cod_produto).replace(/^0+/, '')]
        );

        // 2. Insere os itens (tabela filha)
        for (let i = 0; i < itens.length; i++) {
            const it = itens[i];
            // Normaliza o código tirando zeros à esquerda
            const codNormalizado = String(it.cod_produto).replace(/^0+/, '');
            
            await db.run(
                'INSERT INTO familias_itens (familia_id, cod_produto, rotulo, ordem) VALUES (?, ?, ?, ?)',
                [familiaId, codNormalizado, it.rotulo || '', i + 1]
            );
        }

        // 🚨 RELIGA A CHECAGEM DE CHAVE ESTRANGEIRA
        await db.run('PRAGMA foreign_keys = ON');

        res.json({ success: true, familiaId });
    } catch (e) {
        console.error('❌ Erro ao agrupar itens:', e);
        // Garante que religa mesmo com erro
        try { const db = await openTabela(); await db.run('PRAGMA foreign_keys = ON'); } catch(err) {}
        res.status(500).json({ success: false, error: e.message });
    }
});

// ROTA PARA AGRUPAR SUBGRUPOS (SIMPLIFICADA)
app.post('/api/tabela/agrupar-subgrupos', async (req, res) => {
    try {
        const { grupo, subgrupos, nome_familia } = req.body;
        const db = await openTabela();

        // Limpa as tabelas de família para evitar conflitos (simplificação)
        await db.run('DELETE FROM familias');
        await db.run('DELETE FROM familias_itens');

        const familiaId = 1; // Fixo para este grupo

        // 1. Salva a família principal
        await db.run(
            'INSERT INTO familias (id, nome, descricao, item_principal) VALUES (?, ?, ?, ?)',
            [familiaId, nome_familia, 'Família agrupada', '']
        );

        // 2. Para cada subgrupo, pega todos os itens e salva na família
        for (const subgrupoNome of subgrupos) {
            const itens = await db.all(
                'SELECT codigo FROM scraping_produtos WHERE grupo = ? AND subgrupo = ?',
                [grupo, subgrupoNome]
            );

            for (let i = 0; i < itens.length; i++) {
                const cod = itens[i].codigo;
                await db.run(
                    'INSERT INTO familias_itens (familia_id, cod_produto, rotulo, ordem) VALUES (?, ?, ?, ?)',
                    [familiaId, cod, subgrupoNome, i + 1]
                );
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error('❌ Erro ao agrupar subgrupos:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});


(async () => {
    try {
        await openTabela();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor TABELA em http://localhost:${PORT}`);
            console.log(`📄 Admin:        http://localhost:${PORT}/admin`);
            console.log(`📄 Vendedor:     http://localhost:${PORT}/vendedor`);
            console.log(`📄 Apresentação: http://localhost:${PORT}/apresentacao`);
            console.log(`📄 Teste:        http://localhost:${PORT}/teste`);
        });
    } catch (e) {
        console.error('❌ Erro:', e);
        process.exit(1);
    }
})();