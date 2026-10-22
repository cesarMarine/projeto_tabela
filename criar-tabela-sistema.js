// criar-tabela-sistema.js — cria a tabela itens_sistema
import openTabela from './database_tabela.js';

(async () => {
    try {
        const db = await openTabela();

        console.log('📦 Criando tabela itens_sistema...');

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

        await db.run(`CREATE INDEX IF NOT EXISTS idx_itens_sistema_cod_barras ON itens_sistema(cod_barras)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_itens_sistema_descricao ON itens_sistema(descricao)`);

        console.log('✅ Tabela criada com sucesso!');

        // Teste: conta quantos registros tem
        const total = await db.get('SELECT COUNT(*) as c FROM itens_sistema');
        console.log(`📊 Registros atuais: ${total.c}`);

        process.exit(0);
    } catch (e) {
        console.error('❌ Erro:', e.message);
        process.exit(1);
    }
})();