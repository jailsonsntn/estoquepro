// Utilitário para importar dados da planilha Excel
const XLSX = require('xlsx');
const { db } = require('./db');
const path = require('path');

function importPlanilha(filePath, { limit = null, clearBefore = false } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const subset = limit ? data.slice(0, limit) : data;
      db.serialize(()=>{
        if (clearBefore) {
          db.run('DELETE FROM estoque');
        }
        let pending = subset.length;
        if(pending===0) return resolve();
        subset.forEach(item => {
          db.run(`INSERT INTO estoque (codigo, nome, unidade, ncm, sit_trib, local_estoque, qt_estoque, c_medio, venda_cons, custo_total, venda_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item['Código da peça'],
              item['Peça'],
              item['Un'],
              item['NCM'],
              item['Sit. Trib.'],
              item['Local de Estoque'],
              item['Qt.Estoque'],
              item['C.Médio'],
              item['Venda Cons.'],
              item['Custo Total'],
              item['Venda Total']
            ], (err)=>{
              if(err) console.error('Erro insert planilha', err);
              pending -=1;
              if(pending===0) resolve();
            }
          );
        });
      });
    } catch(e){
      reject(e);
    }
  });
}

module.exports = { importPlanilha };
