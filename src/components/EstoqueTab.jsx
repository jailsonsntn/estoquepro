import React, { useEffect, useMemo, useState } from 'react';

// Função para escapar caracteres especiais
const escapeHtml = (text) => {
  if (!text) return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.toString().replace(/[&<>"']/g, (m) => map[m]);
};

// Função para renderizar texto com segurança
const safeRender = (text) => {
  if (!text) return '';
  try {
    // Converte para string e remove caracteres de controle problemáticos
    return text.toString().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } catch (e) {
    console.warn('Erro ao renderizar texto:', e);
    return '[Erro de encoding]';
  }
};

export default function EstoqueTab({
  loading,
  initializing,
  pendingSearch,
  setPendingSearch,
  setPage,
  page,
  totalPages,
  showAdd,
  setShowAdd,
  selected,
  deleteSelected,
  exportEstoqueCSV,
  exportDadosJSON,
  importInputRef,
  onImportarJSONArquivo,
  reloadEstoque,
  reimportCSV,
  doBackup,
  paged,
  editingId,
  startEdit,
  saveEdit,
  cancelEdit,
  setViewItem,
  persistDelete,
  toggleSelect,
  newItem,
  setNewItem,
  calcularVendaSug,
  addItem,
  message,
  viewItem,
  flashMsg
}) {
  // ===== Colunas (drag & drop) =====
  const columnsMeta = useMemo(() => ([
    { key:'codigo', label:'Código da Peça' },
    { key:'nome', label:'Peça', style:{ minWidth:180 } },
    { key:'unidade', label:'Un' },
    { key:'ncm', label:'NCM' },
    { key:'sit_trib', label:'Sit. Trib.' },
    { key:'local_estoque', label:'Local de Estoque' },
    { key:'qt_estoque', label:'Qt. Estoque', num:true },
    { key:'reservado', label:'Reservado', num:true },
    { key:'disponivel', label:'Disponível', num:true },
    { key:'c_medio', label:'C. Médio', num:true },
    { key:'margem', label:'Margem (%)', num:true },
    { key:'venda_cons', label:'Venda Cons.', num:true },
    { key:'custo_total', label:'Custo Total', num:true },
    { key:'venda_total', label:'Venda Total', num:true },
  ]), []);
  const knownKeys = useMemo(() => new Set(columnsMeta.map(c=>c.key)), [columnsMeta]);
  const defaultOrder = useMemo(() => columnsMeta.map(c=>c.key), [columnsMeta]);
  const [colOrder, setColOrder] = useState(defaultOrder);
  const [dragIndex, setDragIndex] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('estoque_col_order_v1');
      if (raw) {
        const arr = JSON.parse(raw).filter(k => knownKeys.has(k));
        const missing = defaultOrder.filter(k => !arr.includes(k));
        if (arr.length) setColOrder([...arr, ...missing]);
      }
    } catch(_) {}
  }, [knownKeys, defaultOrder]);
  const persistOrder = (arr) => {
    try { localStorage.setItem('estoque_col_order_v1', JSON.stringify(arr)); } catch(_) {}
  };
  const resetOrder = () => { setColOrder(defaultOrder); persistOrder(defaultOrder); };
  const onDragStart = (idx) => (e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (idx) => (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (idx) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    const next = [...colOrder];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(idx, 0, moved);
    setDragIndex(null);
    setColOrder(next);
    persistOrder(next);
  };

  return (
    <div className="estoque-tab">
      {initializing && (
        <div style={{ marginBottom:12 }}>
          <div className="gradient-bar" />
          <div style={{ fontSize:12, color:'#555', marginTop:4 }}>Carregando estoque...</div>
        </div>
      )}
      <div className="actions-bar" style={loading? { opacity:.6, pointerEvents:'none'}:undefined}>
        <input
          className="input"
          type="text"
          placeholder="Buscar... ex: filtro multi termo codigo:123 ncm:8471"
          value={pendingSearch}
          onChange={e=>{ setPendingSearch(e.target.value); setPage(1); }}
        />
        <button className="btn" onClick={()=>{ setShowAdd(true); }}>Adicionar</button>
        <button className="btn btn-danger" disabled={selected.size===0} onClick={deleteSelected}>Remover ({selected.size})</button>
        <button className="btn btn-outline" onClick={()=> doBackup('manual')}>Backup</button>
        <button className="btn btn-outline" title="Força recarregar do banco" onClick={reloadEstoque}>Recarregar</button>
  <button className="btn btn-outline" title="Reimporta o CSV e corrige acentuação" onClick={reimportCSV}>Reimportar CSV</button>
        <button className="btn btn-outline" title="Restaurar ordem padrão das colunas" onClick={resetOrder}>Resetar colunas</button>
      </div>
        <div className="table-wrapper maxh-60vh">
          <table className="table-default">
            <thead className="thead-sticky">
              <tr>
                <th></th>
                {colOrder.map((key, idx) => {
                  const col = columnsMeta.find(c=>c.key===key);
                  return (
                    <th
                      key={key}
                      draggable
                      onDragStart={onDragStart(idx)}
                      onDragOver={onDragOver(idx)}
                      onDrop={onDrop(idx)}
                      title="Arraste para reordenar"
                      style={{
                        textAlign: col?.num?'right':'left',
                        whiteSpace:'nowrap',
                        cursor:'move',
                        opacity: dragIndex===idx? .6: 1
                      }}
                    >
                      {col?.label || key}
                    </th>
                  );
                })}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((item, idx) => {
                const editing = editingId === item.id;
                return (
                    <tr key={item.id} className={selected.has(item.id)?'row-selected':''}>
                    <td><input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleSelect(item.id)} /></td>
                    {colOrder.map((f) => {
                      const col = columnsMeta.find(c=>c.key===f) || { key:f };
                      const isDerived = ['custo_total','venda_total','disponivel','reservado'].includes(f);
                      const disponivelValor = (Number(item.qt_estoque)||0) - (Number(item.reservado)||0);
                      let chipClass = 'disp-ok';
                      if(disponivelValor <= 0) chipClass = 'disp-baixo';
                      else if(disponivelValor < 5) chipClass = 'disp-baixo';
                      else if(disponivelValor < 20) chipClass = 'disp-medio';
                      let content;
                      if(f==='disponivel') {
                        content = (
                          <span
                            title={`Qt. Estoque: ${item.qt_estoque||0}  Reservado: ${item.reservado||0}`}
                            className={`disponivel-chip ${chipClass} ${disponivelValor<0?'estoque-negativo':''}`}
                            style={{ display:'inline-flex', justifyContent:'flex-end' }}
                          >
                            {disponivelValor.toLocaleString('pt-BR')}
                          </span>
                        );
                      } else if(editing && !isDerived) {
                        content = (
                          <input
                            className="input"
                            style={{ width:'100%', textAlign: col.num?'right':'left' }}
                            type={['qt_estoque','c_medio','venda_cons','margem'].includes(f)?'number':'text'}
                            value={item[f] ?? ''}
                            onChange={e=> {
                              const val = ['qt_estoque','c_medio','venda_cons','margem'].includes(f) ? Number(e.target.value) : e.target.value;
                              // Atualiza linha editável localmente
                              item[f] = val;
                              // Recalcular campos derivados unitários se custo/margem/venda mudar
                              if(['c_medio','margem','venda_cons'].includes(f)) {
                                const cMed = Number(item.c_medio)||0;
                                const marg = Number(item.margem)||0;
                                const custoUnit = cMed + (cMed * (marg/100));
                                item.custo_total = custoUnit;
                                item.venda_total = Number(item.venda_cons)||0;
                              }
                              // Força re-render via pequena mutação de estado (optamos por flashMsg silencioso)
                              flashMsg('Editando (não salvo ainda)...','info');
                            }}
                          />
                        );
                      } else {
                        content = (
                          <span style={{
                            ...((f==='qt_estoque' && item.qt_estoque < 10) || (f==='disponivel' && ((item.qt_estoque - (item.reservado||0)) < 0)) ? { color:'red', fontWeight:'bold' }: {}),
                            display:'inline-block',
                            minWidth: col.num?60: undefined,
                            textAlign: col.num?'right':'left'
                          }}>
                            {col.num ? 
                              Number(f==='disponivel' ? (item.qt_estoque - (item.reservado||0)) : item[f]).toLocaleString('pt-BR', { minimumFractionDigits: ['c_medio','venda_cons','custo_total','venda_total'].includes(f)?2:0 }) 
                              : safeRender(item[f])
                            }
                          </span>
                        );
                      }
                      return (
                        <td key={f} style={{ ...(col.style||{}) }}>
                          {content}
                        </td>
                      );
                    })}
                    <td style={{ whiteSpace:'nowrap', display:'flex', gap:6 }}>
                      {editing ? (
                        <>
                          <button className="btn" onClick={saveEdit}>Salvar</button>
                          <button className="btn btn-outline" onClick={cancelEdit}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-icon btn-outline" title="Ver" aria-label="Ver" onClick={()=> setViewItem(item)}>
                            <span role="img" aria-hidden="true">👁️</span>
                          </button>
                          <button className="btn btn-icon" title="Editar" aria-label="Editar" onClick={()=> startEdit(item.id)}>
                            <span role="img" aria-hidden="true">✏️</span>
                          </button>
                          <button className="btn btn-icon btn-danger" title="Excluir" aria-label="Excluir" onClick={()=> { if(window.confirm('Excluir este item?')) { persistDelete([item.id]); flashMsg('Item excluído.'); } }}>
                            <span role="img" aria-hidden="true">🗑️</span>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {paged.length===0 && (
                <tr>
                  <td colSpan={16} style={{ padding:20, textAlign:'center', color:'#888' }}>Nenhum item encontrado.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={16} className="tfoot-sticky" style={{ padding:'8px 10px' }}>
                  <div className="pagination-bar" style={{ padding:0 }}>
                    <button className="btn btn-outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
                    <span style={{ padding:'0 6px' }}>Página {page} / {totalPages}</span>
                    <button className="btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>Próxima</button>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {showAdd && (
          <div className="modal-overlay">
            <div className="modal-panel" style={{ width:500 }}>
              <h3>Novo Item</h3>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                {['codigo','nome','unidade','ncm','sit_trib','local_estoque','qt_estoque','c_medio','margem'].map(f => (
                  <label key={f} style={{ display:'flex', flexDirection:'column', fontSize:12 }}>
                    {f === 'c_medio'? 'Custo Médio (R$)' : f === 'margem' ? 'Margem (%)' : f}
                    <input
                      className="input"
                      type={['qt_estoque','c_medio','margem'].includes(f)?'number':'text'}
                      value={newItem[f]}
                      onChange={e=> setNewItem(v=> ({...v, [f]: ['qt_estoque','c_medio','margem'].includes(f)? Number(e.target.value): e.target.value, ultimoCalculoAuto: f==='margem' || f==='c_medio' ? true : v.ultimoCalculoAuto }))}
                    />
                  </label>
                ))}
                <label style={{ gridColumn:'1 / span 2', display:'flex', flexDirection:'column', fontSize:12 }}>
                  Preço de Venda (R$)
                  <input
                    className="input"
                    type='number'
                    value={newItem.venda_cons}
                    onChange={e=> setNewItem(v=> ({...v, venda_cons: Number(e.target.value), travarVenda: true, ultimoCalculoAuto:false }))}
                  />
                  <small style={{ color:'#555' }}>Calculado: {calcularVendaSug(newItem.c_medio, newItem.margem).toLocaleString('pt-BR',{minimumFractionDigits:2})} {newItem.travarVenda? '(manual)' : '(auto)'}</small>
                  <div style={{ marginTop:4, display:'flex', gap:8, alignItems:'center' }}>
                    <button className="btn btn-outline" type='button' onClick={()=> setNewItem(v=> ({...v, travarVenda:false, ultimoCalculoAuto:true, venda_cons: calcularVendaSug(v.c_medio, v.margem) }))}>Usar Automático</button>
                    {newItem.travarVenda && <button className="btn" type='button' onClick={()=> setNewItem(v=> ({...v, travarVenda:false, ultimoCalculoAuto:true }))}>Liberar Auto</button>}
                  </div>
                </label>
              </div>
              <div className="actions-right" style={{ marginTop:12 }}>
                <button className="btn btn-outline" onClick={()=> setShowAdd(false)}>Fechar</button>
                <button className="btn" onClick={addItem}>Salvar</button>
              </div>
            </div>
          </div>
        )}
        {message && (
          <div className={`message ${message.type==='error'?'error':'info'}`} style={{ position:'fixed', bottom:16, right:16 }}>
            {message.text}
          </div>
        )}
        {viewItem && (
          <div className="modal-overlay">
            <div className="modal-panel modal-md maxh-85vh overflow-auto">
              <h3 style={{ marginTop:0 }}>Detalhes da Peça</h3>
              <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
                <tbody>
                  {Object.entries({
                    'Código': safeRender(viewItem.codigo),
                    'Peça': safeRender(viewItem.nome),
                    'Unidade': safeRender(viewItem.unidade),
                    'NCM': safeRender(viewItem.ncm),
                    'Situação Tributária': safeRender(viewItem.sit_trib),
                    'Local de Estoque': safeRender(viewItem.local_estoque),
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
              <div className="actions-right" style={{ marginTop:12 }}>
                <button className="btn" onClick={()=> setViewItem(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
