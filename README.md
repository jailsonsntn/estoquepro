# EstoquePro

Aplicativo desktop de gestão de estoque feito com Electron + React e banco de dados local SQLite. Focado em simplicidade e desempenho para uso offline, com importação automática de dados a partir de CSV ou planilha Excel, abas de Estoque, Encomendas, Vales e uma Calculadora de preço de venda. Inclui backup automático e exportação de dados.

> Plataforma alvo: Windows (x64). Funciona sem servidor e sem autenticação.

## ✨ Funcionalidades
- Estoque
  - Listagem com busca avançada (ex.: `codigo:123 ncm:8471 peca:rolamento`), ordenação e paginação
  - Edição, inclusão e remoção de itens
  - Coluna “Disponível” (Estoque – Reservado) com badges de nível
  - Reimportação de CSV/Planilha e recarregamento do banco
  - Exportação do estoque para CSV
- Encomendas (registros)
  - Cadastro/edição de encomendas com itens e totalização
  - Visualização e impressão/PDF (layout moderno)
  - Exclusão e recarga
- Vales
  - Clientes fixos (cadastro, edição, inativação)
  - Criação/edição/duplicação de vales, status ABERTO/QUITADO/CANCELADO
  - Reserva automática do estoque enquanto o vale está ABERTO e baixa ao quitar
  - Visualização, impressão/PDF e filtros
- Calculadora de preço de venda
  - Considera impostos (ICMS, IPI, PIS, COFINS), frete, taxa de cartão, promoções e comissões
  - Presets de marketplaces (Shopee, Olist, Magalu, Americanas, Mercado Livre) com faixas de tarifa e subsídio
  - Escolha da base do lucro (custo do produto ou custo base)
- Importação de dados
  - CSV `dadosestoque.csv` (com ou sem cabeçalho) — heurística de mapeamento de colunas
  - Planilha Excel `DADOS.XLS` (fallback automático)
  - Watcher: se o CSV mudar, reimporta sozinho
- Exportação e Backup
  - Exporta CSV de estoque e JSON completo (estoque, encomendas, vales e itens)
  - Backup automático do banco em `backups/estoquepro-YYYYMMDD-HHMMSS.db`

## 🏗️ Arquitetura
- Electron (main process) carrega `src/index.html` e abre a janela principal
- React (renderer) monta a UI das abas em `src/App.js`
- SQLite local em `estoquepro.db` com WAL habilitado
- Importadores: `src/importCSV.js` e `src/importPlanilha.js`
- Persistência e migrações mínimas em `src/db.js`

## 📦 Requisitos
- Node.js 18+ (recomendado)
- Windows 10/11 (x64)

## 🚀 Como executar (dev)
No PowerShell, dentro da pasta do projeto:

```powershell
# Instalar dependências
npm install

# Rodar em modo desenvolvimento (gera bundle e inicia o Electron)
npm run start
```

Atalhos úteis:
- `npm run build` — somente gerar bundle (esbuild)
- `npm run dev` — build com watch + Electron

## 🏁 Build para distribuição
Gera artefatos Windows (portable e NSIS installer):

```powershell
# Recomendado: garantir dependências nativas do Electron
npm install

# Gerar build do app e empacotar
npm run electron-build
```

Saída em `dist/`, por padrão:
- Portable: `EstoquePro-<versão>-x64.exe`
- Installer NSIS: `EstoquePro-<versão>-x64.nsis.exe`

Também há um alvo alternativo baseado em `electron-packager`:

```powershell
npm run package:dir
```

## 📁 Dados e importação
O app busca arquivos na mesma pasta do executável/projeto (baseDir):
- `dadosestoque.csv` (preferencial)
- `DADOS.XLS` (fallback)

Fluxo automático na inicialização:
1) Carrega dados do SQLite para preencher a UI
2) Se existir `dadosestoque.csv`, importa automaticamente (limpando a tabela de estoque antes) e recarrega
3) Se não houver CSV, tenta importar `DADOS.XLS`
4) Cria um watcher: se o CSV for alterado, reimporta automaticamente

