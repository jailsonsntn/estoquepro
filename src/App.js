import React, { useState, useEffect, useMemo, useRef } from 'react';
import './style.css';
const { initDB } = require('./db');
const { importPlanilha } = require('./importPlanilha');
const fs = window.require ? window.require('fs') : null;
const path = window.require ? window.require('path') : null;
let sqlite3 = null;
try {
  sqlite3 = window.require ? window.require('sqlite3').verbose() : null;
} catch (e) {
  console.error('Falha ao carregar sqlite3 no renderer:', e);
  sqlite3 = null;
}
console.log('Renderer env -> fs?', !!fs, 'path?', !!path, 'sqlite3?', !!sqlite3, '__dirname=', typeof __dirname !== 'undefined' ? __dirname : 'n/a');
import { getEmpresaInfo, getLogoPath } from './empresaInfo';
const { getBaseDir } = require('./pathUtil');
import { empresaInfo, pdfStyles } from './empresaConfig';
import EstoqueTab from './components/EstoqueTab';

const TABS = [
  { key: 'estoque', label: 'Estoque' },
  { key: 'encomendas', label: 'Encomendas' },
  { key: 'vales', label: 'Vales' },
  { key: 'calculadora', label: 'Calculadora' },
];

export default function App() {
  const [tab, setTab] = useState('estoque');
  const [estoque, setEstoque] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'codigo', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ codigo:'', nome:'', unidade:'', ncm:'', sit_trib:'', local_estoque:'', qt_estoque:0, c_medio:0, margem:0, venda_cons:0, custo_total:0, venda_total:0, travarVenda:false, ultimoCalculoAuto:true });
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const importInputRef = useRef(null);
  const lastBackupRef = useRef(0);
  // Estado calculadora
  const [calc, setCalc] = useState({
    precoCompra:0,
    icms:0, ipi:0, pis:0, cofins:0,
    frete:0,
    taxaCartao:0,
    comissaoMarketplace:0,
    margem:0,
    marketplace:'',
    baseLucro:'custo_produto', // 'custo_produto' | 'custo_total_base'
    impostoVenda:0, // % sobre preço de venda
    promocao:0,     // % sobre preço de venda
    tarifaFixa:0,   // R$
    subsidioFrete:0 // R$
  });
  const [calcHistorico, setCalcHistorico] = useState([]);
  // Encomendas
  const [encomendas, setEncomendas] = useState([]);
  const [loadingEncomendas, setLoadingEncomendas] = useState(false);
  const [viewEncomenda, setViewEncomenda] = useState(null);
  const [showNovaEncomenda, setShowNovaEncomenda] = useState(false);
  const [novaEncomendaTipo, setNovaEncomendaTipo] = useState('venda');
  const STATUS_OPCOES = [
    'AGUARDANDO PEÇA',
    'PEÇA CHEGOU',
    'CONSUMIDOR CIENTE',
    'CONSUMIDOR CIENTE AGUARDANDO RETIRADA',
    'RETIRADO'
  ];
  const [novaEncomendaDados, setNovaEncomendaDados] = useState({ nome_cliente:'', telefone_cliente:'', observacao:'', status:'AGUARDANDO PEÇA' });
  const [novaEncomendaItens, setNovaEncomendaItens] = useState([]); // {tempId, estoque_id, codigo, nome, qtd, preco, total}
  const [filtroPeca, setFiltroPeca] = useState('');
  const [editandoEncomendaId, setEditandoEncomendaId] = useState(null);
  const [viewEncomendaItens, setViewEncomendaItens] = useState([]);
  // Vales
  const [vales, setVales] = useState([]);
  const [clientesVale, setClientesVale] = useState([]);
  const [loadingVales, setLoadingVales] = useState(false);
  const [showNovoVale, setShowNovoVale] = useState(false);
  const [novoVale, setNovoVale] = useState({ cliente_id:null, cliente_nome:'', cliente_telefone:'', observacao:'', itens:[], status:'ABERTO', ajuste_percent:0 });
  const [filtroClientesVale, setFiltroClientesVale] = useState('');
  const [viewVale, setViewVale] = useState(null);
  const [editandoValeId, setEditandoValeId] = useState(null);
  const [filtroVales, setFiltroVales] = useState('');
  const [viewValeItens, setViewValeItens] = useState([]);
  // Clientes (modal)
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [clienteForm, setClienteForm] = useState({ id:null, nome:'', cpf:'', telefone:'', endereco:'', observacao:'', ativo:1 });
  const [empresa, setEmpresa] = useState({ nome:'', ramo:'', endereco:'', telefone:'', site:'', cnpj:'', ie:'', linhaTelefone:'' });
  const [logoCor, setLogoCor] = useState('preto');
  // Estado de operações longas (overlay busy)
  const [busy, setBusy] = useState(false); // false | string (mensagem)

  const runBusy = async (msg, fn) => {
    try {
      setBusy(msg || 'Processando...');
      await fn();
    } finally {
      setBusy(false);
    }
  };
  // ===== Carregamento inicial (empresa + estoque via DB/CSV) =====
  const loadEstoqueFromDB = () => {
    try {
      console.log('EstoquePro: Iniciando loadEstoqueFromDB');
      if (!sqlite3) {
        console.warn('EstoquePro: sqlite3 indisponível no renderer, seguindo sem carregar do banco.');
        setLoading(false);
        setInitializing(false);
        return;
      }
  const dbPath = path.join(getBaseDir(), 'estoquepro.db');
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
      try {
        db.exec('PRAGMA busy_timeout = 3000; PRAGMA read_uncommitted = true;');
      } catch(e) { console.warn('PRAGMA leitura warn:', e?.message||e); }
      const doSelect = (attempt=1) => db.all('SELECT * FROM estoque ORDER BY codigo', [], (err, rows) => {
        if(!err) {
          console.log(`EstoquePro: Carregados ${rows?.length || 0} itens do banco`);
          const normalized = normalizeOldTotals(rows||[]);
          setEstoque(normalized.rows);
          if(normalized.updatedIds.length){
            // Atualiza em background os registros corrigidos
            try {
              const writeDb = new sqlite3.Database(dbPath);
              writeDb.serialize(()=>{
                normalized.updatedIds.forEach(u => {
                  writeDb.run('UPDATE estoque SET custo_total = ?, venda_total = ? WHERE id = ?', [u.custo_total, u.venda_total, u.id]);
                });
              });
              try { writeDb.close(); } catch(_){ }
            } catch(exNorm){ console.error('Falha normalizar totals (write):', exNorm); }
          }
          try { flashMsg && flashMsg(`Banco carregado: ${(rows?.length||0)} itens`); } catch(_){}
        } else {
          if (err && err.code === 'SQLITE_BUSY' && attempt < 3) {
            console.warn('SELECT ocupado, tentando novamente...', attempt);
            return setTimeout(()=> doSelect(attempt+1), 300);
          }
          console.error('Erro ao carregar estoque:', err);
        }
        try { db.close && db.close(); } catch(_) {}
        setLoading(false);
        setInitializing(false);
      });
      doSelect();
    } catch(e){ 
      console.error('Erro na conexão com banco:', e); 
      setLoading(false); 
      setInitializing(false);
    }
  };

  useEffect(() => {
    // Carrega dados da empresa
    try { setEmpresa(getEmpresaInfo()); } catch(e){ console.error('empresa info', e); }
    let watcher = null;
    let debounceTimer = null;
    (async () => {
      try {
        await Promise.resolve(initDB());
        console.log('EstoquePro init: __dirname=', __dirname);
        console.log('EstoquePro init: fs?', !!fs, 'path?', !!path);
        if(!fs || !path){ console.warn('EstoquePro: fs/path indisponível'); setLoading(false); return; }
  const dbPath = path.join(getBaseDir(), 'estoquepro.db');
  const csvPath = path.join(getBaseDir(), 'dadosestoque.csv');
        console.log('EstoquePro init: dbPath=', dbPath, 'exists=', fs.existsSync(dbPath));
        console.log('EstoquePro init: csvPath=', csvPath, 'exists=', fs.existsSync(csvPath));
        // 1) Carrega imediatamente do banco para preencher a UI
        loadEstoqueFromDB();

        // 2) Importação automática em background (se arquivo existir)
        setTimeout(async () => {
          try {
            if (fs.existsSync(csvPath)) {
              const { importEstoqueCSV } = require('./importCSV');
              const res = await importEstoqueCSV(csvPath, { clearBefore:true, headerless:true });
              console.log('Auto-import CSV (bg):', res);
              flashMsg && flashMsg(`CSV importado: ${res.inserted||0} itens`);
              loadEstoqueFromDB();
            } else if (fs.existsSync(path.join(getBaseDir(), 'DADOS.XLS'))) {
              // Fallback: importa planilha Excel se CSV não existir
              try {
                const { importPlanilha } = require('./importPlanilha');
                await importPlanilha(path.join(getBaseDir(), 'DADOS.XLS'), { clearBefore:true });
                console.log('Auto-import XLS concluído');
                flashMsg && flashMsg('Planilha XLS importada');
                loadEstoqueFromDB();
              } catch(ex) { console.error('Falha import XLS', ex); }
            } else {
              console.warn('EstoquePro: Nenhum arquivo de dados encontrado (CSV/XLS).');
            }
          } catch(e) { console.error('Falha import bg', e); }
  }, 1000);
        // Fallback para nunca ficar travado no loading
        setTimeout(()=> {
          setLoading(l=> { if(l){ console.warn('EstoquePro: Fallback liberando loading após 7s'); } return false; });
        }, 7000);

        // Watcher para reimportar automaticamente ao alterar o CSV
        try {
          if (fs.existsSync(csvPath)) {
            watcher = fs.watch(csvPath, { persistent:false }, (event) => {
              if (event === 'change') {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                  try {
                    const { importEstoqueCSV } = require('./importCSV');
                    const res = await importEstoqueCSV(csvPath, { clearBefore:true, headerless:true });
                    console.log('Auto-reimport CSV (watch):', res);
                    flashMsg && flashMsg(`CSV atualizado: ${res.inserted||0} itens`);
                    loadEstoqueFromDB();
                  } catch (e) {
                    console.error('Watcher import error', e);
                    flashMsg && flashMsg('Falha ao reimportar CSV (watch)','error');
                  }
                }, 400);
              }
            });
          }
        } catch(e){ console.warn('Watcher CSV não inicializado:', e); }
      } catch(e){ console.error(e); setLoading(false); }
    })();

    return () => {
      try { if (watcher && watcher.close) watcher.close(); } catch(_){}
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  // ===== Backup/Export/Import Utils =====
  const ensureDir = (dirPath) => {
    try { if (fs && !fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true }); } catch (e) { console.error(e); }
  };
  const ts = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };
  const doBackup = (reason = 'manual') => {
    const exec = () => {
      try {
        const now = Date.now();
        if (reason !== 'manual' && now - lastBackupRef.current < 30 * 60 * 1000) return; // 30 min
        lastBackupRef.current = now;
        if (!fs || !path) return;
  const dbSrc = path.join(getBaseDir(), 'estoquepro.db');
        if (!fs.existsSync(dbSrc)) return;
  const backupDir = path.join(getBaseDir(), 'backups');
        ensureDir(backupDir);
        const dest = path.join(backupDir, `estoquepro-${ts()}.db`);
        // Checkpoint WAL para garantir consistência antes do backup
        try {
          const dbTmp = new sqlite3.Database(dbSrc);
          dbTmp.run('PRAGMA wal_checkpoint(TRUNCATE)', [], (e)=>{
            try { dbTmp.close(); } catch(_){ }
            try { fs.copyFileSync(dbSrc, dest); } catch(e2){ console.error(e2); }
          });
        } catch(_){
          // Fallback: copia direta
          fs.copyFileSync(dbSrc, dest);
        }
        if (reason === 'manual') flashMsg('Backup criado em backups/');
      } catch (e) { console.error(e); flashMsg('Falha ao criar backup', 'error'); }
    };
    if(reason === 'manual') runBusy('Criando backup...', async ()=> exec()); else exec();
  };

  const loadEncomendas = () => {
    setLoadingEncomendas(true);
    try {
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
      db.all(`SELECT e.*, (
        SELECT COUNT(*) FROM encomenda_itens ei WHERE ei.encomenda_id = e.id
      ) as itens_count FROM encomendas e ORDER BY datetime(e.data) DESC LIMIT 500`, [], (err, rows)=> {
        if(!err) setEncomendas(rows||[]);
        setLoadingEncomendas(false);
      });
    } catch(e){
      console.error(e); setLoadingEncomendas(false);
    }
  };

  const carregarItensEncomenda = (id) => {
    try {
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
      db.all('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [id], (err, rows)=> {
        if(!err) setViewEncomendaItens(rows||[]);
      });
    } catch(e){ console.error(e); }
  };

  const abrirVisualizacaoEncomenda = (e) => { setViewEncomenda(e); setViewEncomendaItens([]); carregarItensEncomenda(e.id); };
  const editarEncomenda = (e) => {
    try {
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
      db.all('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [e.id], (err, rows)=> {
        if(!err){
          setNovaEncomendaItens(rows.map(r => ({ tempId: r.id, estoque_id: r.estoque_id, codigo: r.codigo||'', nome: r.nome||'', qtd: r.quantidade, preco: r.preco_unit, total: r.total })));
          setNovaEncomendaDados({ nome_cliente: e.nome_cliente||'', telefone_cliente: e.telefone_cliente||'', observacao: e.observacao||'', status: e.status||'AGUARDANDO PEÇA' });
          setEditandoEncomendaId(e.id);
          setShowNovaEncomenda(true);
        }
      });
    } catch(ex){ console.error(ex); }
  };
  const excluirEncomenda = (e) => {
    if(!window.confirm('Excluir esta encomenda?')) return;
    try {
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
      db.run('DELETE FROM encomendas WHERE id = ?', [e.id], (err)=> {
        if(err){ console.error(err); flashMsg('Erro ao excluir','error'); return; }
        flashMsg('Encomenda excluída.');
        loadEncomendas();
        if(viewEncomenda && viewEncomenda.id===e.id){ setViewEncomenda(null); setViewEncomendaItens([]); }
        doBackup('change');
      });
    } catch(ex){ console.error(ex); }
  };
  const imprimirEncomenda = (e) => {
    const area = document.getElementById('print-area-encomenda');
    if(!area) return;
    
    const w = window.open('', 'PRINT', 'height=800,width=1000');
    if(!w) return;
    
    // Cabeçalho HTML com design moderno
    const htmlContent = `
      <html>
        <head>
          <title>Encomenda #${e.id} - ${empresaInfo.nome}</title>
          <meta charset="UTF-8">
          ${pdfStyles}
        </head>
        <body>
          <div class="documento-header">
            <div class="logo-section">
              <!-- Logo será inserida aqui se necessário -->
            </div>
            <div class="empresa-info">
              <h1 class="empresa-nome">${empresaInfo.nome}</h1>
              <p class="empresa-razao">${empresaInfo.razaoSocial}</p>
              <p class="empresa-endereco">${empresaInfo.endereco}</p>
              <p class="empresa-contato">
                Tel: ${empresaInfo.telefone} | ${empresaInfo.website}
              </p>
              <p class="empresa-dados-fiscais">
                CNPJ: ${empresaInfo.cnpj} | I.E.: ${empresaInfo.inscricaoEstadual}
              </p>
            </div>
          </div>
          
          <h2 class="documento-titulo">Encomenda</h2>
          <div class="documento-numero">Nº ${e.id}</div>
          
          <div class="info-section">
            <div class="info-card">
              <h4>Dados da Encomenda</h4>
              <p><strong>Status:</strong> <span class="status status-${e.status?.toLowerCase().replace(' ', '-')}">${e.status}</span></p>
              <p><strong>Data:</strong> ${new Date(e.data).toLocaleDateString('pt-BR')}</p>
              <p><strong>Tipo:</strong> ${e.tipo || 'Não informado'}</p>
            </div>
            <div class="info-card">
              <h4>Cliente/Fornecedor</h4>
              <p><strong>Nome:</strong> ${e.cliente || e.fornecedor || 'Não informado'}</p>
              <p><strong>Telefone:</strong> ${e.telefone || 'Não informado'}</p>
              <p><strong>Observações:</strong> ${e.obs || 'Nenhuma'}</p>
            </div>
          </div>
          
          <div class="tabela-container">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição do Item</th>
                  <th class="numero">Quantidade</th>
                  <th class="numero">Valor Unit.</th>
                  <th class="numero">Valor Total</th>
                </tr>
              </thead>
              <tbody>
                ${area.querySelector('tbody')?.innerHTML || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">Nenhum item cadastrado</td></tr>'}
              </tbody>
            </table>
          </div>
          
          <div class="resumo-section">
            <div class="resumo-valores">
              <div class="valor-item valor-total">
                <div class="valor-label">Total Geral</div>
                <div class="valor-numero">R$ ${(e.valor_total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
              </div>
            </div>
          </div>
          
          <div class="assinatura-section">
            <div class="assinatura-campo">
              <p>Assinatura do Cliente</p>
            </div>
            <div class="assinatura-campo">
              <p>Assinatura do Responsável</p>
            </div>
          </div>
          
          <div class="rodape">
            <p>Documento gerado em ${new Date().toLocaleString('pt-BR')} - ${empresaInfo.nome}</p>
          </div>
        </body>
      </html>
    `;
    
    w.document.write(htmlContent);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  // ===== Calculadora (cálculos derivados) =====
  const calcResultados = useMemo(() => {
    try {
    const toNum = (v) => Number(v)||0;
    const r2 = (n) => Math.round((Number(n)||0) * 100) / 100; // arredonda para 2 casas
    const base = toNum(calc.precoCompra);
    const impostosPerc = toNum(calc.icms) + toNum(calc.ipi) + toNum(calc.pis) + toNum(calc.cofins);
    const impostosValor = r2(base * (impostosPerc/100));
    const frete = r2(toNum(calc.frete));
    const custoBase = r2(base + impostosValor + frete); // custos independentes do preço (sem tarifas fixas de marketplace)

    const mp = String(calc.marketplace||'');
    const config = {
      'Shopee': { comissao: 20, taxaFixa: (pv)=>4.00, subsidioFrete: (pv)=>0 },
      'Olist': { comissao: 23, taxaFixa: (pv)=>5.00, subsidioFrete: (pv)=> (pv>=79?25:0) },
      'Magalu': { comissao: 20, taxaFixa: (pv)=>5.00, subsidioFrete: (pv)=> (pv>=79?25:0) },
      'Americanas': { comissao: 20, taxaFixa: (pv)=>0.00, subsidioFrete: (pv)=> (pv>=90?40: (pv>=40 && pv<=89.99?25:0)) },
      'Mercado Livre': { 
        comissao: 13, 
        taxaFixa: (pv)=> { if(pv < 12.5) return pv/2; if(pv <= 29) return 6.25; if(pv <= 50) return 6.50; if(pv <= 78.99) return 6.75; return 0; },
        // Subsídio no ML: conforme orientação do usuário, considerar o custo do produto (base), não o preço de venda
        subsidioFrete: ()=> (base>=79?25:0)
      }
    };

  const percentCartao = toNum(calc.taxaCartao);
  const margemPerc = toNum(calc.margem);
  const comissaoManual = toNum(calc.comissaoMarketplace);
  const impostoVendaPerc = toNum(calc.impostoVenda); // (%) sobre o preço de venda
  const promoPerc = toNum(calc.promocao); // (%) sobre o preço de venda
  const tarifaFixaExtra = r2(toNum(calc.tarifaFixa));
  const subsidioFreteExtra = r2(toNum(calc.subsidioFrete));

    const conf = config[mp];
    const comPerc = (comissaoManual > 0) ? comissaoManual : (conf ? conf.comissao : 0);

    // Soma das taxas proporcionais ao preço de venda
    const sPerc = (toNum(comPerc) + percentCartao + impostoVendaPerc + promoPerc) / 100;

    // Iterar poucas vezes apenas para estabilizar faixas de tarifa fixa dependentes do preço
    let pvGuess = r2((custoBase + tarifaFixaExtra + subsidioFreteExtra) * (1 + margemPerc/100));
    let taxaFixa = 0, subsidio = 0, lucroDesejadoValor = 0, precoVenda = 0;
    for (let i = 0; i < 4; i++) {
      const presetTaxa = conf ? conf.taxaFixa(pvGuess) : 0;
      const presetSub = conf ? conf.subsidioFrete(pvGuess) : 0;
      // Override: se usuário informar manual (>0), usar manual sozinho
      taxaFixa = r2(tarifaFixaExtra > 0 ? tarifaFixaExtra : presetTaxa);
      subsidio = r2(subsidioFreteExtra > 0 ? subsidioFreteExtra : presetSub);
      const custosIndep = r2(impostosValor + frete + taxaFixa + subsidio);
      // Base para lucro desejado
      const baseLucroValor = calc.baseLucro === 'custo_total_base' ? r2(base + custosIndep) : base; // custo do produto vs custo base
      lucroDesejadoValor = r2(baseLucroValor * (margemPerc/100));
      const numerador = r2(base + custosIndep + lucroDesejadoValor);
      const denom = (1 - sPerc) <= 0 ? 1 : (1 - sPerc);
      const pvNew = r2(numerador / denom);
      if (Math.abs(pvNew - pvGuess) < 0.01) { pvGuess = pvNew; break; }
      pvGuess = pvNew;
    }
    precoVenda = r2(pvGuess);

    // Componentes dependentes do preço calculado
    const comissaoVal = r2(precoVenda * (toNum(comPerc)/100));
    const cartaoVal = r2(precoVenda * (percentCartao/100));
    const impostoVendaVal = r2(precoVenda * (impostoVendaPerc/100));
    const promoVal = r2(precoVenda * (promoPerc/100));
    const custosIndepFinais = r2(impostosValor + frete + taxaFixa + subsidio);
    const custoTotal = r2(base + custosIndepFinais + comissaoVal + cartaoVal + impostoVendaVal + promoVal);
    const lucroFinal = r2(precoVenda - custoTotal);

    return {
      custoTotal,
      margemAplicada: lucroDesejadoValor, // exibe como "margem aplicada" o lucro desejado (alinhado à planilha)
      precoVenda,
      detalhes: {
        marketplace: mp||'Nenhum',
        comissaoPercent: toNum(comPerc),
        comissaoValor: comissaoVal,
        taxaFixa,
        subsidioFrete: subsidio,
        taxaCartaoValor: cartaoVal,
  impostoVendaValor: impostoVendaVal,
        promocaoValor: promoVal,
        impostosValor,
        frete,
        fixasTotal: r2(taxaFixa + subsidio + frete),
        lucroDesejadoValor,
        lucroFinalValor: lucroFinal,
        sPercentTotal: r2(sPerc*100)
      }
    };
    } catch (err) {
      console.error('Calculadora: falha ao calcular resultados:', err);
      const safe = (v)=> (isFinite(v)? v : 0);
      return {
        custoTotal: 0,
        margemAplicada: 0,
        precoVenda: 0,
        detalhes: {
          marketplace: String(calc.marketplace||'') || 'Nenhum',
          comissaoPercent: 0,
          comissaoValor: 0,
          taxaFixa: 0,
          subsidioFrete: 0,
          taxaCartaoValor: 0,
          impostoVendaValor: 0,
          promocaoValor: 0,
          impostosValor: 0,
          frete: 0,
          fixasTotal: 0,
          lucroDesejadoValor: 0,
          lucroFinalValor: 0,
          sPercentTotal: 0
        }
      };
    }
  }, [calc]);

  const salvarCalculo = () => {
    setCalcHistorico(h => [{ id: Date.now(), data: new Date().toISOString(), entrada: { ...calc }, resultado: { ...calcResultados } }, ...h].slice(0,200));
    flashMsg('Cálculo salvo.');
  };

  useEffect(()=> { if(tab==='encomendas') { Promise.resolve(initDB()).then(()=> loadEncomendas()); } }, [tab]);
  useEffect(()=> { if(tab==='vales') { Promise.resolve(initDB()).then(()=> { loadVales(); loadClientesVale(); }); } }, [tab]);

  // Helpers DB
  const getDB = () => {
  const dbPath = path.join(getBaseDir(), 'estoquepro.db');
    return new sqlite3.Database(dbPath);
  };

  const persistUpdate = (id, field, value) => {
    const attemptUpdate = (attempt=1) => {
      const db = getDB();
      db.run(`UPDATE estoque SET ${field} = ? WHERE id = ?`, [value, id], (err)=>{
        if(err && err.code==='SQLITE_BUSY' && attempt < 5){
          const delay = 120 * attempt;
            console.warn(`UPDATE retry ${attempt} (${field}) em ${delay}ms`);
            setTimeout(()=> attemptUpdate(attempt+1), delay);
        }
      });
    };
    attemptUpdate();
  };

  const persistNew = (item) => {
    const doInsert = (attempt=1) => {
      const db = getDB();
    // Novo significado: custo_total e venda_total representam valores unitários ajustados (não multiplicados pela quantidade em estoque)
    const custo_unit_ajustado = Number(item.c_medio||0) + (Number(item.c_medio||0) * (Number(item.margem||0)/100));
    const venda_total_unit = item.venda_cons; // Mantemos venda_total como equivalente ao preço de venda unitário
      db.run(`INSERT INTO estoque (codigo, nome, unidade, ncm, sit_trib, local_estoque, qt_estoque, c_medio, margem, venda_cons, custo_total, venda_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item.codigo, item.nome, item.unidade, item.ncm, item.sit_trib, item.local_estoque, item.qt_estoque, item.c_medio, item.margem || 0, item.venda_cons, custo_unit_ajustado, venda_total_unit], function(err){
          if(err && err.code==='SQLITE_BUSY' && attempt < 5){
            const delay = 150 * attempt;
            console.warn('INSERT retry em', delay, 'ms');
            return setTimeout(()=> doInsert(attempt+1), delay);
          }
          if(!err){
            const id = this.lastID;
            setEstoque(prev => [...prev, { ...item, id, custo_total: custo_unit_ajustado, venda_total: venda_total_unit }]);
          } else {
            console.error('Falha insert item:', err);
            flashMsg('Erro ao salvar item (lock persistente)','error');
          }
        });
    };
    doInsert();
  };

  const persistDelete = (ids) => {
    const db = getDB();
    const placeholders = ids.map(()=>'?').join(',');
    db.run(`DELETE FROM estoque WHERE id IN (${placeholders})`, ids, () => {
      setEstoque(prev => prev.filter(it => !ids.includes(it.id)));
    });
  };

  // Filtro / busca
  const filtered = useMemo(() => {
    let rows = [...estoque];
    const normalize = (s) => String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
    if (search.trim()) {
      const rawTokens = search.trim().split(/\s+/).filter(Boolean);
      const fieldMap = {
        codigo: 'codigo', cod: 'codigo',
        nome: 'nome', peca: 'nome', peça: 'nome',
        local: 'local_estoque', estoque: 'local_estoque',
        ncm: 'ncm',
        sit: 'sit_trib', situacao: 'sit_trib',
        un: 'unidade', unidade: 'unidade',
        disponivel: 'disponivel', disp:'disponivel'
      };
      const tokens = rawTokens.map(t => {
        const parts = t.split(':');
        if(parts.length>1){
          const key = normalize(parts[0]);
            if(fieldMap[key]){
              return { type:'field', field: fieldMap[key], value: normalize(parts.slice(1).join(':')) };
            }
        }
        return { type:'term', value: normalize(t) };
      });
      rows = rows.filter(r => {
        return tokens.every(tok => {
          if(tok.type==='field'){
            if(tok.field==='disponivel'){
              const dispVal = (Number(r.qt_estoque)||0) - (Number(r.reservado)||0);
              return normalize(dispVal).includes(tok.value);
            }
            const val = r[tok.field];
            return normalize(val).includes(tok.value);
          } else {
            // term -> precisa existir em algum campo
            const values = Object.entries(r).map(([k,v])=> {
              if(k==='disponivel') return ''; // ignore stored
              if(k==='qt_estoque' || k==='reservado') return String(v||'');
              return String(v||'');
            });
            // incluir disponivel derivado
            values.push(String((Number(r.qt_estoque)||0) - (Number(r.reservado)||0)));
            return values.some(val => normalize(val).includes(tok.value));
          }
        });
      });
    }
    rows.sort((a,b)=>{
      const getField = (row, field) => {
        if(field==='disponivel') return (Number(row.qt_estoque)||0) - (Number(row.reservado)||0);
        return row[field];
      };
      const fa = getField(a, sort.field);
      const fb = getField(b, sort.field);
      if (fa == null && fb != null) return -1;
      if (fa != null && fb == null) return 1;
      if (fa === fb) return 0;
      if (fa > fb) return sort.dir === 'asc' ? 1 : -1;
      return sort.dir === 'asc' ? -1 : 1;
    });
    return rows;
  }, [estoque, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page-1)*pageSize, page*pageSize);

  // Debug para verificar paginação
  console.log(`EstoquePro Debug: Total=${estoque.length}, Filtrados=${filtered.length}, Página=${page}/${totalPages}, PageSize=${pageSize}, Exibindo=${paged.length}`);

  const startEdit = (id) => {
    setEditingId(id);
    const item = estoque.find(i=>i.id===id);
    setEditValues({ ...item });
  };
  const cancelEdit = () => { setEditingId(null); setEditValues({}); };
  const saveEdit = () => {
    // Recalcular campos derivados segundo novo critério (valores unitários, não multiplicados pela quantidade)
    const custo_unit_ajustado = Number(editValues.c_medio||0) + (Number(editValues.c_medio||0) * (Number(editValues.margem||0)/100));
    const updated = { ...editValues, custo_total: custo_unit_ajustado, venda_total: Number(editValues.venda_cons||0) };
    setEstoque(prev => prev.map(r => r.id === updated.id ? updated : r));
    ['qt_estoque','c_medio','margem','venda_cons','custo_total','venda_total','local_estoque','nome','ncm','sit_trib','unidade','codigo'].forEach(f=>persistUpdate(updated.id, f, updated[f]));
    setEditingId(null); setEditValues({});
    flashMsg('Item atualizado.');
  };

  const flashMsg = (text, type='info') => {
    setMessage({ text, type });
    setTimeout(()=>setMessage(null), 3000);
  };

  // Exportações e Importação
  const exportEstoqueCSV = () => {
    runBusy('Exportando CSV...', async () => {
      try {
        const cols = ['id','codigo','nome','unidade','ncm','sit_trib','local_estoque','qt_estoque','c_medio','margem','venda_cons','custo_total','venda_total'];
        const header = cols.join(';');
        const lines = estoque.map(r => cols.map(c => {
          const v = r[c];
          if (v == null) return '';
          const s = String(v).replace(/\n/g,' ').replace(/;/g,',');
          return s;
        }).join(';'));
        const csv = [header, ...lines].join('\n');
  const outDir = path.join(getBaseDir(), 'exports'); ensureDir(outDir);
        const outPath = path.join(outDir, `estoque-${ts()}.csv`);
        fs.writeFileSync(outPath, csv, 'utf-8');
        flashMsg('CSV exportado em exports/');
      } catch(e){ console.error(e); flashMsg('Erro ao exportar CSV','error'); }
    });
  };

  const exportDadosJSON = async () => {
    runBusy('Exportando JSON...', async () => {
      try {
        await Promise.resolve(initDB());
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
        db.all('SELECT * FROM estoque', [], (e1, estRows) => {
          if(e1){ console.error(e1); flashMsg('Erro exportando estoque','error'); return; }
          db.all('SELECT * FROM encomendas', [], (e2, encRows) => {
            if(e2){ console.error(e2); flashMsg('Erro exportando encomendas','error'); return; }
            db.all('SELECT * FROM encomenda_itens', [], (e3, itRows) => {
              if(e3){ console.error(e3); flashMsg('Erro exportando itens','error'); return; }
              db.all('SELECT * FROM vale_clientes', [], (e4, vcRows) => {
                if(e4){ console.error(e4); flashMsg('Erro exportando clientes de vale','error'); return; }
                db.all('SELECT * FROM vales', [], (e5, vRows) => {
                  if(e5){ console.error(e5); flashMsg('Erro exportando vales','error'); return; }
                  db.all('SELECT * FROM vale_itens', [], (e6, viRows) => {
                    if(e6){ console.error(e6); flashMsg('Erro exportando itens de vale','error'); return; }
                    const payload = {
                      version: 3,
                      dataGeracao: new Date().toISOString(),
                      estoque: estRows||[],
                      encomendas: encRows||[],
                      encomenda_itens: itRows||[],
                      vale_clientes: vcRows||[],
                      vales: vRows||[],
                      vale_itens: viRows||[],
                    };
                    const json = JSON.stringify(payload, null, 2);
                    const outDir = path.join(getBaseDir(), 'exports'); ensureDir(outDir);
                    const outPath = path.join(outDir, `dados-${ts()}.json`);
                    fs.writeFileSync(outPath, json, 'utf-8');
                    flashMsg('JSON exportado em exports/');
                  });
                });
              });
            });
          });
        });
      } catch(e){ console.error(e); flashMsg('Erro na exportação','error'); }
    });
  };

  // Botão "Escolher arquivo" removido a pedido do usuário

  const onImportarJSONArquivo = async (filePath) => {
    runBusy('Importando JSON...', async () => {
      try {
        await Promise.resolve(initDB());
        const raw = fs.readFileSync(filePath, 'utf-8');
        const obj = JSON.parse(raw);
        const est = Array.isArray(obj.estoque) ? obj.estoque : (obj.data && obj.data.estoque)||[];
        const enc = Array.isArray(obj.encomendas) ? obj.encomendas : (obj.data && obj.data.encomendas)||[];
        const its = Array.isArray(obj.encomenda_itens) ? obj.encomenda_itens : (obj.data && obj.data.encomenda_itens)||[];
        const vc = Array.isArray(obj.vale_clientes) ? obj.vale_clientes : (obj.data && obj.data.vale_clientes)||[];
        const vs = Array.isArray(obj.vales) ? obj.vales : (obj.data && obj.data.vales)||[];
        const vis = Array.isArray(obj.vale_itens) ? obj.vale_itens : (obj.data && obj.data.vale_itens)||[];
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
        db.serialize(()=>{
          db.run('BEGIN TRANSACTION');
            db.run('DELETE FROM encomenda_itens');
            db.run('DELETE FROM encomendas');
            db.run('DELETE FROM vale_itens');
            db.run('DELETE FROM vales');
            db.run('DELETE FROM vale_clientes');
            db.run('DELETE FROM estoque');
            const stmtEst = db.prepare('INSERT INTO estoque (id, codigo, nome, unidade, ncm, sit_trib, local_estoque, qt_estoque, c_medio, margem, venda_cons, custo_total, venda_total, reservado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            est.forEach(r => stmtEst.run([r.id, r.codigo, r.nome, r.unidade, r.ncm, r.sit_trib, r.local_estoque, r.qt_estoque||0, r.c_medio||0, r.margem||0, r.venda_cons||0, (r.c_medio||0)*(r.qt_estoque||0), (r.venda_cons||0)*(r.qt_estoque||0), r.reservado||0]));
            stmtEst.finalize();
            const stmtEnc = db.prepare('INSERT INTO encomendas (id, tipo, data, status, observacao, nome_cliente, telefone_cliente, total_itens, total_geral) VALUES (?,?,?,?,?,?,?,?,?)');
            enc.forEach(r => stmtEnc.run([r.id, r.tipo||'registro', r.data||new Date().toISOString(), r.status||'AGUARDANDO PEÇA', r.observacao||'', r.nome_cliente||'', r.telefone_cliente||'', r.total_itens||0, r.total_geral||0]));
            stmtEnc.finalize();
            const stmtIt = db.prepare('INSERT INTO encomenda_itens (id, encomenda_id, estoque_id, quantidade, preco_unit, total, codigo, nome) VALUES (?,?,?,?,?,?,?,?)');
            its.forEach(r => stmtIt.run([r.id, r.encomenda_id, r.estoque_id||0, r.quantidade||0, r.preco_unit||0, r.total||0, r.codigo||'', r.nome||'' ]));
            stmtIt.finalize();
            if(vc && vc.length){
              const stmtVc = db.prepare('INSERT INTO vale_clientes (id, nome, cpf, telefone, endereco, observacao, ativo) VALUES (?,?,?,?,?,?,?)');
              vc.forEach(r => stmtVc.run([
                r.id,
                r.nome||'',
                r.cpf||'',
                r.telefone||'',
                r.endereco||'',
                r.observacao||'',
                r.ativo==null?1:r.ativo
              ]));
              stmtVc.finalize();
            }
            if(vs && vs.length){
              const stmtVs = db.prepare('INSERT INTO vales (id, cliente_id, data, status, observacao, total_itens, total_geral, ajuste_percent) VALUES (?,?,?,?,?,?,?,?)');
              vs.forEach(r => stmtVs.run([r.id, r.cliente_id||null, r.data||new Date().toISOString(), r.status||'ABERTO', r.observacao||'', r.total_itens||0, r.total_geral||0, r.ajuste_percent||0]));
              stmtVs.finalize();
            }
            if(vis && vis.length){
              const stmtVis = db.prepare('INSERT INTO vale_itens (id, vale_id, estoque_id, quantidade, preco_unit, total, codigo, nome) VALUES (?,?,?,?,?,?,?,?)');
              vis.forEach(r => stmtVis.run([r.id, r.vale_id, r.estoque_id||null, r.quantidade||0, r.preco_unit||0, r.total||0, r.codigo||'', r.nome||'' ]));
              stmtVis.finalize();
            }
            db.run('UPDATE estoque SET reservado = 0');
            db.all(`SELECT vi.estoque_id as id, SUM(vi.quantidade) as qtd
                    FROM vale_itens vi
                    JOIN vales v ON v.id = vi.vale_id
                    WHERE v.status='ABERTO' AND vi.estoque_id IS NOT NULL
                    GROUP BY vi.estoque_id`, [], (gErr, groupRows)=>{
              if(gErr){ console.error(gErr); }
              else if(groupRows && groupRows.length){
                groupRows.forEach(rg => {
                  db.run('UPDATE estoque SET reservado = COALESCE(reservado,0) + ? WHERE id=?', [rg.qtd||0, rg.id]);
                });
              }
              db.run('COMMIT', (err)=>{
                if(err){ console.error(err); flashMsg('Erro ao importar','error'); return; }
                reloadFromDB();
                loadEncomendas();
                loadVales();
                flashMsg('Dados importados com sucesso.');
                doBackup('change');
              });
            });
        });
      } catch(e){ console.error(e); flashMsg('Arquivo inválido','error'); }
    });
  };

  const addItem = () => {
    if(!newItem.codigo || !newItem.nome){ flashMsg('Código e Nome obrigatórios','error'); return; }
    const payload = { ...newItem };
    // garantir venda_cons coerente
    if(!newItem.travarVenda) {
      const vc = calcularVendaSug(newItem.c_medio, newItem.margem);
      payload.venda_cons = vc;
    }
    persistNew(payload);
    setShowAdd(false);
    setNewItem({ codigo:'', nome:'', unidade:'', ncm:'', sit_trib:'', local_estoque:'', qt_estoque:0, c_medio:0, margem:0, venda_cons:0, custo_total:0, venda_total:0, travarVenda:false, ultimoCalculoAuto:true });
    flashMsg('Item adicionado.');
  };

  const calcularVendaSug = (custo, margem) => {
    const c = Number(custo)||0; const m = Number(margem)||0; return c * (1 + m/100);
  };

  useEffect(()=> {
    // Atualiza venda_cons automaticamente apenas se usuário não travou / não alterou manualmente
    if(showAdd && !newItem.travarVenda && newItem.ultimoCalculoAuto){
      setNewItem(v => ({ ...v, venda_cons: calcularVendaSug(v.c_medio, v.margem) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newItem.c_medio, newItem.margem]);

  const deleteSelected = () => {
    if(selected.size===0){ return; }
    if(!window.confirm('Remover itens selecionados?')) return;
    const ids = Array.from(selected);
    persistDelete(ids);
    setSelected(new Set());
    flashMsg('Itens removidos.');
  };

  const toggleSelect = (id) => {
    setSelected(prev => { const s = new Set(prev); if(s.has(id)) s.delete(id); else s.add(id); return s; });
  };

  const changeSort = (field) => {
    setSort(prev => prev.field === field ? { field, dir: prev.dir==='asc'?'desc':'asc' } : { field, dir:'asc' });
  };

  useEffect(()=>{ if(page>totalPages) setPage(totalPages); }, [totalPages,page]);

  // Debounce simples busca
  const [pendingSearch, setPendingSearch] = useState('');
  useEffect(()=>{ const t = setTimeout(()=> setSearch(pendingSearch), 300); return ()=>clearTimeout(t); }, [pendingSearch]);

  const reloadFromDB = () => {
  const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
    db.all('SELECT * FROM estoque', [], (err, rows) => {
      if(!err){
        const normalized = normalizeOldTotals(rows||[]);
        setEstoque(normalized.rows);
        if(normalized.updatedIds.length){
          try {
            const writeDb = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
            writeDb.serialize(()=>{
              normalized.updatedIds.forEach(u => writeDb.run('UPDATE estoque SET custo_total=?, venda_total=? WHERE id=?', [u.custo_total, u.venda_total, u.id]));
            });
            try { writeDb.close(); } catch(_){ }
          } catch(exNorm){ console.error('Norm reload write fail', exNorm); }
        }
      }
    });
  };

  // ===== Normalização de registros antigos (que armazenavam total multiplicado pela quantidade) =====
  const normalizeOldTotals = (rows) => {
    const updatedIds = [];
    const fixed = rows.map(r => {
      const qt = Number(r.qt_estoque)||0;
      const cMed = Number(r.c_medio)||0;
      const margem = Number(r.margem)||0;
      let custo_total = r.custo_total;
      let venda_total = r.venda_total;
      const expectedOldCusto = qt ? Number((cMed * qt).toFixed(2)) : cMed;
      const expectedOldVenda = qt ? Number(((Number(r.venda_cons)||0) * qt).toFixed(2)) : Number(r.venda_cons||0);
      const looksOld = qt>0 && (Math.abs(Number(custo_total||0) - expectedOldCusto) < 0.01);
      const looksOldVenda = qt>0 && (Math.abs(Number(venda_total||0) - expectedOldVenda) < 0.01);
      if(looksOld || looksOldVenda){
        const newCusto = Number((cMed + (cMed * (margem/100))).toFixed(2));
        const newVenda = Number((Number(r.venda_cons)||0).toFixed(2));
        custo_total = newCusto;
        venda_total = newVenda;
        updatedIds.push({ id: r.id, custo_total, venda_total });
      }
      return { ...r, custo_total, venda_total };
    });
    return { rows: fixed, updatedIds };
  };

  // ====== Vales (DB) ======
  const loadClientesVale = () => {
    try { const db = getDB(); db.all('SELECT * FROM vale_clientes WHERE ativo=1 ORDER BY nome', [], (err, rows)=>{ if(!err) setClientesVale(rows||[]); }); } catch(e){ console.error(e); }
  };
  const loadVales = () => {
    setLoadingVales(true);
    try { const db = getDB(); db.all(`SELECT v.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.cpf as cliente_cpf, c.endereco as cliente_endereco FROM vales v LEFT JOIN vale_clientes c ON c.id=v.cliente_id ORDER BY datetime(v.data) DESC LIMIT 500`, [], (err, rows)=>{ if(!err) setVales(rows||[]); setLoadingVales(false); }); } catch(e){ console.error(e); setLoadingVales(false); }
  };
  const salvarClienteVale = async (cli) => {
    try {
      await Promise.resolve(initDB());
      const db = getDB();
      if(cli.id){
        db.run('UPDATE vale_clientes SET nome=?, cpf=?, telefone=?, endereco=?, observacao=?, ativo=? WHERE id=?',[cli.nome, cli.cpf||'', cli.telefone||'', cli.endereco||'', cli.observacao||'', cli.ativo?1:0, cli.id], (err)=> {
          if(err){ console.error(err); flashMsg('Erro ao atualizar cliente','error'); return; }
          loadClientesVale();
          flashMsg('Cliente atualizado.');
        });
      } else {
        db.run('INSERT INTO vale_clientes (nome, cpf, telefone, endereco, observacao, ativo) VALUES (?,?,?,?,?,1)', [cli.nome, cli.cpf||'', cli.telefone||'', cli.endereco||'', cli.observacao||''], (err)=> {
          if(err){ console.error(err); flashMsg('Erro ao criar cliente','error'); return; }
          loadClientesVale();
          flashMsg('Cliente criado.');
        });
      }
    } catch(e){ console.error(e); flashMsg('Falha ao salvar cliente','error'); }
  };
  const openNovoClienteModal = () => { setClienteForm({ id:null, nome:'', cpf:'', telefone:'', endereco:'', observacao:'', ativo:1 }); setShowClienteModal(true); };
  const openEditarClienteModal = (c) => { setClienteForm({ id:c.id, nome:c.nome||'', cpf:c.cpf||'', telefone:c.telefone||'', endereco:c.endereco||'', observacao:c.observacao||'', ativo: c.ativo==null?1:c.ativo }); setShowClienteModal(true); };
  const excluirClienteVale = (id) => {
    if(!window.confirm('Excluir cliente?')) return;
    try { const db = getDB(); db.run('UPDATE vale_clientes SET ativo=0 WHERE id=?', [id], ()=> loadClientesVale()); } catch(e){ console.error(e); }
  };
  const abrirNovoVale = () => {
    setEditandoValeId(null);
    setNovoVale({ cliente_id:null, cliente_nome:'', cliente_telefone:'', observacao:'', itens:[{ id:Date.now()+Math.random(), estoque_id:null, codigo:'', nome:'', qtd:1, preco:0, total:0 }], status:'ABERTO', ajuste_percent:0 });
    setShowNovoVale(true);
  };
  const addLinhaVale = () => setNovoVale(v => ({...v, itens:[...v.itens, { id:Date.now()+Math.random(), estoque_id:null, codigo:'', nome:'', qtd:1, preco:0, total:0 }]}));
  const reservarEstoque = (estoque_id, quantidade) => {
    if(!estoque_id || !quantidade) return;
    try { const db = getDB(); db.run('UPDATE estoque SET reservado = COALESCE(reservado,0) + ? WHERE id=?', [quantidade, estoque_id]); } catch(e){ console.error(e); }
  };
  const liberarReserva = (estoque_id, quantidade) => {
    if(!estoque_id || !quantidade) return;
    try { const db = getDB(); db.run('UPDATE estoque SET reservado = MAX(0, COALESCE(reservado,0) - ?) WHERE id=?', [quantidade, estoque_id]); } catch(e){ console.error(e); }
  };
  const salvarVale = async () => {
    await runBusy('Salvando vale...', async () => new Promise((resolve) => {
      try {
        const db = getDB();
        const subtotal = novoVale.itens.reduce((a,i)=> a + (i.total||0), 0);
        const total = subtotal * (1 + (Number(novoVale.ajuste_percent)||0)/100);
        if(editandoValeId){
          db.all('SELECT * FROM vale_itens WHERE vale_id=?', [editandoValeId], (e0, antigos)=>{
            if(e0){ console.error(e0); flashMsg('Erro ao carregar itens antigos','error'); resolve(); return; }
            db.serialize(()=>{
              db.get('SELECT status FROM vales WHERE id=?', [editandoValeId], (eS, rowS)=>{
                const eraAberto = !eS && rowS && rowS.status==='ABERTO';
                if(eraAberto){ antigos.forEach(r=> { if(r.estoque_id) liberarReserva(r.estoque_id, r.quantidade||0); }); }
                db.run('UPDATE vales SET cliente_id=?, status=?, observacao=?, total_itens=?, total_geral=?, ajuste_percent=? WHERE id=?', [
                  novoVale.cliente_id||null, novoVale.status, novoVale.observacao||'', novoVale.itens.length, total, Number(novoVale.ajuste_percent)||0, editandoValeId
                ], (eU)=>{
                  if(eU){ console.error(eU); flashMsg('Erro ao atualizar vale','error'); resolve(); return; }
                  db.run('DELETE FROM vale_itens WHERE vale_id=?', [editandoValeId], (eDel)=>{
                    if(eDel) console.error(eDel);
                    let pending = novoVale.itens.length; if(pending===0) return finalizeUpd();
                    novoVale.itens.forEach(it => {
                      const values = [editandoValeId, it.estoque_id||null, it.qtd||0, it.preco||0, it.total||0, it.codigo||'', it.nome||''];
                      db.run('INSERT INTO vale_itens (vale_id, estoque_id, quantidade, preco_unit, total, codigo, nome) VALUES (?,?,?,?,?,?,?)', values, (e2)=>{
                        if(e2) console.error(e2);
                        if(novoVale.status==='ABERTO' && it.estoque_id) reservarEstoque(it.estoque_id, it.qtd||0);
                        pending--; if(pending===0) finalizeUpd();
                      });
                    });
                    function finalizeUpd(){
                      setShowNovoVale(false); setEditandoValeId(null);
                      loadVales(); reloadFromDB(); flashMsg('Vale atualizado.'); doBackup && doBackup('change');
                      resolve();
                    }
                  });
                });
              });
            });
          });
        } else {
          db.run('INSERT INTO vales (cliente_id, data, status, observacao, total_itens, total_geral, ajuste_percent) VALUES (?,?,?,?,?,?,?)', [novoVale.cliente_id||null, new Date().toISOString(), novoVale.status, novoVale.observacao||'', novoVale.itens.length, total, Number(novoVale.ajuste_percent)||0], function(err){
            if(err){ console.error(err); flashMsg('Erro ao salvar vale','error'); resolve(); return; }
            const valeId = this.lastID;
            let pending = novoVale.itens.length; if(pending===0) return finalize();
            novoVale.itens.forEach(it => {
              const values = [valeId, it.estoque_id||null, it.qtd||0, it.preco||0, it.total||0, it.codigo||'', it.nome||''];
              db.run('INSERT INTO vale_itens (vale_id, estoque_id, quantidade, preco_unit, total, codigo, nome) VALUES (?,?,?,?,?,?,?)', values, (e2)=>{
                if(e2) console.error(e2);
                if(novoVale.status==='ABERTO' && it.estoque_id) reservarEstoque(it.estoque_id, it.qtd||0);
                pending--; if(pending===0) finalize();
              });
            });
            function finalize(){
              setShowNovoVale(false);
              loadVales();
              reloadFromDB();
              flashMsg('Vale registrado.');
              doBackup && doBackup('change');
              resolve();
            }
          });
        }
      } catch(e){ console.error(e); flashMsg('Falha ao salvar vale','error'); resolve(); }
    }));
  };
  const editarVale = (v) => {
    if(v.status!=='ABERTO'){ flashMsg('Apenas vales ABERTO podem ser editados','error'); return; }
    try { const db = getDB(); db.all('SELECT * FROM vale_itens WHERE vale_id=? ORDER BY id', [v.id], (err, rows)=>{
      if(err){ console.error(err); return; }
      const itensMap = (rows||[]).map(r => ({ id:r.id, estoque_id:r.estoque_id, codigo:r.codigo||'', nome:r.nome||'', qtd:r.quantidade, preco:r.preco_unit, total:r.total }));
      setNovoVale({ cliente_id: v.cliente_id||null, observacao: v.observacao||'', status: v.status||'ABERTO', itens: itensMap.length? itensMap : [{ id:Date.now()+Math.random(), estoque_id:null, codigo:'', nome:'', qtd:1, preco:0, total:0 }], ajuste_percent: v.ajuste_percent||0 });
      setEditandoValeId(v.id);
      setShowNovoVale(true);
    }); } catch(e){ console.error(e); }
  };
  const duplicarVale = (v) => {
    try { const db = getDB(); db.all('SELECT * FROM vale_itens WHERE vale_id=? ORDER BY id', [v.id], (err, rows)=>{
      if(err){ console.error(err); return; }
      const itensMap = (rows||[]).map(r => ({ id:Date.now()+Math.random()+r.id, estoque_id:r.estoque_id, codigo:r.codigo||'', nome:r.nome||'', qtd:r.quantidade, preco:r.preco_unit, total:r.total }));
      setEditandoValeId(null);
      setNovoVale({ cliente_id: v.cliente_id||null, observacao: v.observacao||'', status:'ABERTO', itens: itensMap, ajuste_percent: v.ajuste_percent||0 });
      setShowNovoVale(true);
    }); } catch(e){ console.error(e); }
  };
  const quitarVale = (v) => {
    if(v.status!=='ABERTO'){ flashMsg('Apenas vales ABERTO podem ser quitados','error'); return; }
    if(!window.confirm('Quitar este vale? Itens serão baixados do estoque.')) return;
    try { const db = getDB(); db.all('SELECT * FROM vale_itens WHERE vale_id=?', [v.id], (err, rows)=>{
      if(err){ console.error(err); flashMsg('Erro ao carregar itens','error'); return; }
      db.serialize(()=>{
        rows.forEach(r => {
          if(r.estoque_id){
            // baixa do estoque e libera reserva
            db.run('UPDATE estoque SET qt_estoque = COALESCE(qt_estoque,0) - ?, reservado = MAX(0, COALESCE(reservado,0) - ?) WHERE id=?', [r.quantidade||0, r.quantidade||0, r.estoque_id]);
          }
        });
        db.run('UPDATE vales SET status="QUITADO" WHERE id=?', [v.id], ()=> { loadVales(); reloadFromDB(); flashMsg('Vale quitado.'); doBackup && doBackup('change'); });
      });
    }); } catch(e){ console.error(e); }
  };
  const cancelarVale = (v) => {
    if(v.status!=='ABERTO'){ flashMsg('Apenas vales ABERTO podem ser cancelados','error'); return; }
    if(!window.confirm('Cancelar este vale? Reservas serão liberadas.')) return;
    try { const db = getDB(); db.all('SELECT * FROM vale_itens WHERE vale_id=?', [v.id], (err, rows)=>{
      if(err){ console.error(err); flashMsg('Erro ao carregar itens','error'); return; }
      rows.forEach(r => { if(r.estoque_id) liberarReserva(r.estoque_id, r.quantidade||0); });
      db.run('UPDATE vales SET status="CANCELADO" WHERE id=?', [v.id], ()=> { loadVales(); reloadFromDB(); flashMsg('Vale cancelado.'); doBackup && doBackup('change'); });
    }); } catch(e){ console.error(e); }
  };
  const excluirVale = (v) => {
    if(!window.confirm('Excluir vale?')) return;
    try { const db = getDB();
      db.all('SELECT * FROM vale_itens WHERE vale_id=?', [v.id], (e1, rows)=>{
        db.run('DELETE FROM vales WHERE id=?', [v.id], (e2)=>{
          if(e2){ console.error(e2); flashMsg('Erro ao excluir','error'); return; }
          // liberar reservas caso estivesse ABERTO
          if(v.status==='ABERTO') rows.forEach(r => r.estoque_id && liberarReserva(r.estoque_id, r.quantidade||0));
          loadVales(); reloadFromDB(); flashMsg('Vale excluído.'); doBackup && doBackup('change');
        });
      });
    } catch(e){ console.error(e); }
  };
  const carregarItensVale = (valeId) => {
    try { const db = getDB(); db.all('SELECT * FROM vale_itens WHERE vale_id=? ORDER BY id', [valeId], (err, rows)=> { if(!err) setViewValeItens(rows||[]); }); } catch(e){ console.error(e); }
  };
  const abrirVisualizacaoVale = (v) => { setViewVale(v); setViewValeItens([]); carregarItensVale(v.id); };
  const imprimirVale = (v) => {
    const area = document.getElementById('print-area-vale');
    if(!area) return;
    
    const w = window.open('', 'PRINT', 'height=800,width=1000');
    if(!w) return;
    
    // Determinar status e cor
  const statusClass = v.status?.toLowerCase().replace(/\s+/g, '-') || 'aberto';
    
    // Cabeçalho HTML com design moderno
    const htmlContent = `
      <html>
        <head>
          <title>Vale #${v.id} - ${empresaInfo.nome}</title>
          <meta charset="UTF-8">
          ${pdfStyles}
        </head>
        <body>
          <div class="documento-header">
            <div class="logo-section">
              <!-- Logo será inserida aqui se necessário -->
            </div>
            <div class="empresa-info">
              <h1 class="empresa-nome">${empresaInfo.nome}</h1>
              <p class="empresa-razao">${empresaInfo.razaoSocial}</p>
              <p class="empresa-endereco">${empresaInfo.endereco}</p>
              <p class="empresa-contato">
                Tel: ${empresaInfo.telefone} | ${empresaInfo.website}
              </p>
              <p class="empresa-dados-fiscais">
                CNPJ: ${empresaInfo.cnpj} | I.E.: ${empresaInfo.inscricaoEstadual}
              </p>
            </div>
          </div>
          
          <h2 class="documento-titulo">Vale</h2>
          <div class="documento-numero">Nº ${v.id}</div>
          
          <div class="info-section">
            <div class="info-card">
              <h4>Dados do Vale</h4>
              <p><strong>Status:</strong> <span class="status status-${statusClass}">${v.status || 'ABERTO'}</span></p>
              <p><strong>Data:</strong> ${new Date(v.data).toLocaleDateString('pt-BR')}</p>
              <p><strong>Total de Itens:</strong> ${v.total_itens || 0}</p>
            </div>
            <div class="info-card">
              <h4>Cliente</h4>
              <p><strong>Nome:</strong> ${v.cliente_nome || 'Não informado'}</p>
              ${v.cliente_cpf ? `<p><strong>CPF:</strong> ${v.cliente_cpf}</p>` : ''}
              ${v.cliente_endereco ? `<p><strong>Endereço:</strong> ${v.cliente_endereco}</p>` : ''}
              <p><strong>Observações:</strong> ${v.observacao || 'Nenhuma'}</p>
              ${v.ajuste_percent ? `<p><strong>Ajuste:</strong> ${v.ajuste_percent}%</p>` : ''}
            </div>
          </div>
          
          <div class="tabela-container">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição do Item</th>
                  <th class="numero">Quantidade</th>
                  <th class="numero">Preço Unit.</th>
                  <th class="numero">Total</th>
                </tr>
              </thead>
              <tbody>
                ${area.querySelector('tbody')?.innerHTML || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">Nenhum item cadastrado</td></tr>'}
              </tbody>
            </table>
          </div>
          
          <div class="resumo-section">
            <div class="resumo-valores">
              ${v.ajuste_percent ? `
                <div class="valor-item">
                  <div class="valor-label">Subtotal</div>
                  <div class="valor-numero">R$ ${((v.total_geral || 0) / (1 + (v.ajuste_percent || 0) / 100)).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
                </div>
                <div class="valor-item">
                  <div class="valor-label">Ajuste (${v.ajuste_percent}%)</div>
                  <div class="valor-numero">R$ ${((v.total_geral || 0) - ((v.total_geral || 0) / (1 + (v.ajuste_percent || 0) / 100))).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
                </div>
              ` : ''}
              <div class="valor-item valor-total">
                <div class="valor-label">Total Geral</div>
                <div class="valor-numero">R$ ${(v.total_geral || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
              </div>
            </div>
          </div>
          
          <div class="assinatura-section">
            <div class="assinatura-campo">
              <p>Assinatura do Cliente</p>
            </div>
            <div class="assinatura-campo">
              <p>Assinatura do Responsável</p>
            </div>
          </div>
          
          <div class="rodape">
            <p>Documento gerado em ${new Date().toLocaleString('pt-BR')} - ${empresaInfo.nome}</p>
            ${v.status === 'ABERTO' ? '<p style="color:#dc2626; font-weight:600; margin-top:5px;">⚠️ Vale em aberto - Sujeito a alterações</p>' : ''}
          </div>
        </body>
      </html>
    `;
    
    w.document.write(htmlContent);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>✨ EstoquePro</h1>
        <nav className="app-tabs">
          {TABS.map(t => (
            <button key={t.key} className={tab===t.key? 'active':''} onClick={()=> setTab(t.key)}>{t.label}</button>
          ))}
        </nav>
      </header>
      <main className="main-container">
        {tab === 'estoque' && (
          <EstoqueTab
            loading={loading}
            initializing={initializing}
            pendingSearch={pendingSearch}
            setPendingSearch={setPendingSearch}
            setPage={setPage}
            page={page}
            totalPages={totalPages}
            showAdd={showAdd}
            setShowAdd={setShowAdd}
            selected={selected}
            deleteSelected={deleteSelected}
            exportEstoqueCSV={exportEstoqueCSV}
            exportDadosJSON={exportDadosJSON}
            importInputRef={importInputRef}
            onImportarJSONArquivo={onImportarJSONArquivo}
            reloadEstoque={()=> { setLoading(true); loadEstoqueFromDB(); }}
            reimportCSV={()=> {
              runBusy('Reimportando CSV...', async ()=> {
                try {
                  const baseDir = getBaseDir();
                  const csvPath = path.join(baseDir, 'dadosestoque.csv');
                  const xlsPath = path.join(baseDir, 'DADOS.XLS');
                  if(fs && fs.existsSync(csvPath)){
                    const { importEstoqueCSV } = require('./importCSV');
                    setLoading(true);
                    await importEstoqueCSV(csvPath, { clearBefore:true, headerless:true });
                    const db = new sqlite3.Database(path.join(baseDir, 'estoquepro.db'));
                    db.all('SELECT * FROM estoque', [], (err, rows)=>{ 
                      if(!err) setEstoque(rows||[]); 
                      try { db.close && db.close(); } catch(_) {}
                      setLoading(false); 
                      flashMsg('Reimportado CSV.'); 
                    });
                  } else if (fs && fs.existsSync(xlsPath)) {
                    // Fallback: importar planilha Excel
                    try {
                      const { importPlanilha } = require('./importPlanilha');
                      setLoading(true);
                      await importPlanilha(xlsPath, { clearBefore:true });
                      const db = new sqlite3.Database(path.join(baseDir, 'estoquepro.db'));
                      db.all('SELECT * FROM estoque', [], (err, rows)=>{ 
                        if(!err) setEstoque(rows||[]); 
                        try { db.close && db.close(); } catch(_) {}
                        setLoading(false); 
                        flashMsg('Planilha DADOS.XLS importada.'); 
                      });
                    } catch(ex) { console.error(ex); setLoading(false); flashMsg('Falha ao importar DADOS.XLS','error'); }
                  } else {
                    flashMsg(`Arquivo de dados não encontrado. Coloque 'dadosestoque.csv' ou 'DADOS.XLS' na pasta:\n${baseDir}`,'error');
                  }
                } catch(e){ console.error(e); setLoading(false); flashMsg('Falha reimportar','error'); }
              });
            }}
            doBackup={doBackup}
            paged={paged}
            editingId={editingId}
            startEdit={startEdit}
            saveEdit={saveEdit}
            cancelEdit={cancelEdit}
            setViewItem={setViewItem}
            persistDelete={persistDelete}
            toggleSelect={toggleSelect}
            newItem={newItem}
            setNewItem={setNewItem}
            calcularVendaSug={calcularVendaSug}
            addItem={addItem}
            message={message}
            viewItem={viewItem}
            flashMsg={flashMsg}
          />
        )}
        {tab === 'encomendas' && <div></div>}
        {tab === 'encomendas' && (
          <div>
            <div className="actions-bar" style={{ marginBottom:8 }}>
              <button className="btn" onClick={()=>{ setNovaEncomendaTipo('registro'); setShowNovaEncomenda(true); }}>Nova Encomenda</button>
              <button className="btn btn-outline" onClick={loadEncomendas}>Recarregar</button>
              <span>{encomendas.length} encomendas</span>
            </div>
            {loadingEncomendas ? <div>Carregando encomendas...</div> : (
              <div className="table-wrapper maxh-60vh">
                <table className="table-default" style={{ fontSize:13 }}>
                  <thead className="thead-sticky">
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Telefone</th>
                      <th>Itens</th>
                      <th>Total (R$)</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {encomendas.map(e => (
                      <tr key={e.id} style={{ background: e.status==='cancelada' ? '#ffecec' : undefined }}>
                        <td>{e.id}</td>
                        <td>{e.status}</td>
                        <td>{new Date(e.data).toLocaleString('pt-BR')}</td>
                        <td>{e.nome_cliente || '-'}</td>
                        <td>{e.telefone_cliente || '-'}</td>
                        <td className="text-right">{e.itens_count}</td>
                        <td className="text-right">{Number(e.total_geral||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                        <td style={{ whiteSpace:'nowrap', display:'flex', gap:6 }}>
                          <button className="btn btn-icon btn-outline" title="Ver" aria-label="Ver" onClick={()=> abrirVisualizacaoEncomenda(e)}>
                            <span role="img" aria-hidden="true">👁️</span>
                          </button>
                          <button className="btn btn-icon" title="Editar" aria-label="Editar" onClick={()=> editarEncomenda(e)}>
                            <span role="img" aria-hidden="true">✏️</span>
                          </button>
                          <button className="btn btn-icon btn-danger" title="Excluir" aria-label="Excluir" onClick={()=> excluirEncomenda(e)}>
                            <span role="img" aria-hidden="true">🗑️</span>
                          </button>
                          <button className="btn btn-outline" title="Gerar PDF" aria-label="Gerar PDF" onClick={()=> { setViewEncomenda(e); carregarItensEncomenda(e.id); setTimeout(()=> imprimirEncomenda(e), 200); }}>PDF</button>
                        </td>
                      </tr>
                    ))}
                    {encomendas.length===0 && (
                      <tr><td colSpan={7} style={{ padding:16, textAlign:'center', color:'#666' }}>Nenhuma encomenda.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {viewEncomenda && (
              <div className="modal-overlay">
                <div className="modal-panel modal-md maxh-85vh overflow-auto">
                  <div id='print-area-encomenda'>
                    <h3 style={{ marginTop:0 }}>Encomenda #{viewEncomenda.id}</h3>
                    <p style={{ margin:'4px 0' }}>Data: {new Date(viewEncomenda.data).toLocaleString('pt-BR')}</p>
                    <p style={{ margin:'4px 0' }}>Status: {viewEncomenda.status}</p>
                    <p style={{ margin:'4px 0' }}>Cliente: {viewEncomenda.nome_cliente || '-'}</p>
                    <p style={{ margin:'4px 0' }}>Telefone: {viewEncomenda.telefone_cliente || '-'}</p>
                    <p style={{ margin:'4px 0' }}>Observação: {viewEncomenda.observacao || '-'}</p>
                    <p style={{ margin:'4px 0' }}>Total (R$): <strong>{Number(viewEncomenda.total_geral||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></p>
                    <h4 style={{ margin:'12px 0 4px' }}>Itens</h4>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr style={{ background:'#f5f5f5' }}>
                          <th style={{ textAlign:'left', padding:4, border:'1px solid #ddd' }}>Código</th>
                          <th style={{ textAlign:'left', padding:4, border:'1px solid #ddd' }}>Peça</th>
                          <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Qtd</th>
                          <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Preço</th>
                          <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewEncomendaItens.map(it => (
                          <tr key={it.id}>
                            <td style={{ padding:4, border:'1px solid #eee' }}>{it.codigo||'-'}</td>
                            <td style={{ padding:4, border:'1px solid #eee' }}>{it.nome||'-'}</td>
                            <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.quantidade).toLocaleString('pt-BR')}</td>
                            <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.preco_unit).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                            <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                          </tr>
                        ))}
                        {viewEncomendaItens.length===0 && (
                          <tr><td colSpan={5} style={{ padding:8, textAlign:'center', color:'#666' }}>Carregando itens...</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="actions-right" style={{ marginTop:16 }}>
                    <button className="btn" onClick={()=> imprimirEncomenda(viewEncomenda)}>Imprimir / PDF</button>
                    <button className="btn btn-outline" onClick={()=> setViewEncomenda(null)}>Fechar</button>
                  </div>
                </div>
              </div>
            )}
            {showNovaEncomenda && (
              <div className="modal-overlay">
                <div className="modal-panel modal-lg maxh-90vh overflow-auto">
                  <h3 style={{ marginTop:0 }}>{editandoEncomendaId? 'Editar Encomenda #'+editandoEncomendaId : 'Nova Encomenda (Registro)'}</h3>
                  <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:12 }}>
                    <label style={{ flex:'1 1 200px', fontSize:12, display:'flex', flexDirection:'column' }}>Nome do Cliente
                      <input className="input" value={novaEncomendaDados.nome_cliente} onChange={e=> setNovaEncomendaDados(v=>({...v, nome_cliente:e.target.value}))} />
                    </label>
                    <label style={{ flex:'1 1 160px', fontSize:12, display:'flex', flexDirection:'column' }}>Telefone
                      <input className="input" value={novaEncomendaDados.telefone_cliente} onChange={e=> setNovaEncomendaDados(v=>({...v, telefone_cliente:e.target.value}))} />
                    </label>
                    <label style={{ flex:'1 1 260px', fontSize:12, display:'flex', flexDirection:'column' }}>Observação
                      <input className="input" value={novaEncomendaDados.observacao} onChange={e=> setNovaEncomendaDados(v=>({...v, observacao:e.target.value}))} />
                    </label>
                    <label style={{ flex:'1 1 200px', fontSize:12, display:'flex', flexDirection:'column' }}>Status Inicial
                      <select className="select" value={novaEncomendaDados.status} onChange={e=> setNovaEncomendaDados(v=>({...v, status:e.target.value}))}>
                        {STATUS_OPCOES.map(s=> <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                  </div>
                  <div style={{ marginBottom:8, display:'flex', gap:8, alignItems:'center' }}>
                    <input className="input" placeholder='Filtrar peça por código/nome...' value={filtroPeca} onChange={e=> setFiltroPeca(e.target.value)} style={{ flex:1 }} />
                    <button className="btn" onClick={()=> {
                      // adiciona item vazio
                      setNovaEncomendaItens(itens => [...itens, { tempId:Date.now()+Math.random(), estoque_id:null, codigo:'', nome:'', qtd:1, preco:0, total:0 }]);
                    }}>Adicionar Linha</button>
                  </div>
                  <div className="table-wrapper maxh-300">
                    <table className="table-default" style={{ fontSize:12 }}>
                      <thead className="thead-sticky">
                        <tr>
                          <th style={{ padding:6 }}>Código</th>
                          <th style={{ padding:6 }}>Peça</th>
                          <th style={{ padding:6 }}>Qtd</th>
                          <th style={{ padding:6 }}>Preço (R$)</th>
                          <th style={{ padding:6 }}>Total (R$)</th>
                          <th style={{ padding:6 }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {novaEncomendaItens.map((it, idx) => {
                          // Geração de sugestões com base em código ou nome digitados
                          const termo = (it.codigo||it.nome||'').trim().toLowerCase();
                          let sugestoes = [];
                          if(termo.length >= 2){
                            sugestoes = estoque.filter(p => (
                              (p.codigo && p.codigo.toLowerCase().includes(termo)) ||
                              (p.nome && p.nome.toLowerCase().includes(termo))
                            )).slice(0,8);
                          }
                          const selecionarSugestao = (p) => {
                            setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId ? {
                              ...x,
                              estoque_id: p.id,
                              codigo: p.codigo||'',
                              nome: p.nome||'',
                              preco: Number(p.venda_cons)||0,
                              qtd: x.qtd || 1,
                              total: (x.qtd || 1) * (Number(p.venda_cons)||0)
                            } : x));
                          };
                          return (
                            <tr key={it.tempId} style={{ background: idx%2?'#fafafa':'#fff' }}>
                              <td style={{ padding:4, position:'relative' }}>
                                <input className="input"
                                  style={{ width:100 }}
                                  value={it.codigo}
                                  placeholder='Código'
                                  onChange={e=> {
                                    const val = e.target.value; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, codigo:val } : x));
                                  }}
                                />
                              </td>
                              <td style={{ padding:4, position:'relative' }}>
                                <input className="input"
                                  style={{ width:220 }}
                                  value={it.nome}
                                  placeholder='Nome da peça'
                                  onChange={e=> {
                                    const val = e.target.value; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, nome:val } : x));
                                  }}
                                />
                                {sugestoes.length>0 && (
                                  <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:10, background:'#fff', border:'1px solid #ccc', maxHeight:160, overflowY:'auto', fontSize:11, boxShadow:'0 2px 6px rgba(0,0,0,0.15)' }}>
                                    {sugestoes.map(p => (
                                      <div key={p.id} onMouseDown={()=> selecionarSugestao(p)} style={{ padding:'4px 6px', cursor:'pointer', display:'flex', gap:6 }}>
                                        <span style={{ minWidth:70, fontFamily:'monospace' }}>{p.codigo}</span>
                                        <span style={{ flex:1 }}>{p.nome}</span>
                                        <span style={{ color:'#555' }}>R$ {Number(p.venda_cons||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
                                      </div>
                                    ))}
                                    {sugestoes.length===0 && <div style={{ padding:6, color:'#666' }}>Sem resultados</div>}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding:4 }}>
                                <input className="input" type='number' style={{ width:70, textAlign:'right' }} value={it.qtd} onChange={e=> {
                                  const qtd = Number(e.target.value)||0; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, qtd, total: qtd * x.preco } : x));
                                }} />
                              </td>
                              <td style={{ padding:4 }}>
                                <input className="input" type='number' style={{ width:90, textAlign:'right' }} value={it.preco} onChange={e=> {
                                  const preco = Number(e.target.value)||0; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, preco, total: preco * x.qtd } : x));
                                }} />
                              </td>
                              <td style={{ padding:4, textAlign:'right', fontWeight:600 }}>
                                {Number(it.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
                              </td>
                              <td style={{ padding:4 }}>
                                <button className="btn btn-danger" onClick={()=> setNovaEncomendaItens(arr => arr.filter(x=> x.tempId!==it.tempId))}>Remover</button>
                              </td>
                            </tr>
                          );
                        })}
                        {novaEncomendaItens.length===0 && (
                          <tr><td colSpan={6} style={{ padding:16, textAlign:'center', color:'#666' }}>Nenhum item adicionado.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <strong>Total da Encomenda: R$ {novaEncomendaItens.reduce((acc,i)=> acc + (i.total||0),0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
                    <div className="actions-right">
                      <button className="btn btn-outline" onClick={()=> { setShowNovaEncomenda(false); setNovaEncomendaItens([]); }}>Cancelar</button>
                      <button className="btn" disabled={novaEncomendaItens.length===0 || !novaEncomendaDados.nome_cliente} onClick={()=> {
                        runBusy('Salvando encomenda...', async () => new Promise((resolve) => {
                          try {
                            const db = new sqlite3.Database(path.join(getBaseDir(), 'estoquepro.db'));
                            const totalGeral = novaEncomendaItens.reduce((acc,i)=> acc + (i.total||0),0);
                            if(editandoEncomendaId){
                              db.run(`UPDATE encomendas SET status=?, observacao=?, nome_cliente=?, telefone_cliente=?, total_itens=?, total_geral=? WHERE id=?`, [
                                novaEncomendaDados.status, novaEncomendaDados.observacao, novaEncomendaDados.nome_cliente, novaEncomendaDados.telefone_cliente, novaEncomendaItens.length, totalGeral, editandoEncomendaId
                              ], (err)=> {
                                if(err){ console.error(err); flashMsg('Erro ao atualizar','error'); resolve(); return; }
                                db.run('DELETE FROM encomenda_itens WHERE encomenda_id=?', [editandoEncomendaId], (err2)=> {
                                  if(err2) console.error(err2);
                                  let pending = novaEncomendaItens.length; if(pending===0) return finalizeUpd();
                                  novaEncomendaItens.forEach(it => {
                                    db.run(`INSERT INTO encomenda_itens (encomenda_id, estoque_id, quantidade, preco_unit, total, codigo, nome) VALUES (?,?,?,?,?,?,?)`, [
                                      editandoEncomendaId, it.estoque_id||0, it.qtd, it.preco, it.total, it.codigo, it.nome
                                    ], (errI)=> { if(errI) console.error(errI); pending--; if(pending===0) finalizeUpd(); });
                                  });
                                  function finalizeUpd(){
                                    loadEncomendas();
                                    flashMsg('Encomenda atualizada.');
                                    setShowNovaEncomenda(false);
                                    setNovaEncomendaDados({ nome_cliente:'', telefone_cliente:'', observacao:'', status:'AGUARDANDO PEÇA' });
                                    setNovaEncomendaItens([]);
                                    setEditandoEncomendaId(null);
                                    doBackup('change');
                                    resolve();
                                  }
                                });
                              });
                            } else {
                              db.run(`INSERT INTO encomendas (tipo, data, status, observacao, nome_cliente, telefone_cliente, total_itens, total_geral) VALUES (?,?,?,?,?,?,?,?)`, [
                                'registro', new Date().toISOString(), novaEncomendaDados.status, novaEncomendaDados.observacao, novaEncomendaDados.nome_cliente, novaEncomendaDados.telefone_cliente, novaEncomendaItens.length, totalGeral
                              ], function(err){
                                if(err){ console.error(err); flashMsg('Erro ao salvar encomenda','error'); resolve(); return; }
                                const encomendaId = this.lastID;
                                let pending = novaEncomendaItens.length;
                                if(pending===0) { return finalizeNew(); }
                                novaEncomendaItens.forEach(it => {
                                  db.run(`INSERT INTO encomenda_itens (encomenda_id, estoque_id, quantidade, preco_unit, total, codigo, nome) VALUES (?,?,?,?,?,?,?)`, [
                                    encomendaId, it.estoque_id || 0, it.qtd, it.preco, it.total, it.codigo, it.nome
                                  ], (err2)=> { if(err2) console.error(err2); pending--; if(pending===0) finalizeNew(); });
                                });
                                function finalizeNew(){
                                  loadEncomendas();
                                  flashMsg('Encomenda registrada.');
                                  setShowNovaEncomenda(false);
                                  setNovaEncomendaDados({ nome_cliente:'', telefone_cliente:'', observacao:'', status:'AGUARDANDO PEÇA' });
                                  setNovaEncomendaItens([]);
                                  doBackup('change');
                                  resolve();
                                }
                              });
                            }
                          } catch(e){ console.error(e); flashMsg('Falha na persistência','error'); resolve(); }
                        }));
                      }}>Salvar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'vales' && <div>Em breve: Vales</div>}
        {tab === 'vales' && (
          <div>
            <div className="actions-bar" style={{ marginBottom:8 }}>
              <button className="btn" onClick={abrirNovoVale}>Novo Vale</button>
              <button className="btn btn-outline" onClick={loadVales}>Recarregar</button>
              <span>{vales.length} vales</span>
              <input className="input" placeholder='Filtrar por cliente, status...' value={filtroVales} onChange={e=> setFiltroVales(e.target.value)} />
            </div>
            <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:12 }}>
              <div style={{ flex:'1 1 280px', minWidth:260 }}>
                <h4>Clientes Fixos</h4>
                <div className="card" style={{ padding:8, maxHeight:220, overflow:'auto' }}>
                  {clientesVale.map(c => (
                    <div key={c.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px dashed #eee' }}>
                      <div>
                        <div style={{ fontWeight:600 }}>{c.nome}</div>
                        <div style={{ fontSize:12, color:'#555' }}>{c.telefone}</div>
                        {c.cpf && <div style={{ fontSize:11, color:'#777' }}>CPF: {c.cpf}</div>}
                        {c.endereco && <div style={{ fontSize:11, color:'#777' }}>{c.endereco}</div>}
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-icon btn-outline" title="Editar" aria-label="Editar" onClick={()=> openEditarClienteModal(c)}>
                          <span role="img" aria-hidden="true">✏️</span>
                        </button>
                        <button className="btn btn-icon btn-danger" title="Excluir" aria-label="Excluir" onClick={()=> excluirClienteVale(c.id)}>
                          <span role="img" aria-hidden="true">🗑️</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {clientesVale.length===0 && <div style={{ color:'#666' }}>Nenhum cliente.</div>}
                </div>
                <div style={{ marginTop:8, display:'flex', gap:8 }}>
                  <button className="btn" onClick={openNovoClienteModal}>Novo Cliente</button>
                </div>
              </div>
              <div style={{ flex:'2 1 520px', minWidth:380 }}>
                <h4>Vales</h4>
                {loadingVales ? <div>Carregando...</div> : (
                  <div className="table-wrapper" style={{ maxHeight:'55vh' }}>
                    <table className="table-default" style={{ fontSize:13 }}>
                      <thead className="thead-sticky">
                        <tr>
                          <th style={{ padding:6 }}>ID</th>
                          <th style={{ padding:6 }}>Data</th>
                          <th style={{ padding:6 }}>Cliente</th>
                          <th style={{ padding:6 }}>Status</th>
                          <th style={{ padding:6, textAlign:'right' }}>Total (R$)</th>
                          <th style={{ padding:6 }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vales.filter(v => {
                          const q = (filtroVales||'').trim().toLowerCase();
                          if(!q) return true;
                          return (v.cliente_nome||'').toLowerCase().includes(q) || (v.status||'').toLowerCase().includes(q) || String(v.id).includes(q);
                        }).map(v => (
                          <tr key={v.id}>
                            <td style={{ padding:6 }}>{v.id}</td>
                            <td style={{ padding:6 }}>{new Date(v.data).toLocaleString('pt-BR')}</td>
                            <td style={{ padding:6 }}>{v.cliente_nome || '-'}</td>
                            <td style={{ padding:6 }}>{v.status}</td>
                            <td style={{ padding:6, textAlign:'right' }}>{Number(v.total_geral||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                            <td style={{ padding:6, display:'flex', gap:6 }}>
                              <button className="btn btn-icon btn-outline" title="Ver" aria-label="Ver" onClick={()=> abrirVisualizacaoVale(v)}>
                                <span role="img" aria-hidden="true">👁️</span>
                              </button>
                              <button className="btn btn-icon" title="Editar" aria-label="Editar" onClick={()=> editarVale(v)}>
                                <span role="img" aria-hidden="true">✏️</span>
                              </button>
                              <button className="btn btn-outline" onClick={()=> duplicarVale(v)}>Duplicar</button>
                              {v.status==='ABERTO' && <button className="btn" onClick={()=> quitarVale(v)}>Quitar</button>}
                              {v.status==='ABERTO' && <button className="btn btn-outline" onClick={()=> cancelarVale(v)}>Cancelar</button>}
                              <button className="btn btn-icon btn-danger" title="Excluir" aria-label="Excluir" onClick={()=> excluirVale(v)}>
                                <span role="img" aria-hidden="true">🗑️</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                        {vales.length===0 && <tr><td colSpan={6} style={{ padding:12, textAlign:'center', color:'#666' }}>Sem vales.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {showNovoVale && (
              <div className="modal-overlay">
                <div className="modal-panel modal-xl maxh-92vh overflow-auto" style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <h3 style={{ margin:'0 0 4px' }}>{editandoValeId? `Editar Vale #${editandoValeId}` : 'Novo Vale'}</h3>
                  <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                    <div style={{ flex:'2 1 600px', minWidth:520 }}>
                      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:8 }}>
                        <div style={{ display:'flex', flexDirection:'column', flex:'2 1 320px', gap:4 }}>
                          <label style={{ fontSize:12, fontWeight:600 }}>Cliente Fixo</label>
                          <div style={{ display:'flex', gap:4 }}>
                            <input className="input" placeholder='Filtrar...' value={filtroClientesVale} onChange={e=> setFiltroClientesVale(e.target.value)} style={{ flex:'1 1 140px' }} />
                            <select className="select" style={{ flex:'2 1 220px' }} value={novoVale.cliente_id||''} onChange={e=> setNovoVale(v=> ({...v, cliente_id: e.target.value? Number(e.target.value) : null }))}>
                              <option value=''>— Selecione —</option>
                              {clientesVale.filter(c => {
                                const q = filtroClientesVale.trim().toLowerCase(); if(!q) return true; return (c.nome||'').toLowerCase().includes(q) || String(c.telefone||'').includes(q);
                              }).map(c=> <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          </div>
                        </div>
                        <label style={{ flex:'1 1 200px', display:'flex', flexDirection:'column', fontSize:12 }}>Observação
                          <input className="input" value={novoVale.observacao} onChange={e=> setNovoVale(v=> ({...v, observacao:e.target.value}))} />
                        </label>
                        <label style={{ flex:'0 0 120px', display:'flex', flexDirection:'column', fontSize:12 }}>Ajuste (%)
                          <input className="input" type='number' value={novoVale.ajuste_percent} onChange={e=> setNovoVale(v=> ({...v, ajuste_percent: Number(e.target.value)||0 }))} />
                        </label>
                      </div>
                      <div style={{ marginBottom:8 }}>
                        <button className="btn" onClick={addLinhaVale}>Adicionar Linha</button>
                      </div>
                      <div className="table-wrapper maxh-320">
                        <table className="table-default" style={{ fontSize:12 }}>
                          <thead className="thead-sticky">
                            <tr>
                              <th style={{ padding:6 }}>Código</th>
                              <th style={{ padding:6 }}>Peça</th>
                              <th style={{ padding:6 }}>Qtd</th>
                              <th style={{ padding:6 }}>Preço</th>
                              <th style={{ padding:6 }}>Total</th>
                              <th style={{ padding:6 }}>Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {novoVale.itens.map((it, idx) => {
                          const termo = (it.codigo||it.nome||'').trim().toLowerCase();
                          let sugestoes = [];
                          if(termo.length>=2){
                            sugestoes = estoque.filter(p => (
                              (p.codigo && p.codigo.toLowerCase().includes(termo)) || (p.nome && p.nome.toLowerCase().includes(termo))
                            )).slice(0,8);
                          }
                          const selecionar = (p) => setNovoVale(v => ({...v, itens: v.itens.map(x => x.id===it.id ? ({ ...x, estoque_id:p.id, codigo:p.codigo||'', nome:p.nome||'', preco: Number(p.venda_cons)||0, qtd: x.qtd||1, total: (x.qtd||1) * (Number(p.venda_cons)||0) }) : x)}));
                          const invalido = !it.nome || !it.codigo;
                          return (
                            <tr key={it.id} style={{ background: idx%2?'#fafafa':'#fff', outline: invalido? '2px solid #f90':'none', outlineOffset: -2 }}>
                              <td style={{ padding:4 }}>
                                <input className="input" style={{ width:100 }} value={it.codigo} onChange={e=> setNovoVale(v=> ({...v, itens: v.itens.map(x=> x.id===it.id? ({...x, codigo:e.target.value}) : x)}))} />
                              </td>
                              <td style={{ padding:4, position:'relative' }}>
                                <input className="input" style={{ width:240 }} value={it.nome} onChange={e=> setNovoVale(v=> ({...v, itens: v.itens.map(x=> x.id===it.id? ({...x, nome:e.target.value}) : x)}))} />
                                {sugestoes.length>0 && (
                                  <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:10, background:'#fff', border:'1px solid #ccc', maxHeight:160, overflowY:'auto', fontSize:11, boxShadow:'0 2px 6px rgba(0,0,0,0.15)' }}>
                                    {sugestoes.map(p => (
                                      <div key={p.id} onMouseDown={()=> selecionar(p)} style={{ padding:'4px 6px', cursor:'pointer', display:'flex', gap:6, alignItems:'center' }}>
                                        <span style={{ minWidth:70, fontFamily:'monospace' }}>{p.codigo}</span>
                                        <span style={{ flex:1 }}>{p.nome}</span>
                                        <span style={{ color:'#555', whiteSpace:'nowrap' }}>Disp: {( (p.qt_estoque||0) - (p.reservado||0) ).toLocaleString('pt-BR')}</span>
                                        <span style={{ color:'#555', whiteSpace:'nowrap' }}>R$ {Number(p.venda_cons||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding:4 }}>
                                <input className="input" type='number' style={{ width:70, textAlign:'right' }} value={it.qtd} onChange={e=> setNovoVale(v=> ({...v, itens: v.itens.map(x=> x.id===it.id? ({...x, qtd: Number(e.target.value)||0, total:(Number(e.target.value)||0) * (x.preco||0)}) : x)}))} />
                              </td>
                              <td style={{ padding:4 }}>
                                <input className="input" type='number' style={{ width:90, textAlign:'right' }} value={it.preco} onChange={e=> setNovoVale(v=> ({...v, itens: v.itens.map(x=> x.id===it.id? ({...x, preco: Number(e.target.value)||0, total: (Number(e.target.value)||0) * (x.qtd||0)}) : x)}))} />
                              </td>
                              <td style={{ padding:4, textAlign:'right', fontWeight:600 }}>{Number(it.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                              <td style={{ padding:4 }}><button className="btn btn-danger" onClick={()=> setNovoVale(v=> ({...v, itens: v.itens.filter(x=> x.id!==it.id)}))}>Remover</button></td>
                            </tr>
                          );
                            })}
                            {novoVale.itens.length===0 && <tr><td colSpan={6} style={{ padding:12, textAlign:'center', color:'#666' }}>Sem itens.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      {(() => { const subtotal = novoVale.itens.reduce((a,i)=> a + (i.total||0), 0); const ajuste = (subtotal * (Number(novoVale.ajuste_percent)||0))/100; const total = subtotal + ajuste; return (
                      <div style={{ marginTop:10, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
                        <div style={{ display:'flex', flexDirection:'column', fontSize:12, lineHeight:1.3 }}>
                          <span>Subtotal: <strong>R$ {subtotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>
                          <span>Ajuste ({Number(novoVale.ajuste_percent)||0}%): <strong style={{ color: ajuste>=0?'#070':'#900' }}>{(ajuste>=0?'+':'') + ajuste.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>
                          <span style={{ fontSize:13 }}>Total: <strong>R$ {total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          <button className="btn btn-outline" onClick={()=> setShowNovoVale(false)}>Fechar</button>
                          <button className="btn" disabled={(novoVale.cliente_id==null) || novoVale.itens.length===0} onClick={salvarVale}>Salvar</button>
                        </div>
                      </div>
                      ); })()}
                    </div>
                    <div style={{ flex:'1 1 320px', minWidth:300 }}>
                      <h4 style={{ margin:'0 0 6px' }}>Pré-visualização</h4>
                      <div id='preview-vale' className="card overflow-auto" style={{ maxHeight:470 }}>
                        <div style={{ fontSize:12, marginBottom:6, display:'flex', alignItems:'center', gap:10 }}>
                          <img src={getLogoPath(logoCor)} alt='Logo' style={{ height:38, background:'#fff', borderRadius:4, border:'1px solid #eee', padding:2 }} onClick={()=>setLogoCor(c=>c==='preto'?'branco':'preto')} title='Clique para alternar cor da logo' />
                          <div>
                            <strong>{empresa.nome}</strong><br />
                            <span style={{ color:'#555' }}>{empresa.ramo}</span><br />
                            <span style={{ color:'#555' }}>{empresa.cnpj}</span><br />
                            <span style={{ color:'#555' }}>{empresa.ie}</span><br />
                            <span style={{ color:'#555' }}>{empresa.endereco}</span><br />
                            <span style={{ color:'#555' }}>{empresa.linhaTelefone}</span><br />
                            {empresa.site && <span style={{ color:'#555' }}>{empresa.site}</span>}
                          </div>
                        </div>
                        <div style={{ fontSize:12, marginBottom:6 }}>
                          <div><strong>Cliente:</strong> { (clientesVale.find(c=> c.id===novoVale.cliente_id)||{}).nome || '-' }</div>
                          { (clientesVale.find(c=> c.id===novoVale.cliente_id)||{}).cpf && (
                            <div><strong>CPF:</strong> {(clientesVale.find(c=> c.id===novoVale.cliente_id)||{}).cpf}</div>
                          )}
                          { (clientesVale.find(c=> c.id===novoVale.cliente_id)||{}).endereco && (
                            <div><strong>Endereço:</strong> {(clientesVale.find(c=> c.id===novoVale.cliente_id)||{}).endereco}</div>
                          )}
                          <div><strong>Data:</strong> { new Date().toLocaleString('pt-BR') }</div>
                          <div><strong>Status:</strong> { novoVale.status }</div>
                          {novoVale.observacao && <div><strong>Obs:</strong> {novoVale.observacao}</div>}
                        </div>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                          <thead>
                            <tr style={{ background:'#e9e9e9' }}>
                              <th style={{ textAlign:'left', padding:4, border:'1px solid #ddd' }}>Código</th>
                              <th style={{ textAlign:'left', padding:4, border:'1px solid #ddd' }}>Peça</th>
                              <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Qtd</th>
                              <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Preço</th>
                              <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {novoVale.itens.map(it => (
                              <tr key={it.id}>
                                <td style={{ padding:4, border:'1px solid #eee' }}>{it.codigo||'-'}</td>
                                <td style={{ padding:4, border:'1px solid #eee' }}>{it.nome||'-'}</td>
                                <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.qtd||0).toLocaleString('pt-BR')}</td>
                                <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.preco||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                                <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                              </tr>
                            ))}
                            {novoVale.itens.length===0 && (
                              <tr><td colSpan={5} style={{ padding:8, textAlign:'center', color:'#777' }}>Sem itens.</td></tr>
                            )}
                          </tbody>
                        </table>
                        {(() => { const subtotal = novoVale.itens.reduce((a,i)=> a + (i.total||0), 0); const ajuste = (subtotal * (Number(novoVale.ajuste_percent)||0))/100; const total = subtotal + ajuste; return (
                          <div style={{ textAlign:'right', marginTop:6, fontSize:12 }}>
                            <div>Subtotal: R$ {subtotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                            <div>Ajuste ({Number(novoVale.ajuste_percent)||0}%): {(ajuste>=0?'+':'') + ajuste.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                            <strong style={{ display:'block', marginTop:2 }}>Total: R$ {total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
                          </div>
                        ); })()}
                        <div style={{ marginTop:20 }}>
                          <div style={{ height:50, borderBottom:'1px solid #000', width:220 }}></div>
                          <div style={{ fontSize:10, textAlign:'center', marginTop:4 }}>Assinatura</div>
                        </div>
                      </div>
                      <div style={{ marginTop:8, display:'flex', gap:8 }}>
                        <button className="btn" onClick={()=> {
                          const area = document.getElementById('preview-vale');
                          if(!area) return;
                          const w = window.open('', 'PRINT', 'height=800,width=900');
                          if(!w) return;
                          w.document.write('<html><head><title>Prévia Vale</title><style>body{font-family:Arial;font-size:11px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:4px;} h2{margin:4px 0;}</style></head><body>');
                          w.document.write(area.innerHTML);
                          w.document.write('</body></html>');
                          w.document.close(); w.focus(); setTimeout(()=> w.print(), 200);
                        }}>Imprimir Rascunho</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {viewVale && (
              <div className="modal-overlay">
                <div className="modal-panel modal-w-680 maxh-90vh overflow-auto">
                  <div id='print-area-vale'>
                    <h2 style={{ marginTop:0 }}>Vale #{viewVale.id}</h2>
                    <div style={{ marginBottom:8 }}>
                      <div><strong>{empresa.nome}</strong></div>
                      <div style={{ fontSize:12 }}>{empresa.cnpj} — {empresa.endereco} — {empresa.telefone}</div>
                    </div>
                    <div style={{ margin:'8px 0' }}>
                      <div><strong>Cliente:</strong> {viewVale.cliente_nome || '-'}</div>
                      {viewVale.cliente_cpf && <div style={{ fontSize:12 }}><strong>CPF:</strong> {viewVale.cliente_cpf}</div>}
                      {viewVale.cliente_endereco && <div style={{ fontSize:12 }}><strong>Endereço:</strong> {viewVale.cliente_endereco}</div>}
                      <div style={{ fontSize:12 }}><strong>Data:</strong> {new Date(viewVale.data).toLocaleString('pt-BR')}</div>
                      <div style={{ fontSize:12 }}><strong>Status:</strong> {viewVale.status}</div>
                    </div>
                    <h4>Itens</h4>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr style={{ background:'#f5f5f5' }}>
                          <th style={{ textAlign:'left', padding:4, border:'1px solid #ddd' }}>Código</th>
                          <th style={{ textAlign:'left', padding:4, border:'1px solid #ddd' }}>Peça</th>
                          <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Qtd</th>
                          <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Preço</th>
                          <th style={{ textAlign:'right', padding:4, border:'1px solid #ddd' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewValeItens.length===0 && (
                          <tr><td colSpan={5} style={{ padding:8, textAlign:'center' }}>Carregando...</td></tr>
                        )}
                        {viewValeItens.map(it => (
                          <tr key={it.id}>
                            <td style={{ padding:4, border:'1px solid #eee' }}>{it.codigo||'-'}</td>
                            <td style={{ padding:4, border:'1px solid #eee' }}>{it.nome||'-'}</td>
                            <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.quantidade).toLocaleString('pt-BR')}</td>
                            <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.preco_unit).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                            <td style={{ padding:4, border:'1px solid #eee', textAlign:'right' }}>{Number(it.total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ textAlign:'right', marginTop:8 }}>
                      <strong>Total do Vale: R$ {Number(viewVale.total_geral||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
                    </div>
                    <div style={{ marginTop:16 }}>
                      <div style={{ height:60, borderBottom:'1px solid #000', width:280 }}></div>
                      <div style={{ fontSize:12 }}>Assinatura do Cliente</div>
                    </div>
                  </div>
                  <div className="actions-right" style={{ marginTop:12 }}>
                    <button className="btn" onClick={()=> imprimirVale(viewVale)}>Imprimir / PDF</button>
                    <button className="btn btn-outline" onClick={()=> setViewVale(null)}>Fechar</button>
                  </div>
                </div>
              </div>
            )}
            {showClienteModal && (
              <div className="modal-overlay">
                <div className="modal-panel modal-sm">
                  <h3 style={{ marginTop:0 }}>{clienteForm.id? 'Editar Cliente' : 'Novo Cliente'}</h3>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
                    <label style={{ display:'flex', flexDirection:'column', fontSize:12 }}>Nome completo
                      <input className="input" value={clienteForm.nome} onChange={e=> setClienteForm(v=> ({...v, nome:e.target.value}))} />
                    </label>
                    <label style={{ display:'flex', flexDirection:'column', fontSize:12 }}>CPF
                      <input className="input" value={clienteForm.cpf} onChange={e=> setClienteForm(v=> ({...v, cpf:e.target.value}))} />
                    </label>
                    <label style={{ display:'flex', flexDirection:'column', fontSize:12 }}>Telefone
                      <input className="input" value={clienteForm.telefone} onChange={e=> setClienteForm(v=> ({...v, telefone:e.target.value}))} />
                    </label>
                    <label style={{ display:'flex', flexDirection:'column', fontSize:12 }}>Endereço
                      <input className="input" value={clienteForm.endereco} onChange={e=> setClienteForm(v=> ({...v, endereco:e.target.value}))} />
                    </label>
                    <label style={{ display:'flex', flexDirection:'column', fontSize:12 }}>Observação
                      <input className="input" value={clienteForm.observacao} onChange={e=> setClienteForm(v=> ({...v, observacao:e.target.value}))} />
                    </label>
                    {clienteForm.id && (
                      <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                        <input type='checkbox' checked={!!clienteForm.ativo} onChange={e=> setClienteForm(v=> ({...v, ativo: e.target.checked?1:0}))} /> Ativo
                      </label>
                    )}
                  </div>
                  <div className="actions-right" style={{ marginTop:12 }}>
                    <button className="btn btn-outline" onClick={()=> setShowClienteModal(false)}>Cancelar</button>
                    <button className="btn" onClick={async ()=> {
                      if(!clienteForm.nome.trim()){ flashMsg('Informe o nome completo do cliente','error'); return; }
                      await salvarClienteVale(clienteForm);
                      setShowClienteModal(false);
                    }}>Salvar</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'calculadora' && (
          <div className="calc-wrapper">
            <div className="calc-form-container">
              <div className="calc-form">
                
                <div className="calc-row">
                  <div className="calc-field">
                    <label>Marketplace</label>
                    <select className="select" value={calc.marketplace} onChange={e=> setCalc(c=> ({...c, marketplace: e.target.value }))}>
                      <option value="">Nenhum</option>
                      <option value="Shopee">Shopee</option>
                      <option value="Olist">Olist</option>
                      <option value="Magalu">Magalu</option>
                      <option value="Americanas">Americanas</option>
                      <option value="Mercado Livre">Mercado Livre</option>
                    </select>
                  </div>
                  <div className="calc-field">
                    <label>Preço de Compra (R$)</label>
                    <input 
                      type="number" 
                      value={calc.precoCompra} 
                      onChange={e => setCalc(c => ({...c, precoCompra: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>Base do Lucro</label>
                    <select className="select" value={calc.baseLucro} onChange={e=> setCalc(c=> ({...c, baseLucro: e.target.value }))}>
                      <option value="custo_produto">Custo do produto</option>
                      <option value="custo_total_base">Custo base (c/ impostos e frete)</option>
                    </select>
                  </div>
                  <div className="calc-field">
                    <label>Margem de Lucro (%)</label>
                    <input 
                      type="number" 
                      value={calc.margem} 
                      onChange={e => setCalc(c => ({...c, margem: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div className="calc-row">
                  <div className="calc-field">
                    <label>Tarifa Fixa (R$)</label>
                    <input 
                      type="number" 
                      value={calc.tarifaFixa} 
                      onChange={e => setCalc(c => ({...c, tarifaFixa: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>Subsídio Frete (R$)</label>
                    <input 
                      type="number" 
                      value={calc.subsidioFrete} 
                      onChange={e => setCalc(c => ({...c, subsidioFrete: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div className="calc-row">
                  <div className="calc-field">
                    <label>ICMS (%)</label>
                    <input 
                      type="number" 
                      value={calc.icms} 
                      onChange={e => setCalc(c => ({...c, icms: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>IPI (%)</label>
                    <input 
                      type="number" 
                      value={calc.ipi} 
                      onChange={e => setCalc(c => ({...c, ipi: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>PIS (%)</label>
                    <input 
                      type="number" 
                      value={calc.pis} 
                      onChange={e => setCalc(c => ({...c, pis: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>COFINS (%)</label>
                    <input 
                      type="number" 
                      value={calc.cofins} 
                      onChange={e => setCalc(c => ({...c, cofins: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div className="calc-row">
                  <div className="calc-field">
                    <label>Frete (R$)</label>
                    <input 
                      type="number" 
                      value={calc.frete} 
                      onChange={e => setCalc(c => ({...c, frete: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>Taxa Cartão (%)</label>
                    <input 
                      type="number" 
                      value={calc.taxaCartao} 
                      onChange={e => setCalc(c => ({...c, taxaCartao: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>Comissão Marketplace (%)</label>
                    <input 
                      type="number" 
                      value={calc.comissaoMarketplace} 
                      onChange={e => setCalc(c => ({...c, comissaoMarketplace: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                    <small style={{ color:'#666' }}>Se você selecionar um Marketplace, a comissão será aplicada pelo preset.</small>
                  </div>
                </div>

                <div className="calc-row">
                  <div className="calc-field">
                    <label>Imposto sobre Venda (%)</label>
                    <input 
                      type="number" 
                      value={calc.impostoVenda} 
                      onChange={e => setCalc(c => ({...c, impostoVenda: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                  <div className="calc-field">
                    <label>Promoção (%)</label>
                    <input 
                      type="number" 
                      value={calc.promocao} 
                      onChange={e => setCalc(c => ({...c, promocao: Number(e.target.value)}))}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div className="calc-results">
                  <h3>Resultado Final</h3>
                  <div className="calc-result-box">
                    <div className="result-item">
                      <span>Custo Total:</span>
                      <strong>R$ {calcResultados.custoTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div className="result-item">
                      <span>Lucro Desejado (R$):</span>
                      <strong>R$ {calcResultados.margemAplicada.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div className="result-item main-result">
                      <span>Preço de Venda:</span>
                      <strong>R$ {calcResultados.precoVenda.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div className="result-item">
                      <span>Lucro Final:</span>
                      <strong>R$ {calcResultados.detalhes.lucroFinalValor.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>
                    </div>
                  </div>
                  {calc.marketplace && (
                    <div style={{ marginTop:12, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:10, fontSize:13 }}>
                      <div style={{ fontWeight:600, marginBottom:6 }}>Detalhamento Marketplace ({calcResultados.detalhes.marketplace})</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(220px, 1fr))', gap:8 }}>
                        <div>Comissão (%): <strong>{(calcResultados.detalhes.comissaoPercent||0).toLocaleString('pt-BR')}</strong></div>
                        <div>Comissão (R$): <strong>{(calcResultados.detalhes.comissaoValor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                        <div style={{ gridColumn:'1 / span 2', marginTop:6, padding:8, background:'#eef2ff', border:'1px dashed #c7d2fe', borderRadius:6 }}>
                          <div style={{ fontWeight:600, marginBottom:4 }}>Taxas Fixas + Frete</div>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(140px, 1fr))', gap:6 }}>
                            <div>Taxa Fixa (R$): <strong>{(calcResultados.detalhes.taxaFixa||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                            <div>Subsídio Frete (R$): <strong>{(calcResultados.detalhes.subsidioFrete||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                            <div>Frete (R$): <strong>{(calcResultados.detalhes.frete||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                          </div>
                          <div style={{ marginTop:6 }}>Total Fixas: <strong style={{ fontSize:15 }}>R$ {calcResultados.detalhes.fixasTotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                        </div>
                        <div>Taxa Cartão (R$): <strong>{(calcResultados.detalhes.taxaCartaoValor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                        <div>Impostos (R$): <strong>{(calcResultados.detalhes.impostosValor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                        <div>Imposto sobre Venda (R$): <strong>{(calcResultados.detalhes.impostoVendaValor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                        <div>Promoção (R$): <strong>{(calcResultados.detalhes.promocaoValor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>
                      </div>
                      {calc.marketplace==='Mercado Livre' && (
                        <div style={{ marginTop:6, color:'#334155' }}>
                          Faixas de taxa por item (ML):
                          <ul style={{ margin:'4px 0 0 16px' }}>
                            <li><small>Menos de R$ 12,50 → 50% do preço</small></li>
                            <li><small>R$ 12,50 a R$ 29,00 → R$ 6,25</small></li>
                            <li><small>R$ 29,00 a R$ 50,00 → R$ 6,50</small></li>
                            <li><small>R$ 50,00 a R$ 78,99 → R$ 6,75</small></li>
                            <li><small>Subsídio frete vendedor R$ 25,00 quando CUSTO do produto ≥ R$ 79,00</small></li>
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="calc-actions">
                    <button className="btn-save" onClick={salvarCalculo}>
                      Salvar Cálculo
                    </button>
                    <button className="btn-history" onClick={() => console.log('Histórico')}>
                      Histórico ({calcHistorico.length})
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}
      </main>
      {busy && (
        <div className="busy-overlay">
          <div className="busy-box">
            <div className="spinner" />
            <div>{typeof busy === 'string' ? busy : 'Processando...'}</div>
            <div style={{ fontSize:11, opacity:.8 }}>Aguarde...</div>
          </div>
        </div>
      )}
    </div>
  );
}
