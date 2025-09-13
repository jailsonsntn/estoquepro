// Este arquivo será responsável pela conexão e manipulação do banco SQLite
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../estoquepro.db');
const db = new sqlite3.Database(dbPath);

function initDB() {
  db.run(`CREATE TABLE IF NOT EXISTS estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT,
    nome TEXT,
    unidade TEXT,
    ncm TEXT,
    sit_trib TEXT,
    local_estoque TEXT,
    qt_estoque INTEGER,
    c_medio REAL,
    margem REAL,
    venda_cons REAL,
    custo_total REAL,
    venda_total REAL
  )`);
  // tentativa de adicionar coluna margem se tabela já existia sem ela
  db.get("PRAGMA table_info(estoque)", (err,row)=>{ /* trigger open */ });
  db.all("PRAGMA table_info(estoque)", (err, cols)=> {
    if(!err && cols && !cols.find(c=> c.name === 'margem')) {
      db.run('ALTER TABLE estoque ADD COLUMN margem REAL');
    }
  });
  // Tabela de encomendas (compras e vendas)
  db.run(`CREATE TABLE IF NOT EXISTS encomendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL, -- 'compra' ou 'venda'
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmada', -- 'confirmada' | 'cancelada'
    observacao TEXT,
    nome_cliente TEXT,
    telefone_cliente TEXT,
    total_itens INTEGER DEFAULT 0,
    total_geral REAL DEFAULT 0
  )`);

  // Itens da encomenda
  db.run(`CREATE TABLE IF NOT EXISTS encomenda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encomenda_id INTEGER NOT NULL,
    estoque_id INTEGER NOT NULL,
    quantidade REAL NOT NULL,
    preco_unit REAL NOT NULL,
    total REAL NOT NULL,
    codigo TEXT,
    nome TEXT,
    FOREIGN KEY(encomenda_id) REFERENCES encomendas(id) ON DELETE CASCADE,
    FOREIGN KEY(estoque_id) REFERENCES estoque(id)
  )`);

  // Índices auxiliares
  db.run('CREATE INDEX IF NOT EXISTS idx_encomendas_tipo_data ON encomendas(tipo, data)');
  db.run('CREATE INDEX IF NOT EXISTS idx_encomenda_itens_encomenda ON encomenda_itens(encomenda_id)');

  // Migração para adicionar colunas caso tabela exista sem elas
  db.all("PRAGMA table_info(encomendas)", (err, cols)=> {
    if(!err && cols) {
      if(!cols.find(c=>c.name==='nome_cliente')) db.run('ALTER TABLE encomendas ADD COLUMN nome_cliente TEXT');
      if(!cols.find(c=>c.name==='telefone_cliente')) db.run('ALTER TABLE encomendas ADD COLUMN telefone_cliente TEXT');
    }
  });

  // Migração encomenda_itens para adicionar codigo e nome se não existirem
  db.all("PRAGMA table_info(encomenda_itens)", (err, cols)=> {
    if(!err && cols) {
      if(!cols.find(c=>c.name==='codigo')) db.run('ALTER TABLE encomenda_itens ADD COLUMN codigo TEXT');
      if(!cols.find(c=>c.name==='nome')) db.run('ALTER TABLE encomenda_itens ADD COLUMN nome TEXT');
    }
  });
}

module.exports = { db, initDB };