Formato do CSV:
- Delimitador: `;` por padrão (auto-detecta `,` se fizer mais sentido)
- Aceita com ou sem cabeçalho.
  - Sem cabeçalho: exige apenas as duas primeiras colunas como
    - Coluna A: Código da peça
    - Coluna B: Nome da peça
  - Com cabeçalho: mapeia por nomes aproximados (ex.: `Código`, `Peça`, `Un`, `NCM`, `Sit. Trib.`, `Local de Estoque`, `Qt.Estoque`, `C.Médio`, `Venda Cons.`, `Custo Total`, `Venda Total`).

Dicas:
- Encoding é detectado automaticamente (UTF-8/Latin1) com remoção de BOM e correções de acentuação
- Valores numéricos aceitam `1.234,56` (será normalizado)

## 💾 Banco de dados, exportação e backup
- Banco: `estoquepro.db` (WAL habilitado)
- Exportar estoque para CSV: botão Exportar CSV (aba Estoque)
- Exportar JSON completo: botão Exportar JSON (aba Estoque)
  - Inclui: `estoque`, `encomendas`, `encomenda_itens`, `vale_clientes`, `vales`, `vale_itens`
- Backup: botão Backup (manual) ou automático em alterações relevantes
  - Arquivos em `backups/estoquepro-YYYYMMDD-HHMMSS.db`

## 🖨️ Impressão/PDF
- Encomendas e Vales possuem telas de visualização com opção de imprimir/gerar PDF
- Layout inclui cabeçalho com dados da empresa e totalizações

## 🧩 Abas e fluxos de uso
- Estoque
  - Buscar com termos livres e filtros de campo: `codigo:`, `nome:`, `local:`, `ncm:`, `sit:`, `unidade:`, `disponivel:`
  - Adicionar item com cálculo de venda sugerida a partir de custo e margem
  - Remover itens selecionados; exportar; backup; reimportar CSV/planilha
- Encomendas
  - Nova/editar via modal, com sugestões de peças por código ou nome
  - Impressão/PDF com cabeçalho e tabela de itens
- Vales
  - Clientes fixos (CRUD simples)
  - Novo vale (status ABERTO reserva o estoque; QUITADO baixa o estoque; CANCELADO libera reservas)
  - Duplicar vale; imprimir/PDF; filtro por cliente/status
- Calculadora
  - Informe custos, impostos, taxas e comissão; veja preço de venda, custo total e lucro final

## 🔧 Scripts disponíveis
- `npm run build` — bundle via esbuild
- `npm run start` — build + start Electron
- `npm run dev` — build com `--watch` + Electron
- `npm run electron-build` — build + empacotamento via electron-builder
- `npm run package:dir` — empacotar diretório via electron-packager

## 📂 Estrutura (resumo)
- `main.js` — processo principal do Electron e IPCs pontuais
- `src/App.js` — UI principal (abas, lógica de importação, backup, exportação)
- `src/components/EstoqueTab.jsx` — tabela de estoque e ações
- `src/db.js` — conexão SQLite, schema e migrações simples
- `src/importCSV.js` — importação robusta de CSV (encoding, delimitador, aspas, heurísticas)
- `src/importPlanilha.js` — importação a partir de Excel (XLS/XLSX)
- `backups/` — backups automáticos do banco
- `exports/` — saídas de exportação (CSV/JSON)

## 🧭 Dicas e solução de problemas
- Erros de permissão ao escrever arquivos: execute o app em pasta com permissão de escrita (fora de `C:\\Program Files`)
- CSV com acentuação incorreta: use o botão “Reimportar CSV” (o importador tenta corrigir encoding automaticamente)
- Bloqueios no SQLite (SQLITE_BUSY): há retry/backoff configurado e `busy_timeout`; aguarde alguns segundos e tente novamente
- Se nenhum dado aparecer, verifique se `dadosestoque.csv` ou `DADOS.XLS` estão na pasta base e se os nomes das colunas são reconhecíveis

## 🧾 Licença
A definir pelo autor do repositório.

---

Feito com ❤️ para uso direto em Windows, sem complicação de servidor.
