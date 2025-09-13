// Script de build usando esbuild para gerar bundle.js
const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: [path.join(__dirname, '../src/index.js')],
  bundle: true,
  platform: 'browser',
  outfile: path.join(__dirname, '../src/bundle.js'),
  sourcemap: true,
  target: ['chrome120'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.js': 'jsx' },
  external: ['fs','path','sqlite3','electron','events','util']
}).catch(e => { console.error(e); process.exit(1); });
