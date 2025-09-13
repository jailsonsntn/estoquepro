import React, { useState, useEffect, useMemo } from 'react';
const { initDB } = require('./db');
const { importPlanilha } = require('./importPlanilha');
const fs = window.require ? window.require('fs') : null;
const path = window.require ? window.require('path') : null;
const sqlite3 = window.require ? window.require('sqlite3').verbose() : null;

const TABS = [
  { key: 'estoque', label: 'Estoque' },
  { key: 'encomendas', label: 'Encomendas' },
  { key: 'vales', label: 'Vales' },
  { key: 'calculadora', label: 'Calculadora' },
  { key: 'relatorios', label: 'Relatórios' },
];

export default function App() {
  const [tab, setTab] = useState('estoque');
  const [estoque, setEstoque] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'codigo', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ codigo:'', nome:'', unidade:'', ncm:'', sit_trib:'', local_estoque:'', qt_estoque:0, c_medio:0, margem:0, venda_cons:0, custo_total:0, venda_total:0, travarVenda:false, ultimoCalculoAuto:true });
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  // Estado calculadora
  const [calc, setCalc] = useState({ precoCompra:0, icms:0, ipi:0, pis:0, cofins:0, frete:0, taxaCartao:0, comissaoMarketplace:0, margem:0 });
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

  const calcResultados = useMemo(()=>{
    const pc = Number(calc.precoCompra)||0;
    const icms = pc * (Number(calc.icms)||0)/100;
    const ipi = pc * (Number(calc.ipi)||0)/100;
    const pis = pc * (Number(calc.pis)||0)/100;
    const cofins = pc * (Number(calc.cofins)||0)/100;
    const frete = Number(calc.frete)||0;
    const base = pc + icms + ipi + pis + cofins + frete;
    const taxaCartao = base * (Number(calc.taxaCartao)||0)/100;
    const comissao = base * (Number(calc.comissaoMarketplace)||0)/100;
    const custoTotal = base + taxaCartao + comissao;
    const margemAplicada = custoTotal * (Number(calc.margem)||0)/100;
    const precoVenda = custoTotal + margemAplicada;
    return { custoTotal, margemAplicada, precoVenda };
  }, [calc]);

  const salvarCalculo = () => {
    const registro = { id: Date.now(), data: new Date().toISOString(), entrada: { ...calc }, resultado: calcResultados };
    setCalcHistorico(prev => [registro, ...prev.slice(0,49)]); // mantém últimos 50
    flashMsg('Cálculo salvo.');
  };

  useEffect(() => {
    // Inicializa banco e importa planilha se necessário
    initDB();
    const dbPath = path ? path.join(__dirname, '../estoquepro.db') : '';
    if (fs && fs.existsSync(dbPath)) {
      const db = new sqlite3.Database(dbPath);
      db.all('SELECT * FROM estoque', [], (err, rows) => {
        if (!err) setEstoque(rows);
        setLoading(false);
      });
    } else {
      // Importa planilha se banco não existe
      importPlanilha(path.join(__dirname, '../../DADOS.XLS'));
      setLoading(false);
    }
  }, []);

  const loadEncomendas = () => {
    setLoadingEncomendas(true);
    try {
      const db = new sqlite3.Database(path.join(__dirname, '../estoquepro.db'));
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
      const db = new sqlite3.Database(path.join(__dirname, '../estoquepro.db'));
      db.all('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [id], (err, rows)=> {
        if(!err) setViewEncomendaItens(rows||[]);
      });
    } catch(e){ console.error(e); }
  };

  const abrirVisualizacaoEncomenda = (e) => { setViewEncomenda(e); setViewEncomendaItens([]); carregarItensEncomenda(e.id); };
  const editarEncomenda = (e) => {
    try {
      const db = new sqlite3.Database(path.join(__dirname, '../estoquepro.db'));
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
      const db = new sqlite3.Database(path.join(__dirname, '../estoquepro.db'));
      db.run('DELETE FROM encomendas WHERE id = ?', [e.id], (err)=> {
        if(err){ console.error(err); flashMsg('Erro ao excluir','error'); return; }
        flashMsg('Encomenda excluída.');
        loadEncomendas();
        if(viewEncomenda && viewEncomenda.id===e.id){ setViewEncomenda(null); setViewEncomendaItens([]); }
      });
    } catch(ex){ console.error(ex); }
  };
  const imprimirEncomenda = (e) => {
    const area = document.getElementById('print-area-encomenda');
    if(!area) return;
    const w = window.open('', 'PRINT', 'height=600,width=800');
    if(!w) return;
    w.document.write('<html><head><title>Encomenda #'+e.id+'</title><style>body{font-family:Arial; font-size:12px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:4px;} h2{margin:4px 0;} .right{text-align:right;} .muted{color:#555;font-size:11px;}</style></head><body>');
    w.document.write(area.innerHTML);
    w.document.write('</body></html>');
    w.document.close();
    w.focus();
    setTimeout(()=> w.print(), 300);
  };

  useEffect(()=> { if(tab==='encomendas') loadEncomendas(); }, [tab]);

  // Helpers DB
  const getDB = () => {
    const dbPath = path.join(__dirname, '../estoquepro.db');
    return new sqlite3.Database(dbPath);
  };

  const persistUpdate = (id, field, value) => {
    const db = getDB();
    db.run(`UPDATE estoque SET ${field} = ? WHERE id = ?`, [value, id]);
  };

  const persistNew = (item) => {
    const db = getDB();
    db.run(`INSERT INTO estoque (codigo, nome, unidade, ncm, sit_trib, local_estoque, qt_estoque, c_medio, margem, venda_cons, custo_total, venda_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [item.codigo, item.nome, item.unidade, item.ncm, item.sit_trib, item.local_estoque, item.qt_estoque, item.c_medio, item.margem || 0, item.venda_cons, item.c_medio * item.qt_estoque, item.venda_cons * item.qt_estoque], function(){
        const id = this.lastID;
        setEstoque(prev => [...prev, { ...item, id, custo_total: item.c_medio * item.qt_estoque, venda_total: item.venda_cons * item.qt_estoque }]);
      });
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
    if (search.trim()) {
      const term = search.toLowerCase();
      rows = rows.filter(r => Object.values(r).some(v => String(v||'').toLowerCase().includes(term)));
    }
    rows.sort((a,b)=>{
      const fa = a[sort.field];
      const fb = b[sort.field];
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

  const startEdit = (id) => {
    setEditingId(id);
    const item = estoque.find(i=>i.id===id);
    setEditValues(item);
  };
  const cancelEdit = () => { setEditingId(null); setEditValues({}); };
  const saveEdit = () => {
    // recalcular campos derivados
    const updated = { ...editValues, custo_total: editValues.c_medio * editValues.qt_estoque, venda_total: editValues.venda_cons * editValues.qt_estoque };
    setEstoque(prev => prev.map(r => r.id === updated.id ? updated : r));
    ['qt_estoque','c_medio','margem','venda_cons','custo_total','venda_total','local_estoque','nome','ncm','sit_trib','unidade','codigo'].forEach(f=>persistUpdate(updated.id, f, updated[f]));
    setEditingId(null); setEditValues({});
    flashMsg('Item atualizado.');
  };

  const flashMsg = (text, type='info') => {
    setMessage({ text, type });
    setTimeout(()=>setMessage(null), 3000);
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
    const db = new sqlite3.Database(path.join(__dirname, '../estoquepro.db'));
    db.all('SELECT * FROM estoque', [], (err, rows) => {
      if(!err) setEstoque(rows);
    });
  };

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', padding: '8px', background: '#eee' }}>
        <h1 style={{ flex: 1 }}>EstoquePro</h1>
        <nav>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ margin: '0 4px', fontWeight: tab === t.key ? 'bold' : 'normal' }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main style={{ padding: 16 }}>
        {tab === 'estoque' && (
          loading ? <div>Carregando estoque...</div> : (
            <div>
              <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                <input placeholder="Buscar..." style={{ flex:1, minWidth:200 }} value={pendingSearch} onChange={e=>{ setPendingSearch(e.target.value); setPage(1); }} />
                <button onClick={()=>{ setShowAdd(true); }}>Adicionar</button>
                <button disabled={selected.size===0} onClick={deleteSelected}>Remover Selecionados ({selected.size})</button>
                <span>{filtered.length} itens</span>
              </div>
              <div style={{ overflowX:'auto', maxHeight:'60vh', border:'1px solid #ccc', borderRadius:4 }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse:'separate', borderSpacing:0 }}>
                  <thead style={{ position:'sticky', top:0, zIndex:1 }}>
                    <tr style={{ background:'#f0f2f5', textTransform:'uppercase', fontSize:11, letterSpacing:'.5px' }}>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}></th>
                      {[
                        { key:'codigo', label:'Código da Peça' },
                        { key:'nome', label:'Peça' },
                        { key:'unidade', label:'Un' },
                        { key:'ncm', label:'NCM' },
                        { key:'sit_trib', label:'Sit. Trib.' },
                        { key:'local_estoque', label:'Local de Estoque' },
                        { key:'qt_estoque', label:'Qt. Estoque', num:true },
                        { key:'c_medio', label:'C. Médio', num:true },
                        { key:'margem', label:'Margem (%)', num:true },
                        { key:'venda_cons', label:'Venda Cons.', num:true },
                        { key:'custo_total', label:'Custo Total', num:true },
                        { key:'venda_total', label:'Venda Total', num:true }
                      ].map(col => (
                        <th
                          key={col.key}
                          onClick={()=>changeSort(col.key)}
                          style={{
                            cursor:'pointer',
                            padding:'6px 8px',
                            textAlign: col.num?'right':'left',
                            borderBottom:'1px solid #d9d9d9',
                            background:'#f0f2f5',
                            whiteSpace:'nowrap'
                          }}
                        >
                          {col.label}{sort.field===col.key ? (sort.dir==='asc'?' ▲':' ▼') : ''}
                        </th>
                      ))}
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((item, idx) => {
                      const editing = editingId === item.id;
                      const rowStyle = { background: selected.has(item.id)?'#e6f7ff': (idx % 2 ? '#fafafa':'#fff') };
                      return (
                        <tr key={item.id} style={rowStyle}>
                          <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}><input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleSelect(item.id)} /></td>
                          {[
                            { key:'codigo' },
                            { key:'nome', style:{ minWidth:180 } },
                            { key:'unidade' },
                            { key:'ncm' },
                            { key:'sit_trib' },
                            { key:'local_estoque' },
                            { key:'qt_estoque', num:true },
                            { key:'c_medio', num:true },
                            { key:'margem', num:true },
                            { key:'venda_cons', num:true },
                            { key:'custo_total', num:true },
                            { key:'venda_total', num:true }
                          ].map(col => {
                            const f = col.key;
                            const isDerived = ['custo_total','venda_total'].includes(f);
                            const content = editing && !isDerived ? (
                              <input
                                style={{ width:'100%', fontSize:12, textAlign: col.num?'right':'left' }}
                                type={['qt_estoque','c_medio','venda_cons','margem'].includes(f)?'number':'text'}
                                value={editValues[f]}
                                onChange={e=> {
                                  const raw = ['qt_estoque','c_medio','venda_cons','margem'].includes(f)? Number(e.target.value) : e.target.value;
                                  setEditValues(v=> {
                                    let next = { ...v, [f]: raw };
                                    if(['c_medio','margem'].includes(f)) {
                                      // recalcular venda_cons automaticamente mantendo manual se usuário editar venda_cons diretamente
                                      if(!v._vendaManual) {
                                        const custo = f==='c_medio'? raw : next.c_medio;
                                        const margem = f==='margem'? raw : next.margem;
                                        next.venda_cons = (Number(custo)||0) * (1 + (Number(margem)||0)/100);
                                      }
                                    }
                                    if(f==='venda_cons') next._vendaManual = true;
                                    return next;
                                  });
                                }}
                              />
                            ) : (
                              <span style={{
                                ...(f==='qt_estoque' && item.qt_estoque < 10 ? { color:'red', fontWeight:'bold' }: {}),
                                display:'inline-block',
                                minWidth: col.num?60: undefined,
                                textAlign: col.num?'right':'left'
                              }}>
                                {col.num ? Number(item[f]).toLocaleString('pt-BR', { minimumFractionDigits: ['c_medio','venda_cons','custo_total','venda_total'].includes(f)?2:0 }) : item[f]}
                              </span>
                            );
                            return (
                              <td key={f} style={{ padding:'4px 6px', borderBottom:'1px solid #eee', ...(col.style||{}) }}>
                                {content}
                              </td>
                            );
                          })}
                          <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee', whiteSpace:'nowrap', display:'flex', gap:4 }}>
                            {editing ? (
                              <>
                                <button onClick={saveEdit}>Salvar</button>
                                <button onClick={cancelEdit}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button onClick={()=> setViewItem(item)}>Ver</button>
                                <button onClick={()=> startEdit(item.id)}>Editar</button>
                                <button style={{ color:'#c00' }} onClick={()=> {
                                  if(window.confirm('Excluir este item?')) {
                                    persistDelete([item.id]);
                                    flashMsg('Item excluído.');
                                  }
                                }}>Excluir</button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {paged.length===0 && (
                      <tr>
                        <td colSpan={13} style={{ padding:20, textAlign:'center', color:'#888' }}>Nenhum item encontrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop:8, display:'flex', gap:8, alignItems:'center' }}>
                <button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
                <span>Página {page} / {totalPages}</span>
                <button disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>Próxima</button>
              </div>
              {showAdd && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ background:'#fff', padding:16, width:500, maxHeight:'90vh', overflow:'auto' }}>
                    <h3>Novo Item</h3>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                      {['codigo','nome','unidade','ncm','sit_trib','local_estoque','qt_estoque','c_medio','margem'].map(f => (
                        <label key={f} style={{ display:'flex', flexDirection:'column', fontSize:12 }}>
                          {f === 'c_medio'? 'Custo Médio (R$)' : f === 'margem' ? 'Margem (%)' : f}
                          <input
                            type={['qt_estoque','c_medio','margem'].includes(f)?'number':'text'}
                            value={newItem[f]}
                            onChange={e=> setNewItem(v=> ({...v, [f]: ['qt_estoque','c_medio','margem'].includes(f)? Number(e.target.value): e.target.value, ultimoCalculoAuto: f==='margem' || f==='c_medio' ? true : v.ultimoCalculoAuto }))}
                          />
                        </label>
                      ))}
                      <label style={{ gridColumn:'1 / span 2', display:'flex', flexDirection:'column', fontSize:12 }}>
                        Preço de Venda (R$)
                        <input
                          type='number'
                          value={newItem.venda_cons}
                          onChange={e=> setNewItem(v=> ({...v, venda_cons: Number(e.target.value), travarVenda: true, ultimoCalculoAuto:false }))}
                        />
                        <small style={{ color:'#555' }}>Calculado: {calcularVendaSug(newItem.c_medio, newItem.margem).toLocaleString('pt-BR',{minimumFractionDigits:2})} {newItem.travarVenda? '(manual)' : '(auto)'}</small>
                        <div style={{ marginTop:4, display:'flex', gap:8, alignItems:'center' }}>
                          <button type='button' onClick={()=> setNewItem(v=> ({...v, travarVenda:false, ultimoCalculoAuto:true, venda_cons: calcularVendaSug(v.c_medio, v.margem) }))}>Usar Automático</button>
                          {newItem.travarVenda && <button type='button' onClick={()=> setNewItem(v=> ({...v, travarVenda:false, ultimoCalculoAuto:true }))}>Liberar Auto</button>}
                        </div>
                      </label>
                    </div>
                    <div style={{ marginTop:12, display:'flex', gap:8, justifyContent:'flex-end' }}>
                      <button onClick={()=> setShowAdd(false)}>Fechar</button>
                      <button onClick={addItem}>Salvar</button>
                    </div>
                  </div>
                </div>
              )}
              {message && (
                <div style={{ position:'fixed', bottom:16, right:16, background: message.type==='error'?'#ffcccc':'#e6f7ff', padding:'8px 12px', borderRadius:4 }}>
                  {message.text}
                </div>
              )}
              {viewItem && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ background:'#fff', padding:20, width:480, maxHeight:'85vh', overflow:'auto', borderRadius:6 }}>
                    <h3 style={{ marginTop:0 }}>Detalhes da Peça</h3>
                    <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
                      <tbody>
                        {Object.entries({
                          'Código': viewItem.codigo,
                          'Peça': viewItem.nome,
                          'Unidade': viewItem.unidade,
                          'NCM': viewItem.ncm,
                          'Situação Tributária': viewItem.sit_trib,
                          'Local de Estoque': viewItem.local_estoque,
                          'Quantidade': viewItem.qt_estoque,
                          'Custo Médio': viewItem.c_medio,
                          'Margem (%)': viewItem.margem,
                          'Venda Consumidor': viewItem.venda_cons,
                          'Custo Total': viewItem.custo_total,
                          'Venda Total': viewItem.venda_total
                        }).map(([k,v]) => (
                          <tr key={k}>
                            <td style={{ padding:'4px 6px', fontWeight:'600', borderBottom:'1px solid #eee', width:170 }}>{k}</td>
                            <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop:12, textAlign:'right' }}>
                      <button onClick={()=> setViewItem(null)}>Fechar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        )}
  {tab === 'encomendas' && <div></div>}
        {tab === 'encomendas' && (
          <div>
            <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
              <button onClick={()=>{ setNovaEncomendaTipo('registro'); setShowNovaEncomenda(true); }}>Nova Encomenda</button>
              <button onClick={loadEncomendas}>Recarregar</button>
              <span>{encomendas.length} encomendas</span>
            </div>
            {loadingEncomendas ? <div>Carregando encomendas...</div> : (
              <div style={{ overflowX:'auto', maxHeight:'60vh', border:'1px solid #ccc', borderRadius:4 }}>
                <table style={{ width:'100%', fontSize:13, borderCollapse:'separate', borderSpacing:0 }}>
                  <thead style={{ position:'sticky', top:0, zIndex:1 }}>
                    <tr style={{ background:'#f0f2f5', textTransform:'uppercase', fontSize:11, letterSpacing:'.5px' }}>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>ID</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Status</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Data</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Cliente</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Telefone</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Itens</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Total (R$)</th>
                      <th style={{ padding:'6px 8px', borderBottom:'1px solid #d9d9d9', background:'#f0f2f5' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {encomendas.map(e => (
                      <tr key={e.id} style={{ background: e.status==='cancelada' ? '#ffecec' : '#fff' }}>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}>{e.id}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}>{e.status}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}>{new Date(e.data).toLocaleString('pt-BR')}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}>{e.nome_cliente || '-'}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee' }}>{e.telefone_cliente || '-'}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee', textAlign:'right' }}>{e.itens_count}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee', textAlign:'right' }}>{Number(e.total_geral||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                        <td style={{ padding:'4px 6px', borderBottom:'1px solid #eee', whiteSpace:'nowrap', display:'flex', gap:4 }}>
                          <button onClick={()=> abrirVisualizacaoEncomenda(e)}>Ver</button>
                          <button onClick={()=> editarEncomenda(e)}>Editar</button>
                          <button style={{ color:'#c00' }} onClick={()=> excluirEncomenda(e)}>Excluir</button>
                          <button onClick={()=> { setViewEncomenda(e); carregarItensEncomenda(e.id); setTimeout(()=> imprimirEncomenda(e), 200); }}>PDF</button>
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
              <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ background:'#fff', padding:20, width:520, maxHeight:'85vh', overflow:'auto', borderRadius:6 }}>
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
                  <div style={{ textAlign:'right', marginTop:16, display:'flex', gap:8, justifyContent:'flex-end' }}>
                    <button onClick={()=> imprimirEncomenda(viewEncomenda)}>Imprimir / PDF</button>
                    <button onClick={()=> setViewEncomenda(null)}>Fechar</button>
                  </div>
                </div>
              </div>
            )}
            {showNovaEncomenda && (
              <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ background:'#fff', padding:20, width:840, maxHeight:'90vh', overflow:'auto', borderRadius:8 }}>
                  <h3 style={{ marginTop:0 }}>{editandoEncomendaId? 'Editar Encomenda #'+editandoEncomendaId : 'Nova Encomenda (Registro)'}</h3>
                  <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:12 }}>
                    <label style={{ flex:'1 1 200px', fontSize:12, display:'flex', flexDirection:'column' }}>Nome do Cliente
                      <input value={novaEncomendaDados.nome_cliente} onChange={e=> setNovaEncomendaDados(v=>({...v, nome_cliente:e.target.value}))} />
                    </label>
                    <label style={{ flex:'1 1 160px', fontSize:12, display:'flex', flexDirection:'column' }}>Telefone
                      <input value={novaEncomendaDados.telefone_cliente} onChange={e=> setNovaEncomendaDados(v=>({...v, telefone_cliente:e.target.value}))} />
                    </label>
                    <label style={{ flex:'1 1 260px', fontSize:12, display:'flex', flexDirection:'column' }}>Observação
                      <input value={novaEncomendaDados.observacao} onChange={e=> setNovaEncomendaDados(v=>({...v, observacao:e.target.value}))} />
                    </label>
                    <label style={{ flex:'1 1 200px', fontSize:12, display:'flex', flexDirection:'column' }}>Status Inicial
                      <select value={novaEncomendaDados.status} onChange={e=> setNovaEncomendaDados(v=>({...v, status:e.target.value}))}>
                        {STATUS_OPCOES.map(s=> <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                  </div>
                  <div style={{ marginBottom:8, display:'flex', gap:8, alignItems:'center' }}>
                    <input placeholder='Filtrar peça por código/nome...' value={filtroPeca} onChange={e=> setFiltroPeca(e.target.value)} style={{ flex:1 }} />
                    <button onClick={()=> {
                      // adiciona item vazio
                      setNovaEncomendaItens(itens => [...itens, { tempId:Date.now()+Math.random(), estoque_id:null, codigo:'', nome:'', qtd:1, preco:0, total:0 }]);
                    }}>Adicionar Linha</button>
                  </div>
                  <div style={{ overflowX:'auto', border:'1px solid #ccc', borderRadius:4, maxHeight:300 }}>
                    <table style={{ width:'100%', fontSize:12, borderCollapse:'separate', borderSpacing:0 }}>
                      <thead style={{ position:'sticky', top:0, background:'#f5f5f5' }}>
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
                                <input
                                  style={{ width:100 }}
                                  value={it.codigo}
                                  placeholder='Código'
                                  onChange={e=> {
                                    const val = e.target.value; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, codigo:val } : x));
                                  }}
                                />
                              </td>
                              <td style={{ padding:4, position:'relative' }}>
                                <input
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
                                <input type='number' style={{ width:70, textAlign:'right' }} value={it.qtd} onChange={e=> {
                                  const qtd = Number(e.target.value)||0; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, qtd, total: qtd * x.preco } : x));
                                }} />
                              </td>
                              <td style={{ padding:4 }}>
                                <input type='number' style={{ width:90, textAlign:'right' }} value={it.preco} onChange={e=> {
                                  const preco = Number(e.target.value)||0; setNovaEncomendaItens(arr => arr.map(x=> x.tempId===it.tempId? { ...x, preco, total: preco * x.qtd } : x));
                                }} />
                              </td>
                              <td style={{ padding:4, textAlign:'right', fontWeight:600 }}>
                                {Number(it.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
                              </td>
                              <td style={{ padding:4 }}>
                                <button onClick={()=> setNovaEncomendaItens(arr => arr.filter(x=> x.tempId!==it.tempId))}>Remover</button>
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
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={()=> { setShowNovaEncomenda(false); setNovaEncomendaItens([]); }}>Cancelar</button>
                      <button disabled={novaEncomendaItens.length===0 || !novaEncomendaDados.nome_cliente} onClick={()=> {
                        // Persistir encomenda e itens
                        try {
                          const db = new sqlite3.Database(path.join(__dirname, '../estoquepro.db'));
                          const totalGeral = novaEncomendaItens.reduce((acc,i)=> acc + (i.total||0),0);
                          if(editandoEncomendaId){
                            db.run(`UPDATE encomendas SET status=?, observacao=?, nome_cliente=?, telefone_cliente=?, total_itens=?, total_geral=? WHERE id=?`, [
                              novaEncomendaDados.status, novaEncomendaDados.observacao, novaEncomendaDados.nome_cliente, novaEncomendaDados.telefone_cliente, novaEncomendaItens.length, totalGeral, editandoEncomendaId
                            ], (err)=> {
                              if(err){ console.error(err); flashMsg('Erro ao atualizar','error'); return; }
                              db.run('DELETE FROM encomenda_itens WHERE encomenda_id=?', [editandoEncomendaId], (err2)=> {
                                if(err2) console.error(err2);
                                let pending = novaEncomendaItens.length; if(pending===0) finalizeUpd();
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
                                }
                              });
                            });
                          } else {
                            db.run(`INSERT INTO encomendas (tipo, data, status, observacao, nome_cliente, telefone_cliente, total_itens, total_geral) VALUES (?,?,?,?,?,?,?,?)`, [
                              'registro', new Date().toISOString(), novaEncomendaDados.status, novaEncomendaDados.observacao, novaEncomendaDados.nome_cliente, novaEncomendaDados.telefone_cliente, novaEncomendaItens.length, totalGeral
                            ], function(err){
                              if(err){ console.error(err); flashMsg('Erro ao salvar encomenda','error'); return; }
                              const encomendaId = this.lastID;
                              let pending = novaEncomendaItens.length;
                              if(pending===0) { finalizeNew(); }
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
                              }
                            });
                          }
                        } catch(e){ console.error(e); flashMsg('Falha na persistência','error'); }
                      }}>Salvar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'vales' && <div>Em breve: Vales</div>}
        {tab === 'calculadora' && (
          <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 520px', minWidth:320 }}>
              <h2>Calculadora de Precificação</h2>
              <div style={{ background:'#f8f9fa', padding:16, borderRadius:6, marginBottom:16 }}>
                <h4 style={{ marginTop:0 }}>Preço de Compra</h4>
                <label style={{ display:'block', fontSize:12, marginBottom:8 }}>Preço de compra unitário (R$)
                  <input type="number" value={calc.precoCompra} onChange={e=> setCalc(c=>({...c, precoCompra:Number(e.target.value)}))} style={{ width:'100%' }} />
                </label>
              </div>
              <div style={{ background:'#f8f9fa', padding:16, borderRadius:6, marginBottom:16 }}>
                <h4 style={{ marginTop:0 }}>Impostos (%)</h4>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(100px,1fr))', gap:8 }}>
                  {['icms','ipi','pis','cofins'].map(f => (
                    <label key={f} style={{ fontSize:12 }}>{f.toUpperCase()}
                      <input type="number" value={calc[f]} onChange={e=> setCalc(c=>({...c, [f]:Number(e.target.value)}))} style={{ width:'100%' }} />
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ background:'#f8f9fa', padding:16, borderRadius:6, marginBottom:16 }}>
                <h4 style={{ marginTop:0 }}>Taxas Adicionais</h4>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:8 }}>
                  <label style={{ fontSize:12 }}>Frete (R$)
                    <input type="number" value={calc.frete} onChange={e=> setCalc(c=>({...c, frete:Number(e.target.value)}))} style={{ width:'100%' }} />
                  </label>
                  <label style={{ fontSize:12 }}>Taxa Cartão (%)
                    <input type="number" value={calc.taxaCartao} onChange={e=> setCalc(c=>({...c, taxaCartao:Number(e.target.value)}))} style={{ width:'100%' }} />
                  </label>
                  <label style={{ fontSize:12 }}>Comissão Marketplace (%)
                    <input type="number" value={calc.comissaoMarketplace} onChange={e=> setCalc(c=>({...c, comissaoMarketplace:Number(e.target.value)}))} style={{ width:'100%' }} />
                  </label>
                </div>
              </div>
              <div style={{ background:'#f8f9fa', padding:16, borderRadius:6, marginBottom:16 }}>
                <h4 style={{ marginTop:0 }}>Margem de Lucro</h4>
                <label style={{ fontSize:12 }}>Margem desejada (%)
                  <input type="number" value={calc.margem} onChange={e=> setCalc(c=>({...c, margem:Number(e.target.value)}))} style={{ width:'100%' }} />
                </label>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={salvarCalculo}>Salvar Cálculo</button>
                <button onClick={()=> setCalc({ precoCompra:0, icms:0, ipi:0, pis:0, cofins:0, frete:0, taxaCartao:0, comissaoMarketplace:0, margem:0 })}>Limpar</button>
              </div>
            </div>
            <div style={{ flex:'1 1 280px', minWidth:260 }}>
              <h3>Resultados</h3>
              <div style={{ background:'#0f5132', color:'#fff', padding:16, borderRadius:6, marginBottom:12 }}>
                <div style={{ fontSize:12, opacity:.85 }}>Custo Total</div>
                <div style={{ fontSize:24, fontWeight:'bold' }}>R$ {calcResultados.custoTotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                <div style={{ fontSize:12, opacity:.85, marginTop:12 }}>Margem Aplicada</div>
                <div style={{ fontSize:20, fontWeight:'bold' }}>R$ {calcResultados.margemAplicada.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                <div style={{ fontSize:12, opacity:.85, marginTop:12 }}>Preço de Venda Sugerido</div>
                <div style={{ fontSize:28, fontWeight:'bold', color:'#b7ffb7' }}>R$ {calcResultados.precoVenda.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
              </div>
              <h4 style={{ marginTop:0 }}>Histórico</h4>
              <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid #ddd', borderRadius:4 }}>
                <table style={{ width:'100%', fontSize:11, borderCollapse:'collapse' }}>
                  <thead style={{ position:'sticky', top:0, background:'#fafafa' }}>
                    <tr>
                      <th style={{ textAlign:'left', padding:4 }}>Data</th>
                      <th style={{ textAlign:'right', padding:4 }}>Compra</th>
                      <th style={{ textAlign:'right', padding:4 }}>Venda Sug.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcHistorico.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding:4 }}>{new Date(r.data).toLocaleString('pt-BR')}</td>
                        <td style={{ padding:4, textAlign:'right' }}>R$ {Number(r.entrada.precoCompra).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                        <td style={{ padding:4, textAlign:'right' }}>R$ {r.resultado.precoVenda.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                      </tr>
                    ))}
                    {calcHistorico.length===0 && (
                      <tr><td colSpan={3} style={{ textAlign:'center', padding:8, color:'#666' }}>Sem cálculos.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {tab === 'relatorios' && <div>Em breve: Relatórios</div>}
      </main>
    </div>
  );
}
