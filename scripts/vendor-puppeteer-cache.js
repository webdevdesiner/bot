/**
 * Copia o cache local do Puppeteer (Chrome baixado pelo postinstall) para vendor/,
 * para o electron-builder incluir no instalador — PCs clientes não têm C:\Users\...\ .cache\puppeteer
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const src = path.join(os.homedir(), '.cache', 'puppeteer');
const dest = path.join(__dirname, '..', 'vendor', 'puppeteer-cache');

if (!fs.existsSync(src)) {
  console.error(
    '[vendor-puppeteer] Cache não encontrado em',
    src,
    '\nRode na raiz do projeto: npx puppeteer browsers install chrome\nDepois execute: npm run vendor:puppeteer'
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('[vendor-puppeteer] OK →', dest);
