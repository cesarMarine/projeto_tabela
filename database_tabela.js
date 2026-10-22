// database_tabela.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'tabela.db');

let dbInstance = null;

async function openTabela() {
    if (dbInstance) return dbInstance;
    dbInstance = await open({ filename: DB_PATH, driver: sqlite3.Database });
    await dbInstance.exec('PRAGMA foreign_keys = ON;');
    await criarTabelas(dbInstance);
    return dbInstance;
}

async function criarTabelas(db) {
    await db.exec(`
        -- ============================================================
        -- VENDEDORES
        -- ============================================================
        CREATE TABLE IF NOT EXISTS vendedores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            codigo_representante TEXT UNIQUE,     -- "36" = LEANDRO
            ativo INTEGER DEFAULT 1,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- ============================================================
        -- CLIENTES (importados da planilha)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,          -- CÓDIGO (chave)
            cnpj TEXT UNIQUE,                     -- CPF/CNPJ
            nome_fantasia TEXT,                   -- NOME
            razao_social TEXT,                    -- RAZÃO SOCIAL
            cidade TEXT,
            uf TEXT,
            contato TEXT,
            telefone TEXT,
            celular TEXT,
            email TEXT,
            email_nfe TEXT,
            codigo_representante TEXT,            -- "36" (liga ao vendedor)
            vendedor_id INTEGER,
            ativo INTEGER DEFAULT 1,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
        );

        -- ============================================================
        -- CATÁLOGO VISUAL
        -- ============================================================
        CREATE TABLE IF NOT EXISTS grupos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            ordem INTEGER DEFAULT 0,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS subgrupos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grupo_id INTEGER NOT NULL,
            nome TEXT NOT NULL,
            imagem_url TEXT,
            imagem_lateral_1 TEXT,
            imagem_lateral_2 TEXT,
            descricao_longa TEXT,
            ordem INTEGER DEFAULT 0,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- ITENS (preços + estoque unificados)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cod_produto TEXT UNIQUE NOT NULL,
            descricao TEXT,
            preco REAL DEFAULT 0,
            saldo REAL DEFAULT 0,
            imagem_url TEXT,
            subgrupo_id INTEGER,
            atualizado_preco DATETIME,
            atualizado_estoque DATETIME,
            FOREIGN KEY (subgrupo_id) REFERENCES subgrupos(id) ON DELETE SET NULL
        );

        -- ============================================================
        -- CAMPANHAS (ofertas do mês, por vendedor)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS campanhas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,                   -- "OFERTAS OUTUBRO 2026"
            subtitulo TEXT,                       -- "Válido até 31/10"
            banner_url TEXT,                      -- imagem do topo da capa
            vendedor_id INTEGER,                  -- dono da campanha
            senha TEXT,                           -- senha geral (opcional)
            exigir_senha INTEGER DEFAULT 0,       -- 0 = só CNPJ, 1 = CNPJ+senha
            ativa INTEGER DEFAULT 0,              -- 1 = cliente consegue entrar
            data_inicio DATETIME,
            data_fim DATETIME,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
        );

        -- ============================================================
        -- OFERTAS DA CAMPANHA (quais itens entram, com desconto)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS ofertas_campanha (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campanha_id INTEGER NOT NULL,
            cod_produto TEXT NOT NULL,
            desconto_pct REAL NOT NULL,           -- 5 = 5%
            ativo INTEGER DEFAULT 1,
            UNIQUE(campanha_id, cod_produto),
            FOREIGN KEY (campanha_id) REFERENCES campanhas(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- PEDIDOS
        -- ============================================================
        CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campanha_id INTEGER,
            cliente_id INTEGER,
            vendedor_id INTEGER,
            total REAL DEFAULT 0,
            qtd_itens INTEGER DEFAULT 0,
            status TEXT DEFAULT 'Recebido',       -- Recebido | Enviado | Cancelado
            observacao TEXT,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campanha_id) REFERENCES campanhas(id),
            FOREIGN KEY (cliente_id) REFERENCES clientes(id),
            FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
        );

        CREATE TABLE IF NOT EXISTS pedido_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            cod_produto TEXT NOT NULL,
            descricao TEXT,
            quantidade REAL NOT NULL,
            valor_unitario REAL NOT NULL,
            valor_com_desconto REAL,
            subtotal REAL NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- LOG DE IMPORTAÇÕES
        -- ============================================================
        CREATE TABLE IF NOT EXISTS importacoes_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL,
            inseridos INTEGER DEFAULT 0,
            atualizados INTEGER DEFAULT 0,
            ignorados INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            data DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- ============================================================
        -- ÍNDICES
        -- ============================================================
        CREATE INDEX IF NOT EXISTS idx_vendedores_rep    ON vendedores(codigo_representante);
        CREATE INDEX IF NOT EXISTS idx_clientes_codigo   ON clientes(codigo);
        CREATE INDEX IF NOT EXISTS idx_clientes_cnpj     ON clientes(cnpj);
        CREATE INDEX IF NOT EXISTS idx_clientes_vend     ON clientes(vendedor_id);
        CREATE INDEX IF NOT EXISTS idx_clientes_rep      ON clientes(codigo_representante);
        CREATE INDEX IF NOT EXISTS idx_itens_cod         ON itens(cod_produto);
        CREATE INDEX IF NOT EXISTS idx_itens_sub         ON itens(subgrupo_id);
        CREATE INDEX IF NOT EXISTS idx_subgrupos_grupo   ON subgrupos(grupo_id);
        CREATE INDEX IF NOT EXISTS idx_campanhas_vend    ON campanhas(vendedor_id);
        CREATE INDEX IF NOT EXISTS idx_ofertas_camp      ON ofertas_campanha(campanha_id);
        CREATE INDEX IF NOT EXISTS idx_pedidos_vend      ON pedidos(vendedor_id);
        CREATE INDEX IF NOT EXISTS idx_pedidos_cli       ON pedidos(cliente_id);
    `);

    // ============================================================
    // MIGRAÇÕES (adiciona colunas que faltam sem apagar nada)
    // ============================================================
    await migrar(db, 'vendedores', [
        ['codigo_representante', 'TEXT'],
        ['data_cadastro', 'DATETIME']
    ]);
    await migrar(db, 'clientes', [
        ['nome_fantasia', 'TEXT'],
        ['contato', 'TEXT'],
        ['telefone', 'TEXT'],
        ['celular', 'TEXT'],
        ['email', 'TEXT'],
        ['email_nfe', 'TEXT'],
        ['codigo_representante', 'TEXT'],
        ['data_cadastro', 'DATETIME']
    ]);
    await migrar(db, 'itens', [
        ['imagem_url', 'TEXT'],
        ['subgrupo_id', 'INTEGER']
    ]);

    // ============================================================
    // SEEDS
    // ============================================================
    const grpCount = await db.get('SELECT COUNT(*) as c FROM grupos');
    if (grpCount.c === 0) {
        const gruposIniciais = [
            'INÍCIO', 'VARAS', 'MOLINETES', 'CARRETILHAS', 'LINHAS',
            'ANZÓIS', 'ISCAS', 'ACESSÓRIOS', 'PEÇAS', 'DAIWA', 'MEGABASS'
        ];
        for (let i = 0; i < gruposIniciais.length; i++) {
            await db.run('INSERT INTO grupos (nome, ordem) VALUES (?, ?)',
                [gruposIniciais[i], i]);
        }
        console.log('🌱 Grupos iniciais criados');
    }
}

async function migrar(db, tabela, colunas) {
    const cols = await db.all(`PRAGMA table_info(${tabela})`);
    const nomes = cols.map(c => c.name);
    for (const [nome, tipo] of colunas) {
        if (!nomes.includes(nome)) {
            try {
                await db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${tipo}`);
                console.log(`🔧 ${tabela}.${nome} adicionada`);
            } catch (e) {
                console.log(`⚠️ Não foi possível adicionar ${tabela}.${nome}: ${e.message}`);
            }
        }
    }
}

export default openTabela;