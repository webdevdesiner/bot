const path = require('path');
const fs = require('fs');

/**
 * Puppeteer 24+ baixa Chrome em %USERPROFILE%\.cache\puppeteer — em PCs clientes isso não existe.
 * No app instalado (Electron), empacotamos vendor/puppeteer-cache em resources/puppeteer-cache.
 * Deve rodar antes de qualquer require que carregue o puppeteer / whatsapp-web.js.
 */
(function patchPuppeteerCacheDirForPackagedApp() {
  try {
    const rp = process.resourcesPath;
    if (!rp) return;
    const bundled = path.join(rp, 'puppeteer-cache');
    if (fs.existsSync(bundled)) {
      process.env.PUPPETEER_CACHE_DIR = bundled;
    }
  } catch (_) {}
})();

const dotenv = require('dotenv');

/**
 * Carrega vários `.env` em cascata (último sobrescreve chaves repetidas).
 * WEBHOOK_BASE_URL e ajustes locais ficam em APP_USER_DATA_PATH; credenciais Mercado Pago
 * oficiais vêm do `.env` em `resources/` (instalador) e são reaplicadas depois — senão um
 * `.env` antigo no AppData com TEST- continuaria vencendo após atualizar o app.
 */
function loadDotenvCascade() {
  const userDataEnv = process.env.APP_USER_DATA_PATH
    ? path.join(process.env.APP_USER_DATA_PATH, '.env')
    : null;
  const resourcesEnv = process.resourcesPath ? path.join(process.resourcesPath, '.env') : null;
  const chain = [
    path.join(__dirname, '.env'),
    path.join(process.cwd(), '.env'),
    resourcesEnv,
    userDataEnv
  ].filter(Boolean);

  const seen = new Set();
  for (const p of chain) {
    if (seen.has(p) || !fs.existsSync(p)) continue;
    seen.add(p);
    dotenv.config({ path: p, override: true });
  }
  if (seen.size === 0) {
    dotenv.config();
  }
}

/** No app instalado, MP_* do pacote deve prevalecer sobre valores antigos no AppData. */
function applyBundledMercadoPagoKeysFromResources() {
  if (String(process.env.ORION_USE_USER_MP_CREDS || '').trim() === '1') return;
  const resourcesEnv = process.resourcesPath ? path.join(process.resourcesPath, '.env') : null;
  if (!resourcesEnv || !fs.existsSync(resourcesEnv)) return;
  try {
    const parsed = dotenv.parse(fs.readFileSync(resourcesEnv, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (!k.startsWith('MP_')) continue;
      const s = v != null ? String(v).trim() : '';
      if (s !== '') process.env[k] = s;
    }
  } catch (err) {
    console.warn('[env] Falha ao aplicar MP_* do resources/.env:', err?.message || err);
  }
}

loadDotenvCascade();
applyBundledMercadoPagoKeysFromResources();

const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  CATALOGO_UNIFICADO,
  REGRAS_GLOBAIS
} = require('./catalogo-unificado');
const { runSyncLink } = require('./sync-link');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Erro: Configure a GEMINI_API_KEY no arquivo .env');
  process.exit(1);
}
console.log('--- Configuração Carregada ---');
const _mpTok = String(process.env.MP_ACCESS_TOKEN || '');
const _mpMode = _mpTok.startsWith('TEST-')
  ? 'sandbox (token TEST-)'
  : _mpTok.startsWith('APP_USR-')
    ? 'produção (token APP_USR-)'
    : _mpTok
      ? 'definido (prefixo desconhecido)'
      : 'ausente';
console.log('Mercado Pago modo:', _mpMode);
console.log('Mercado Pago (MP_ACCESS_TOKEN):', !!process.env.MP_ACCESS_TOKEN);
console.log('Mercado Pago (MP_PUBLIC_KEY):', !!process.env.MP_PUBLIC_KEY);
console.log('WEBHOOK_BASE_URL:', !!process.env.WEBHOOK_BASE_URL);
console.log('Mercado Pago (MP_WEBHOOK_SECRET):', !!process.env.MP_WEBHOOK_SECRET);
console.log('Gerente de processo (GERENTE_PROCESSO_CHAT_ID):', !!process.env.GERENTE_PROCESSO_CHAT_ID);
console.log('Ngrok (NGROK_AUTHTOKEN):', !!process.env.NGROK_AUTHTOKEN);

// ========== CONFIGURAÇÃO DO BOT ==========
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-pro';
const GEMINI_MAX_RETRIES = Math.max(0, Number(process.env.GEMINI_MAX_RETRIES || 2));
const GEMINI_RETRY_BASE_MS = Math.max(200, Number(process.env.GEMINI_RETRY_BASE_MS || 800));
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const WEBHOOK_INVALID_ALERT_COOLDOWN_MS = Math.max(
  10 * 60 * 1000,
  Number(process.env.WEBHOOK_INVALID_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000)
);
const DASHBOARD_ORDERS_LIMIT_DEFAULT = Math.max(
  200,
  Math.floor(Number(process.env.DASHBOARD_ORDERS_LIMIT_DEFAULT || 5000))
);
const DASHBOARD_ORDERS_LIMIT_MAX = Math.max(
  DASHBOARD_ORDERS_LIMIT_DEFAULT,
  Math.floor(Number(process.env.DASHBOARD_ORDERS_LIMIT_MAX || 10000))
);
const HUMAN_CHAT_CMD_PAUSE = process.env.HUMAN_CHAT_CMD_PAUSE || '#assumir';
const HUMAN_CHAT_CMD_RESUME = process.env.HUMAN_CHAT_CMD_RESUME || '#liberar';
const OPERACOES_CHAT_ID = String(process.env.OPERACOES_CHAT_ID || '').trim();
const ADMIN_CHAT_IDS_RAW = String(process.env.ADMIN_CHAT_IDS || '').trim();
const SALES_START_CHAT_IDS_RAW = String(process.env.SALES_START_CHAT_IDS || '').trim();
const WHATSAPP_SEND_TYPING = String(process.env.WHATSAPP_SEND_TYPING || '0').trim() === '1';

/** Perguntas espontâneas de cliente (sobrescreva via .env se os links mudarem). */
const ORION_SOCIAL_INSTAGRAM_URL =
  String(process.env.ORION_SOCIAL_INSTAGRAM_URL || '').trim() ||
  'https://www.instagram.com/p/DXA8GRJkcYA/?igsh=NjN3YTBoMXI3a3F6';
const ORION_SOCIAL_TIKTOK_URL =
  String(process.env.ORION_SOCIAL_TIKTOK_URL || '').trim() || 'https://vt.tiktok.com/ZS9FfuBfW/';

const CAMPOS_ENTREGA = ['nome', 'rua', 'numero', 'cep', 'cidade', 'bairro'];
const CAMPOS_OBRIGATORIOS_ENTREGA = ['nome', 'rua', 'numero', 'cep', 'cidade'];
let db = null;
const APP_USER_DATA_PATH = String(process.env.APP_USER_DATA_PATH || '').trim();
const PERSIST_BASE_DIR = APP_USER_DATA_PATH || __dirname;
if (!fs.existsSync(PERSIST_BASE_DIR)) {
  fs.mkdirSync(PERSIST_BASE_DIR, { recursive: true });
}
const DB_FILE = path.join(PERSIST_BASE_DIR, 'orion.db');
// Sessão whatsapp-web.js isolada por app: pasta dedicada + clientId único (evita conflito "browser already running").
const WWEBJS_DATA_ROOT = path.join(PERSIST_BASE_DIR, 'wwebjs-data');
const WWEBJS_CLIENT_ID = String(process.env.WWEBJS_CLIENT_ID || 'orion-desktop').trim() || 'orion-desktop';
if (!fs.existsSync(WWEBJS_DATA_ROOT)) {
  fs.mkdirSync(WWEBJS_DATA_ROOT, { recursive: true });
}
const LOGS_DIR = path.join(PERSIST_BASE_DIR, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const APP_LOG_FILE = path.join(LOGS_DIR, 'app.log');
let latestQrBase64 = null;
let latestQrAt = null;
let whatsappLastEvent = 'booting';
let whatsappLastEventAt = new Date().toISOString();
let whatsappLastError = null;
let whatsappDebugRecent = [];
let whatsappClientAuthenticated = false;
let whatsappConnectionState = 'UNKNOWN';
let whatsappAuthenticatedAt = null;
let whatsappMonitorStarted = false;
/** URL pública do túnel ngrok (base HTTPS), quando ativo. */
let webhookUrl = null;
/** Pausa global de emergência: quando true, o bot não responde nenhuma conversa. */
let emergencyPauseGlobal = false;
const REGRAS_GLOBAIS_PROMPT = JSON.stringify(REGRAS_GLOBAIS, null, 2);
const CATALOGO_UNIFICADO_BASE = CATALOGO_UNIFICADO;
const ALIASES_NOME_LP_PARA_SKU = {
  'Blend BPC+TB': '#OR-2026-021-BT',
  'BPC+TB': '#OR-2026-021-BT',
  'KLOW Blend': '#OR-2026-KL80',
  'CJC-1295 + Ipamorelin': '#OR-2026-019-CI',
  'Água Bacteriostática': '#OR-2026-BAC10'
};

function deepCloneCatalogBase() {
  return JSON.parse(JSON.stringify(CATALOGO_UNIFICADO_BASE || {}));
}

function buildSkuProduto(catalogo) {
  const o = {};
  for (const [sku, row] of Object.entries(catalogo || {})) {
    const c = row?.comercial || {};
    o[sku] = `${c.nome || ''} ${c.dosagem || ''}`.replace(/\s+/g, ' ').trim();
  }
  return o;
}

function buildNomeProdutoParaSku(catalogo) {
  const o = {};
  for (const [sku, row] of Object.entries(catalogo || {})) {
    const c = row?.comercial || {};
    const nome = `${c.nome || ''} ${c.dosagem || ''}`.replace(/\s+/g, ' ').trim();
    if (nome) o[nome] = sku;
  }
  return o;
}

function normalizePriceText(raw) {
  const original = String(raw || '').trim();
  if (!original) return '';
  const withoutCurrency = original.replace(/^R\$\s*/i, '').trim();
  const cleaned = withoutCurrency.replace(/[^\d.,]/g, '');
  if (!cleaned) return original;
  const decimalComma = cleaned.includes(',');
  const normalized = decimalComma
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return original;
  return `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getEffectiveWebhookBaseUrl() {
  const inMemory = String(webhookUrl || '').trim().replace(/\/+$/, '');
  if (inMemory) return inMemory;
  return String(process.env.WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '');
}

function persistWebhookBaseUrlForTesting(baseUrl) {
  try {
    const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!normalized) return;
    process.env.WEBHOOK_BASE_URL = normalized;

    const envPath = APP_USER_DATA_PATH
      ? path.join(APP_USER_DATA_PATH, '.env')
      : path.join(__dirname, '.env');
    const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const line = `WEBHOOK_BASE_URL=${normalized}`;
    let next = '';
    if (/^WEBHOOK_BASE_URL=.*$/m.test(current)) {
      next = current.replace(/^WEBHOOK_BASE_URL=.*$/m, line);
    } else {
      next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`;
    }
    fs.writeFileSync(envPath, next, 'utf8');
    console.log('[Webhook] WEBHOOK_BASE_URL atualizado em', envPath);
  } catch (err) {
    console.warn('[Webhook] Não foi possível persistir WEBHOOK_BASE_URL:', err?.message || err);
  }
}

function extractOrderSkuDemand(message, catalogo) {
  const text = String(message || '');
  const demand = {};
  const skuRegex = /#OR-[A-Z0-9-]+/gi;
  let match;
  while ((match = skuRegex.exec(text)) !== null) {
    const sku = String(match[0] || '').toUpperCase();
    if (!catalogo?.[sku]) continue;
    const from = Math.max(0, match.index - 24);
    const to = Math.min(text.length, skuRegex.lastIndex + 24);
    const context = text.slice(from, to);
    let qty = 1;
    const m1 = context.match(/(?:x|qtd[:\s]*)\s*(\d{1,3})/i);
    const m2 = context.match(/(\d{1,3})\s*x/i);
    if (m1?.[1]) qty = Number(m1[1]) || 1;
    else if (m2?.[1]) qty = Number(m2[1]) || 1;
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    demand[sku] = Number(demand[sku] || 0) + Math.floor(qty);
  }
  return demand;
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSingleSkuFromCustomerText(message, catalogo, contextHint = '') {
  const text = String(message || '');
  const normalizedMsg = normalizeForMatch(text);
  if (!normalizedMsg) return null;

  const bySku = extractOrderSkuDemand(text, catalogo);
  const skuByRegex = Object.keys(bySku || {});
  if (skuByRegex.length === 1) return skuByRegex[0];
  if (skuByRegex.length > 1) return '__MULTI__';

  const numberMatch = normalizedMsg.match(/\b(\d{1,3})\s*mg?\b|\b(\d{1,3})\b/);
  const mgValue = numberMatch ? Number(numberMatch[1] || numberMatch[2] || 0) : 0;
  const normalizedContext = normalizeForMatch(contextHint);

  // Contexto de dosagem curta: se cliente respondeu só "20" após falar de Tirzepatide, resolve SKU correto.
  if (mgValue > 0 && /^\d{1,3}(?:\s*mg)?$/.test(normalizedMsg) && /\btirzepatide\b/.test(normalizedContext)) {
    for (const [sku, row] of Object.entries(catalogo || {})) {
      const c = row?.comercial || {};
      const nome = normalizeForMatch(c.nome || '');
      const doseNumber = Number((normalizeForMatch(c.dosagem || '').match(/\d{1,3}/)?.[0] || '0'));
      if (nome.includes('tirzepatide') && doseNumber === mgValue) return sku;
    }
  }

  const candidates = [];
  for (const [sku, row] of Object.entries(catalogo || {})) {
    const c = row?.comercial || {};
    const nome = normalizeForMatch(c.nome || '');
    const dose = normalizeForMatch(c.dosagem || '');
    if (!nome || !dose) continue;
    const full = normalizeForMatch(`${c.nome || ''} ${c.dosagem || ''}`);
    if (normalizedMsg.includes(full)) {
      candidates.push({ sku, score: 100 });
      continue;
    }
    const prefix4 = nome.slice(0, 4);
    const prefix5 = nome.slice(0, 5);
    const hasNameHint = (prefix5 && normalizedMsg.includes(prefix5)) || (prefix4 && normalizedMsg.includes(prefix4));
    const doseNumber = Number((dose.match(/\d{1,3}/)?.[0] || '0'));
    if (hasNameHint && mgValue > 0 && doseNumber === mgValue) {
      candidates.push({ sku, score: 90 });
      continue;
    }
    if (hasNameHint && mgValue === 0) {
      candidates.push({ sku, score: 50 });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return '__MULTI__';
  return candidates[0].sku;
}

/** Link da loja oficial apareceu em alguma mensagem do histórico (ex.: bot enviou URL no chat). */
function messageHistoryMentionsStoreUrl(history) {
  const re = /green-koala-180415\.hostingersite\.com/i;
  const arr = Array.isArray(history) ? history : [];
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (re.test(String(arr[i]?.text || ''))) return true;
  }
  return false;
}

/** A última mensagem do bot (antes do envio atual do usuário) ofereceu checkout direto por aqui. */
function lastBotMessageOfferedDirectLink(history) {
  const arr = Array.isArray(history) ? history : [];
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const role = String(arr[i]?.role || '').toLowerCase();
    if (role === 'user') continue;
    const t = String(arr[i]?.text || '').toLowerCase();
    return /link\s+direto|gerar\s+por\s+aqui|agiliz|sem\s+precisar\s+voltar\s+pelo\s+site|gostaria\s+que\s+eu\s+fizesse|qual\s+protocolo|gero\s+seu\s+acesso|link\s+de\s+pagamento\s+agora|posso\s+gerar\s+o?\s*link|gerar\s+o?\s*link\s+de\s+pagamento|pagar\s+por\s+aqui|fechar\s+por\s+aqui/i.test(
      t
    );
  }
  return false;
}

/** Última menção clara de um SKU nas mensagens do usuário (mais recente primeiro). */
function resolveSkuFromRecentUserMessages(history, catalogo) {
  const arr = Array.isArray(history) ? history : [];
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const role = String(arr[i]?.role || '').toLowerCase();
    if (role !== 'user') continue;
    const sku = detectSingleSkuFromCustomerText(String(arr[i]?.text || ''), catalogo);
    if (sku && sku !== '__MULTI__') return sku;
  }
  return null;
}

function buildSkuContextHint(session) {
  const arr = Array.isArray(session?.messageHistory) ? session.messageHistory : [];
  const historyTail = arr
    .slice(-8)
    .map((m) => String(m?.text || ''))
    .join('\n');
  return `${String(session?.lastOrder || '')}\n${historyTail}`.trim();
}

function resolveBestSkuForCheckout(session, catalogRuntime, currentUserMessage = '') {
  let sku = String(session?.lastDetectedSku || '').trim();
  if (sku && sku !== '__MULTI__' && catalogRuntime?.[sku]) return sku;

  const hint = buildSkuContextHint(session);
  sku = detectSingleSkuFromCustomerText(String(currentUserMessage || ''), catalogRuntime, hint) || '';
  if (sku && sku !== '__MULTI__' && catalogRuntime?.[sku]) return sku;

  sku = resolveSkuFromRecentUserMessages(session?.messageHistory, catalogRuntime) || '';
  if (sku && sku !== '__MULTI__' && catalogRuntime?.[sku]) return sku;

  sku = detectSingleSkuFromCustomerText(String(session?.lastOrder || ''), catalogRuntime, hint) || '';
  if (sku && sku !== '__MULTI__' && catalogRuntime?.[sku]) return sku;

  return '';
}

async function getStockBySku() {
  const rows = await db.all('SELECT sku, quantity FROM stock_data');
  return Object.fromEntries(
    (rows || []).map((r) => [String(r.sku || '').trim().toUpperCase(), Number(r.quantity ?? 0)])
  );
}

async function reserveStockForOrder(orderDemand) {
  const entries = Object.entries(orderDemand || {}).filter(([, qty]) => Number(qty) > 0);
  if (entries.length === 0) {
    return { ok: true, reserved: [] };
  }
  await db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const insufficient = [];
    const reserved = [];
    for (const [skuRaw, qtyRaw] of entries) {
      const sku = String(skuRaw || '').trim().toUpperCase();
      const qty = Math.floor(Number(qtyRaw) || 0);
      if (!sku || qty <= 0) continue;
      const row = await db.get('SELECT quantity FROM stock_data WHERE sku = ?', [sku]);
      const available = Number(row?.quantity ?? 0);
      if (available < qty) {
        insufficient.push({ sku, required: qty, available });
        continue;
      }
      const nextQty = available - qty;
      await db.run(
        `INSERT INTO stock_data (sku, quantity, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(sku) DO UPDATE SET
           quantity=excluded.quantity,
           updated_at=excluded.updated_at`,
        [sku, nextQty, new Date().toISOString()]
      );
      reserved.push({ sku, qty, before: available, after: nextQty });
    }
    if (insufficient.length > 0) {
      await db.exec('ROLLBACK');
      return { ok: false, insufficient };
    }
    await db.exec('COMMIT');
    return { ok: true, reserved };
  } catch (err) {
    try {
      await db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

async function restoreReservedStock(reservedItems) {
  const entries = Array.isArray(reservedItems) ? reservedItems : [];
  if (entries.length === 0) return;
  await db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const item of entries) {
      const sku = String(item?.sku || '').trim().toUpperCase();
      const qty = Math.floor(Number(item?.qty) || 0);
      if (!sku || qty <= 0) continue;
      const row = await db.get('SELECT quantity FROM stock_data WHERE sku = ?', [sku]);
      const available = Number(row?.quantity ?? 0);
      const nextQty = available + qty;
      await db.run(
        `INSERT INTO stock_data (sku, quantity, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(sku) DO UPDATE SET
           quantity=excluded.quantity,
           updated_at=excluded.updated_at`,
        [sku, nextQty, new Date().toISOString()]
      );
    }
    await db.exec('COMMIT');
  } catch (err) {
    try {
      await db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

async function savePaymentStockReservation(paymentId, chatId, reservedItems) {
  const pid = String(paymentId || '').trim();
  const cid = String(chatId || '').trim();
  if (!pid || !cid) return;
  const items = (Array.isArray(reservedItems) ? reservedItems : [])
    .map((r) => ({ sku: String(r?.sku || '').trim().toUpperCase(), qty: Math.floor(Number(r?.qty) || 0) }))
    .filter((r) => r.sku && r.qty > 0);
  if (!items.length) return;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO payment_stock_reservation (payment_id, chat_id, items_json, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(payment_id) DO UPDATE SET
       chat_id=excluded.chat_id,
       items_json=excluded.items_json,
       created_at=excluded.created_at`,
    [pid, cid, JSON.stringify(items), now]
  );
}

async function deletePaymentStockReservationsForChat(chatId) {
  const cid = String(chatId || '').trim();
  if (!cid) return;
  await db.run('DELETE FROM payment_stock_reservation WHERE chat_id = ?', [cid]);
}

function detectClienteSolicitouCancelamentoPedido(text) {
  const t = normalizeForMatch(String(text || ''));
  if (!t || t.length < 8) return false;
  const needles = [
    'cancelar o pedido',
    'cancelar pedido',
    'quero cancelar o pedido',
    'quero cancelar',
    'cancela esse pedido',
    'cancele o pedido',
    'desistir do pedido',
    'desisto do pedido',
    'desistir da compra',
    'desisto da compra',
    'nao vou mais pagar',
    'não vou mais pagar',
    'nao vou pagar',
    'não vou pagar',
    'nao quero mais o pedido',
    'não quero mais o pedido',
    'nao quero mais',
    'não quero mais',
    'pode cancelar o pedido',
    'pode cancelar',
    'excluir o pedido',
    'excluir pedido',
    'anular o pedido',
    'desfazer o pedido',
    'cancelar a compra',
    'cancela o pagamento',
    'cancelar o pagamento'
  ];
  if (needles.some((n) => t.includes(n))) return true;
  if (/\bcancelar\b/.test(t) && (t.includes('pedid') || t.includes('compr') || t.includes('pagamento'))) return true;
  return false;
}

/**
 * Libera estoque reservado, remove reserva MP e zera PENDING na sessão. Sem mensagem ao cliente.
 * Usado ao trocar de produto com pedido anterior em aberto, ou pelo fluxo explícito de cancelamento.
 */
async function releasePendingCheckoutResources(chatId, session) {
  const pay = String(session?.paymentStatus || '').toUpperCase().trim();
  if (pay !== 'PENDING') return { ok: true };

  const catalogRuntime = await getRuntimeCatalog();
  const preferenceId = String(session?.lastPaymentId || '').trim();
  let itemsToRestore = [];

  if (preferenceId) {
    const row = await db.get('SELECT items_json FROM payment_stock_reservation WHERE payment_id = ?', [preferenceId]);
    if (row?.items_json) {
      try {
        const parsed = JSON.parse(row.items_json);
        if (Array.isArray(parsed)) itemsToRestore = parsed;
      } catch {
        itemsToRestore = [];
      }
    }
  }

  if (itemsToRestore.length === 0) {
    const fromOrder = extractOrderSkuDemand(String(session?.lastOrder || ''), catalogRuntime);
    if (Object.keys(fromOrder).length > 0) {
      itemsToRestore = Object.entries(fromOrder).map(([sku, qty]) => ({ sku, qty }));
    } else {
      const single = detectSingleSkuFromCustomerText(String(session?.lastOrder || ''), catalogRuntime);
      if (single && single !== '__MULTI__') {
        itemsToRestore = [{ sku: single, qty: 1 }];
      }
    }
  }

  const normalized = (Array.isArray(itemsToRestore) ? itemsToRestore : [])
    .map((it) => ({ sku: String(it?.sku || '').trim().toUpperCase(), qty: Math.floor(Number(it?.qty) || 0) }))
    .filter((it) => it.sku && it.qty > 0);

  if (normalized.length === 0) {
    return {
      ok: false,
      errorMessage:
        'Não consegui identificar os itens do pedido anterior com segurança. Peça a um atendente humano ou envie *cancelar o pedido* e monte o protocolo de novo.'
    };
  }

  try {
    await restoreReservedStock(normalized);
  } catch (err) {
    console.error('[Cancel] Falha ao restaurar estoque:', err);
    return {
      ok: false,
      errorMessage: 'Tive um problema ao devolver o estoque do pedido anterior. Chame o suporte humano para ajustar.'
    };
  }

  if (preferenceId) {
    await db.run('DELETE FROM payment_stock_reservation WHERE payment_id = ?', [preferenceId]).catch(() => {});
    await setPaymentSession(preferenceId, chatId, {
      status: 'CANCELLED_BY_CLIENT',
      invoiceUrl: session?.lastLink || null
    });
  }

  await updateSession(chatId, {
    paymentStatus: null,
    lastOrder: null,
    lastLink: null,
    lastPaymentId: null,
    checkoutState: null,
    checkoutFollowupCount: 0,
    checkoutLastFollowupAt: null,
    checkoutSnoozedUntil: null
  });

  pushDebugLog('info', `[checkout-release] PENDING liberado chat=${chatId} itens=${JSON.stringify(normalized)}`);
  return { ok: true };
}

async function tryClienteCancelarPedidoPendente(chatId, session) {
  const pay = String(session?.paymentStatus || '').toUpperCase().trim();
  if (pay === 'PAID') {
    await sendHumanizedMessage(
      chatId,
      'Seu pagamento já foi confirmado no sistema, então não consigo cancelar o pedido automaticamente por aqui. Se precisar ajustar algo nesse estágio, peça ao atendimento humano.'
    );
    return true;
  }
  if (pay !== 'PENDING') {
    await sendHumanizedMessage(
      chatId,
      'Não encontrei um pedido *aguardando pagamento* para cancelar. Se quiser montar um protocolo novo, é só me dizer o que precisa.'
    );
    return true;
  }

  const released = await releasePendingCheckoutResources(chatId, session);
  if (!released.ok) {
    await sendHumanizedMessage(chatId, released.errorMessage || 'Não consegui cancelar o pedido automaticamente.');
    return true;
  }

  await sendHumanizedMessage(
    chatId,
    'Pedido cancelado: a *reserva de estoque* dos itens foi devolvida automaticamente.\n\nQuando quiser, é só montar um novo protocolo aqui ou pelo carrinho oficial que eu gero um link novo.'
  );
  return true;
}

function computeOrderTotalFromDemand(orderDemand, catalogRuntime) {
  let total = 0;
  for (const [skuRaw, qtyRaw] of Object.entries(orderDemand || {})) {
    const sku = String(skuRaw || '').trim().toUpperCase();
    const qty = Math.max(0, Math.floor(Number(qtyRaw) || 0));
    if (!sku || qty <= 0) continue;
    const priceRaw = catalogRuntime?.[sku]?.comercial?.precoOriginal ?? catalogRuntime?.[sku]?.comercial?.preco;
    const unit = parsePriceToNumber(priceRaw);
    if (!Number.isFinite(unit) || unit < 0) return NaN;
    if (unit === 0) continue;
    total += unit * qty;
  }
  return total;
}

function formatStructuredOrderMessageFromDemand(orderDemand, catalogRuntime) {
  const items = Object.entries(orderDemand || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([skuRaw, qtyRaw]) => {
      const sku = String(skuRaw || '').trim().toUpperCase();
      const qty = Math.max(0, Math.floor(Number(qtyRaw) || 0));
      const priceRaw = catalogRuntime?.[sku]?.comercial?.precoOriginal ?? catalogRuntime?.[sku]?.comercial?.preco ?? '';
      return `${qty}x ${sku} (${priceRaw})`;
    });
  const total = computeOrderTotalFromDemand(orderDemand, catalogRuntime);
  const totalText =
    Number.isFinite(total) && total > 0
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)
      : 'R$ 0,00';
  return `NOVO PROTOCOLO - ORION Itens: ${items.join(' | ')} Total: ${totalText} Quero realizar o pagamento seguro.`;
}

async function processarCheckoutEstruturado(chatId, orderMessage, session, options = {}) {
  const catalogRuntime = await getRuntimeCatalog();
  const skuProdutoRuntime = buildSkuProduto(catalogRuntime);
  const orderDemand = extractOrderSkuDemand(String(orderMessage || ''), catalogRuntime);

  let decodedMessage = String(orderMessage || '');
  for (const [sku, name] of Object.entries(skuProdutoRuntime)) {
    decodedMessage = decodedMessage.split(sku).join(`*${name}*`);
  }

  // Segundo pedido / troca de produto: com link anterior ainda pendente, libera estoque e MP antes de gerar novo checkout.
  if (
    session.paymentStatus === 'PENDING' &&
    session.lastLink &&
    String(session.lastOrder || '').trim() !== String(decodedMessage || '').trim() &&
    Object.keys(orderDemand).length > 0
  ) {
    pushDebugLog('info', `[checkout] troca de pedido (PENDING anterior) chat=${chatId}`);
    const released = await releasePendingCheckoutResources(chatId, session);
    if (!released.ok) {
      return { ok: false, errorMessage: released.errorMessage };
    }
    session = await getOrCreateSession(chatId);
  }

  if (session.paymentStatus === 'PENDING' && session.lastOrder === decodedMessage && session.lastLink) {
    const link = session.lastLink;
    // Mesmo link do pedido já pendente — expor invoiceUrl para todos os chamadores (antes só linkPagamento existia e checkout.invoiceUrl virava undefined na mensagem).
    return { ok: true, reusedPending: true, linkPagamento: link, invoiceUrl: link, decodedMessage };
  }

  if (Object.keys(orderDemand).length === 0) {
    return {
      ok: false,
      errorMessage:
        'Não consegui validar o estoque desse pedido com segurança. Por favor, confirme o SKU e quantidade para eu gerar seu link.'
    };
  }

  const reserveResult = await reserveStockForOrder(orderDemand);
  if (!reserveResult.ok) {
    const missingLines = (reserveResult.insufficient || [])
      .map((it) => {
        const friendly = skuProdutoRuntime[it.sku] || it.sku;
        return `- ${friendly}: disponível ${it.available}, solicitado ${it.required}`;
      })
      .join('\n');
    return {
      ok: false,
      errorMessage: `No momento, um ou mais itens do seu protocolo estão sem estoque suficiente:\n${missingLines}`
    };
  }
  const reservedItems = reserveResult.reserved || [];

  const totalFromMessageMatch = String(orderMessage || '').match(/Total:?\s*R\$\s*([\d.,]+)/i);
  let valorTotal = NaN;
  if (totalFromMessageMatch?.[1]) {
    const limpo = totalFromMessageMatch[1].replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
    valorTotal = parseFloat(limpo);
  }
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    valorTotal = computeOrderTotalFromDemand(orderDemand, catalogRuntime);
  }
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    await restoreReservedStock(reservedItems);
    return { ok: false, errorMessage: 'Não consegui calcular o total do pedido com segurança.' };
  }

  let invoiceUrl = null;
  let paymentId = null;
  try {
    const paymentResult = await criarPagamentoMercadoPago(valorTotal, chatId);
    if (paymentResult?.initPoint) invoiceUrl = paymentResult.initPoint;
    if (paymentResult?.preferenceId) paymentId = paymentResult.preferenceId;
    if (!paymentId || !invoiceUrl) {
      await restoreReservedStock(reservedItems);
      return {
        ok: false,
        errorMessage:
          'Tive uma instabilidade ao gerar seu link de pagamento e liberei a reserva do estoque automaticamente. Me chama para tentar novamente em seguida.'
      };
    }
    await setPaymentSession(paymentId, chatId, { status: 'PENDING', value: valorTotal, invoiceUrl });
    await savePaymentStockReservation(paymentId, chatId, reservedItems);
  } catch (paymentErr) {
    await restoreReservedStock(reservedItems);
    console.error('[Checkout] Falha ao gerar pagamento com reserva ativa:', paymentErr);
    return {
      ok: false,
      errorMessage:
        'Tive uma instabilidade ao gerar seu link de pagamento e liberei a reserva do estoque automaticamente. Me chama para tentar novamente em seguida.'
    };
  }

  const singleSku = Object.keys(orderDemand).length === 1 ? Object.keys(orderDemand)[0] : null;
  const nextSession = await saveSession(chatId, {
    ...session,
    lastOrder: decodedMessage,
    lastLink: invoiceUrl,
    paymentStatus: 'PENDING',
    lastPaymentId: paymentId,
    checkoutState: 'PENDING_PAYMENT',
    checkoutFollowupCount: 0,
    checkoutLastFollowupAt: null,
    checkoutSnoozedUntil: null,
    dadosEntrega: { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' },
    deliveryNotified: false,
    paymentWelcomeSent: false,
    deliveryFlowClosed: false,
    contactName: session.contactName || null,
    phoneNumber: session.phoneNumber || null,
    phoneSource: session.phoneSource || null,
    profilePic: session.profilePic || null,
    setorAtual: 'VENDAS',
    lastDetectedSku: singleSku || session.lastDetectedSku || null,
    messageHistory: options?.resetHistory ? [] : session.messageHistory || []
  });

  const stakeholderTargets = getStakeholderSalesStartTargets();
  if (options?.notifyAdmin && stakeholderTargets.length > 0) {
    const adminReport = `🚨 *NOVA VENDA INICIADA* 🚨\n\n*Cliente:* ${options?.notifyName || session?.contactName || chatId}\n*Telefone:* ${session?.phoneNumber || 'N/A'}\n*Chat:* ${chatId}\n*Payment/Pref ID:* ${paymentId || 'N/A'}\n\n*Pedido:*\n${decodedMessage}\n\n*Link:* ${invoiceUrl}`;
    for (const targetId of stakeholderTargets) {
      await safeSendMessage(targetId, adminReport, 'nova-venda-iniciada');
    }
  }

  return {
    ok: true,
    paymentId,
    invoiceUrl,
    valorTotal,
    decodedMessage,
    orderDemand,
    session: nextSession
  };
}

/** URL do checkout MP: só retorna string se for link http(s) válido (evita enviar "undefined" ao cliente). */
function paymentCheckoutUrl(checkout) {
  const u = checkout?.invoiceUrl ?? checkout?.linkPagamento;
  const s = typeof u === 'string' ? u.trim() : '';
  return /^https?:\/\//i.test(s) ? s : '';
}

const MSG_CHECKOUT_SEM_LINK =
  'Consegui registrar seu pedido, mas o link de pagamento não foi gerado corretamente aqui. Por favor, envie *sim* ou peça *link de pagamento* de novo que eu tento na sequência. Se repetir, chame o atendimento humano.';

async function getCatalogPriceOverrides() {
  const rows = await db.all('SELECT sku, price FROM catalog_price_data');
  const out = {};
  for (const row of rows || []) {
    const sku = String(row?.sku || '').trim();
    if (!sku) continue;
    const price = String(row?.price || '').trim();
    if (price) out[sku] = price;
  }
  return out;
}

async function getRuntimeCatalog() {
  const catalogo = deepCloneCatalogBase();
  const overrides = await getCatalogPriceOverrides();
  for (const [sku, price] of Object.entries(overrides)) {
    if (!catalogo[sku] || !catalogo[sku].comercial) continue;
    catalogo[sku].comercial.preco = price;
  }
  return catalogo;
}

function filterCatalogByStock(catalogo, stockBySku = {}) {
  const out = {};
  for (const [sku, row] of Object.entries(catalogo || {})) {
    const key = String(sku || '').trim().toUpperCase();
    const qty = Number(stockBySku[key] ?? 0);
    if (qty > 0) out[sku] = row;
  }
  return out;
}

function pushDebugLog(level, message) {
  const entry = {
    at: new Date().toISOString(),
    level: String(level || 'info'),
    message: String(message || '')
  };
  whatsappDebugRecent = [...whatsappDebugRecent.slice(-99), entry];
  try {
    fs.appendFileSync(APP_LOG_FILE, `[${entry.at}] [${entry.level.toUpperCase()}] ${entry.message}\n`);
  } catch {}
}

function setWhatsAppEvent(eventName, extra = '') {
  whatsappLastEvent = String(eventName || 'unknown');
  whatsappLastEventAt = new Date().toISOString();
  const msg = extra ? `${whatsappLastEvent} | ${extra}` : whatsappLastEvent;
  pushDebugLog('info', `[whatsapp-event] ${msg}`);
}

function setWhatsAppError(err, context = '') {
  const msg = String(err?.message || err || 'erro desconhecido');
  whatsappLastError = context ? `${context}: ${msg}` : msg;
  pushDebugLog('error', `[whatsapp-error] ${whatsappLastError}`);
}

// ========== PROMPTS DE SETOR ==========
const promptVendas = `
IMPORTANTE: A regra de regra_sigilo_protocolo definida em REGRAS_GLOBAIS é absoluta para CONTEÚDO TÉCNICO DETALHADO (UI, diluição exata, passos completos de reconstituição). Se o statusPagamento for BLOQUEADO (pedido aguardando pagamento), NÃO entregue números de UI nem passo a passo completo. Porém, você PODE e DEVE dar orientação superficial útil (visão geral de uso, frequência genérica, objetivo do protocolo e cuidados básicos) em linguagem curta e comercial. BLOQUEADO NÃO proíbe: preços, SKUs, disponibilidade, somar produtos ao pedido, alterar itens antes de pagar, confirmar total, gerar ou reenviar link Mercado Pago, nem orientar carrinho/checkout. Se statusPagamento for SEM_PEDIDO_EM_ABERTO, trate como conversa sem trava de checkout: liste o que há no catálogo e responda "o que tem hoje" normalmente.

SAUDAÇÃO E PRIMEIRO CONTATO (PRIORIDADE SOBRE SIGILO): Se a MENSAGEM DO CLIENTE for só boas-vindas, indicação (ex.: veio por fulano/clínica), ou pedido genérico de atendimento sem citar produto nem dúvida técnica, você DEVE: agradecer a indicação se houver, ser cordial, e fazer UMA pergunta objetiva (ex.: objetivo de pesquisa ou qual linha quer conhecer). É TERMINANTEMENTE PROIBIDO nessa situação: citar "protocolo detalhado de reconstituição", "tabelas de dosagem", "liberados após o pagamento", ou perguntar se quer "link para o seu protocolo" — isso confunde quem ainda não pediu nada técnico. O texto de retenção de sigilo (REGRAS_GLOBAIS.regra_sigilo_protocolo.se_bloqueado) só entra quando o cliente perguntar explicitamente por diluir, UI, seringa, passo a passo de reconstituição, ou equivalente.

REGRA DE OURO DE FLUXO (OBRIGATÓRIA — PRIORIDADE SOBRE OUTRAS REGRAS DE VENDAS):
DÚVIDAS TÉCNICAS: Esclareça tudo com base no CATÁLOGO_UNIFICADO (comercial + tecnico), com autoridade.
INTERESSE EM COMPRAR / PREÇO: Informe SKU e comercial.preco e, em seguida, use imediatamente a ESTRATÉGIA DE ESCOLHA DUPLA:
- Opção A (PRIORITÁRIA): fechamento direto no WhatsApp, tirando o pedido e gerando link de pagamento por aqui.
- Opção B (SECUNDÁRIA): link do site para navegação/catálogo completo e carrinho, apenas se o cliente preferir.
ANUNCIE o Kit Orion de Brinde (#OR-KIT-BRINDE) + frete grátis (REGRAS_GLOBAIS.regra_oferta_kit_orion) em linguagem consultiva e focada em conveniência.
BLOQUEIO DE ENDEREÇO PRÉ-PAGAMENTO: Enquanto o contexto indicar que o pagamento AINDA NÃO foi confirmado (status diferente de pago/confirmado), é TERMINANTEMENTE PROIBIDO pedir nome, e-mail, rua, número, CEP, cidade, bairro, complemento ou "dados de embarque". Não peça endereço "enquanto paga" nem em paralelo ao pagamento.
APÓS PAGAMENTO CONFIRMADO: Somente quando o status no contexto for pagamento CONFIRMADO (PAID), solicite dados de entrega — siga a REGRA DE PAGAMENTO CONFIRMADO abaixo.
APÓS "SIM", "OK", "PODE FECHAR": Priorize fechamento direto no WhatsApp. Confirme o protocolo (SKU ou nome + dosagem), confirme o valor exato do catálogo e siga para geração do link por aqui. Não liste campos de endereço antes da confirmação de pagamento.

TABELA OFICIAL E PRECISÃO IMEDIATA: A fonte única de preço, nome, dosagem e SKU é o JSON do CATÁLOGO_UNIFICADO (tabela oficial da LP + itens do catálogo) e o bloco MAPEAMENTO NOME DO PRODUTO → SKU no contexto deste prompt. Assim que o cliente mencionar produto+dosagem (ex.: "Tirzepatide 20", "Tirzepatide 20mg"), associe na hora o SKU correto e o comercial.preco atual desse SKU no catálogo em tempo real — sem adivinhar nem consultar "conhecimento externo". Nunca invente valores nem SKUs.

TOM DE CONSULTOR DE ELITE: Menos "atendente de formulário", mais consultor estratégico. Se o pagamento já estiver confirmado e o cliente mandar endereço incompleto, complete a coleta com naturalidade. Antes do pagamento confirmado, não inicie coleta de endereço.

VOCÊ É O CONSULTOR DE LOGÍSTICA DA ORION PEPTIDES.
MANTENHA SEMPRE UM TOM PROFISSIONAL, EDUCADO E DIRETO.

MENSAGENS ENXUTAS: Evite textos cansativos. Prefira poucos parágrafos curtos ou lista com "-". Objetivo primeiro; detalhe só se o cliente pedir.
REGRA DE CONCISÃO FORTE (OBRIGATÓRIA):
- Responda primeiro em 1 a 3 frases curtas, focadas exatamente na pergunta do cliente.
- Evite blocos longos, repetição de contexto e excesso de justificativas comerciais.
- Máximo recomendado por resposta: ~320 caracteres, exceto quando o cliente pedir "detalhes", "explica melhor", "passo a passo" ou equivalente.
- Sempre que possível, finalize com uma pergunta binária de avanço (ex.: "Quer link agora ou mais detalhes?").

REGRA DE EXPLICAÇÃO EM PARTES (PROGRESSIVA):
- Não entregue tudo de uma vez.
- Dê o essencial agora e aprofunde em etapas conforme o cliente avançar na conversa.
- Se o cliente pedir informação ampla, entregue um resumo curto e ofereça 2 caminhos: "resumo comercial" ou "detalhe técnico".

REGRAS DE COMPORTAMENTO:
ACOLHIMENTO: Na abertura, valide dor/objetivo sem parecer catálogo automático. Depois que produto E dosagem estiverem escolhidos, confira preço e SKU com confiança usando somente o CATÁLOGO_UNIFICADO.
AUTORIDADE ORION: Mencione sempre a "pureza laboratorial" ou "padrão ouro" da Orion.
ESCOLHA DUPLA OBRIGATÓRIA APÓS PREÇO: Após apresentar produto/benefício técnico + preço, pergunte sempre em formato de escolha:
"Posso gerar seu link de pagamento agora por aqui para agilizar, ou você prefere navegar no catálogo completo pelo site?"
Quando houver um produto específico em contexto (ex.: cliente já sinalizou interesse naquele item), prefira a pergunta de confirmação objetiva:
"Você quer que eu gere o link de pagamento desse produto agora, ou prefere ver mais detalhes antes?"
FOLLOW-UP: NUNCA termine de forma passiva. Termine com UMA pergunta clara orientada ao fechamento.
FORMATAÇÃO WHATSAPP: Use APENAS as formatações do WhatsApp: *texto* para negrito e _texto_ para itálico. PROIBIDO USAR TAGS HTML. Para listas, use apenas o símbolo de traço (-).
LIMITAÇÃO: Responda apenas sobre os SKUs presentes no CATÁLOGO_UNIFICADO (objeto comercial + técnico por SKU). Produto fora do catálogo? Diga que não trabalha com o item.
Se o cliente ainda estiver com dúvidas técnicas mesmo após o início do fluxo de vendas, responda de forma simples e direta sobre o benefício do produto e retome a Escolha Dupla com foco no fechamento direto.
Você tem acesso total aos blocos comercial e tecnico de cada SKU no CATÁLOGO_UNIFICADO. Se o cliente fizer uma pergunta técnica enquanto estiver no fluxo de compra, NÃO mude o setor e NÃO chame o humano. Responda a dúvida de forma clara e direta usando esses dados e, em seguida, retome gentilmente para o fechamento do pedido.
Confirmar definições biológicas (como "TB-500 é Timosina") é considerado suporte de vendas informativo, não consulta médica. Responda prontamente usando o CATÁLOGO_UNIFICADO (bloco tecnico do SKU correspondente).

REGRA DE CHECKOUT HÍBRIDO (PRIORIDADE + ALTERNATIVA):
Fluxo padrão e prioritário: CHECKOUT DIRETO NO WHATSAPP.
Ao sinal de compra, conduza para fechamento direto por aqui, sem empurrar o site como etapa obrigatória.
Se o cliente aceitar fechar por aqui, confirme SKU e valor exato do catálogo e peça confirmação objetiva para seguir.
Frase guia recomendada: "Posso gerar seu link de pagamento agora para você não precisar preencher cadastros no site."
O site é alternativa secundária apenas quando o cliente disser que prefere navegar no catálogo/carrinho.
SANITIZAÇÃO DE CHECKOUT IMEDIATO (OBRIGATÓRIO): Se o cliente quiser comprar ou pagar, diga apenas que vai gerar o link agora. NUNCA escreva a URL do site se o contexto for de checkout imediato.

REGRA DE ALTERAÇÃO DE PEDIDO:
Se o cliente quiser alterar itens/dosagens, ajuste o fechamento direto no WhatsApp confirmando SKU(s), quantidades e valor total atualizado com base no CATÁLOGO_UNIFICADO. Ofereça o carrinho apenas se ele preferir montar por conta própria.
CANCELAMENTO PELO PRÓPRIO CLIENTE (pedido ainda não pago): Se ele pedir claramente para cancelar o pedido/link enquanto o pagamento não estiver confirmado, o sistema já trata cancelamento e devolução da reserva de estoque automaticamente — confirme de forma breve e ofereça remontar o pedido se quiser. Não diga que cancelamento é impossível nesse caso.
NUNCA use formato de link Markdown como [texto](url). No WhatsApp, envie somente URL pura.
Ao cliente que confirmar fechamento direto, sempre valide em uma frase:
- SKU selecionado
- valor exato (comercial.preco/comercial.precoOriginal do CATÁLOGO_UNIFICADO)
- confirmação para gerar o link agora

REGRA DE LINK DE COMPRA:
Se o cliente pedir "link para pagar" ou "finalizar por aqui", priorize fechamento direto no WhatsApp (confirmando SKU + valor exato do catálogo e seguindo para geração do link de pagamento).
PLACEHOLDERS DE LINK (OBRIGATÓRIO):
- Use [LINK_SITE] quando o cliente quiser ver o catálogo, o site ou todos os produtos.
- Use [LINK_PAGAMENTO] APENAS quando o cliente confirmar que quer o link para pagar um produto específico agora.
- NUNCA escreva URLs completas. Use apenas os placeholders acima.

ESTILO DE RESPOSTA (HUMANO E DIRETO):
Seja extremamente pontual e direto. Não dê explicações longas ou benefícios não solicitados.
Responda como um atendente de WhatsApp ágil, não como um robô de e-commerce.
Use no máximo 2 frases por mensagem.
Não entregue detalhes técnicos, frete, vantagens ou diferenciais automaticamente; só quando o cliente perguntar.

REGRA DE PAGAMENTO CONFIRMADO: 
Se o status do pagamento no contexto for CONFIRMADO, NUNCA peça comprovante. Apenas conduza objetivamente para coletar os dados de entrega faltantes.

ENCERRAMENTO DO FLUXO:
Se o fluxo de endereço foi concluído e o cliente confirmou que está tudo certo, não ofereça mais ajuda proativamente. Apenas agradeça e informe que o próximo contato será para o envio do rastreio.

TRANSBORDO TÉCNICO:
Se o cliente fizer uma pergunta técnica que você não sabe responder ou que exija supervisão médica real (caso individual, comorbidade, efeito adverso importante, decisão clínica), responda EXATAMENTE assim: "Essa é uma excelente pergunta técnica. Para sua segurança, vou encaminhar esse ponto agora mesmo para o nosso especialista responsável, que te dará o suporte detalhado em instantes. Um momento, por favor."
Para dúvidas comuns de uso pré-compra ("como usa", "quantas aplicações em média", "como funciona"), não transborde de imediato: dê orientação superficial objetiva e convide para fechamento. Exemplo de linha final: "Após a aquisição, te passo o protocolo detalhado completo e todo suporte."
`.trim();

const promptTecnico = `
IMPORTANTE: A regra de regra_sigilo_protocolo em REGRAS_GLOBAIS vale para detalhes técnicos completos (UI, diluição exata, reconstituição passo a passo) quando o contexto indicar BLOQUEADO (pagamento pendente). Em BLOQUEADO, responda tecnicamente de forma superficial e útil (sem números de UI e sem passo a passo completo), e conduza para fechamento informando que o detalhado vem após aquisição com suporte total. Quando statusPagamento for SEM_PEDIDO_EM_ABERTO, perguntas como "o que tem disponível", catálogo ou estoque devem ser atendidas com dados do contexto — é PROIBIDO responder com o script de sigilo. Não use esse script para recusar preço, SKU, disponibilidade nem link de pagamento — nesses casos use [VENDAS] se precisar e conduza o checkout.

SAUDAÇÃO / SÓ "QUERO ATENDIMENTO": Se a mensagem for abertura cordial ou pedido genérico de atendimento sem pergunta técnica, responda em tom acolhedor e pergunte o foco (dúvida científica vs interesse em produto). NÃO use o parágrafo de sigilo sobre protocolo após pagamento nem "link do protocolo". Só use a retenção técnica se o cliente pedir diluição, UI, ou passo a passo com pagamento ainda não confirmado (BLOQUEADO).

TRANSIÇÃO SILENCIOSA PARA VENDAS (MANDATÓRIO):
Se o cliente demonstrar intenção de compra, aceitar um valor/orçamento, pedir para fechar, perguntar preço para comprar, ou confirmar fechamento com termos como "Sim", "Ok", "Pode ser" em contexto de compra, responda normalmente ao cliente e inclua ao FINAL da mensagem a linha com a tag exata [VENDAS] (ou [MUDAR_PARA_VENDAS], equivalente). O cliente não deve ler explicações sobre mudança de setor.
É proibido dizer que vai encaminhar para outro setor, departamento ou pessoa — o sistema troca para vendas automaticamente e de forma imediata.

Você é o Especialista Técnico da Orion Peptides, com tom científico, sério e acessível.
Você deve soar como um bioquímico da Orion Peptides.

OBJETIVIDADE (WhatsApp): Respostas curtas e escaneáveis. Priorize 2 a 4 frases ou poucos tópicos com "-". Evite blocos longos e repetição. Entregue o núcleo da resposta já no início. Ao final, UMA pergunta-gancho para o cliente escolher o próximo passo (ex.: "Quer que eu detalhe reconstituição, comparação com outro SKU ou só os números de protocolo?"). Só aprofunde se o cliente pedir explicitamente "detalhe", "explica melhor" ou "passo a passo".
CONCISÃO PROGRESSIVA (MANDATÓRIA):
- Responda a pergunta principal em até 2 frases curtas.
- Não despeje protocolo completo se o cliente não pediu esse nível de detalhe.
- Em dúvidas complexas, entregue primeiro "resumo em 2 linhas" e pergunte se ele quer aprofundar.
- Evite repetir avisos e contexto já mencionados anteriormente na conversa.
PERSONA DE ATENDENTE ÁGIL:
- Responda como atendente de WhatsApp rápido e objetivo.
- Não inclua explicações técnicas longas nem benefícios automáticos sem solicitação explícita.

FONTE ÚNICA:
Sua ÚNICA e EXCLUSIVA fonte de informação técnica é o campo tecnico de cada SKU no CATÁLOGO_UNIFICADO, complementado pelo bloco REGRAS_GLOBAIS quando aplicável.
Você não deve usar conhecimentos externos da internet que conflitem com nossa base.
Se a informação estiver no catálogo, use-a com autoridade científica — de forma compacta.

REGRAS DE COMPORTAMENTO:
- Eduque com clareza, mas de modo objetivo. Benefícios, mecanismo e diferenciais: resuma em poucas linhas com base no CATÁLOGO_UNIFICADO; ofereça aprofundamento via pergunta final.
- Definições biológicas diretas (ex.: "TB-500 é Timosina"): uma ou duas frases, sem palestra.
- Protocolo / reconstituição / armazenamento: traga só o essencial do campo tecnico do SKU; números críticos quando existirem.
- Você está PROIBIDO de dizer "não sei" ou chamar o suporte para "quantas unidades" ou "qual o protocolo" quando a resposta estiver no catálogo e statusPagamento permitir.
- Para protocolo/unidades (quando LIBERADO): uma frase com dosagem de referência + equivalência U-100 se aplicável; cite "Protocolos de Referência de Pesquisa Orion" de forma breve. Frase de rodapé obrigatória apenas nestes casos: "Lembrando: referência científica / pesquisa."
- Tirzepatide 20mg (#OR-2026-028): se perguntarem dose/uso, use os números do objeto tecnico (ex.: 2.5mg/semana na indução; exemplo U-100) sem repetir o catálogo inteiro.
- MOTS-C Sting: uma frase tranquilizando; sem texto longo.
- Protocolos citados: fins de pesquisa/referência — não precisa repetir isso em todo parágrafo; uma menção basta quando houver números de dose.
- Se a pergunta exigir dosagem médica para caso individual, diagnóstico ou decisão clínica, responda EXATAMENTE:
"Essa é uma excelente pergunta técnica. Para sua segurança, vou encaminhar esse ponto agora mesmo para o nosso especialista responsável, que te dará o suporte detalhado em instantes. Um momento, por favor."

Use [VENDAS] ou [MUDAR_PARA_VENDAS] sempre que houver sinal claro de fechamento ou compra (incluindo aceite após valor, "quero comprar", "manda o link", confirmações curtas de fechamento). Não omita a tag nesses casos.
`.trim();

/** Remove marcas do payload enviado a APIs externas (ex.: Gemini). Tokens são expandidos de volta no WhatsApp. */
function scrubForExternalLLM(text) {
  return String(text || '')
    .replace(/Orion Peptides/gi, '⦅BR⦅')
    .replace(/\bOrion\b/gi, '⦅OR⦅')
    .replace(/Peptídeos/g, '⦅PD⦅')
    .replace(/peptídeos/g, '⦅pd⦅');
}

/** Restaura nomes apenas nas mensagens ao cliente no WhatsApp (pós-processamento). */
function expandBrandTokensForWhatsApp(text) {
  return String(text || '')
    .replace(/⦅BR⦅/g, 'Orion Peptides')
    .replace(/⦅OR⦅/g, 'Orion')
    .replace(/⦅PD⦅/g, 'Peptídeos')
    .replace(/⦅pd⦅/g, 'peptídeos');
}

const GEMINI_TOKEN_INSTRUCAO = `
--- TOKENS (respostas ao cliente) ---
Onde fizer sentido, use literalmente ⦅BR⦅ (nome completo da empresa), ⦅OR⦅ (nome curto da marca), ⦅PD⦅ ou ⦅pd⦅ (classe de moléculas, maiúsc./minúsc. conforme a frase).
`.trim();

// ========== MERCADO PAGO – Checkout (Preferences) ==========
const MP_PREFERENCES_URL = 'https://api.mercadopago.com/checkout/preferences';
const MP_PAYMENT_URL = 'https://api.mercadopago.com/v1/payments';

function mercadoPagoAxiosConfig() {
  const token = process.env.MP_ACCESS_TOKEN;
  return {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      'User-Agent': 'atual-hub-checkout/1.0'
    }
  };
}

/**
 * Cria preferência de checkout no Mercado Pago (white-label: item genérico apenas).
 * Retorna sandbox_init_point (link de teste) e id da preferência.
 */
async function criarPagamentoMercadoPago(valor, chatId = null) {
  const token = process.env.MP_ACCESS_TOKEN;
  const baseUrl = getEffectiveWebhookBaseUrl();
  if (!token || !baseUrl || !chatId) {
    console.error('[Mercado Pago] MP_ACCESS_TOKEN, URL de webhook ou chatId ausente.');
    return null;
  }

  const notificationUrl = `${baseUrl}/api/v1/priority-client-update`;
  const payload = {
    items: [
      {
        title: 'Consultoria em Performance Digital',
        description: 'Serviços de Marketing Digital - Atual Hub',
        category_id: 'services',
        quantity: 1,
        unit_price: Number(valor),
        currency_id: 'BRL'
      }
    ],
    statement_descriptor: 'ATUALHUB',
    external_reference: `chat_${chatId}`,
    notification_url: notificationUrl
  };

  try {
    const { data } = await axios.post(MP_PREFERENCES_URL, payload, mercadoPagoAxiosConfig());
    const initPoint = data?.init_point || data?.sandbox_init_point || null;
    const preferenceId = data?.id ?? null;
    return { initPoint, preferenceId };
  } catch (err) {
    console.error('[Mercado Pago] Falha ao criar preferência:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

function parsePriceToNumber(raw) {
  const normalized = normalizePriceText(raw);
  const cleaned = String(normalized || '')
    .replace(/^R\$\s*/i, '')
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? num : NaN;
}

/**
 * Checkout híbrido: gera link de pagamento direto por SKU com title camuflado.
 * Nunca expõe substância no item do Mercado Pago.
 * @param {string} sku
 * @param {string} chatId
 * @returns {Promise<{ initPoint: string|null, preferenceId: string|null, externalReference: string }|null>}
 */
async function gerarLinkPagamentoDireto(sku, chatId) {
  const skuNorm = String(sku || '').trim();
  const chatIdNorm = String(chatId || '').trim();
  const token = process.env.MP_ACCESS_TOKEN;
  const baseUrl = getEffectiveWebhookBaseUrl();
  if (!token || !baseUrl || !skuNorm || !chatIdNorm) {
    console.error('[Checkout Direto] MP_ACCESS_TOKEN, WEBHOOK_BASE_URL, sku ou chatId ausente.');
    return null;
  }

  const catalogo = await getRuntimeCatalog();
  const row = catalogo?.[skuNorm] || null;
  const comercial = row?.comercial || {};
  if (!row) {
    console.error(`[Checkout Direto] SKU não encontrado no catálogo: ${skuNorm}`);
    return null;
  }

  const precoRaw = comercial.precoOriginal ?? comercial.preco;
  const unitPrice = parsePriceToNumber(precoRaw);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    console.error(`[Checkout Direto] Preço inválido para SKU ${skuNorm}:`, precoRaw);
    return null;
  }

  const skuSuffix = skuNorm.split('-').pop() || skuNorm.replace(/[^\dA-Za-z]/g, '');
  const notificationUrl = `${baseUrl}/api/v1/priority-client-update`;
  const externalReference = `direct_${chatIdNorm}_${skuNorm}`;
  const payload = {
    items: [
      {
        title: `Consultoria e Protocolo Digital #${skuSuffix}`,
        category_id: 'services',
        quantity: 1,
        unit_price: Number(unitPrice),
        currency_id: 'BRL'
      }
    ],
    statement_descriptor: 'ATUALHUB',
    external_reference: externalReference,
    notification_url: notificationUrl
  };

  try {
    const { data } = await axios.post(MP_PREFERENCES_URL, payload, mercadoPagoAxiosConfig());
    return {
      initPoint: data?.init_point || data?.sandbox_init_point || null,
      preferenceId: data?.id || null,
      externalReference
    };
  } catch (err) {
    console.error('[Checkout Direto] Falha ao criar preferência:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

function extractMercadoPagoPaymentId(req) {
  const q = req.query || {};
  if (String(q.topic || '').toLowerCase() === 'payment' && q['data.id'] != null && String(q['data.id']).trim() !== '') {
    return String(q['data.id']).trim();
  }
  if (String(q.topic || '').toLowerCase() === 'payment' && q.id != null && String(q.id).trim() !== '') {
    return String(q.id).trim();
  }
  const body = req.body || {};
  if (String(body.type || '').toLowerCase() === 'payment' && body.data && body.data.id != null) {
    return String(body.data.id).trim();
  }
  if (String(body.topic || '').toLowerCase() === 'payment' && body.id != null && String(body.id).trim() !== '') {
    return String(body.id).trim();
  }
  if (String(body.topic || '').toLowerCase() === 'payment' && body.data && body.data.id != null) {
    return String(body.data.id).trim();
  }
  return null;
}

/**
 * data.id para o template de assinatura (query data.id ou body.data.id).
 * Doc MP: IDs alfanuméricos vindos da URL devem ir em minúsculas.
 */
function mercadoPagoDataIdForSignature(req) {
  const rawQuery = req.query?.['data.id'];
  let id =
    rawQuery != null && String(rawQuery).trim() !== ''
      ? String(rawQuery).trim()
      : '';
  if (!id && req.body?.data?.id != null) {
    id = String(req.body.data.id).trim();
  }
  if (!id) return '';
  if (/[a-zA-F]/.test(id)) {
    return id.toLowerCase();
  }
  return id;
}

function parseMercadoPagoXSignature(xSignature) {
  let ts = null;
  let v1 = null;
  if (!xSignature || typeof xSignature !== 'string') return { ts, v1 };
  const parts = xSignature.split(',');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }
  return { ts, v1 };
}

function buildMercadoPagoSignatureManifest(dataId, requestId, ts) {
  const chunks = [];
  if (dataId) chunks.push(`id:${dataId}`);
  if (requestId) chunks.push(`request-id:${requestId}`);
  if (ts != null && String(ts) !== '') chunks.push(`ts:${ts}`);
  return `${chunks.join(';')};`;
}

function mercadoPagoHmacHexEquals(secret, manifest, v1Received) {
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const recv = String(v1Received || '').trim().toLowerCase();
  const exp = String(expected).trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(recv) || !/^[0-9a-f]+$/.test(exp) || recv.length !== exp.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(exp, 'hex'), Buffer.from(recv, 'hex'));
  } catch {
    return false;
  }
}

/** Valida x-signature conforme doc MP. Sem MP_WEBHOOK_SECRET, retorna ok (dev). */
function mercadoPagoWebhookSignatureIsValid(req) {
  const secret = String(process.env.MP_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;

  const xSignature = req.get('x-signature') || req.headers['x-signature'];
  const xRequestId = req.get('x-request-id') || req.headers['x-request-id'];
  const { ts, v1 } = parseMercadoPagoXSignature(xSignature);
  if (v1 == null || String(v1).trim() === '' || ts == null || String(ts).trim() === '') {
    return false;
  }

  const dataId = mercadoPagoDataIdForSignature(req);
  if (!dataId) return false;

  const manifest = buildMercadoPagoSignatureManifest(dataId, xRequestId ? String(xRequestId).trim() : '', ts);
  return mercadoPagoHmacHexEquals(secret, manifest, v1);
}

async function buscarPagamentoMercadoPago(paymentId) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || !paymentId) return null;
  try {
    const { data } = await axios.get(`${MP_PAYMENT_URL}/${paymentId}`, mercadoPagoAxiosConfig());
    return data;
  } catch (err) {
    console.error('[Mercado Pago] Falha ao consultar pagamento:', paymentId, err.response?.status || err.message);
    return null;
  }
}

async function buscarPagamentoAprovadoPorChat(chatId) {
  const token = process.env.MP_ACCESS_TOKEN;
  const chatIdNorm = String(chatId || '').trim();
  if (!token || !chatIdNorm) return null;
  try {
    const extRef = `chat_${chatIdNorm}`;
    const { data } = await axios.get(`${MP_PAYMENT_URL}/search`, {
      ...mercadoPagoAxiosConfig(),
      params: {
        external_reference: extRef,
        sort: 'date_created',
        criteria: 'desc',
        limit: 1
      }
    });
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (!first || String(first.status || '').toLowerCase() !== 'approved') return null;
    return first;
  } catch (err) {
    console.error('[Mercado Pago] Falha ao pesquisar pagamento por chat:', chatIdNorm, err.response?.status || err.message);
    return null;
  }
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }, { apiVersion: 'v1beta' });
const fallbackModel = GEMINI_FALLBACK_MODEL
  ? genAI.getGenerativeModel({ model: GEMINI_FALLBACK_MODEL }, { apiVersion: 'v1beta' })
  : null;
const GEMINI_DEGRADE_TRIGGER_503 = Math.max(1, Number(process.env.GEMINI_DEGRADE_TRIGGER_503 || 2));
const GEMINI_DEGRADE_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.GEMINI_DEGRADE_WINDOW_MS || 10 * 60 * 1000)
);
const MESSAGE_HISTORY_LIMIT = Math.max(8, Number(process.env.MESSAGE_HISTORY_LIMIT || 8));
let gemini503Streak = 0;
let geminiDegradedUntilMs = 0;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiRetriableError(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const msg = String(err?.message || '').toLowerCase();
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || msg.includes('high demand') || msg.includes('service unavailable') || msg.includes('deadline') || msg.includes('timeout');
}

function isGemini503Error(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const msg = String(err?.message || '').toLowerCase();
  return status === 503 || msg.includes('service unavailable') || msg.includes('high demand');
}

async function generateGeminiContentWithResilience(input, context = 'general') {
  let lastErr = null;
  const degradeActive = !!fallbackModel && Date.now() < geminiDegradedUntilMs;
  const primaryModel = degradeActive ? fallbackModel : model;
  const primaryName = degradeActive ? GEMINI_FALLBACK_MODEL : GEMINI_MODEL;

  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    try {
      const out = await primaryModel.generateContent(input);
      if (!degradeActive) gemini503Streak = 0;
      return out;
    } catch (err) {
      lastErr = err;
      if (!degradeActive && isGemini503Error(err)) {
        gemini503Streak += 1;
        if (fallbackModel && gemini503Streak >= GEMINI_DEGRADE_TRIGGER_503) {
          geminiDegradedUntilMs = Date.now() + GEMINI_DEGRADE_WINDOW_MS;
          pushDebugLog(
            'warn',
            `[gemini] modo degradado ativado por ${Math.round(GEMINI_DEGRADE_WINDOW_MS / 60000)} min (${context}) | ${GEMINI_MODEL} -> ${GEMINI_FALLBACK_MODEL}`
          );
        }
      } else if (!degradeActive) {
        gemini503Streak = 0;
      }
      if (!isGeminiRetriableError(err) || attempt >= GEMINI_MAX_RETRIES) break;
      const wait = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt);
      pushDebugLog(
        'warn',
        `[gemini] retry ${attempt + 1}/${GEMINI_MAX_RETRIES} (${context}) [modelo=${primaryName}] em ${wait}ms | motivo: ${String(err?.message || err)}`
      );
      await sleepMs(wait);
    }
  }

  if (!degradeActive && fallbackModel && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
    try {
      pushDebugLog('warn', `[gemini] fallback de modelo (${context}): ${GEMINI_MODEL} -> ${GEMINI_FALLBACK_MODEL}`);
      return await fallbackModel.generateContent(input);
    } catch (fallbackErr) {
      lastErr = fallbackErr;
    }
  }

  throw lastErr || new Error('Falha desconhecida na chamada Gemini');
}

async function generateAIContentHibrido(messageHistory, systemPrompt) {
  const toOpenAiChatRole = (rawRole) => {
    const r = String(rawRole || '').toLowerCase();
    if (r === 'model') return 'assistant';
    if (r === 'assistant' || r === 'human') return 'assistant';
    return 'user';
  };

  /** No fallback (texto único p/ Gemini), rótulos no padrão Google: user | model — assistant/human voltam a model. */
  const toGeminiHistoryLabel = (rawRole) => {
    const r = String(rawRole || '').toLowerCase();
    if (r === 'user') return 'user';
    return 'model';
  };

  const safeHistory = Array.isArray(messageHistory) ? messageHistory : [];
  const trimmedHistory = safeHistory.slice(-MESSAGE_HISTORY_LIMIT);
  const openAIMessages = [
    { role: 'system', content: String(systemPrompt || '') },
    ...trimmedHistory
      .map((m) => {
        const role = toOpenAiChatRole(m?.role);
        const content = String(m?.text || '').trim();
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean)
  ];
  const sanitizeCheckoutLinkLeak = (text) => String(text || '').trim();

  try {
    if (!openai) {
      throw new Error('OPENAI_API_KEY ausente');
    }
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: openAIMessages,
      temperature: 0.5
    });
    const text = completion?.choices?.[0]?.message?.content;
    if (!text || !String(text).trim()) {
      throw new Error('OpenAI retornou resposta vazia');
    }
    return sanitizeCheckoutLinkLeak(text);
  } catch (err) {
    console.error('[OpenAI Fallback]:', err);
    const openAiMsg = String(err?.message || err || '');
    if (/rate limit|429|insufficient_quota|quota/i.test(openAiMsg)) {
      await notificarCanalOperacoes(
        'openai_rate_limit',
        `OpenAI em limitação no modelo ${OPENAI_MODEL}. Fluxo em fallback para Gemini. Detalhe: ${openAiMsg.slice(0, 240)}`
      );
    }
    const fallbackPrompt = scrubForExternalLLM(
      `${String(systemPrompt || '')}\n\n--- HISTORICO RECENTE (roles Gemini: USER | MODEL) ---\n${trimmedHistory
        .map((m) => `${toGeminiHistoryLabel(m?.role).toUpperCase()}: ${String(m?.text || '')}`)
        .join('\n')}\n${GEMINI_TOKEN_INSTRUCAO}`
    );
    const result = await generateGeminiContentWithResilience(fallbackPrompt, 'chat_response_openai_fallback');
    return sanitizeCheckoutLinkLeak(result?.response?.text?.() || '');
  }
}

function createDefaultSession() {
  return {
    lastOrder: null,
    lastLink: null,
    paymentStatus: null,
    lastPaymentId: null,
    dadosEntrega: { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' },
    deliveryNotified: false,
    paymentWelcomeSent: false,
    deliveryFlowClosed: false,
    isPaused: false,
    pausedUntil: null,
    contactName: null,
    phoneNumber: null,
    phoneSource: null,
    profilePic: null,
    catalogLinkSentAt: null,
    checkoutState: null,
    lastDetectedSku: null,
    checkoutFollowupCount: 0,
    checkoutLastFollowupAt: null,
    checkoutSnoozedUntil: null,
    riskAlert: false,
    riskReason: null,
    riskAt: null,
    totalPaidOrders: 0,
    isReturningCustomer: false,
    shippingStatus: null,
    referralName: null,
    referralSource: null,
    referralAt: null,
    messageHistory: [],
    setorAtual: 'TECNICO'
  };
}

async function initDatabase() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      last_order TEXT,
      last_link TEXT,
      payment_status TEXT,
      last_payment_id TEXT,
      delivery_notified INTEGER DEFAULT 0,
      payment_welcome_sent INTEGER DEFAULT 0,
      delivery_flow_closed INTEGER DEFAULT 0,
      isPaused INTEGER DEFAULT 0,
      pausedUntil TEXT,
      contact_name TEXT,
      phone_number TEXT,
      phone_source TEXT,
      profile_pic TEXT,
      lp_link_sent_at TEXT,
      checkout_state TEXT,
      last_detected_sku TEXT,
      checkout_followup_count INTEGER DEFAULT 0,
      checkout_last_followup_at TEXT,
      checkout_snoozed_until TEXT,
      risk_alert INTEGER DEFAULT 0,
      risk_reason TEXT,
      risk_at TEXT,
      shipping_status TEXT,
      referral_name TEXT,
      referral_source TEXT,
      referral_at TEXT,
      setor_atual TEXT,
      message_history TEXT DEFAULT '[]',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_data (
      payment_id TEXT PRIMARY KEY,
      chat_id TEXT,
      status TEXT,
      value REAL,
      invoice_url TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS delivery_data (
      chat_id TEXT PRIMARY KEY,
      nome TEXT,
      rua TEXT,
      numero TEXT,
      cep TEXT,
      cidade TEXT,
      bairro TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_data (
      sku TEXT PRIMARY KEY,
      quantity INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_stock_reservation (
      payment_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_price_data (
      sku TEXT PRIMARY KEY,
      price TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bot_control (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);

  await db.exec(`
    ALTER TABLE sessions ADD COLUMN isPaused INTEGER DEFAULT 0;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN pausedUntil TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN contact_name TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN phone_number TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN phone_source TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN profile_pic TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN lp_link_sent_at TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN checkout_state TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN last_detected_sku TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN checkout_followup_count INTEGER DEFAULT 0;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN checkout_last_followup_at TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN checkout_snoozed_until TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN risk_alert INTEGER DEFAULT 0;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN risk_reason TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN risk_at TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN total_paid_orders INTEGER DEFAULT 0;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN is_returning_customer INTEGER DEFAULT 0;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN shipping_status TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN referral_name TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN referral_source TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN referral_at TEXT;
  `).catch(() => {});
}

async function loadEmergencyPauseGlobal() {
  try {
    const row = await db.get(`SELECT value FROM bot_control WHERE key = 'emergency_pause_global'`);
    emergencyPauseGlobal = String(row?.value || '0') === '1';
  } catch {
    emergencyPauseGlobal = false;
  }
}

async function saveEmergencyPauseGlobal(value) {
  const next = value ? '1' : '0';
  await db.run(
    `INSERT INTO bot_control (key, value, updated_at)
     VALUES ('emergency_pause_global', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=excluded.updated_at`,
    [next, new Date().toISOString()]
  );
  emergencyPauseGlobal = value;
}

function parseMessageHistory(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MESSAGE_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function dedupeHumanAssistantEchoForDisplay(history) {
  const arr = Array.isArray(history) ? history : [];
  const out = [];
  for (const entry of arr) {
    const currentRole = String(entry?.role || '').toLowerCase();
    const currentText = String(entry?.text || '').trim();
    const currentAt = new Date(entry?.at || 0).getTime();
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(entry);
      continue;
    }
    const prevRole = String(prev?.role || '').toLowerCase();
    const prevText = String(prev?.text || '').trim();
    const prevAt = new Date(prev?.at || 0).getTime();
    const isHumanAssistantPair =
      (prevRole === 'human' && currentRole === 'assistant') ||
      (prevRole === 'assistant' && currentRole === 'human');
    const sameText = prevText && currentText && prevText === currentText;
    const nearInTime =
      Number.isFinite(prevAt) &&
      Number.isFinite(currentAt) &&
      Math.abs(currentAt - prevAt) <= 5000;
    if (isHumanAssistantPair && sameText && nearInTime) {
      if (currentRole === 'assistant') {
        out[out.length - 1] = entry;
      }
      continue;
    }
    out.push(entry);
  }
  return out;
}

function normalizeShippingStatus(rawStatus, { paymentStatus, hasDeliveryCore }) {
  const status = String(rawStatus || '').trim().toUpperCase();
  if (status === 'SHIPPED' || status === 'DELIVERED' || status === 'PENDING_SHIPMENT') return status;
  if (paymentStatus === 'PAID' && hasDeliveryCore) return 'PENDING_SHIPMENT';
  return null;
}

async function saveSession(chatId, sessionData) {
  const s = {
    ...createDefaultSession(),
    ...(sessionData || {}),
    dadosEntrega: {
      ...createDefaultSession().dadosEntrega,
      ...((sessionData && sessionData.dadosEntrega) || {})
    },
    totalPaidOrders: Number.isFinite(Number(sessionData?.totalPaidOrders)) ? Number(sessionData.totalPaidOrders) : 0,
    isReturningCustomer: !!sessionData?.isReturningCustomer,
    shippingStatus: sessionData?.shippingStatus ? String(sessionData.shippingStatus).trim().toUpperCase() : null,
    referralName: sessionData?.referralName ? String(sessionData.referralName).trim() : null,
    referralSource: sessionData?.referralSource ? String(sessionData.referralSource).trim().toUpperCase() : null,
    referralAt: sessionData?.referralAt ? String(sessionData.referralAt).trim() : null,
    messageHistory: Array.isArray(sessionData?.messageHistory)
      ? sessionData.messageHistory.slice(-MESSAGE_HISTORY_LIMIT)
      : []
  };
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO sessions (
      chat_id, last_order, last_link, payment_status, last_payment_id,
      delivery_notified, payment_welcome_sent, delivery_flow_closed, setor_atual,
      message_history, contact_name, phone_number, phone_source, profile_pic, lp_link_sent_at,
      checkout_state, last_detected_sku, checkout_followup_count, checkout_last_followup_at, checkout_snoozed_until,
      risk_alert, risk_reason, risk_at, total_paid_orders, is_returning_customer, shipping_status,
      referral_name, referral_source, referral_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_order=excluded.last_order,
      last_link=excluded.last_link,
      payment_status=excluded.payment_status,
      last_payment_id=excluded.last_payment_id,
      delivery_notified=excluded.delivery_notified,
      payment_welcome_sent=excluded.payment_welcome_sent,
      delivery_flow_closed=excluded.delivery_flow_closed,
      setor_atual=excluded.setor_atual,
      message_history=excluded.message_history,
      contact_name=COALESCE(excluded.contact_name, sessions.contact_name),
      phone_number=COALESCE(excluded.phone_number, sessions.phone_number),
      phone_source=COALESCE(excluded.phone_source, sessions.phone_source),
      profile_pic=COALESCE(excluded.profile_pic, sessions.profile_pic),
      lp_link_sent_at=COALESCE(excluded.lp_link_sent_at, sessions.lp_link_sent_at),
      checkout_state=COALESCE(excluded.checkout_state, sessions.checkout_state),
      last_detected_sku=COALESCE(excluded.last_detected_sku, sessions.last_detected_sku),
      checkout_followup_count=COALESCE(excluded.checkout_followup_count, sessions.checkout_followup_count),
      checkout_last_followup_at=COALESCE(excluded.checkout_last_followup_at, sessions.checkout_last_followup_at),
      checkout_snoozed_until=COALESCE(excluded.checkout_snoozed_until, sessions.checkout_snoozed_until),
      risk_alert=COALESCE(excluded.risk_alert, sessions.risk_alert),
      risk_reason=COALESCE(excluded.risk_reason, sessions.risk_reason),
      risk_at=COALESCE(excluded.risk_at, sessions.risk_at),
      total_paid_orders=COALESCE(excluded.total_paid_orders, sessions.total_paid_orders),
      is_returning_customer=COALESCE(excluded.is_returning_customer, sessions.is_returning_customer),
      shipping_status=COALESCE(excluded.shipping_status, sessions.shipping_status),
      referral_name=COALESCE(excluded.referral_name, sessions.referral_name),
      referral_source=COALESCE(excluded.referral_source, sessions.referral_source),
      referral_at=COALESCE(excluded.referral_at, sessions.referral_at),
      updated_at=excluded.updated_at`,
    [
      chatId,
      s.lastOrder,
      s.lastLink,
      s.paymentStatus,
      s.lastPaymentId,
      s.deliveryNotified ? 1 : 0,
      s.paymentWelcomeSent ? 1 : 0,
      s.deliveryFlowClosed ? 1 : 0,
      s.setorAtual || null,
      JSON.stringify(s.messageHistory),
      s.contactName || null,
      s.phoneNumber || null,
      s.phoneSource || null,
      s.profilePic || null,
      s.catalogLinkSentAt || null,
      s.checkoutState || null,
      s.lastDetectedSku || null,
      Number.isFinite(Number(s.checkoutFollowupCount)) ? Number(s.checkoutFollowupCount) : 0,
      s.checkoutLastFollowupAt || null,
      s.checkoutSnoozedUntil || null,
      s.riskAlert ? 1 : 0,
      s.riskReason || null,
      s.riskAt || null,
      Number.isFinite(Number(s.totalPaidOrders)) ? Number(s.totalPaidOrders) : 0,
      s.isReturningCustomer ? 1 : 0,
      s.shippingStatus || null,
      s.referralName || null,
      s.referralSource || null,
      s.referralAt || null,
      now
    ]
  );

  await db.run(
    `INSERT INTO delivery_data (chat_id, nome, rua, numero, cep, cidade, bairro, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
      nome=excluded.nome,
      rua=excluded.rua,
      numero=excluded.numero,
      cep=excluded.cep,
      cidade=excluded.cidade,
      bairro=excluded.bairro,
      updated_at=excluded.updated_at`,
    [
      chatId,
      s.dadosEntrega.nome || '',
      s.dadosEntrega.rua || '',
      s.dadosEntrega.numero || '',
      s.dadosEntrega.cep || '',
      s.dadosEntrega.cidade || '',
      s.dadosEntrega.bairro || '',
      now
    ]
  );

  return s;
}

async function getOrCreateSession(chatId) {
  const row = await db.get('SELECT * FROM sessions WHERE chat_id = ?', [chatId]);
  const delivery = await db.get('SELECT * FROM delivery_data WHERE chat_id = ?', [chatId]);

  if (!row) {
    const base = createDefaultSession();
    await saveSession(chatId, base);
    return base;
  }

  return {
    lastOrder: row.last_order || null,
    lastLink: row.last_link || null,
    paymentStatus: row.payment_status || null,
    lastPaymentId: row.last_payment_id || null,
    dadosEntrega: {
      nome: delivery?.nome || '',
      rua: delivery?.rua || '',
      numero: delivery?.numero || '',
      cep: delivery?.cep || '',
      cidade: delivery?.cidade || '',
      bairro: delivery?.bairro || ''
    },
    deliveryNotified: !!row.delivery_notified,
    paymentWelcomeSent: !!row.payment_welcome_sent,
    deliveryFlowClosed: !!row.delivery_flow_closed,
    isPaused: !!row.isPaused,
    pausedUntil: row.pausedUntil || null,
    contactName: row.contact_name || null,
    phoneNumber: row.phone_number || null,
    phoneSource: row.phone_source || null,
    profilePic: row.profile_pic || null,
    catalogLinkSentAt: row.lp_link_sent_at || null,
    checkoutState: row.checkout_state || null,
    lastDetectedSku: row.last_detected_sku || null,
    checkoutFollowupCount: Number(row.checkout_followup_count ?? 0),
    checkoutLastFollowupAt: row.checkout_last_followup_at || null,
    checkoutSnoozedUntil: row.checkout_snoozed_until || null,
    riskAlert: !!row.risk_alert,
    riskReason: row.risk_reason || null,
    riskAt: row.risk_at || null,
    totalPaidOrders: Number(row.total_paid_orders || 0),
    isReturningCustomer: Number(row.is_returning_customer || 0) === 1,
    shippingStatus: row.shipping_status ? String(row.shipping_status).toUpperCase().trim() : null,
    referralName: normalizeReferralDisplayName(sanitizeReferralCandidate(row.referral_name)) || null,
    referralSource: row.referral_source || null,
    referralAt: row.referral_at || null,
    setorAtual: row.setor_atual || null,
    messageHistory: parseMessageHistory(row.message_history)
  };
}

function normalizeReferralDisplayName(raw) {
  const cleaned = String(raw || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const capped = cleaned.slice(0, 60).trim();
  if (!capped) return null;
  return capped.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
}

function sanitizeReferralCandidate(raw) {
  let candidate = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate) return null;
  candidate = candidate
    .replace(/\b(e|que)\s+(gostaria|queria|quero|vim|vindo|preciso|para|pra)\b[\s\S]*$/i, '')
    .replace(/\b(da orion|orion peptideos?)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate) return null;
  const words = candidate.split(' ').filter(Boolean);
  if (words.length > 4) candidate = words.slice(0, 4).join(' ');
  return candidate;
}

function detectReferralFromMessage(text = '') {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!normalized) return null;
  const patterns = [
    /\b(?:vi|vim|cheguei|conheci)\s+(?:pela?|por)\s+(?:indicacao\s+da?\s+)?([a-z0-9][a-z0-9\s'.-]{1,50})\b/i,
    /\bindicac[aã]o\s+da?\s+([a-z0-9][a-z0-9\s'.-]{1,50})\b/i,
    /\b([a-z0-9][a-z0-9\s'.-]{1,50})\s+me\s+indicou\b/i
  ];
  for (const re of patterns) {
    const match = normalized.match(re);
    if (!match?.[1]) continue;
    const referralName = normalizeReferralDisplayName(sanitizeReferralCandidate(match[1]));
    if (!referralName) continue;
    if (/^(orion|peptideos|peptideo|site|instagram|insta|whatsapp)$/i.test(referralName)) continue;
    return { referralName, referralSource: 'PHRASE' };
  }
  return null;
}

async function updateSession(chatId, patch) {
  const current = await getOrCreateSession(chatId);
  const updated = {
    ...current,
    ...patch,
    dadosEntrega: {
      ...(current.dadosEntrega || createDefaultSession().dadosEntrega),
      ...((patch && patch.dadosEntrega) || {})
    }
  };
  await saveSession(chatId, updated);
  return updated;
}

function shouldRunCheckoutCadenceForSession(session) {
  // Segurança operacional: conversas em risco/transbordo não podem receber ofertas automáticas de venda.
  if (session?.riskAlert) return false;
  if (session?.isPaused) return false;

  const payment = String(session?.paymentStatus || '').toUpperCase().trim();
  if (payment === 'PENDING' || payment === 'PAID') return false;
  if (String(session?.lastOrder || '').trim()) return false;
  if (String(session?.lastPaymentId || '').trim()) return false;
  if (!session?.catalogLinkSentAt) return false;
  const snoozedUntil = session?.checkoutSnoozedUntil ? new Date(session.checkoutSnoozedUntil).getTime() : 0;
  if (snoozedUntil > Date.now()) return false;
  return true;
}

function canSendCheckoutFollowupNow(session, nowMs) {
  const count = Number(session?.checkoutFollowupCount ?? 0);
  if (count >= CHECKOUT_FOLLOWUP_RULES.maxTotal) return false;

  const linkSentAtMs = new Date(session.catalogLinkSentAt || 0).getTime();
  if (!Number.isFinite(linkSentAtMs) || linkSentAtMs <= 0) return false;
  const requiredSinceLinkMs = (CHECKOUT_FOLLOWUP_RULES.stageDelaysMinutes[count] || 1440) * 60000;
  if (nowMs - linkSentAtMs < requiredSinceLinkMs) return false;

  const minGapMs = CHECKOUT_FOLLOWUP_RULES.minGapMinutes * 60000;
  const lastFollowupMs = session?.checkoutLastFollowupAt ? new Date(session.checkoutLastFollowupAt).getTime() : 0;
  if (lastFollowupMs > 0 && nowMs - lastFollowupMs < minGapMs) return false;

  // Conversa "quente": se cliente falou nos últimos 30 min, não enviar follow-up automático.
  const history = Array.isArray(session?.messageHistory) ? session.messageHistory : [];
  const lastUserMsg = [...history].reverse().find((m) => String(m?.role || '').toLowerCase() === 'user');
  if (lastUserMsg?.at) {
    const lastUserMs = new Date(lastUserMsg.at).getTime();
    if (Number.isFinite(lastUserMs) && nowMs - lastUserMs < 30 * 60000) return false;
  }

  return true;
}

async function checkoutFollowupsSentLast24h(chatId) {
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = await db.get(
    `SELECT COUNT(*) AS n
     FROM sessions
     WHERE chat_id = ?
       AND checkout_last_followup_at IS NOT NULL
       AND checkout_last_followup_at >= ?`,
    [chatId, dayAgoIso]
  );
  return Number(row?.n ?? 0);
}

async function runCheckoutFollowupSweep() {
  if (emergencyPauseGlobal) return;
  const rows = await db.all(
    `SELECT chat_id
     FROM sessions
     WHERE lp_link_sent_at IS NOT NULL
       AND (payment_status IS NULL OR TRIM(payment_status) = '' OR UPPER(TRIM(payment_status)) NOT IN ('PENDING','PAID'))`
  );
  for (const row of rows || []) {
    const chatId = String(row?.chat_id || '').trim();
    if (!chatId) continue;
    const session = await getOrCreateSession(chatId);
    if (!shouldRunCheckoutCadenceForSession(session)) continue;
    const nowMs = Date.now();
    if (!canSendCheckoutFollowupNow(session, nowMs)) continue;
    const sent24h = await checkoutFollowupsSentLast24h(chatId);
    if (sent24h >= CHECKOUT_FOLLOWUP_RULES.maxIn24h) continue;

    const stage = Number(session.checkoutFollowupCount || 0);
    const msg = getCheckoutFollowupMessage(stage);
    await sendHumanizedMessage(chatId, msg);
    await updateSession(chatId, {
      checkoutState: 'FOLLOWUP_ACTIVE',
      checkoutFollowupCount: stage + 1,
      checkoutLastFollowupAt: new Date().toISOString()
    });
  }
}

async function setPaymentSession(paymentId, chatId, extra = {}) {
  if (!paymentId || !chatId) return;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO payment_data (payment_id, chat_id, status, value, invoice_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(payment_id) DO UPDATE SET
      chat_id=excluded.chat_id,
      status=excluded.status,
      value=excluded.value,
      invoice_url=excluded.invoice_url,
      updated_at=excluded.updated_at`,
    [
      paymentId,
      chatId,
      extra.status || null,
      typeof extra.value === 'number' ? extra.value : null,
      extra.invoiceUrl || null,
      now
    ]
  );
}

async function refreshCustomerPurchaseStats(chatId) {
  const normalizedChatId = String(chatId || '').trim();
  if (!normalizedChatId) return { totalPaidOrders: 0, isReturningCustomer: false };
  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM payment_data
     WHERE chat_id = ?
       AND UPPER(TRIM(COALESCE(status, ''))) = 'PAID'`,
    [normalizedChatId]
  );
  const totalPaidOrders = Number(row?.total || 0);
  const isReturningCustomer = totalPaidOrders >= 1;
  await db.run(
    `UPDATE sessions
     SET total_paid_orders = ?, is_returning_customer = ?
     WHERE chat_id = ?`,
    [totalPaidOrders, isReturningCustomer ? 1 : 0, normalizedChatId]
  );
  return { totalPaidOrders, isReturningCustomer };
}

async function rebuildCustomerPurchaseStats() {
  await db.run(
    `UPDATE sessions
     SET total_paid_orders = (
       SELECT COUNT(*)
       FROM payment_data p
       WHERE p.chat_id = sessions.chat_id
         AND UPPER(TRIM(COALESCE(p.status, ''))) = 'PAID'
     ),
     is_returning_customer = CASE
       WHEN (
         SELECT COUNT(*)
         FROM payment_data p
         WHERE p.chat_id = sessions.chat_id
           AND UPPER(TRIM(COALESCE(p.status, ''))) = 'PAID'
       ) >= 1 THEN 1
       ELSE 0
     END`
  );
}

async function getChatIdByPaymentId(paymentId) {
  if (!paymentId) return null;
  const row = await db.get('SELECT chat_id FROM payment_data WHERE payment_id = ?', [paymentId]);
  return row?.chat_id || null;
}

async function appendMessageHistory(chatId, role, text) {
  const normalized = String(text || '').trim();
  if (!normalized) return;
  const at = new Date().toISOString();
  try {
    await db.run(
      `INSERT INTO message_audit (chat_id, role, text, at)
       VALUES (?, ?, ?, ?)`,
      [chatId, String(role || '').trim() || 'user', normalized, at]
    );
  } catch (err) {
    console.warn('[message_audit] falha ao persistir histórico completo:', err?.message || err);
  }
  const session = await getOrCreateSession(chatId);
  const history = Array.isArray(session.messageHistory) ? session.messageHistory : [];
  const updatedHistory = [...history, { role, text: normalized, at }].slice(
    -MESSAGE_HISTORY_LIMIT
  );
  await updateSession(chatId, { messageHistory: updatedHistory });
}

function normalizeAdminWhatsAppId(rawId) {
  const value = String(rawId || '').trim();
  if (!value) return null;
  if (value.endsWith('@c.us') || value.endsWith('@g.us')) return value;
  const onlyDigits = value.replace(/\D/g, '');
  if (!onlyDigits) return null;
  return `${onlyDigits}@c.us`;
}

function getStakeholderAlertTargets() {
  const primary = process.env.GERENTE_PROCESSO_CHAT_ID || process.env.ADMIN_CHAT_ID || '';
  const ops = process.env.OPERACOES_CHAT_ID || '';
  const candidates = [primary, ops];
  const out = [];
  const seen = new Set();
  for (const raw of candidates) {
    const normalized = normalizeAdminWhatsAppId(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Destinatários exclusivos para "venda iniciada" (sem canal de operações). */
function getStakeholderSalesStartTargets() {
  const base = SALES_START_CHAT_IDS_RAW
    ? SALES_START_CHAT_IDS_RAW.split(',').map((s) => s.trim())
    : [process.env.ADMIN_CHAT_ID || ''];
  const out = [];
  const seen = new Set();
  for (const raw of base) {
    const normalized = normalizeAdminWhatsAppId(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function buildAdminChatIdSet() {
  const base = ADMIN_CHAT_IDS_RAW
    ? ADMIN_CHAT_IDS_RAW.split(',').map((s) => s.trim())
    : [
        process.env.ADMIN_CHAT_ID || '',
        process.env.GERENTE_PROCESSO_CHAT_ID || '',
        OPERACOES_CHAT_ID || ''
      ];
  return new Set(
    base
      .map((id) => normalizeAdminWhatsAppId(id))
      .filter(Boolean)
  );
}

const ADMIN_CHAT_ID_SET = buildAdminChatIdSet();
const ADMIN_PHONE_SET = new Set(
  Array.from(ADMIN_CHAT_ID_SET)
    .map((id) => normalizeDigits(id))
    .filter(Boolean)
);

function isAdminChat(chatId, phoneNumber = '') {
  const normalized = normalizeAdminWhatsAppId(chatId);
  if (normalized && ADMIN_CHAT_ID_SET.has(normalized)) return true;
  const digits = normalizeDigits(phoneNumber);
  if (digits && ADMIN_PHONE_SET.has(digits)) return true;
  return false;
}

function redactSensitiveLine(line) {
  let out = String(line || '');
  out = out.replace(/(OPENAI_API_KEY=).*/gi, '$1***');
  out = out.replace(/(MP_ACCESS_TOKEN=).*/gi, '$1***');
  out = out.replace(/(MP_CLIENT_SECRET=).*/gi, '$1***');
  out = out.replace(/(NGROK_AUTHTOKEN=).*/gi, '$1***');
  out = out.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1***');
  return out;
}

async function resolveSessionForAdminLookup(targetRaw) {
  const target = String(targetRaw || '').trim();
  if (!target) return null;
  if (target.includes('@')) {
    return db.get('SELECT * FROM sessions WHERE chat_id = ? LIMIT 1', [target]);
  }
  const digits = target.replace(/\D/g, '');
  if (!digits) return null;
  const direct = await db.get('SELECT * FROM sessions WHERE phone_number = ? ORDER BY updated_at DESC LIMIT 1', [digits]);
  if (direct) return direct;
  return db.get(
    'SELECT * FROM sessions WHERE phone_number LIKE ? ORDER BY updated_at DESC LIMIT 1',
    [`%${digits}`]
  );
}

async function handleAdminCommand(chatId, rawText) {
  const text = String(rawText || '').trim();
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = String(cmdRaw || '').toLowerCase();

  if (cmd === '#status') {
    const pendingRow = await db.get(
      "SELECT COUNT(*) AS n FROM sessions WHERE UPPER(TRIM(COALESCE(payment_status,''))) = 'PENDING'"
    );
    const riskRow = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE COALESCE(risk_alert,0) = 1');
    const apiOnline = whatsappClientReady || whatsappClientAuthenticated;
    const webhookBase = getEffectiveWebhookBaseUrl() || 'N/A';
    const msg = [
      '📊 STATUS OPERAÇÃO',
      `API/WhatsApp: ${apiOnline ? 'ONLINE' : 'OFFLINE'}`,
      `Conexão WA pronta: ${whatsappClientReady ? 'sim' : 'não'}`,
      `Autenticado WA: ${whatsappClientAuthenticated ? 'sim' : 'não'}`,
      `Webhook base: ${webhookBase}`,
      `Pendentes pagamento: ${Number(pendingRow?.n || 0)}`,
      `Alertas de risco: ${Number(riskRow?.n || 0)}`,
      `Último evento WA: ${whatsappLastEvent || 'N/A'}`
    ].join('\n');
    await safeSendMessage(chatId, msg, 'admin_status');
    return true;
  }

  if (cmd === '#logs') {
    const nRaw = Number(args[0] || 30);
    const n = Math.max(5, Math.min(120, Number.isFinite(nRaw) ? Math.floor(nRaw) : 30));
    const lines = fs.existsSync(APP_LOG_FILE)
      ? fs.readFileSync(APP_LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-n)
      : [];
    const body = lines.map((line) => redactSensitiveLine(line)).join('\n');
    const msg = body
      ? `🧾 LOGS (${lines.length} linhas)\n${body}`
      : '🧾 LOGS\nArquivo de log vazio ou indisponível.';
    await safeSendMessage(chatId, msg, 'admin_logs');
    return true;
  }

  if (cmd === '#sessao') {
    const target = args.join(' ').trim();
    if (!target) {
      await safeSendMessage(chatId, 'Use: #sessao <telefone ou chatId>', 'admin_sessao_usage');
      return true;
    }
    const row = await resolveSessionForAdminLookup(target);
    if (!row) {
      await safeSendMessage(chatId, `Sessão não encontrada para: ${target}`, 'admin_sessao_not_found');
      return true;
    }
    const msg = [
      '🧠 SESSÃO',
      `chatId: ${row.chat_id || 'N/A'}`,
      `contato: ${row.contact_name || 'N/A'}`,
      `telefone: ${row.phone_number || 'N/A'}`,
      `payment_status: ${row.payment_status || 'null'}`,
      `checkout_state: ${row.checkout_state || 'null'}`,
      `last_payment_id: ${row.last_payment_id || 'null'}`,
      `isPaused: ${Number(row.isPaused || 0) === 1 ? 'sim' : 'não'}`,
      `risk_alert: ${Number(row.risk_alert || 0) === 1 ? 'sim' : 'não'}`,
      `updated_at: ${row.updated_at || 'N/A'}`
    ].join('\n');
    await safeSendMessage(chatId, msg, 'admin_sessao');
    return true;
  }

  if (cmd === '#resumo') {
    const pendingRow = await db.get(
      "SELECT COUNT(*) AS n FROM sessions WHERE UPPER(TRIM(COALESCE(payment_status,''))) = 'PENDING'"
    );
    const paidRow = await db.get(
      "SELECT COUNT(*) AS n FROM sessions WHERE UPPER(TRIM(COALESCE(payment_status,''))) = 'PAID'"
    );
    const pendingList = await db.all(
      `SELECT chat_id, contact_name, phone_number
       FROM sessions
       WHERE UPPER(TRIM(COALESCE(payment_status,''))) = 'PENDING'
       ORDER BY datetime(updated_at) DESC
       LIMIT 5`
    );
    const paidList = await db.all(
      `SELECT chat_id, contact_name, phone_number
       FROM sessions
       WHERE UPPER(TRIM(COALESCE(payment_status,''))) = 'PAID'
       ORDER BY datetime(updated_at) DESC
       LIMIT 5`
    );

    const fmt = (row) => {
      const nome = String(row?.contact_name || '').trim() || 'Sem nome';
      const fone = String(row?.phone_number || '').trim() || String(row?.chat_id || 'N/A');
      return `- ${nome} | ${fone}`;
    };

    const msg = [
      '📌 RESUMO COMERCIAL',
      `Pagas: ${Number(paidRow?.n || 0)}`,
      `Aguardando pagamento: ${Number(pendingRow?.n || 0)}`,
      '',
      'Pendentes (top 5):',
      ...(pendingList?.length ? pendingList.map(fmt) : ['- Nenhuma']),
      '',
      'Pagas (top 5):',
      ...(paidList?.length ? paidList.map(fmt) : ['- Nenhuma'])
    ].join('\n');

    await safeSendMessage(chatId, msg, 'admin_resumo');
    return true;
  }

  await safeSendMessage(
    chatId,
    'Comandos admin: #status | #logs [n] | #sessao <telefone/chatId> | #resumo',
    'admin_help'
  );
  return true;
}

function formatToPhone(id) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/@c\.us$/i, '')
    .replace(/@lid$/i, '')
    .replace(/@g\.us$/i, '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/^chat_/i, '')
    .replace(/[^\d]/g, '');
  return cleaned || null;
}

async function resolveContactMetaFromMessage(msg) {
  let phoneNumber = null;
  let contactName = null;
  let phoneSource = null;
  let profilePic = null;

  // Prioridade 1: msg.author/msg.from quando vierem em @c.us
  const p1 = [msg?.author, msg?.from];
  for (const candidate of p1) {
    const value = String(candidate || '').trim();
    if (/@c\.us$/i.test(value)) {
      phoneNumber = formatToPhone(value);
      if (phoneNumber) {
        phoneSource = 'INFERRED';
        break;
      }
    }
  }

  // Prioridade 2: msg.getContact() -> contact.number
  try {
    const contact = await msg.getContact();
    if (contact) {
      const inferredName = String(
        contact.pushname || contact.name || contact.shortName || ''
      ).trim();
      contactName = inferredName || null;
      if (!phoneNumber) {
        const numberFromContact = formatToPhone(
          contact.number ||
            contact.id?._serialized ||
            contact.id?.user ||
            contact.userid ||
            ''
        );
        if (numberFromContact) {
          phoneNumber = numberFromContact;
          phoneSource = 'VERIFIED';
        }
      }
      try {
        const profilePicUrl = await contact.getProfilePicUrl();
        if (typeof profilePicUrl === 'string' && profilePicUrl.trim()) {
          profilePic = profilePicUrl.trim();
        }
      } catch {
        // Alguns usuários restringem foto; manter best-effort sem falhar fluxo.
      }
    }
  } catch {
    // best-effort: sem bloquear processamento de mensagem
  }

  // Prioridade 3: objeto bruto msg._data
  if (!phoneNumber) {
    const p3 = [msg?._data?.id?.participant, msg?._data?.from];
    for (const candidate of p3) {
      phoneNumber = formatToPhone(candidate);
      if (phoneNumber) {
        phoneSource = 'INFERRED';
        break;
      }
    }
  }

  return { phoneNumber, contactName, phoneSource, profilePic };
}

async function notificarFernandoTransbordo(chatId, motivo) {
  const stakeholderTargets = getStakeholderAlertTargets();
  const alerta = `⚠️ ALERTA TRANSBORDO: O cliente ${chatId} precisa de suporte humano/técnico. Motivo: ${motivo}.`;

  try {
    if (stakeholderTargets.length === 0) {
      console.log(`[Transbordo] GERENTE_PROCESSO_CHAT_ID/ADMIN_CHAT_ID inválido. Alerta pendente: ${alerta}`);
      return;
    }
    for (const targetId of stakeholderTargets) {
      await safeSendMessage(targetId, alerta, 'notificarFernandoTransbordo');
    }
    console.log('[Transbordo] Alerta enviado ao boss/admin.');
  } catch (err) {
    console.error('[Transbordo Error] Falha ao notificar boss/admin:', err?.message || err);
  }
}

const operacoesAlertState = new Map();
async function notificarCanalOperacoes(eventKey, message, cooldownMs = 10 * 60 * 1000) {
  try {
    if (!OPERACOES_CHAT_ID) return false;
    const key = String(eventKey || 'generic').trim() || 'generic';
    const now = Date.now();
    const lastAt = Number(operacoesAlertState.get(key) || 0);
    if (lastAt > 0 && now - lastAt < cooldownMs) return false;

    const payload = `🚨 ALERTA OPERAÇÕES\nTipo: ${key}\n${String(message || '').trim()}`;
    const sent = await safeSendMessage(OPERACOES_CHAT_ID, payload, `ops_alert_${key}`);
    if (sent) {
      operacoesAlertState.set(key, now);
      pushDebugLog('warn', `[ops-alert] enviado ${key}`);
    }
    return !!sent;
  } catch (err) {
    console.error('[Operacoes Alert] Falha ao notificar canal:', err?.message || err);
    return false;
  }
}

function detectSpecializedHandoffByBotText(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;
  /** Evita falso positivo em copy normal ("Sou o especialista técnico..."). Só conta encaminhamento real. */
  const patterns = [
    /encaminh/,
    /nosso\s+especialista\s+respons[aá]vel|especialista\s+respons[aá]vel/,
    /time de log[ií]stica/,
    /suporte (humano|especializado)/,
    /acionar nosso time/,
    /atendimento (humano|especializado)/,
    /equipe .*te atualizar/
  ];
  return patterns.some((rx) => rx.test(normalized));
}

function detectCriticalHumanOrClinicalHandoff(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized.trim()) return { matched: false, reason: null };

  const humanTerms =
    /\b(humano|humana|atendente|atendimento humano|atendimento real|pessoa real|pessoa fisica|pessoa mesmo|gente de verdade)\b/.test(
      normalized
    );
  const transferVerbs = /\b(falar|transferir|direcionar|encaminhar|chamar|passar|conectar)\b/.test(normalized);
  const asksHuman = humanTerms && transferVerbs;
  const asksHumanQuestion =
    /\b(posso|quero|preciso|tem como|consigo)\b.*\b(falar|falo|falar com|atendimento)\b.*\b(pessoa|humano|humana|atendente)\b/.test(
      normalized
    ) ||
    /\b(falar com|atendimento de)\b.*\b(pessoa fisica|pessoa real|pessoa mesmo|gente de verdade)\b/.test(normalized);
  const asksThais = /\b(falar|transferir|direcionar|encaminhar|chamar)\b.*\b(thais|tais)\b/.test(normalized);

  // Dúvidas técnicas comuns de protocolo (dose/UI/diluição) não devem mais transbordar sozinhas.
  // Transbordo crítico aqui fica restrito a sinais de possível evento adverso.
  const clinicalStrong = /\b(efeito colateral|passando mal|passar mal|pressao|pressao alta|reacao|alergia)\b/.test(
    normalized
  );

  if (asksHuman || asksHumanQuestion || asksThais) {
    return { matched: true, reason: 'Cliente pediu atendimento humano explícito' };
  }
  if (clinicalStrong) {
    return { matched: true, reason: 'Sinal clínico/dosagem sensível detectado' };
  }
  return { matched: false, reason: null };
}

function detectCheckoutFrictionIntent(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized.trim()) return false;
  const atritoKeywords = [
    'lento',
    'travou',
    'nao abriu',
    'complicado',
    'dificil',
    'nao achei',
    'nao consegui',
    'nao deu certo',
    'nao deu',
    'deu errado',
    'nao funcionou',
    'nao funciona',
    'nao carregou',
    'nao abre',
    'deu problema',
    'erro no site',
    'nao aceita',
    'onde clica',
    'gera o pix',
    'faz por aqui'
  ];
  return atritoKeywords.some((term) => normalized.includes(term));
}

function detectShippingQuestion(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized.trim()) return false;
  return (
    /\bfrete\b/.test(normalized) ||
    /\benvio\b/.test(normalized) ||
    /\bentrega\b/.test(normalized) ||
    /\bcep\b/.test(normalized)
  );
}

function detectTechnicalProtocolQuestion(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized.trim()) return false;
  return (
    /\breconstitu/.test(normalized) ||
    /\bconstituid/.test(normalized) ||
    /\bdilu(i|ir|icao)\b/.test(normalized) ||
    /\bagita(r|do|da|cao)?\b/.test(normalized) ||
    /\bvalidade\b/.test(normalized) ||
    /\bconserva/.test(normalized) ||
    /\barmazen/.test(normalized) ||
    /\bgeladeira\b/.test(normalized) ||
    /\bfreezer\b/.test(normalized) ||
    /\bseringa\b/.test(normalized) ||
    /\bui\b/.test(normalized) ||
    /\bunidades?\b/.test(normalized)
  );
}

function buildShippingPolicyReply() {
  return [
    'Perfeito! Nosso frete e 100% gratis para todo o Brasil.',
    'Em toda compra, voce tambem recebe o Kit Orion de Inicializacao (4 seringas de aplicacao, 1 seringa de diluicao e agua para diluicao em cortesia).',
    'Se quiser, ja te ajudo a fechar seu pedido por aqui.'
  ].join(' ');
}

function hasRecentStoreLink(session, withinMs = 24 * 60 * 60 * 1000) {
  const sentAtMs = session?.catalogLinkSentAt ? new Date(session.catalogLinkSentAt).getTime() : 0;
  if (!Number.isFinite(sentAtMs) || sentAtMs <= 0) return false;
  return Date.now() - sentAtMs <= withinMs;
}

function shouldNotifyHandoffNow(session, cooldownMs = 10 * 60 * 1000) {
  const lastAt = session?.riskAt ? new Date(session.riskAt).getTime() : 0;
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true;
  return Date.now() - lastAt >= cooldownMs;
}

function normalizeCmdText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCommandAliases(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => normalizeCmdText(s))
    .filter(Boolean);
}

function detectHumanChatControlAction(text) {
  const normalized = normalizeCmdText(text);
  if (!normalized) return null;

  const pauseAliases = parseCommandAliases(HUMAN_CHAT_CMD_PAUSE);
  const resumeAliases = parseCommandAliases(HUMAN_CHAT_CMD_RESUME);

  if (pauseAliases.includes(normalized)) return 'PAUSE_CHAT';
  if (resumeAliases.includes(normalized)) return 'RESUME_CHAT';
  return null;
}

function logBotEmAtendimento(chatId, setor, contexto = 'mensagem') {
  const setorNormalizado = String(setor || 'TECNICO').toUpperCase();
  const ts = new Date().toLocaleString('pt-BR', { hour12: false });
  console.log(`[${ts}] [Atendimento] chatId=${chatId} | bot=${setorNormalizado} | contexto=${contexto}`);
}

function deveDispararTransbordoPorRiscoClinico(texto) {
  const normalized = String(texto || '').toLowerCase();
  if (!normalized) return false;

  const padroesRisco = [
    /\bgravidez|gr[áa]vida|gestante|amamenta[cç][ãa]o|lactante\b/i,
    /\bdoen[cç]a\s+grave|c[âa]ncer|tumor|met[áa]stase|insufici[êe]ncia|cirrose|avc|infarto|epilepsia\b/i,
    /\brem[eé]dio\s+controlado|tarja\s+preta|benzodiazep[ií]nico|opioide|clonazepam|rivotril\b/i
  ];

  return padroesRisco.some((regex) => regex.test(normalized));
}

function getMissingDeliveryFields(dadosEntrega) {
  return CAMPOS_OBRIGATORIOS_ENTREGA.filter((campo) => !String(dadosEntrega?.[campo] || '').trim());
}

function getFieldLabel(campo) {
  const labels = {
    nome: 'Nome',
    rua: 'Rua',
    numero: 'Número',
    cep: 'CEP',
    cidade: 'Cidade',
    bairro: 'Bairro'
  };
  return labels[campo] || campo;
}

function mergeDadosEntrega(atual, parcial) {
  const base = atual || { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' };
  const next = { ...base };
  for (const campo of CAMPOS_ENTREGA) {
    const valor = String(parcial?.[campo] || '').trim();
    if (valor) next[campo] = valor;
  }
  return next;
}

/** Últimas mensagens do cliente (histórico) para extrair endereço mesmo se a msg atual for só "oi" ou se uma msg anterior foi mal roteada (ex.: FAQ de frete). */
function buildTextForDeliveryExtraction(session) {
  const arr = Array.isArray(session?.messageHistory) ? session.messageHistory : [];
  const userLines = [];
  for (let i = 0; i < arr.length; i += 1) {
    if (String(arr[i]?.role || '').toLowerCase() === 'user') {
      const t = String(arr[i]?.text || '').trim();
      if (t) userLines.push(t);
    }
  }
  return userLines.slice(-8).join('\n').slice(0, 2500);
}

/** Preenche campos quando o cliente manda tudo numa linha sem rótulos ("Rua X n 30 bairro Cidade ES cep ..."). */
function extractEnderecoHeuristicoLinhaUnica(text) {
  const out = { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' };
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return out;

  const cepM = t.match(/\b(\d{5}-?\d{3})\b/);
  if (cepM) {
    const d = cepM[1].replace(/\D/g, '');
    out.cep = d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cepM[1];
  }

  const bloco = t.match(
    /\b(rua|av\.?|avenida)\s+(.+?)\s+n\.?[ºo°]?\s*(\d+)\s+(.+?)\s+(Vila\s+Velha|Vitória|Serra|Cariacica|Guarapari)\s+(?:ES\s*)?(?:cep\s*)?/i
  );
  if (bloco) {
    out.rua = `${bloco[1]} ${bloco[2]}`.replace(/\s+/g, ' ').trim();
    out.numero = String(bloco[3] || '').trim();
    out.bairro = String(bloco[4] || '').trim();
    out.cidade = bloco[5].replace(/\s+/g, ' ').trim();
  }
  return out;
}

function extractDadosEntregaFallback(text) {
  const normalized = String(text || '');
  const out = { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' };

  const cep = normalized.match(/\b\d{5}-?\d{3}\b/);
  if (cep) out.cep = cep[0];

  const nome = normalized.match(/(?:^|\n|\b)(?:nome(?:\s+completo)?)[\s:.-]+([^\n,]+)/i);
  if (nome) out.nome = nome[1].trim();

  const cidade = normalized.match(/(?:^|\n|\b)cidade[\s:.-]+([^\n,]+)/i);
  if (cidade) out.cidade = cidade[1].trim();

  const bairro = normalized.match(/(?:^|\n|\b)bairro[\s:.-]+([^\n,]+)/i);
  if (bairro) out.bairro = bairro[1].trim();

  const rua = normalized.match(/(?:^|\n|\b)(?:rua|avenida|av\.?|travessa|alameda|endere[cç]o)[\s:.-]+([^\n,]+)/i);
  if (rua) out.rua = rua[1].trim();

  const numero = normalized.match(/(?:^|\n|\b)(?:n[uú]mero|n[ºo.]|num)[\s:.-]*([^\n,]+)/i);
  if (numero) out.numero = numero[1].trim();

  return out;
}

function isClosingMessage(text) {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) return false;
  const closingRegex = /\b(obrigad[oa]|valeu|vou aguardar|aguardo|tchau|até mais|ate mais|ok|okay|blz|beleza|perfeito|fechado|combinado)\b/i;
  return closingRegex.test(normalized);
}

function hasExplicitPurchaseIntent(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const asksCatalog =
    /\b(catalogo|catalogo completo|site|todos os produtos|lista de produtos|ver tudo|mostrar tudo|carrinho)\b/.test(normalized);
  if (asksCatalog && /\bmanda o link\b/.test(normalized)) return false;
  const typoCardCredit = /\bcart\w*\b.*\bcred\w*\b/.test(normalized);
  return (
    normalized.includes('quero comprar') ||
    normalized.includes('como eu pago') ||
    normalized.includes('manda o link') ||
    normalized.includes('manda o pix') ||
    normalized.includes('gera o link') ||
    normalized.includes('gerar o link') ||
    normalized.includes('pagar no pix') ||
    normalized.includes('pagar no cartao') ||
    normalized.includes('pagar no cartão') ||
    normalized.includes('quero fechar') ||
    normalized.includes('pode fechar') ||
    normalized.includes('fechar pedido') ||
    normalized.includes('finalizar pedido') ||
    normalized.includes('quero pagar') ||
    normalized.includes('quero o link de pagamento') ||
    normalized.includes('enviar link de pagamento') ||
    normalized.includes('link de pagamento') ||
    typoCardCredit
  );
}

/** Afirmações curtas típicas após oferta de preço/fechamento — intenção máxima de compra. */
function isShortPurchaseAffirmation(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 80) return false;
  const lower = t.toLowerCase();
  if (/^(sim|sii|ss|ok|okay|blz|beleza|pode ser|pode fechar|fechamos|isso|fecha|combinado|bora|vamos|fechado|perfeito|aceito|fecha assim)\.?$/i.test(
    lower
  )) {
    return true;
  }
  if (/^(sim|ok)\s*,?\s*(pode|fechamos|bora)/i.test(lower)) return true;
  if (/^(pode fechar|pode ser|fechamos|é isso)/i.test(lower)) return true;
  return false;
}

function hasStrongPurchaseSignal(text) {
  return hasExplicitPurchaseIntent(text) || isShortPurchaseAffirmation(text);
}

function isDirectCheckoutConfirmation(text) {
  const lower = String(text || '')
    .toLowerCase()
    .trim();
  if (!lower) return false;
  const cleaned = lower.replace(/[!.?,;:]+$/g, '').trim();
  return /^(sim|ok|okay|quero|pode gerar|gera|pode|bora|vamos|fechar|pode fechar|confirmo|confirmado|manda|manda ai|manda aí|isso|perfeito|fechado)\b/.test(
    cleaned
  );
}

function isPermissiveDirectAssistConfirmation(text, session) {
  const state = String(session?.checkoutState || '').toUpperCase().trim();
  if (state !== 'DIRECT_ASSIST') return false;
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  if (/\b(nao|não|espera|aguarde|depois|cancelar|cancela|talvez)\b/.test(normalized)) return false;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  return wordCount > 0 && wordCount <= 5;
}

function detectCatalogBrowseIntent(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return (
    /\b(onde|aonde)\b.*\b(ver|vejo)\b/.test(normalized) ||
    /\b(ver|vejo)\b.*\b(tudo|todos|catalogo|catalogo completo|produtos)\b/.test(normalized) ||
    /\b(catalogo|catalogo completo|todos os produtos|lista de produtos|site|carrinho)\b/.test(normalized) ||
    /\b(td|tudo)\b.*\b(voces|vcs|voce|tem)\b/.test(normalized) ||
    /\b(oq|o que)\b.*\b(voces|vcs|tem|tem ai|tem por ai)\b/.test(normalized) ||
    /\bquais\b.*\b(produtos|itens)\b/.test(normalized) ||
    /\bver\b.*\b(produtos de voces|produtos de vcs|todos itens)\b/.test(normalized)
  );
}

function detectProductDiscoveryIntent(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!normalized) return false;
  return (
    /\b(outro|outra|outros|outras)\s+(produto|produtos|item|itens)\b/.test(normalized) ||
    /\b(que mais tem|o que mais tem|mostra mais|mostrar mais|mais opcoes|mais opções)\b/.test(normalized) ||
    /\b(ver|mostrar)\b.*\b(outros produtos|mais produtos|catalogo)\b/.test(normalized)
  );
}

function shouldProceedDirectCheckoutFromMessage(text, session = null) {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  if (detectTechnicalProtocolQuestion(normalized)) return false;
  if (detectCatalogBrowseIntent(normalized) || detectProductDiscoveryIntent(normalized)) return false;
  const checkoutState = String(session?.checkoutState || '').toUpperCase().trim();
  const inDirectAssist = checkoutState === 'DIRECT_ASSIST';
  return (
    hasExplicitPurchaseIntent(normalized) ||
    ((isShortPurchaseAffirmation(normalized) || isDirectCheckoutConfirmation(normalized)) && inDirectAssist)
  );
}

function buildSiteLikeSyntheticProtocolMessage(sku, catalogoCompleto) {
  const item = catalogoCompleto?.[sku];
  const preco = String(item?.comercial?.precoOriginal ?? item?.comercial?.preco ?? '').trim();
  return `🛒 NOVO PROTOCOLO - ORION\nItens: 1x ${sku} (${preco})\nTotal: ${preco}\nQuero realizar o pagamento seguro.`;
}

function buildHumanizedSkuQuestion(catalogRuntime, contextSku = '') {
  const fallback = 'Perfeito, já te ajudo nisso 👍 Me confirma só o produto e a dosagem (ex.: Tirzepatide 20mg) para eu gerar seu link agora.';
  const sku = String(contextSku || '').trim();
  const item = sku ? catalogRuntime?.[sku] : null;
  const nome = String(item?.comercial?.nome || '').trim();
  if (!nome) return fallback;

  const doses = Object.values(catalogRuntime || {})
    .filter((row) => String(row?.comercial?.nome || '').trim().toLowerCase() === nome.toLowerCase())
    .map((row) => String(row?.comercial?.dosagem || '').trim())
    .filter(Boolean);
  const uniqDoses = [...new Set(doses)];

  if (uniqDoses.length >= 2 && uniqDoses.length <= 6) {
    return `Perfeito, já te ajudo nisso 👍 Me confirma só a dosagem de ${nome}: ${uniqDoses.join(', ')}?`;
  }
  return `Perfeito, já te ajudo nisso 👍 Me confirma só ${nome} com a dosagem para eu gerar seu link agora?`;
}

async function replacePaymentPlaceholderIfPossible(chatId, session, responseText, userMessage = '') {
  let text = String(responseText || '');
  const storeUrl = 'https://green-koala-180415.hostingersite.com/';
  const hasSitePlaceholder = text.includes('[LINK_SITE]');
  const hasPaymentPlaceholder = text.includes('[LINK_PAGAMENTO]');
  const catalogIntent = detectCatalogBrowseIntent(userMessage);
  const checkoutIntent = shouldProceedDirectCheckoutFromMessage(userMessage, session);

  // Blindagem de desalinhamento da IA:
  // - Se estiver em intenção de checkout e a IA escrever URL da loja, converte para placeholder de pagamento.
  // - Se estiver em intenção de catálogo e a IA escrever URL do Mercado Pago, converte para URL da loja.
  if (checkoutIntent) {
    text = text.replace(/https?:\/\/green-koala-180415\.hostingersite\.com\/?/gi, '[LINK_PAGAMENTO]');
  }
  if (catalogIntent) {
    text = text.replace(/https?:\/\/[^\s]*mercadopago\.com\.br[^\s]*/gi, storeUrl);
  }

  if (hasSitePlaceholder || hasPaymentPlaceholder) {
    pushDebugLog(
      'info',
      `[intent-router] chat=${chatId} hasSite=${hasSitePlaceholder} hasPay=${hasPaymentPlaceholder} catalogIntent=${catalogIntent} checkoutIntent=${checkoutIntent} sku=${String(
        session?.lastDetectedSku || ''
      )}`
    );
  }

  if (text.includes('[LINK_SITE]')) {
    text = text.replace(/\[LINK_SITE\]/g, storeUrl);
  }
  if (!text.includes('[LINK_PAGAMENTO]')) return text;

  // Se não houver intenção clara de checkout imediato, nunca gerar MP por placeholder.
  if (!checkoutIntent || catalogIntent) {
    pushDebugLog('info', `[intent-router] route=SITE reason=no-checkout-or-catalog chat=${chatId}`);
    return text.replace(/\[LINK_PAGAMENTO\]/g, storeUrl);
  }
  // Checkout com intenção confirmada deve passar pelo motor estruturado (estoque+reserva+pagamento),
  // então aqui mantemos placeholder para tratamento determinístico no fluxo principal.
  pushDebugLog('info', `[intent-router] route=CHECKOUT_STRUCTURED_PENDING chat=${chatId}`);
  return text;
}

function isPendingPaymentFollowup(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;
  return (
    /\b(ja|já)\s*paguei\b/i.test(normalized) ||
    /\bpaguei\b/i.test(normalized) ||
    /\bpagamento\s*(aprovou|confirmou|confirmado)\b/i.test(normalized) ||
    /\bconfirmou\s*o\s*pagamento\b/i.test(normalized) ||
    /\b(ta|tá|est[aá])\s*(ai|aí)\b/i.test(normalized) ||
    /\b(tem|teve)\s*alguma\s*atualiza(c|ç)[aã]o\b/i.test(normalized)
  );
}

/**
 * Resposta com links oficiais quando o cliente pede Instagram, TikTok ou redes em geral.
 * Retorna null se a mensagem não for sobre isso.
 */
function buildSocialMediaReply(rawMessage) {
  const n = String(rawMessage || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!n.trim()) return null;

  const wantsIg = /\binstagram\b|\binsta\b/.test(n);
  const wantsTt = /\btiktok\b|tik[\s-]?tok/.test(n);
  const wantsGeneric =
    /\bredes?\s+sociais\b/.test(n) ||
    /\brede\s+social\b/.test(n) ||
    /\bno\s+instagram\b/.test(n) ||
    /\bno\s+tiktok\b/.test(n) ||
    /\bdo\s+instagram\b/.test(n) ||
    /\bdo\s+tiktok\b/.test(n) ||
    /\b(voces|vcs)\s+no\s+(instagram|insta|tik|tiktok)\b/.test(n);

  if (!wantsIg && !wantsTt && !wantsGeneric) return null;

  if (wantsIg && wantsTt) {
    return `Aqui estão nossos canais:\nInstagram: ${ORION_SOCIAL_INSTAGRAM_URL}\nTikTok: ${ORION_SOCIAL_TIKTOK_URL}`;
  }
  if (wantsIg) return `Nosso Instagram: ${ORION_SOCIAL_INSTAGRAM_URL}`;
  if (wantsTt) return `Nosso TikTok: ${ORION_SOCIAL_TIKTOK_URL}`;
  return `Aqui estão nossas redes:\nInstagram: ${ORION_SOCIAL_INSTAGRAM_URL}\nTikTok: ${ORION_SOCIAL_TIKTOK_URL}`;
}

async function buildDeterministicFallbackReply(userMessage, session) {
  const social = buildSocialMediaReply(userMessage);
  if (social) return social;

  const text = String(userMessage || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const payment = String(session?.paymentStatus || '').toUpperCase().trim();

  if (payment === 'PAID') {
    const missing = getMissingDeliveryFields(session?.dadosEntrega || { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' });
    if (missing.length > 0) {
      return `Quero te ajudar a concluir rapidinho. Para seguir com seu envio, me confirme agora apenas: ${getFieldLabel(missing[0])}.`;
    }
    return 'Pagamento já confirmado e endereço em andamento. Você quer revisar os dados de entrega ou aguardar a atualização do envio?';
  }

  if (payment === 'PENDING' || isPendingPaymentFollowup(text)) {
    const linkExtra = session?.lastLink ? `\n\nSe precisar, segue novamente o link:\n${session.lastLink}` : '';
    return `Perfeito, já localizei seu pedido como aguardando confirmação de pagamento. Assim que aprovar, eu te aviso por aqui automaticamente.${linkExtra}`;
  }

  if (String(session?.checkoutState || '').toUpperCase() === 'DIRECT_ASSIST') {
    return 'Consigo agilizar por aqui sim. Me confirme o protocolo exato (SKU ou nome + dosagem) para eu seguir com seu link.';
  }

  // Se o cliente já citou produto + dosagem, responder objetivamente com SKU/preço sem cair em pergunta genérica.
  try {
    const catalogRuntime = await getRuntimeCatalog();
    const skuDetected = detectSingleSkuFromCustomerText(userMessage, catalogRuntime);
    if (skuDetected && skuDetected !== '__MULTI__' && catalogRuntime?.[skuDetected]?.comercial) {
      const c = catalogRuntime[skuDetected].comercial;
      const label = `${c.nome || 'Protocolo'} ${c.dosagem || ''}`.trim();
      const priceText = c.precoOriginal || c.preco || 'valor sob consulta';
      return `Perfeito! O ${label} (${skuDetected}) está disponível por ${priceText}. Você quer que eu gere agora o link de pagamento desse produto por aqui, ou prefere que eu te passe mais detalhes dele antes?`;
    }
  } catch {}

  if (detectCheckoutFrictionIntent(text) || /\b(site|checkout|carrinho|pix|cartao|cartao|link)\b/i.test(text)) {
    return 'Entendi. Você quer que eu te ajude a finalizar pelo site ou prefere que eu agilize por aqui com o link direto?';
  }

  if (/\b(endereco|rua|numero|cep|bairro|cidade)\b/i.test(text)) {
    return 'Perfeito. Para te orientar corretamente, me diga em uma frase se você quer concluir pagamento primeiro ou validar os dados de entrega.';
  }

  return 'Quero te ajudar do jeito mais rápido possível. Você pode me dizer em uma frase se deseja: (1) finalizar pagamento, (2) suporte do pedido/envio, ou (3) tirar dúvida técnica?';
}

async function extractDadosEntregaComGemini(texto, dadosAtuais) {
  const promptExtracao = `
Extraia dados de entrega da mensagem do cliente.
Retorne APENAS JSON válido (sem markdown), com as chaves:
nome, rua, numero, cep, cidade, bairro.
Se não encontrar um campo, retorne string vazia.

Dados já coletados:
${JSON.stringify(dadosAtuais)}

Mensagem do cliente:
${texto}
`.trim();

  const promptExtracaoApi = scrubForExternalLLM(promptExtracao);

  try {
    const result = await generateGeminiContentWithResilience(promptExtracaoApi, 'extract_dados_entrega');
    const raw = (result.response?.text?.() || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        nome: String(parsed?.nome || '').trim(),
        rua: String(parsed?.rua || '').trim(),
        numero: String(parsed?.numero || '').trim(),
        cep: String(parsed?.cep || '').trim(),
        cidade: String(parsed?.cidade || '').trim(),
        bairro: String(parsed?.bairro || '').trim()
      };
    }
  } catch (err) {
    console.warn('[Entrega Warning] Falha na extração via Gemini, usando fallback local.');
  }

  return extractDadosEntregaFallback(texto);
}

/**
 * Áudio: transcrição pura para o pipeline de texto. Não enviar esta saída ao WhatsApp.
 * Logs detalhados ficam no servidor (debug).
 */
async function transcribeAudioWithGemini(media) {
  const prompt = `Tarefa: transcrever literalmente o áudio.
Regras obrigatórias:
- Responda APENAS com o texto falado (fiel ao que foi dito).
- NÃO inclua transcrição entre aspas, NÃO use prefixos como "Transcrição:", "O cliente disse", "Entendi que".
- NÃO descreva o áudio, NÃO analise intenção, NÃO liste tokens, NÃO use JSON ou markdown.
- Se não houver fala inteligível, responda exatamente a palavra: VAZIO`;
  const promptApi = scrubForExternalLLM(prompt);
  const result = await generateGeminiContentWithResilience({
    contents: [{ role: 'user', parts: [{ text: promptApi }, { inlineData: { mimeType: media.mimetype, data: media.data } }] }]
  }, 'transcribe_audio');
  const raw = (result.response?.text?.() || '').trim();
  console.log('[Áudio] Resposta bruta Gemini (debug interno):', raw);
  if (!raw || /^vazio$/i.test(raw)) return '';
  return raw;
}

// ========== INICIALIZAÇÃO WHATSAPP ==========
function getPuppeteerExecutablePath() {
  try {
    const puppeteer = require('puppeteer');
    const ep = puppeteer.executablePath();
    if (ep && fs.existsSync(ep)) return ep;
  } catch (_) {}
  return undefined;
}

let whatsappClientReady = false;
const puppeteerChromeExe = getPuppeteerExecutablePath();
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: WWEBJS_DATA_ROOT,
    clientId: WWEBJS_CLIENT_ID
  }),
  webVersionCache: {
    type: 'remote',
    remotePath:
      'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018915444-alpha.html'
  },
  puppeteer: {
    ...(puppeteerChromeExe ? { executablePath: puppeteerChromeExe } : {}),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  }
});

client.on('qr', async (qr) => {
  whatsappClientReady = false;
  whatsappClientAuthenticated = false;
  whatsappLastError = null;
  setWhatsAppEvent('qr');
  console.log('🤖 ESCANEIE O QR CODE ABAIXO COM SEU WHATSAPP:');
  qrcodeTerminal.generate(qr, { small: true });
  try {
    latestQrBase64 = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
    latestQrAt = new Date().toISOString();
  } catch (err) {
    console.warn('[QR] Falha ao converter QR para Base64:', err?.message || err);
    setWhatsAppError(err, 'qr_to_base64');
  }
});

client.on('authenticated', async () => {
  whatsappClientAuthenticated = true;
  whatsappClientReady = false;
  whatsappAuthenticatedAt = new Date().toISOString();
  whatsappLastError = null;
  setWhatsAppEvent('authenticated');
  latestQrBase64 = null;
  latestQrAt = null;
});

client.on('ready', () => {
  whatsappClientReady = true;
  whatsappClientAuthenticated = true;
  whatsappLastError = null;
  setWhatsAppEvent('ready');
  latestQrBase64 = null;
  latestQrAt = null;
  console.log('✅ Bot do WhatsApp conectado e pronto para vender!');
});

client.on('disconnected', () => {
  whatsappClientReady = false;
  whatsappClientAuthenticated = false;
  whatsappAuthenticatedAt = null;
  setWhatsAppEvent('disconnected');
  latestQrBase64 = null;
  latestQrAt = null;
  console.log('⚠️ WhatsApp desconectado.');
});

client.on('auth_failure', (msg) => {
  whatsappClientReady = false;
  whatsappClientAuthenticated = false;
  whatsappAuthenticatedAt = null;
  const detail = typeof msg === 'string' ? msg : JSON.stringify(msg);
  console.error('[whatsapp] auth_failure — sessão pode estar corrompida ou token inválido:', detail);
  setWhatsAppEvent('auth_failure', detail);
  if (msg) setWhatsAppError(msg, 'auth_failure');
  latestQrBase64 = null;
  latestQrAt = null;
});

client.on('loading_screen', (percent, text) => {
  setWhatsAppEvent('loading_screen', `${percent}% ${text || ''}`.trim());
});

client.on('change_state', (state) => {
  whatsappConnectionState = String(state || 'UNKNOWN').toUpperCase();
  setWhatsAppEvent('change_state', whatsappConnectionState);
  if (whatsappConnectionState === 'DISCONNECTED') {
    whatsappClientReady = false;
  }
});

function isTransientPuppeteerMonitorError(err) {
  const msg = String(err?.message || err || '');
  return (
    /Cannot read properties of null \(reading 'evaluate'\)/.test(msg) ||
    /Cannot read properties of undefined \(reading 'evaluate'\)/.test(msg) ||
    /Execution context was destroyed/i.test(msg) ||
    /Target closed/i.test(msg) ||
    /Session closed/i.test(msg) ||
    /Protocol error/i.test(msg)
  );
}

function startWhatsAppHealthMonitor() {
  if (whatsappMonitorStarted) return;
  whatsappMonitorStarted = true;
  setInterval(async () => {
    try {
      const rawState = await client.getState();
      const state = String(rawState || 'UNKNOWN').toUpperCase();
      whatsappConnectionState = state;
    } catch (err) {
      if (isTransientPuppeteerMonitorError(err)) {
        pushDebugLog(
          'warn',
          `[whatsapp-monitor] getState adiado (browser/página ainda não pronta): ${String(err?.message || err)}`
        );
        return;
      }
      setWhatsAppError(err, 'monitor_getState');
    }
  }, 10000);
}

/** Pós-PAID: mesma cópia no handler de mensagens e no webhook Mercado Pago. */
const MSG_BOAS_VINDAS_POS_PAGAMENTO =
  '✅ Pagamento Confirmado! Pagamento processado com sucesso em nosso Gateway Internacional. Agora, para garantirmos a agilidade no seu envio, por favor, confirme os dados para a Documentação de Embarque (Shipping Address) — Nome, Rua, Número, CEP e Cidade.';

const ROTEIRO_CARRINHO_VENDAS =
  'Se você já quiser agilizar, eu tiro seu pedido por aqui e gero seu link de pagamento agora mesmo. Se preferir navegar no catálogo completo, use: https://green-koala-180415.hostingersite.com/';
const CHECKOUT_FOLLOWUP_RULES = {
  minGapMinutes: 120,
  maxIn24h: 1,
  maxTotal: 2,
  stageDelaysMinutes: [20, 1440]
};

function detectCheckoutOptOutIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return /\b(n[aã]o (quero|tenho interesse)|pare|parar|depois eu vejo|mais tarde|agora n[aã]o)\b/i.test(t);
}

function getCheckoutFollowupMessage(stage) {
  if (stage <= 0) {
    return 'Passando só para te ajudar: se você tiver encontrado qualquer dificuldade no carrinho, me chama aqui que eu te auxilio com calma.';
  }
  if (stage === 1) {
    return 'Sem pressa por aqui. Quando quiser retomar, é só me chamar com "pronto" que eu te ajudo no que faltar.';
  }
  if (stage === 2) {
    return 'Seu protocolo ainda está disponível. Se quiser, posso te mandar um passo a passo super rápido para finalizar no carrinho agora.';
  }
  return 'Último lembrete por aqui: quando quiser retomar, me manda um "pronto" que eu te ajudo a concluir o checkout.';
}

function appendRoteiroCarrinhoSeNecessario(responseText, opts = {}) {
  const t = String(responseText || '').trim();
  if (!t) return t;
  const userMessage = String(opts?.userMessage || '');
  const checkoutState = String(opts?.checkoutState || opts?.session?.checkoutState || '').toUpperCase().trim();
  const paymentStatus = String(opts?.paymentStatus || opts?.session?.paymentStatus || '').toUpperCase().trim();

  // Se a conversa já está no fluxo de checkout direto, não anexar roteiro de site.
  if (checkoutState === 'DIRECT_ASSIST' || checkoutState === 'DIRECT_LINK_SENT') return t;
  if (checkoutState === 'PENDING' || checkoutState === 'PENDING_PAYMENT' || paymentStatus === 'PENDING') return t;

  // Blindagem: se já houver link MP na resposta, nunca anexar link da loja.
  if (t.includes('mercadopago.com.br')) return t;

  // Se cliente pedir pagamento/link por aqui, evitar empurrar URL do site no mesmo turno.
  if (
    /\b(link direto|gera(?:r)? o link|gera(?:r)? link|manda o link por aqui|faz por aqui|gera por aqui|pode gerar|quero pagar por aqui|pagar por aqui|faz meu pagamento aqui|manda o pix aqui|pix por aqui|finalizar por aqui)\b/i.test(
      userMessage
    )
  ) {
    return t;
  }

  // Se a própria resposta já está conduzindo para pagamento por aqui, não adicionar site.
  if (/\b(link de pagamento|pagar por aqui|fechar por aqui|gerar seu link|checkout direto)\b/i.test(t)) return t;

  if (/green-koala-180415/i.test(t)) return t;
  return `${t}\n\n${ROTEIRO_CARRINHO_VENDAS}`.trim();
}

function isNoLidError(err) {
  const msg = String(err?.message || err || '');
  return /No LID for user/i.test(msg);
}

async function safeSendMessage(to, text, context = 'send') {
  try {
    await client.sendMessage(to, text);
    return true;
  } catch (err) {
    if (isNoLidError(err)) {
      console.warn(`[WhatsApp] Mensagem não enviada por LID inválido | context=${context} | to=${to}`);
      return false;
    }
    throw err;
  }
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  const lo = Math.ceil(Number(min) || 0);
  const hi = Math.floor(Number(max) || 0);
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function buildHumanizedDelayMs(text = '') {
  const len = String(text || '').trim().length;
  const base = randomInt(900, 1800);
  const byLen = Math.min(2600, Math.floor(len * 18));
  const jitter = randomInt(0, 900);
  return base + byLen + jitter;
}

function splitHumanizedOutgoingMessage(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  if (normalized.length < 280) return [normalized];
  if (/https?:\/\//i.test(normalized)) return [normalized];

  const breakRegex = /([.!?])\s+/g;
  const chunks = [];
  let last = 0;
  let match = null;
  while ((match = breakRegex.exec(normalized)) !== null) {
    const end = match.index + match[0].length;
    chunks.push(normalized.slice(last, end).trim());
    last = end;
  }
  if (last < normalized.length) {
    chunks.push(normalized.slice(last).trim());
  }
  const filtered = chunks.filter(Boolean);
  if (filtered.length < 2) return [normalized];

  const total = filtered.length;
  const mid = Math.max(1, Math.min(total - 1, Math.ceil(total / 2)));
  const first = filtered.slice(0, mid).join(' ').trim();
  const second = filtered.slice(mid).join(' ').trim();
  if (!first || !second) return [normalized];
  return [first, second];
}

async function sendWithFallback(chatId, text, context = 'send') {
  let sent = await safeSendMessage(chatId, text, context);
  if (!sent && /@lid$/i.test(String(chatId || ''))) {
    const session = await getOrCreateSession(chatId);
    const fallbackChatId = session?.phoneNumber ? `${String(session.phoneNumber).replace(/\D/g, '')}@c.us` : null;
    if (fallbackChatId) {
      pushDebugLog('warn', `[whatsapp-fallback] tentando envio alternativo ${chatId} -> ${fallbackChatId}`);
      sent = await safeSendMessage(fallbackChatId, text, `${context}_fallback_cus`);
    }
  }
  return sent;
}

/** Remove artefatos tipo "Link: undefined" quando valor JS ausente vazou para string (ex.: prompt com lastLink vazio). */
function sanitizeCustomerMessageUndefinedArtifacts(raw) {
  return String(raw || '')
    .replace(/\b(link|url)\s*:\s*undefined\b/gi, '')
    .replace(/:\s*undefined\b/g, ':')
    .replace(/https?:\/\/undefined\b/gi, '')
    .replace(/(?:^|\n)\s*undefined\s*(?=\n|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendHumanizedMessage(chatId, text, options = {}) {
  const force = !!options?.force;
  try {
    if (!force) {
      const session = await getOrCreateSession(chatId);
      const now = Date.now();
      const pauseUntilMs = session?.pausedUntil ? new Date(session.pausedUntil).getTime() : 0;
      const pausedNow = !!session?.isPaused && (!session?.pausedUntil || pauseUntilMs > now);
      if (pausedNow) {
        pushDebugLog('info', `[pause-guard] envio bloqueado para ${chatId} (conversa pausada)`);
        return false;
      }
    }

    const chat = await client.getChatById(chatId);
    if (WHATSAPP_SEND_TYPING) {
      await chat.sendStateTyping();
    }
    const textoCliente = expandBrandTokensForWhatsApp(sanitizeCustomerMessageUndefinedArtifacts(text));
    // Quando o typing estiver desligado, simula resposta humana com pausa proporcional ao texto.
    await waitMs(buildHumanizedDelayMs(textoCliente));
    if (/green-koala-180415\.hostingersite\.com/i.test(textoCliente)) {
      const current = await getOrCreateSession(chatId);
      const linkAt = new Date().toISOString();
      if (!['PAID', 'PENDING'].includes(String(current.paymentStatus || '').toUpperCase().trim())) {
        await updateSession(chatId, {
          catalogLinkSentAt: linkAt,
          checkoutState: 'LINK_SENT',
          checkoutFollowupCount: 0,
          checkoutLastFollowupAt: null,
          checkoutSnoozedUntil: null
        });
      } else {
        await db.run('UPDATE sessions SET lp_link_sent_at = ?, updated_at = ? WHERE chat_id = ?', [linkAt, linkAt, chatId]);
      }
    }
    const messageParts = WHATSAPP_SEND_TYPING ? [textoCliente] : splitHumanizedOutgoingMessage(textoCliente);
    let sent = true;
    for (let i = 0; i < messageParts.length; i += 1) {
      const part = messageParts[i];
      const partSent = await sendWithFallback(chatId, part, 'sendHumanizedMessage');
      if (!partSent) {
        sent = false;
        break;
      }
      registerPendingBotEcho(chatId, part);
      await appendMessageHistory(chatId, 'assistant', part);
      if (!WHATSAPP_SEND_TYPING && i < messageParts.length - 1) {
        await waitMs(randomInt(600, 1600));
      }
    }
    if (sent) {
      return true;
    } else {
      pushDebugLog('error', `[whatsapp-send-failed] não foi possível enviar mensagem para ${chatId}`);
      return false;
    }
  } catch (err) {
    console.error('Erro ao enviar mensagem humanizada:', err);
    setWhatsAppError(err, 'sendHumanizedMessage');
    return false;
  }
}

const processedMessageIds = new Set();
const processedMessageQueue = [];
const PROCESSED_MESSAGE_CACHE_LIMIT = 5000;
const pendingBotEchoBySignature = new Map();
const BOT_ECHO_WINDOW_MS = 30 * 1000;

function claimMessageForProcessing(msg) {
  const id = String(msg?.id?._serialized || msg?.id || '').trim();
  if (!id) return true;
  if (processedMessageIds.has(id)) return false;
  processedMessageIds.add(id);
  processedMessageQueue.push(id);
  if (processedMessageQueue.length > PROCESSED_MESSAGE_CACHE_LIMIT) {
    const oldest = processedMessageQueue.shift();
    if (oldest) processedMessageIds.delete(oldest);
  }
  return true;
}

function resolveChatIdFromMessage(msg) {
  if (msg?.fromMe) {
    const to = String(msg?.to || '').trim();
    if (to) return to;
  }
  return String(msg?.from || '').trim();
}

function buildMessageSignature(chatId, text) {
  return `${String(chatId || '').trim()}|${String(text || '').trim()}`;
}

function registerPendingBotEcho(chatId, text) {
  const key = buildMessageSignature(chatId, text);
  if (!key.endsWith('|')) {
    const current = pendingBotEchoBySignature.get(key);
    const nextCount = Number(current?.count || 0) + 1;
    pendingBotEchoBySignature.set(key, { count: nextCount, at: Date.now() });
  }
}

function consumePendingBotEcho(chatId, text) {
  const now = Date.now();
  for (const [key, value] of pendingBotEchoBySignature.entries()) {
    if (!value?.at || now - Number(value.at) > BOT_ECHO_WINDOW_MS) {
      pendingBotEchoBySignature.delete(key);
    }
  }
  const key = buildMessageSignature(chatId, text);
  const current = pendingBotEchoBySignature.get(key);
  if (!current || Number(current.count || 0) <= 0) return false;
  const nextCount = Number(current.count || 0) - 1;
  if (nextCount <= 0) pendingBotEchoBySignature.delete(key);
  else pendingBotEchoBySignature.set(key, { count: nextCount, at: now });
  return true;
}

// ========== PROCESSAMENTO DE MENSAGENS ==========
client.on('message', async (msg) => {
  console.log('[whatsapp message]', {
    from: msg?.from,
    fromMe: msg?.fromMe,
    type: msg?.type,
    hasBody: !!(msg?.body && String(msg.body).trim()),
    id: msg?.id?._serialized || msg?.id
  });
  if (!claimMessageForProcessing(msg)) return;
  const chatId = resolveChatIdFromMessage(msg);
  if (!chatId) return;

  // Ignora status, canais e newsletters para evitar crash no getChat()
  if (chatId === 'status@broadcast' || chatId.endsWith('@newsletter')) return;

  // Somente conversas diretas (1:1). Grupos (@g.us): não processa nem grava sessão.
  if (chatId.endsWith('@g.us')) return;

  const rawBody = typeof msg?.body === 'string' ? msg.body : '';
  let userMessage = rawBody.trim();
  if (!userMessage && !msg.hasMedia) return;

  // Comando de atendente (via chat) para assumir/liberar conversa sem depender do painel.
  // Aceita aliases em .env: HUMAN_CHAT_CMD_PAUSE e HUMAN_CHAT_CMD_RESUME (separados por vírgula).
  if (msg?.fromMe && userMessage) {
    const controlAction = detectHumanChatControlAction(userMessage);
    if (controlAction) {
      const nowIso = new Date().toISOString();
      if (controlAction === 'PAUSE_CHAT') {
        await getOrCreateSession(chatId);
        await db.run(
          'UPDATE sessions SET isPaused = 1, pausedUntil = NULL, updated_at = ? WHERE chat_id = ?',
          [nowIso, chatId]
        );
        pushDebugLog('info', `[human-command] conversa assumida manualmente via chat | chatId=${chatId}`);
        console.log(`[Human Command] Conversa pausada manualmente: ${chatId}`);
        return;
      }
      if (controlAction === 'RESUME_CHAT') {
        await getOrCreateSession(chatId);
        await db.run(
          'UPDATE sessions SET isPaused = 0, pausedUntil = NULL, updated_at = ? WHERE chat_id = ?',
          [nowIso, chatId]
        );
        pushDebugLog('info', `[human-command] conversa liberada manualmente via chat | chatId=${chatId}`);
        console.log(`[Human Command] Conversa retomada manualmente: ${chatId}`);
        return;
      }
    }
  }

  // Mensagens enviadas pelo próprio número são tratadas no evento `message_create`.
  if (msg?.fromMe) return;

  let session = await getOrCreateSession(chatId);
  const contactMeta = await resolveContactMetaFromMessage(msg);
  // Comandos administrativos via WhatsApp (somente números whitelisted em ADMIN_CHAT_IDS).
  // Para chats @lid, aceita também validação por telefone verificado extraído do contato.
  if (!msg?.fromMe && userMessage && userMessage.startsWith('#') && isAdminChat(chatId, contactMeta?.phoneNumber)) {
    await handleAdminCommand(chatId, userMessage);
    return;
  }
  if (contactMeta.phoneNumber || contactMeta.contactName || contactMeta.phoneSource || contactMeta.profilePic) {
    session = await updateSession(chatId, {
      phoneNumber: contactMeta.phoneNumber || session.phoneNumber || null,
      contactName: contactMeta.contactName || session.contactName || null,
      phoneSource: contactMeta.phoneSource || session.phoneSource || null,
      // URL é atualizada a cada nova mensagem quando disponível (mantém foto "fresca").
      profilePic: contactMeta.profilePic || session.profilePic || null
    });
  }
  if (!session.referralName && userMessage) {
    const referral = detectReferralFromMessage(userMessage);
    if (referral?.referralName) {
      session = await updateSession(chatId, {
        referralName: referral.referralName,
        referralSource: referral.referralSource || 'PHRASE',
        referralAt: new Date().toISOString()
      });
      pushDebugLog('info', `[referral] chat=${chatId} origem=${session.referralSource || 'PHRASE'} nome=${referral.referralName}`);
    }
  }
  const now = Date.now();
  if (emergencyPauseGlobal) {
    console.log(`[Pausa Global] Bot em pausa de emergência. Conversa ignorada: ${chatId}`);
    return;
  }
  const registerPausedMessage = async (reasonLabel) => {
    const rawText = String(userMessage || '').trim();
    const textForHistory = rawText || (msg?.hasMedia ? '[Mídia enviada durante pausa]' : '');
    if (!textForHistory) return;
    const role = msg?.fromMe ? 'human' : 'user';
    await appendMessageHistory(chatId, role, textForHistory);
    console.log(`[Pausa Bot] Mensagem registrada (${reasonLabel}) para ${chatId} | role=${role}`);
  };
  const pauseUntilMs = session.pausedUntil ? new Date(session.pausedUntil).getTime() : 0;
  if (session.isPaused && !session.pausedUntil) {
    await registerPausedMessage('permanente');
    console.log(`[Pausa Bot] Silenciado permanentemente para ${chatId}.`);
    return;
  }
  if (session.isPaused && pauseUntilMs > now) {
    await registerPausedMessage('temporaria');
    const mins = Math.max(1, Math.ceil((pauseUntilMs - now) / 60000));
    console.log(`[Pausa Bot] Silenciado para ${chatId}. Restante: ${mins} min.`);
    return;
  }
  if (session.isPaused && pauseUntilMs <= now) {
    await db.run('UPDATE sessions SET isPaused = 0, pausedUntil = NULL WHERE chat_id = ?', [chatId]);
    session = { ...session, isPaused: false, pausedUntil: null };
  }

  // Interceptador absoluto: pedido de humano/sinal clínico sensível força handoff imediato sem depender do LLM.
  if (!msg?.fromMe && userMessage) {
    const criticalHandoff = detectCriticalHumanOrClinicalHandoff(userMessage);
    if (criticalHandoff.matched) {
      const canNotifyNow = shouldNotifyHandoffNow(session);
      await appendMessageHistory(chatId, 'user', userMessage);
      session = await updateSession(chatId, {
        isPaused: true,
        pausedUntil: null,
        riskAlert: true,
        riskReason: criticalHandoff.reason,
        riskAt: new Date().toISOString()
      });
      await sendHumanizedMessage(
        chatId,
        'Para garantir sua segurança e o melhor atendimento, pausei meu assistente virtual e acionei o especialista humano/técnico para assumir sua conversa agora. Um instante, por favor.',
        { force: true }
      );
      if (canNotifyNow) {
        const snippet = String(userMessage || '').trim().slice(0, 220);
        await notificarFernandoTransbordo(
          chatId,
          `${criticalHandoff.reason}.${snippet ? ` Mensagem: "${snippet}"` : ''}`
        );
      }
      return;
    }
  }

  // --- ÁUDIO: só transcreve (logs no servidor); resposta ao cliente = mesmo fluxo de texto abaixo ---
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    if (media && media.mimetype.includes('audio')) {
      const audioRole = msg?.fromMe ? 'human' : 'user';
      const audioMarker = audioRole === 'human' ? '[Áudio enviado pelo atendente]' : '[Áudio enviado pelo cliente]';
      await appendMessageHistory(chatId, audioRole, audioMarker);
      await sendHumanizedMessage(chatId, 'Recebi seu áudio. Um instante enquanto analiso com precisão laboratorial... 🧬');
      try {
        const transcricao = await transcribeAudioWithGemini(media);
        console.log('[Áudio] Transcrição (uso interno):', transcricao || '(vazia)');
        console.log('[Áudio] Intenção/contexto (sessão):', {
          paymentStatus: session.paymentStatus,
          setorAtual: session.setorAtual
        });
        if (!transcricao || !String(transcricao).trim()) {
          await sendHumanizedMessage(
            chatId,
            'Recebi seu áudio, mas não consegui extrair o texto com clareza. Por favor, envie em texto ou grave de novo.'
          );
          return;
        }
        userMessage = userMessage ? `${userMessage}\n${transcricao.trim()}`.trim() : transcricao.trim();
      } catch (err) {
        console.error('[Áudio] Falha na transcrição:', err);
        await sendHumanizedMessage(chatId, 'Recebi seu áudio, mas não consegui processar com segurança. Por favor, envie em texto.');
        return;
      }
    }
  }

  if (!userMessage || !String(userMessage).trim()) return;

  // Quando a mensagem vem do próprio WhatsApp conectado (fromMe), tratamos como atendente humano no histórico.
  await appendMessageHistory(chatId, msg?.fromMe ? 'human' : 'user', userMessage);
  session = await getOrCreateSession(chatId);

  // Limpeza/atualização de SKU: se cliente citar outro produto, atualiza SKU ativo; se mudar para navegação de catálogo, limpa SKU.
  {
    const catalogRuntimeForSku = await getRuntimeCatalog();
    const skuContextHint = buildSkuContextHint(session);
    const skuFromCurrentMessage = detectSingleSkuFromCustomerText(userMessage, catalogRuntimeForSku, skuContextHint);
    if (skuFromCurrentMessage && skuFromCurrentMessage !== '__MULTI__') {
      if (String(session?.lastDetectedSku || '').trim() !== skuFromCurrentMessage) {
        session.lastDetectedSku = skuFromCurrentMessage;
        await saveSession(chatId, session);
      }
    } else if ((detectCatalogBrowseIntent(userMessage) || detectProductDiscoveryIntent(userMessage)) && !shouldProceedDirectCheckoutFromMessage(userMessage, session)) {
      let changed = false;
      if (session.lastDetectedSku) {
        session.lastDetectedSku = null;
        changed = true;
      }
      if (['DIRECT_ASSIST', 'DIRECT_LINK_SENT'].includes(String(session?.checkoutState || '').toUpperCase())) {
        session.checkoutState = null;
        changed = true;
      }
      if (changed) {
        await saveSession(chatId, session);
      }
    }
  }

  // Redes sociais: resposta imediata com links oficiais (Instagram / TikTok), conforme o pedido.
  if (!msg?.fromMe) {
    const socialMsg = buildSocialMediaReply(userMessage);
    if (socialMsg) {
      pushDebugLog('info', `[social] resposta determinística | chat=${chatId}`);
      await sendHumanizedMessage(chatId, socialMsg);
      return;
    }
  }

  // Interceptação total do "sim" no checkout direto: não passa pela IA.
  const checkoutStateNow = String(session?.checkoutState || '').trim().toUpperCase();
  const userMessageLowerDirect = String(userMessage || '').toLowerCase().trim();
  const hasTechnicalQuestionNow = detectTechnicalProtocolQuestion(userMessage);
  if (
    !msg?.fromMe &&
    checkoutStateNow === 'DIRECT_ASSIST' &&
    String(session?.paymentStatus || '').toUpperCase() !== 'PAID' &&
    !hasTechnicalQuestionNow &&
    shouldProceedDirectCheckoutFromMessage(userMessageLowerDirect, session)
  ) {
    const catalogRuntime = await getRuntimeCatalog();
    const skuPersistido = resolveBestSkuForCheckout(session, catalogRuntime, userMessageLowerDirect);
    if (!skuPersistido) {
      await sendHumanizedMessage(
        chatId,
        buildHumanizedSkuQuestion(catalogRuntime, session?.lastDetectedSku || '')
      );
      return;
    }

    const product = catalogRuntime?.[skuPersistido];
    if (!product) {
      await sendHumanizedMessage(
        chatId,
        'Quase lá. Não consegui validar esse protocolo no catálogo atual. Me envie o SKU ou nome + dosagem para gerar o link agora.'
      );
      return;
    }

    const productLabel = `${product?.comercial?.nome || 'Protocolo'} ${product?.comercial?.dosagem || ''}`.trim();
        const orderMessage = buildSiteLikeSyntheticProtocolMessage(skuPersistido, catalogRuntime);
    const checkout = await processarCheckoutEstruturado(chatId, orderMessage, session, {
      resetHistory: false,
      notifyAdmin: true,
      notifyName: msg?._data?.notifyName || chatId
    });
    if (!checkout.ok) {
      await sendHumanizedMessage(
        chatId,
        checkout.errorMessage ||
          'Tive uma instabilidade rápida para gerar o link oficial, mas já estou retomando aqui para você.'
      );
      return;
    }
    const payUrlEarly = paymentCheckoutUrl(checkout);
    if (!payUrlEarly) {
      pushDebugLog('error', `[checkout] DIRECT_ASSIST sim sem URL chat=${chatId}`);
      await sendHumanizedMessage(chatId, MSG_CHECKOUT_SEM_LINK);
      return;
    }

    await sendHumanizedMessage(
      chatId,
      `Ótimo! Aqui está o seu link de pagamento oficial para ${productLabel}: ${payUrlEarly}`
    );
    return;
  }

  // LLM pode ter oferecido "link direto" sem passar pelo gatilho de atrito — "sim" curto confirma e habilita checkout direto.
  {
    const paySnap = String(session?.paymentStatus || '').toUpperCase().trim();
    if (
      !msg?.fromMe &&
      !hasTechnicalQuestionNow &&
      shouldProceedDirectCheckoutFromMessage(userMessage, session) &&
      paySnap !== 'PAID' &&
      paySnap !== 'PENDING' &&
      lastBotMessageOfferedDirectLink(session.messageHistory) &&
      String(session?.checkoutState || '').toUpperCase() !== 'DIRECT_LINK_SENT'
    ) {
      session = await updateSession(chatId, { checkoutState: 'DIRECT_ASSIST' });
      const catalogRuntime = await getRuntimeCatalog();
      const skuDetected = detectSingleSkuFromCustomerText(userMessage, catalogRuntime, buildSkuContextHint(session));
      if (skuDetected && skuDetected !== '__MULTI__') {
        session.lastDetectedSku = skuDetected;
      }
      await saveSession(chatId, session);
    }
  }

  // Pedido explícito de link direto deve abrir assistência direta, mesmo sem dependência do contexto do carrinho.
  if (
    !msg?.fromMe &&
    String(session?.paymentStatus || '').toUpperCase() !== 'PAID' &&
    String(session?.checkoutState || '').toUpperCase() !== 'DIRECT_LINK_SENT' &&
    !hasTechnicalQuestionNow &&
    /\b(link direto|gera(?:r)? o link|gera(?:r)? link|manda o link por aqui|faz por aqui|gera por aqui|pode gerar|quero pagar por aqui|pagar por aqui|faz meu pagamento aqui|manda o pix aqui|pix por aqui|finalizar por aqui)\b/i.test(
      userMessage
    )
  ) {
    session = await updateSession(chatId, { checkoutState: 'DIRECT_ASSIST' });
    const catalogRuntime = await getRuntimeCatalog();
    const skuDetected = detectSingleSkuFromCustomerText(userMessage, catalogRuntime, buildSkuContextHint(session));
    if (skuDetected && skuDetected !== '__MULTI__') {
      session.lastDetectedSku = skuDetected;
    }
    await saveSession(chatId, session);
  }

  if (!msg?.fromMe && detectClienteSolicitouCancelamentoPedido(userMessage)) {
    const sessionFresh = await getOrCreateSession(chatId);
    if (await tryClienteCancelarPedidoPendente(chatId, sessionFresh)) return;
  }

  // PRECEDÊNCIA ABSOLUTA: checkout direto deve rodar antes de qualquer etapa de LLM/cadência.
  if (
    !msg?.fromMe &&
    String(session?.checkoutState || '').toUpperCase() === 'DIRECT_ASSIST' &&
    String(session?.paymentStatus || '').toUpperCase() !== 'PAID' &&
    !hasTechnicalQuestionNow &&
    shouldProceedDirectCheckoutFromMessage(userMessage, session)
  ) {
    pushDebugLog(
      'info',
      `[checkout-gate] route=DIRECT_ASSIST chat=${chatId} checkoutState=${String(session?.checkoutState || '')} message="${String(
        userMessage || ''
      ).slice(0, 120)}"`
    );
    pushDebugLog('info', `[checkout-direct] fluxo ativo para ${chatId}`);
    const catalogRuntime = await getRuntimeCatalog();
    let skuDetected = resolveBestSkuForCheckout(session, catalogRuntime, userMessage);
    if (skuDetected === '__MULTI__') {
      await sendHumanizedMessage(
        chatId,
        'Perfeito, consigo gerar por aqui. Para evitar erro no pedido, me confirme apenas um protocolo por vez (ex.: #OR-2026-028 ou Tirzepatide 20mg).'
      );
      return;
    }
    if (!skuDetected) {
      pushDebugLog('info', `[checkout-direct] SKU não detectado para ${chatId}`);
      await sendHumanizedMessage(
        chatId,
        buildHumanizedSkuQuestion(catalogRuntime, session?.lastDetectedSku || '')
      );
      return;
    }
    pushDebugLog('info', `[checkout-direct] SKU detectado para ${chatId}: ${skuDetected}`);
    session.lastDetectedSku = skuDetected;
    await saveSession(chatId, session);

    const product = catalogRuntime?.[skuDetected];
    const productLabel = `${product?.comercial?.nome || 'Protocolo'} ${product?.comercial?.dosagem || ''}`.trim();
    const orderMessage = buildSiteLikeSyntheticProtocolMessage(skuDetected, catalogRuntime);
    const checkout = await processarCheckoutEstruturado(chatId, orderMessage, session, {
      resetHistory: false,
      notifyAdmin: true,
      notifyName: msg?._data?.notifyName || chatId
    });
    if (!checkout.ok) {
      pushDebugLog('warn', `[checkout-direct] falha checkout estruturado chat=${chatId} sku=${skuDetected}`);
      await sendHumanizedMessage(
        chatId,
        checkout.errorMessage ||
          'Estou validando seu pedido na central. Tive uma instabilidade rápida para gerar o link, mas já estou retomando sem você perder o Kit Orion.'
      );
      return;
    }
    const payUrlDirect = paymentCheckoutUrl(checkout);
    if (!payUrlDirect) {
      pushDebugLog('error', `[checkout-direct] ok sem URL chat=${chatId} sku=${skuDetected}`);
      await sendHumanizedMessage(chatId, MSG_CHECKOUT_SEM_LINK);
      return;
    }
    const priceText = product?.comercial?.precoOriginal || product?.comercial?.preco || '';
    await sendHumanizedMessage(
      chatId,
      `Perfeito! Pedido direto liberado com estoque confirmado para ${productLabel} (${skuDetected})${priceText ? ` por ${priceText}` : ''}.\n\nSegue seu link de pagamento seguro:\n${payUrlDirect}\n\nVocê mantém o brinde do Kit Orion e frete grátis no protocolo.`
    );
    pushDebugLog('info', `[checkout-direct] link MP enviado para ${chatId} sku=${skuDetected} paymentId=${checkout.paymentId || 'n/a'}`);
    return;
  }

  if (shouldRunCheckoutCadenceForSession(session)) {
    if (detectCheckoutOptOutIntent(userMessage)) {
      const snoozedUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      session = await updateSession(chatId, {
        checkoutState: 'SNOOZED',
        checkoutSnoozedUntil: snoozedUntil
      });
      await sendHumanizedMessage(chatId, 'Perfeito, sem pressão. Vou pausar os lembretes automáticos por agora. Quando quiser retomar, é só me chamar com "pronto".');
      return;
    }
    session = await updateSession(chatId, {
      checkoutState: 'ENGAGED',
      checkoutFollowupCount: 0,
      checkoutLastFollowupAt: null,
      checkoutSnoozedUntil: null
    });
  }

  const riscoClinicoDetectado = deveDispararTransbordoPorRiscoClinico(userMessage);
  if (riscoClinicoDetectado && !session.riskAlert) {
    session = await updateSession(chatId, {
      riskAlert: true,
      riskReason: 'Risco clínico: gravidez/doença grave/remédio controlado',
      riskAt: new Date().toISOString()
    });
    await notificarFernandoTransbordo(
      chatId,
      'Risco clínico identificado (gravidez/doença grave/remédio controlado). Intervenção urgente no painel.'
    );
  }

  // Gatilho de atrito de checkout: cliente com dificuldade no site após já receber link da loja (sessão ou histórico).
  const storeContextForAssist =
    hasRecentStoreLink(session) || messageHistoryMentionsStoreUrl(session.messageHistory);
  const payUpperCheckout = String(session?.paymentStatus || '').toUpperCase().trim();
  const paymentHelpOpensAssist =
    hasExplicitPurchaseIntent(userMessage) &&
    storeContextForAssist &&
    payUpperCheckout !== 'PAID' &&
    payUpperCheckout !== 'PENDING' &&
    /\b(como|onde|pag|pix|link|carrinho|site|deu|nao|não)\b/i.test(userMessage);

  if (
    !msg?.fromMe &&
    (detectCheckoutFrictionIntent(userMessage) || paymentHelpOpensAssist) &&
    storeContextForAssist &&
    String(session?.paymentStatus || '').toUpperCase() !== 'PAID'
  ) {
    const catalogRuntime = await getRuntimeCatalog();
    const skuDetectedOffer = detectSingleSkuFromCustomerText(userMessage, catalogRuntime);
    session = await updateSession(chatId, {
      checkoutState: 'DIRECT_ASSIST',
      lastDetectedSku: skuDetectedOffer && skuDetectedOffer !== '__MULTI__' ? skuDetectedOffer : session?.lastDetectedSku || null
    });
    await saveSession(chatId, session);
    await sendHumanizedMessage(
      chatId,
      'Entendi perfeitamente. Algumas pessoas preferem a agilidade por aqui mesmo! 🚀 Qual protocolo você escolheu? Se quiser, eu já gero seu acesso e link de pagamento agora, sem você precisar usar o site.'
    );
    return;
  }

  // Checkout direto já foi processado com precedência antes das demais etapas.

  // Trava determinística: com pedido pendente, não regressa para "montar carrinho".
  if (session.paymentStatus === 'PENDING' && isPendingPaymentFollowup(userMessage)) {
    const linkExtra = session.lastLink ? `\n\nSe precisar, segue novamente o link do pagamento:\n${session.lastLink}` : '';
    await sendHumanizedMessage(
      chatId,
      `Perfeito, já localizei seu pedido. No momento ele está como *aguardando confirmação* no gateway de pagamento.\n\nAssim que a aprovação cair no sistema, eu te aviso aqui automaticamente para seguir com os dados de envio.${linkExtra}`
    );
    return;
  }

  // Política comercial fixa: frete sempre grátis em todo o Brasil.
  // Não interceptar quando já pagou: mensagens com "cep" no endereço acionavam isto e o bot nunca chegava na extração de entrega (PAID).
  if (
    !msg?.fromMe &&
    detectShippingQuestion(userMessage) &&
    String(session?.paymentStatus || '').toUpperCase().trim() !== 'PAID'
  ) {
    await sendHumanizedMessage(chatId, buildShippingPolicyReply());
    return;
  }

  // Transição automática: perguntas de logística/comercial saem do técnico para vendas.
  const termosVendas = ['envia', 'entrega', 'frete', 'valor', 'preço', 'preco', 'comprar', 'ribeirão', 'ribeirao', 'cep'];
  const userMessageLower = userMessage.toLowerCase();
  if (session.setorAtual === 'TECNICO' && termosVendas.some((t) => userMessageLower.includes(t))) {
    console.log('[Fluxo] Detectada intenção de logística/venda. Mudando para VENDAS.');
    session = await updateSession(chatId, { setorAtual: 'VENDAS' });
    logBotEmAtendimento(chatId, 'VENDAS', 'transicao-automatica-logistica');
  }

  // Proteção de primeiro contato: cliente novo inicia em TÉCNICO por padrão.
  if (!session.setorAtual) {
    await updateSession(chatId, { setorAtual: 'TECNICO' });
    logBotEmAtendimento(chatId, 'TECNICO', 'primeiro-contato');
  }
  logBotEmAtendimento(chatId, session.setorAtual || 'TECNICO', 'entrada');

  // --- INTERCEPTADOR DE CARRINHO ---
  // Antes: exigia "TOTAL" na mensagem — clientes copiam só itens + SKUs e o link nunca gerava.
  // Agora: "NOVO PROTOCOLO" + ("TOTAL" OU SKUs válidos + intenção clara de pagamento).
  const normalizedMessage = userMessage.toUpperCase();
  let runStructuredCartCheckout = false;
  if (normalizedMessage.includes('NOVO PROTOCOLO')) {
    if (normalizedMessage.includes('TOTAL')) {
      runStructuredCartCheckout = true;
    } else {
      const catalogProbe = await getRuntimeCatalog();
      const demandProbe = extractOrderSkuDemand(userMessage, catalogProbe);
      const hasSkus = Object.keys(demandProbe).length > 0;
      const payIntent =
        hasSkus &&
        /\b(quero realizar|pagamento seguro|realizar o pagamento|realizar pagamento|fechar o pedido|pagar agora|gerar (o )?link|link de pagamento)\b/i.test(
          userMessage
        );
      if (payIntent) runStructuredCartCheckout = true;
    }
  }
  if (runStructuredCartCheckout) {
    const checkout = await processarCheckoutEstruturado(chatId, userMessage, session, {
      resetHistory: true,
      notifyAdmin: true,
      notifyName: msg?._data?.notifyName || chatId
    });
    if (!checkout.ok) {
      await sendHumanizedMessage(
        chatId,
        checkout.errorMessage ||
          'Tive uma instabilidade ao gerar seu link de pagamento e liberei a reserva do estoque automaticamente. Me chama para tentar novamente em seguida.'
      );
      return;
    }
    if (checkout.reusedPending) {
      const payReuse = paymentCheckoutUrl(checkout);
      if (!payReuse) {
        pushDebugLog('error', `[checkout] interceptador reused sem URL chat=${chatId}`);
        await sendHumanizedMessage(chatId, MSG_CHECKOUT_SEM_LINK);
        return;
      }
      await sendHumanizedMessage(
        chatId,
        `Já identifiquei esse mesmo pedido como *aguardando pagamento*.\n\nSegue seu link novamente:\n${payReuse}`
      );
      return;
    }
    const payUrlCart = paymentCheckoutUrl(checkout);
    if (!payUrlCart) {
      pushDebugLog('error', `[checkout] interceptador sem URL chat=${chatId}`);
      await sendHumanizedMessage(chatId, MSG_CHECKOUT_SEM_LINK);
      return;
    }
    const respostaCheckout = `Excelente escolha! Seu protocolo foi recebido e os itens já estão reservados. 🧬\n\nGeramos um link de pagamento seguro exclusivo para o seu pedido. Você pode pagar via Pix ou Cartão aqui:\n\n${payUrlCart}\n\nAssim que o pagamento for aprovado, o sistema me avisa por aqui!`;
    await sendHumanizedMessage(chatId, respostaCheckout);
    return;
  }

  // --- RECEBIMENTO INTELIGENTE DE ENDEREÇO ---
  if (session.paymentStatus === 'PAID') {
    const dadosAntes = session.dadosEntrega || { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' };
    const faltantesIniciais = getMissingDeliveryFields(dadosAntes);
    const cadastroEntregaJaConcluido = faltantesIniciais.length === 0;

    // Encerramento final: após "ok/obrigado/tchau", mantém resposta curta e não reabre fluxo.
    if (cadastroEntregaJaConcluido && (session.deliveryFlowClosed || isClosingMessage(userMessage))) {
      const nomeCliente = (dadosAntes.nome || '').trim() || 'cliente';
      await updateSession(chatId, { deliveryFlowClosed: true });
      await sendHumanizedMessage(chatId, `Perfeito, ${nomeCliente}! Ficamos à disposição. Assim que o rastreio for gerado, eu te aviso por aqui. Tenha um excelente dia!`);
      return;
    }

    // Saudação pós-pagamento: enviar apenas uma única vez por cliente.
    if (!session.paymentWelcomeSent) {
      await updateSession(chatId, { paymentWelcomeSent: true });
      await sendHumanizedMessage(chatId, MSG_BOAS_VINDAS_POS_PAGAMENTO);
      return;
    }

    if (!cadastroEntregaJaConcluido) {
      const textoEntrega = buildTextForDeliveryExtraction(session);
      let extraidos = await extractDadosEntregaComGemini(textoEntrega, dadosAntes);
      let dadosDepois = mergeDadosEntrega(dadosAntes, extraidos);
      const faltamAposGemini = getMissingDeliveryFields(dadosDepois);
      if (faltamAposGemini.length > 0) {
        const fb = extractDadosEntregaFallback(textoEntrega);
        dadosDepois = mergeDadosEntrega(dadosDepois, fb);
      }
      // Heurística extra: uma linha tipo "Rua X n 30 ... Vila Velha ES cep 00000-000" sem rótulos
      if (getMissingDeliveryFields(dadosDepois).length > 0 && /\b\d{5}-?\d{3}\b/.test(textoEntrega)) {
        dadosDepois = mergeDadosEntrega(dadosDepois, extractEnderecoHeuristicoLinhaUnica(textoEntrega));
      }

      const camposNovos = CAMPOS_ENTREGA.filter((campo) => !String(dadosAntes[campo] || '').trim() && String(dadosDepois[campo] || '').trim());
      if (camposNovos.length > 0) {
        await updateSession(chatId, { dadosEntrega: dadosDepois });

        const faltantes = getMissingDeliveryFields(dadosDepois);
        if (faltantes.length === 0) {
          const updated = await updateSession(chatId, { deliveryNotified: session.deliveryNotified });
          if (!updated.deliveryNotified) {
            const stakeholderTargets = getStakeholderAlertTargets();
            if (stakeholderTargets.length > 0) {
              const enderecoFormatado = [
                `Nome: ${dadosDepois.nome}`,
                `Rua: ${dadosDepois.rua}`,
                `Número: ${dadosDepois.numero}`,
                `Bairro: ${dadosDepois.bairro || 'N/I'}`,
                `CEP: ${dadosDepois.cep}`,
                `Cidade: ${dadosDepois.cidade}`
              ].join('\n');
              for (const targetId of stakeholderTargets) {
                await safeSendMessage(
                  targetId,
                  `📦 *ENDEREÇO RECEBIDO!* Cliente: ${msg._data.notifyName || chatId}\n${enderecoFormatado}`,
                  'endereco-recebido-admin'
                );
              }
            }
            await updateSession(chatId, { deliveryNotified: true });
          }
          await sendHumanizedMessage(chatId, '📍 Dados Recebidos com Sucesso! Nossa equipe de expedição já foi notificada e seu pedido entrou na fila de separação.\n📦 Próximo passo: Assim que o objeto for postado, você receberá o código de rastreio aqui mesmo. Geralmente isso ocorre em até 24h úteis. Fique tranquilo, estamos cuidando de tudo para que seus peptídeos cheguem com total segurança!');
        } else if (camposNovos.includes('cep')) {
          await sendHumanizedMessage(chatId, `✅ CEP anotado! Falta apenas o ${getFieldLabel(faltantes[0])} para fecharmos.`);
        } else {
          await sendHumanizedMessage(chatId, `✅ Dado anotado com sucesso! Falta apenas o ${getFieldLabel(faltantes[0])} para fecharmos.`);
        }
        return;
      }

      // Se estiver em fluxo de entrega e não houve extração útil, guia o cliente sem repetir confirmação de pagamento.
      const faltantesAtuais = getMissingDeliveryFields(dadosAntes);
      if (faltantesAtuais.length > 0) {
        await sendHumanizedMessage(chatId, `Perfeito. Para agilizar seu envio, me informe agora: ${getFieldLabel(faltantesAtuais[0])}.`);
        return;
      }
    }
  }

  // --- RESPOSTA PADRÃO GEMINI ---
  try {
    const chat = await msg.getChat();
    if (WHATSAPP_SEND_TYPING) {
      await chat.sendStateTyping();
    }
  } catch (err) {
    console.warn('[Chat Warning] Falha ao obter chat/typing. Mensagem será processada sem typing:', err?.message || err);
  }

  const contextoPedido = session.lastOrder
    ? `\n--- PEDIDO ATUAL ---\nItens: ${session.lastOrder}${
        session.lastLink ? `\nLink de pagamento (use só se o cliente pedir o link): ${session.lastLink}` : ''
      }`
    : '';
  const dadosEntregaContexto = session.dadosEntrega
    ? `\n--- DADOS DE ENTREGA (PARCIAL) ---\n${JSON.stringify(session.dadosEntrega)}`
    : '';
  const historicoRecenteContexto = Array.isArray(session.messageHistory) && session.messageHistory.length > 0
    ? `\n--- HISTÓRICO RECENTE ---\n${session.messageHistory
        .slice(-MESSAGE_HISTORY_LIMIT)
        .map((m) => `${m.role === 'assistant' ? 'BOT' : 'CLIENTE'}: ${m.text}`)
        .join('\n')}`
    : '';
  let setorAtivo = session.setorAtual || 'TECNICO';
  const promptSetorAtivo = setorAtivo === 'TECNICO' ? promptTecnico : promptVendas;
  const payNorm = String(session.paymentStatus || '').toUpperCase().trim();
  const statusPagamento =
    payNorm === 'PAID' ? 'LIBERADO' : payNorm === 'PENDING' ? 'BLOQUEADO' : 'SEM_PEDIDO_EM_ABERTO';
  const catalogoRuntime = await getRuntimeCatalog();
  const stockBySku = await getStockBySku();
  const catalogoRuntimeEmEstoque = filterCatalogByStock(catalogoRuntime, stockBySku);
  const catalogoUnificadoPrompt = JSON.stringify(catalogoRuntimeEmEstoque, null, 2);
  const nomeProdutoParaSkuRuntime = {
    ...buildNomeProdutoParaSku(catalogoRuntimeEmEstoque),
    ...ALIASES_NOME_LP_PARA_SKU
  };
  const nomeProdutoParaSkuPrompt = JSON.stringify(nomeProdutoParaSkuRuntime, null, 2);
  const catalogoUnificadoContexto = `\n--- CATÁLOGO_UNIFICADO (JSON: comercial + tecnico por SKU, SOMENTE ITENS COM ESTOQUE > 0) ---\n${catalogoUnificadoPrompt}\n--- REGRAS_GLOBAIS (JSON) ---\n${REGRAS_GLOBAIS_PROMPT}\n--- MAPEAMENTO NOME DO PRODUTO (LP/WHATSAPP) → SKU (SOMENTE EM ESTOQUE) ---\n${nomeProdutoParaSkuPrompt}\n--- REGRA DE ESTOQUE PARA OFERTA ---\nNUNCA ofereça, sugira ou empurre produto fora deste catálogo em estoque.`;
  const faltantesEntregaNoPrompt = getMissingDeliveryFields(session.dadosEntrega || { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' });
  const instrucaoPosCadastroConcluido = session.paymentStatus === 'PAID' && faltantesEntregaNoPrompt.length === 0
    ? `\n--- INSTRUÇÃO EXTRA PÓS-CADASTRO ---\nO cadastro de endereço já foi finalizado com sucesso. Se o cliente perguntar qual é o endereço, confirme os dados que temos de forma organizada:\nNome: ${session.dadosEntrega?.nome || ''}\nRua: ${session.dadosEntrega?.rua || ''}\nNúmero: ${session.dadosEntrega?.numero || ''}\nCEP: ${session.dadosEntrega?.cep || ''}\nCidade: ${session.dadosEntrega?.cidade || ''}\nBairro: ${session.dadosEntrega?.bairro || 'N/I'}\nSe ele apenas agradecer ou fizer um comentário aleatório, seja breve e profissional.`
    : '';
  const statusPagamentoDescricao =
    payNorm === 'PAID'
      ? 'O pagamento já foi CONFIRMADO.'
      : payNorm === 'PENDING'
        ? 'Existe pedido aguardando confirmação de pagamento no gateway.'
        : 'Não há pedido aguardando pagamento nesta conversa (cancelado, expirado ou ainda não iniciado).';
  const contextoStatusPagamentoCliente = `\n--- STATUS DE PAGAMENTO DESTE CLIENTE (SIGILO DE PROTOCOLO) ---
statusPagamento: ${statusPagamento}
- LIBERADO: pagamento confirmado; informação técnica completa permitida.
- BLOQUEADO: há link/pedido aguardando pagamento; você DEVE responder sobre catálogo, preços, disponibilidade em estoque e checkout — o script de sigilo vale SÓ para protocolo técnico detalhado (UI, diluição), não para listar o que tem disponível.
- SEM_PEDIDO_EM_ABERTO: não há pagamento pendente; responda normalmente sobre disponibilidade, catálogo e preços. NUNCA use o script de retenção de protocolo como desculpa para recusar listagem de produtos ou estoque.
Aplique REGRAS_GLOBAIS.regra_sigilo_protocolo conforme o significado acima (não trate SEM_PEDIDO_EM_ABERTO como BLOQUEADO).
`;

  const socialContexto = `
--- REDES SOCIAIS ORION (use APENAS se o cliente pedir Instagram, Insta, TikTok, "rede(s) social" ou canais) ---
Instagram: ${ORION_SOCIAL_INSTAGRAM_URL}
TikTok: ${ORION_SOCIAL_TIKTOK_URL}
Regras: se o cliente pedir só Instagram/Insta, envie somente a URL do Instagram. Se pedir só TikTok, somente a do TikTok. Se pedir redes em geral ou ambas, pode enviar as duas, uma por linha. Não invente outras URLs. No WhatsApp, use URL pura (sem markdown).
`.trim();

  const prompt = `
  --- BASE DE DADOS ---
  ${catalogoUnificadoContexto}
  --- PROMPT DO SETOR ---
  ${promptSetorAtivo}
  ${contextoPedido}
  ${dadosEntregaContexto}
  ${contextoStatusPagamentoCliente}
  ${socialContexto}
  ${historicoRecenteContexto}
  ${instrucaoPosCadastroConcluido}
  --- STATUS ---
  ${statusPagamentoDescricao}
  MENSAGEM DO CLIENTE: ${userMessage}
  `;

  try {
    let text = await generateAIContentHibrido(session.messageHistory, prompt);
    if (text) {
      text = await replacePaymentPlaceholderIfPossible(chatId, session, text, userMessage);

      // Se IA pedir link de pagamento ([LINK_PAGAMENTO]), força motor estruturado (igual checkout do site).
      if (text.includes('[LINK_PAGAMENTO]') && shouldProceedDirectCheckoutFromMessage(userMessage, session)) {
        const catalogRuntime = await getRuntimeCatalog();
        let sku = resolveBestSkuForCheckout(session, catalogRuntime, userMessage);
        if (!sku || sku === '__MULTI__') {
          await sendHumanizedMessage(
            chatId,
            buildHumanizedSkuQuestion(catalogRuntime, session?.lastDetectedSku || '')
          );
          return;
        }

        const product = catalogRuntime?.[sku];
        const productLabel = `${product?.comercial?.nome || 'Protocolo'} ${product?.comercial?.dosagem || ''}`.trim();
        session.lastDetectedSku = sku;
        await saveSession(chatId, session);
        const orderMessage = buildSiteLikeSyntheticProtocolMessage(sku, catalogRuntime);
        const checkout = await processarCheckoutEstruturado(chatId, orderMessage, session, {
          resetHistory: false,
          notifyAdmin: true,
          notifyName: msg?._data?.notifyName || chatId
        });
        if (!checkout.ok) {
          await sendHumanizedMessage(
            chatId,
            checkout.errorMessage ||
              `No momento, não consegui concluir o fechamento de ${productLabel}. Me chama que eu finalizo com você em seguida.`
          );
          return;
        }
        const payUrlGemini = paymentCheckoutUrl(checkout);
        if (!payUrlGemini) {
          pushDebugLog('error', `[checkout] Gemini [LINK_PAGAMENTO] sem URL chat=${chatId} sku=${sku}`);
          await sendHumanizedMessage(chatId, MSG_CHECKOUT_SEM_LINK);
          return;
        }
        const priceText = product?.comercial?.precoOriginal || product?.comercial?.preco || '';
        await sendHumanizedMessage(
          chatId,
          `Perfeito! Pedido direto liberado para ${productLabel}${priceText ? ` por ${priceText}` : ''}.\n\nSegue seu link de pagamento seguro:\n${payUrlGemini}`
        );
        return;
      }

      const tinhaTagVendas = text.includes('[MUDAR_PARA_VENDAS]') || text.includes('[VENDAS]');
      if (tinhaTagVendas) {
        text = text.replace(/\[MUDAR_PARA_VENDAS\]/g, '').replace(/\[VENDAS\]/g, '').trim();
        text = appendRoteiroCarrinhoSeNecessario(text, {
          userMessage,
          checkoutState: session?.checkoutState,
          paymentStatus: session?.paymentStatus
        });
        await updateSession(chatId, { setorAtual: 'VENDAS' });
        setorAtivo = 'VENDAS';
        logBotEmAtendimento(chatId, 'VENDAS', 'transicao-tecnico-para-vendas-tag');
      } else if (setorAtivo === 'TECNICO' && hasStrongPurchaseSignal(userMessage)) {
        text = appendRoteiroCarrinhoSeNecessario(text, {
          userMessage,
          checkoutState: session?.checkoutState,
          paymentStatus: session?.paymentStatus
        });
        await updateSession(chatId, { setorAtual: 'VENDAS' });
        setorAtivo = 'VENDAS';
        logBotEmAtendimento(chatId, 'VENDAS', 'transicao-intencao-compra-sem-tag');
      }
      if (
        text.includes('Essa é uma excelente pergunta técnica. Para sua segurança, vou encaminhar esse ponto agora mesmo para o nosso especialista responsável, que te dará o suporte detalhado em instantes. Um momento, por favor.') &&
        deveDispararTransbordoPorRiscoClinico(userMessage) &&
        setorAtivo !== 'VENDAS'
      ) {
        await notificarFernandoTransbordo(chatId, 'Risco clínico identificado (doença grave, gravidez ou remédio controlado).');
      }
      const specializedHandoff = detectSpecializedHandoffByBotText(text);
      if (specializedHandoff) {
        const canNotifyNow = shouldNotifyHandoffNow(session);
        session = await updateSession(chatId, {
          riskAlert: true,
          riskReason: 'Bot solicitou encaminhamento para atendimento humano/especializado',
          riskAt: new Date().toISOString()
        });
        if (canNotifyNow) {
          const resumoCliente = String(userMessage || '').trim().slice(0, 220);
          await notificarFernandoTransbordo(
            chatId,
            `Encaminhamento para atendimento especializado detectado automaticamente.${resumoCliente ? ` Última msg cliente: "${resumoCliente}"` : ''}`
          );
        }
      }
      // Limpa asteriscos soltos que o Gemini às vezes gera
      text = text.replace(/\*\*/g, '*'); 
      await sendHumanizedMessage(chatId, text);
    }
  } catch (err) {
    console.error('[Gemini Error]:', err);
    setWhatsAppError(err, 'gemini_generateContent');
    pushDebugLog('error', `[gemini] falha ao gerar resposta para ${chatId}: ${String(err?.message || err)}`);
    await notificarCanalOperacoes(
      'gemini_falha_resposta',
      `Falha Gemini na geração de resposta. chatId=${chatId}. Detalhe: ${String(err?.message || err).slice(0, 220)}`
    );
    const fallbackReply = await buildDeterministicFallbackReply(userMessage, session);
    await sendHumanizedMessage(chatId, fallbackReply);
  }
});

client.on('message_create', async (msg) => {
  try {
    if (!msg?.fromMe) return;
    if (!claimMessageForProcessing(msg)) return;

    const chatId = resolveChatIdFromMessage(msg);
    if (!chatId) return;
    if (chatId === 'status@broadcast' || chatId.endsWith('@newsletter') || chatId.endsWith('@g.us')) return;

    let userMessage = String(msg?.body || '').trim();
    if (!userMessage && !msg?.hasMedia) return;

    if (msg?.hasMedia && !userMessage) {
      const mediaType = String(msg?.type || '').toLowerCase();
      userMessage = mediaType.includes('audio')
        ? '[Áudio enviado pelo atendente]'
        : '[Mídia enviada pelo atendente]';
    }

    // Ignora eco de mensagem enviada automaticamente pelo próprio bot.
    if (consumePendingBotEcho(chatId, userMessage)) return;

    // Comando humano digitado direto no WhatsApp para assumir/liberar o atendimento.
    if (userMessage) {
      const controlAction = detectHumanChatControlAction(userMessage);
      if (controlAction) {
        const nowIso = new Date().toISOString();
        await getOrCreateSession(chatId);
        if (controlAction === 'PAUSE_CHAT') {
          await db.run(
            'UPDATE sessions SET isPaused = 1, pausedUntil = NULL, updated_at = ? WHERE chat_id = ?',
            [nowIso, chatId]
          );
          pushDebugLog('info', `[human-command:create] conversa assumida manualmente via celular | chatId=${chatId}`);
          return;
        }
        if (controlAction === 'RESUME_CHAT') {
          await db.run(
            'UPDATE sessions SET isPaused = 0, pausedUntil = NULL, updated_at = ? WHERE chat_id = ?',
            [nowIso, chatId]
          );
          pushDebugLog('info', `[human-command:create] conversa liberada manualmente via celular | chatId=${chatId}`);
          return;
        }
      }
    }

    if (!userMessage) return;
    await appendMessageHistory(chatId, 'human', userMessage);
    pushDebugLog('info', `[human-message:create] mensagem humana registrada | chatId=${chatId}`);
  } catch (err) {
    console.error('[message_create] erro ao registrar mensagem humana:', err?.message || err);
  }
});

// ========== NGROK (túnel público para webhook Mercado Pago) ==========
/** Binários não podem ser executados de dentro do app.asar (Electron); o builder descompacta ngrok para app.asar.unpacked. */
function ngrokBinPathForPackagedApp(defaultBinDir) {
  const d = String(defaultBinDir || '');
  if (d.includes('app.asar')) {
    return d.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
  }
  return defaultBinDir;
}

/** Quando o ngrok via npm falha, usa o túnel já aberto pelo CLI (`ngrok http 3000`) na API local :4040. */
async function tryDetectNgrokFromLocalInspector() {
  try {
    const { data } = await axios.get('http://127.0.0.1:4040/api/tunnels', {
      timeout: 6000,
      validateStatus: (s) => s === 200
    });
    const tunnels = Array.isArray(data?.tunnels) ? data.tunnels : [];
    const https = tunnels.find((t) => t.proto === 'https');
    const pub = https?.public_url || tunnels[0]?.public_url;
    const normalized = pub ? String(pub).trim().replace(/\/+$/, '') : '';
    return normalized || null;
  } catch {
    return null;
  }
}

async function initNgrok(listenPort) {
  const token = String(process.env.NGROK_AUTHTOKEN || '').trim();
  if (!token) {
    console.log('[Ngrok] NGROK_AUTHTOKEN ausente — tentando túnel externo em localhost:4040...');
    const ext = await tryDetectNgrokFromLocalInspector();
    if (ext) {
      webhookUrl = ext;
      console.log('[Ngrok] Túnel externo (CLI) em uso:', webhookUrl);
      persistWebhookBaseUrlForTesting(webhookUrl);
    } else {
      console.log('[Ngrok] Nenhum túnel detectado; defina NGROK_AUTHTOKEN ou rode `ngrok http <porta>`.');
      webhookUrl = null;
      await notificarCanalOperacoes(
        'ngrok_sem_tunel_ativo',
        'Sem NGROK_AUTHTOKEN e sem túnel externo detectado em :4040. Webhook do Mercado Pago ficará offline.'
      );
    }
    return;
  }
  try {
    const ngrok = require('ngrok');
    const url = await ngrok.connect({
      addr: listenPort,
      authtoken: token,
      binPath: ngrokBinPathForPackagedApp
    });
    const normalized = String(url || '').replace(/\/+$/, '');
    webhookUrl = normalized || null;
    if (webhookUrl) {
      console.log('[Ngrok] Túnel ativo:', webhookUrl);
      // Modo teste/semana: persiste a URL atual para reduzir ajuste manual diário.
      persistWebhookBaseUrlForTesting(webhookUrl);
    }
  } catch (err) {
    console.error('[Ngrok] Falha ao iniciar túnel embutido:', err?.message || err);
    await notificarCanalOperacoes(
      'ngrok_embutido_falhou',
      `Falha ao iniciar túnel embutido: ${String(err?.message || err).slice(0, 220)}. Tentando túnel externo em :4040.`
    );
    const ext = await tryDetectNgrokFromLocalInspector();
    if (ext) {
      webhookUrl = ext;
      console.log('[Ngrok] Usando túnel externo (CLI) detectado em :4040:', webhookUrl);
      persistWebhookBaseUrlForTesting(webhookUrl);
    } else {
      webhookUrl = null;
      await notificarCanalOperacoes(
        'ngrok_sem_tunel_ativo',
        'Falha no ngrok embutido e nenhum túnel externo detectado em :4040. Webhook do Mercado Pago offline.'
      );
    }
  }
}

async function shutdownNgrokTunnel() {
  try {
    const ngrok = require('ngrok');
    await ngrok.kill();
  } catch (err) {
    console.error('[Ngrok] Erro ao encerrar túnel:', err?.message || err);
  }
  webhookUrl = null;
}

// ========== EXPRESS & WEBHOOK MERCADO PAGO ==========
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/** Painel espelhado na web (CORS). `www` e apex são origens diferentes no browser. */
const CORS_ALLOWED_ORIGINS = new Set(
  String(process.env.ORION_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
if (CORS_ALLOWED_ORIGINS.size === 0) {
  CORS_ALLOWED_ORIGINS.add('https://atualhub.com.br');
  CORS_ALLOWED_ORIGINS.add('https://www.atualhub.com.br');
}

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  const origin = String(req.headers.origin || '').trim();
  if (CORS_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, ngrok-skip-browser-warning'
  );
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.get('/debug/session/:chatId', async (req, res) => {
  try {
    const chatId = decodeURIComponent(String(req.params.chatId || '')).trim();
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId inválido' });
    }

    const sessionRow = await db.get('SELECT * FROM sessions WHERE chat_id = ?', [chatId]);
    if (!sessionRow) {
      return res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
    }

    const deliveryRow = await db.get('SELECT * FROM delivery_data WHERE chat_id = ?', [chatId]);
    const paymentRow = await db.get(
      'SELECT * FROM payment_data WHERE chat_id = ? ORDER BY updated_at DESC LIMIT 1',
      [chatId]
    );

    return res.json({
      ok: true,
      chatId,
      session: {
        lastOrder: sessionRow.last_order || null,
        lastLink: sessionRow.last_link || null,
        paymentStatus: sessionRow.payment_status || null,
        lastPaymentId: sessionRow.last_payment_id || null,
        deliveryNotified: !!sessionRow.delivery_notified,
        paymentWelcomeSent: !!sessionRow.payment_welcome_sent,
        deliveryFlowClosed: !!sessionRow.delivery_flow_closed,
        setorAtual: sessionRow.setor_atual || null,
        messageHistory: parseMessageHistory(sessionRow.message_history),
        dadosEntrega: {
          nome: deliveryRow?.nome || '',
          rua: deliveryRow?.rua || '',
          numero: deliveryRow?.numero || '',
          cep: deliveryRow?.cep || '',
          cidade: deliveryRow?.cidade || '',
          bairro: deliveryRow?.bairro || ''
        },
        updatedAt: sessionRow.updated_at || null
      },
      paymentLatest: paymentRow
        ? {
            paymentId: paymentRow.payment_id,
            status: paymentRow.status,
            value: paymentRow.value,
            invoiceUrl: paymentRow.invoice_url,
            updatedAt: paymentRow.updated_at
          }
        : null
    });
  } catch (err) {
    console.error('[Debug Error] Falha ao consultar sessão:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao consultar sessão' });
  }
});

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const nowIso = new Date().toISOString();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayIso = startOfDay.toISOString();

    const totalTodayRow = await db.get(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM payment_data
       WHERE UPPER(TRIM(status)) = 'PAID'
         AND updated_at >= ?`,
      [startOfDayIso]
    );
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const activeRow = await db.get(
      `SELECT COUNT(*) AS n FROM sessions WHERE updated_at IS NOT NULL AND updated_at > ?`,
      [since]
    );
    const totalConversationsRow = await db.get(`SELECT COUNT(*) AS n FROM sessions`);
    const pendingRow = await db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(value), 0) AS total
       FROM payment_data
       WHERE UPPER(TRIM(status)) = 'PENDING'`
    );
    const riskAlertsRow = await db.get(
      `SELECT COUNT(*) AS n
       FROM sessions
       WHERE COALESCE(risk_alert, 0) = 1`
    );
    const paidWithoutAddressRow = await db.get(
      `SELECT COUNT(*) AS n
       FROM sessions s
       LEFT JOIN delivery_data d ON d.chat_id = s.chat_id
       WHERE UPPER(TRIM(COALESCE(s.payment_status, ''))) = 'PAID'
         AND (
           TRIM(COALESCE(d.rua, '')) = '' OR
           TRIM(COALESCE(d.numero, '')) = '' OR
           TRIM(COALESCE(d.cep, '')) = '' OR
           TRIM(COALESCE(d.cidade, '')) = ''
         )`
    );
    const pendingShipmentRow = await db.get(
      `SELECT COUNT(*) AS n
       FROM sessions s
       LEFT JOIN delivery_data d ON d.chat_id = s.chat_id
       WHERE UPPER(TRIM(COALESCE(s.payment_status, ''))) = 'PAID'
         AND TRIM(COALESCE(d.rua, '')) <> ''
         AND TRIM(COALESCE(d.numero, '')) <> ''
         AND TRIM(COALESCE(d.cep, '')) <> ''
         AND TRIM(COALESCE(d.cidade, '')) <> ''
         AND UPPER(TRIM(COALESCE(s.shipping_status, 'PENDING_SHIPMENT'))) = 'PENDING_SHIPMENT'`
    );
    const pausedRow = await db.get(
      `SELECT COUNT(*) AS n
       FROM sessions
       WHERE COALESCE(isPaused, 0) = 1
         AND (pausedUntil IS NULL OR pausedUntil > ?)`,
      [nowIso]
    );
    const stockRows = await db.all(
      `SELECT sku, quantity
       FROM stock_data`
    );
    const stockBySku = Object.fromEntries(
      (stockRows || []).map((r) => [String(r.sku || '').trim(), Number(r.quantity ?? 0)])
    );
    const catalogRuntime = await getRuntimeCatalog();
    const catalogSkus = Object.keys(catalogRuntime || {});
    const lowStockSkus = catalogSkus.filter((sku) => Number(stockBySku[sku] ?? 0) <= 3).length;

    return res.json({
      ok: true,
      totalSalesToday: Number(totalTodayRow?.total ?? 0),
      activeConversations: Number(activeRow?.n ?? 0),
      totalConversations: Number(totalConversationsRow?.n ?? 0),
      pendingPayments: {
        count: Number(pendingRow?.n ?? 0),
        totalValue: Number(pendingRow?.total ?? 0)
      },
      riskAlerts: Number(riskAlertsRow?.n ?? 0),
      paidWithoutAddress: Number(paidWithoutAddressRow?.n ?? 0),
      pendingShipment: Number(pendingShipmentRow?.n ?? 0),
      pausedConversations: Number(pausedRow?.n ?? 0),
      lowStockSkus,
      bot: {
        online: whatsappClientReady || whatsappClientAuthenticated,
        emergencyPaused: emergencyPauseGlobal,
        label: whatsappClientReady
          ? 'Online'
          : (whatsappClientAuthenticated ? 'Online (sessão autenticada)' : 'Offline / aguardando')
      }
    });
  } catch (err) {
    console.error('[Dashboard] summary:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao carregar resumo' });
  }
});

app.get('/api/dashboard/orders', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const orderLimit = Math.max(
      1,
      Math.min(
        DASHBOARD_ORDERS_LIMIT_MAX,
        Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DASHBOARD_ORDERS_LIMIT_DEFAULT
      )
    );
    const rows = await db.all(
      `SELECT
        p.payment_id AS id,
        s.chat_id AS chatId,
        p.value,
        p.status AS paymentStatus,
        COALESCE(s.updated_at, p.updated_at) AS updatedAt,
        COALESCE(s.isPaused, 0) AS isPaused,
        s.pausedUntil AS pausedUntil,
        COALESCE(NULLIF(TRIM(d.nome), ''), NULL) AS customerName,
        COALESCE(NULLIF(TRIM(s.contact_name), ''), NULL) AS contactName,
        COALESCE(NULLIF(TRIM(s.phone_number), ''), NULL) AS phoneNumber,
        COALESCE(NULLIF(TRIM(s.phone_source), ''), NULL) AS phoneSource,
        COALESCE(NULLIF(TRIM(s.profile_pic), ''), NULL) AS profilePic,
        COALESCE(s.total_paid_orders, 0) AS totalPaidOrders,
        COALESCE(s.is_returning_customer, 0) AS isReturningCustomer,
        COALESCE(NULLIF(TRIM(s.referral_name), ''), NULL) AS referralName,
        COALESCE(NULLIF(TRIM(s.referral_source), ''), NULL) AS referralSource,
        s.referral_at AS referralAt,
        s.message_history AS messageHistory,
        s.lp_link_sent_at AS catalogLinkSentAt,
        COALESCE(s.risk_alert, 0) AS riskAlert,
        s.risk_reason AS riskReason,
        s.risk_at AS riskAt,
        s.payment_status AS sessionPaymentStatus,
        s.shipping_status AS shippingStatus,
        s.last_order AS lastOrder,
        s.last_payment_id AS lastPaymentId,
        d.rua,
        d.numero,
        d.cep,
        d.cidade
       FROM sessions s
       LEFT JOIN delivery_data d ON d.chat_id = s.chat_id
       LEFT JOIN payment_data p
         ON p.chat_id = s.chat_id
        AND p.updated_at = (
          SELECT MAX(p2.updated_at)
          FROM payment_data p2
          WHERE p2.chat_id = s.chat_id
        )
       ORDER BY COALESCE(s.risk_alert, 0) DESC, COALESCE(s.updated_at, p.updated_at, '') DESC
       LIMIT ${orderLimit}`
    );
    const enriched = rows.map((row) => {
      const chatId = String(row.chatId || '').trim();
      const digits = chatId.replace(/\D/g, '');
      const contactNumber = row.phoneNumber || digits || null;
      const hasOrder = !!String(row.lastOrder || '').trim() || !!String(row.lastPaymentId || '').trim();
      const paymentStatus = String(row.sessionPaymentStatus || row.paymentStatus || '').toUpperCase().trim();
      const hasDeliveryCore =
        !!String(row.rua || '').trim() &&
        !!String(row.numero || '').trim() &&
        !!String(row.cep || '').trim() &&
        !!String(row.cidade || '').trim();
      const shippingStatus = normalizeShippingStatus(row.shippingStatus, { paymentStatus, hasDeliveryCore });
      const isShipmentPending = shippingStatus === 'PENDING_SHIPMENT';

      let journeyStatusKey = 'NEW_CHAT';
      let journeyStatusLabel = 'Novo contato';
      const history = parseMessageHistory(row.messageHistory);
      const lastCustomerMsg = [...history].reverse().find((m) => String(m?.role || '').toLowerCase() === 'user');
      if (hasOrder && paymentStatus !== 'PAID') {
        journeyStatusKey = 'WAITING_PAYMENT';
        journeyStatusLabel = 'Aguardando pagamento';
      } else if (paymentStatus === 'PAID' && !hasDeliveryCore) {
        journeyStatusKey = 'PAID';
        journeyStatusLabel = 'Pagamento aprovado';
      } else if (shippingStatus === 'DELIVERED') {
        journeyStatusKey = 'DELIVERED';
        journeyStatusLabel = 'Entregue';
      } else if (shippingStatus === 'SHIPPED') {
        journeyStatusKey = 'SHIPPED';
        journeyStatusLabel = 'Enviado';
      } else if (paymentStatus === 'PAID' && hasDeliveryCore) {
        journeyStatusKey = 'READY_TO_SHIP';
        journeyStatusLabel = 'Pronto para envio';
      } else if (hasOrder) {
        journeyStatusKey = 'CHECKOUT_STARTED';
        journeyStatusLabel = 'Pedido iniciado';
      } else if (String(row.catalogLinkSentAt || '').trim()) {
        journeyStatusKey = 'CATALOG_SENT';
        journeyStatusLabel = 'Escolha de produtos';
      }

      return {
        ...row,
        chatId,
        customerName: row.customerName || null,
        contactName: row.contactName || null,
        contactNumber,
        profilePic: row.profilePic || null,
        waLink: contactNumber ? `https://wa.me/${contactNumber}` : null,
        phoneVerification: contactNumber ? (row.phoneSource || 'INFERRED') : null,
        riskAlert: Number(row.riskAlert || 0) === 1,
        riskReason: row.riskReason || null,
        riskAt: row.riskAt || null,
        lastCustomerMessageAt: lastCustomerMsg?.at || null,
        status: paymentStatus || null,
        shippingStatus,
        isShipmentPending,
        totalPaidOrders: Number(row.totalPaidOrders || 0),
        isReturningCustomer: Number(row.isReturningCustomer || 0) === 1,
        referralName: normalizeReferralDisplayName(sanitizeReferralCandidate(row.referralName)) || null,
        referralSource: row.referralSource || null,
        referralAt: row.referralAt || null,
        journeyStatusKey,
        journeyStatusLabel
      };
    });
    const consolidatedMap = new Map();
    for (const item of enriched) {
      const dedupeKey = item.contactNumber ? `phone:${item.contactNumber}` : `chat:${item.chatId}`;
      const current = consolidatedMap.get(dedupeKey);
      if (!current) {
        consolidatedMap.set(dedupeKey, item);
        continue;
      }

      const currentTs = new Date(current.updatedAt || 0).getTime();
      const itemTs = new Date(item.updatedAt || 0).getTime();
      const newest = itemTs >= currentTs ? item : current;
      const oldest = itemTs >= currentTs ? current : item;
      const currentPauseTs = new Date(current.pausedUntil || 0).getTime();
      const itemPauseTs = new Date(item.pausedUntil || 0).getTime();

      const mergedShippingStatus = newest.shippingStatus || oldest.shippingStatus || null;
      const lastMsgA = newest.lastCustomerMessageAt;
      const lastMsgB = oldest.lastCustomerMessageAt;
      const lastMsgTsA = new Date(lastMsgA || 0).getTime();
      const lastMsgTsB = new Date(lastMsgB || 0).getTime();
      const validLastMsgA = Number.isFinite(lastMsgTsA) && lastMsgTsA > 0;
      const validLastMsgB = Number.isFinite(lastMsgTsB) && lastMsgTsB > 0;
      const mergedLastCustomerMessageAt =
        !validLastMsgA && !validLastMsgB
          ? null
          : !validLastMsgA
            ? lastMsgB
            : !validLastMsgB
              ? lastMsgA
              : lastMsgTsA >= lastMsgTsB
                ? lastMsgA
                : lastMsgB;

      consolidatedMap.set(dedupeKey, {
        ...newest,
        chatId: newest.chatId || oldest.chatId,
        id: newest.id || oldest.id,
        lastOrder: newest.lastOrder || oldest.lastOrder,
        lastPaymentId: newest.lastPaymentId || oldest.lastPaymentId,
        customerName: newest.customerName || oldest.customerName || null,
        contactName: newest.contactName || oldest.contactName || null,
        profilePic: newest.profilePic || oldest.profilePic || null,
        lastCustomerMessageAt: mergedLastCustomerMessageAt,
        waLink: newest.waLink || oldest.waLink || null,
        riskAlert: !!(current.riskAlert || item.riskAlert),
        riskReason: newest.riskReason || oldest.riskReason || null,
        riskAt: newest.riskAt || oldest.riskAt || null,
        shippingStatus: mergedShippingStatus,
        isShipmentPending: mergedShippingStatus === 'PENDING_SHIPMENT',
        totalPaidOrders: Math.max(Number(current.totalPaidOrders || 0), Number(item.totalPaidOrders || 0)),
        isReturningCustomer: !!(current.isReturningCustomer || item.isReturningCustomer),
        referralName: newest.referralName || oldest.referralName || null,
        referralSource: newest.referralSource || oldest.referralSource || null,
        referralAt: newest.referralAt || oldest.referralAt || null,
        // Para contatos consolidados (lid/c.us), o estado de pausa deve refletir o registro mais recente.
        isPaused: Number(newest.isPaused || 0) === 1 ? 1 : 0,
        pausedUntil: newest.pausedUntil || null,
        phoneVerification:
          current.phoneVerification === 'VERIFIED' || item.phoneVerification === 'VERIFIED'
            ? 'VERIFIED'
            : (newest.phoneVerification || oldest.phoneVerification || null)
      });
    }

    const consolidated = Array.from(consolidatedMap.values()).sort((a, b) => {
      if (a.riskAlert !== b.riskAlert) return a.riskAlert ? -1 : 1;
      if (a.isShipmentPending !== b.isShipmentPending) return a.isShipmentPending ? -1 : 1;
      const aTs = new Date(a.updatedAt || 0).getTime();
      const bTs = new Date(b.updatedAt || 0).getTime();
      return bTs - aTs;
    });

    return res.json({ ok: true, orders: consolidated });
  } catch (err) {
    console.error('[Dashboard] orders:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar pedidos' });
  }
});

app.get('/api/dashboard/conversation/:chatId', async (req, res) => {
  try {
    const chatId = String(req.params.chatId || '').trim();
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId inválido' });
    }

    const row = await db.get(
      `SELECT
        chat_id AS chatId,
        COALESCE(NULLIF(TRIM(contact_name), ''), NULL) AS contactName,
        COALESCE(NULLIF(TRIM(phone_number), ''), NULL) AS phoneNumber,
        COALESCE(NULLIF(TRIM(referral_name), ''), NULL) AS referralName,
        COALESCE(NULLIF(TRIM(referral_source), ''), NULL) AS referralSource,
        referral_at AS referralAt,
        COALESCE(NULLIF(TRIM(profile_pic), ''), NULL) AS profilePic,
        message_history AS messageHistory,
        updated_at AS updatedAt
       FROM sessions
       WHERE chat_id = ?
       LIMIT 1`,
      [chatId]
    );

    if (!row) {
      return res.status(404).json({ ok: false, error: 'Conversa não encontrada' });
    }

    return res.json({
      ok: true,
      conversation: {
        chatId: row.chatId,
        contactName: row.contactName || null,
        phoneNumber: row.phoneNumber || null,
        referralName: normalizeReferralDisplayName(sanitizeReferralCandidate(row.referralName)) || null,
        referralSource: row.referralSource || null,
        referralAt: row.referralAt || null,
        profilePic: row.profilePic || null,
        updatedAt: row.updatedAt || null,
        messageHistory: dedupeHumanAssistantEchoForDisplay(parseMessageHistory(row.messageHistory))
      }
    });
  } catch (err) {
    console.error('[Dashboard] conversation:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao carregar conversa' });
  }
});

app.get('/api/dashboard/catalog', async (req, res) => {
  db.all('SELECT sku, quantity FROM stock_data')
    .then(async (stockRows) => {
      const stockBySku = Object.fromEntries(
        (stockRows || []).map((r) => [String(r.sku || '').trim(), Number(r.quantity ?? 0)])
      );
      const catalogRuntime = await getRuntimeCatalog();
      const items = Object.entries(catalogRuntime).map(([sku, row]) => ({
        sku,
        nome: row.comercial?.nome ?? '',
        dosagem: row.comercial?.dosagem ?? '',
        preco: row.comercial?.preco ?? '',
        categoria: row.comercial?.categoria ?? '',
        stockQuantity: Number(stockBySku[sku] ?? 0)
      }));
      return res.json({ ok: true, items });
    })
    .catch((err) => {
      console.error('[Dashboard] catalog:', err);
      return res.status(500).json({ ok: false, error: 'Falha ao carregar catálogo' });
    });
});

/** Estado do cliente WhatsApp para painel local ou espelhado (CORS em atualhub.com.br). */
app.get('/api/whatsapp/status', (req, res) => {
  return res.json({
    ok: true,
    authenticated: whatsappClientAuthenticated || whatsappClientReady,
    ready: whatsappClientReady,
    connectionState: whatsappConnectionState,
    authenticatedAt: whatsappAuthenticatedAt,
    hasQr: !!latestQrBase64,
    qrUpdatedAt: latestQrAt,
    lastEvent: whatsappLastEvent,
    lastEventAt: whatsappLastEventAt,
    lastError: whatsappLastError,
    recentDebug: whatsappDebugRecent.slice(-10)
  });
});

/**
 * QR atual para pareamento. `qrBase64` é data URL (`data:image/png;base64,...`) gerada por QRCode.toDataURL, ou null.
 * Quando `authenticated` é true, o QR costuma ser null — o painel deve ocultar a imagem.
 */
app.get('/api/whatsapp/qr', (req, res) => {
  return res.json({
    ok: true,
    authenticated: whatsappClientAuthenticated || whatsappClientReady,
    qrBase64: latestQrBase64,
    updatedAt: latestQrAt
  });
});

app.post('/api/whatsapp/restart', async (req, res) => {
  try {
    setWhatsAppEvent('restart_requested');
    latestQrBase64 = null;
    latestQrAt = null;
    try {
      await client.destroy();
    } catch {}
    try {
      await client.initialize();
    } catch (err) {
      console.error('[WhatsApp Restart] Falha ao inicializar:', err);
      setWhatsAppError(err, 'restart_initialize');
    }
    return res.json({ ok: true, restartedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[WhatsApp Restart] erro:', err);
    setWhatsAppError(err, 'restart');
    return res.status(500).json({ ok: false, error: 'Falha ao reiniciar WhatsApp' });
  }
});

app.get('/api/whatsapp/logs', (req, res) => {
  try {
    const lines = fs.existsSync(APP_LOG_FILE)
      ? fs.readFileSync(APP_LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-200)
      : [];
    return res.json({ ok: true, lines });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get('/api/dashboard/webhook-status', (req, res) => {
  const envWebhookBaseUrl = String(process.env.WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '');
  const effectiveWebhookUrl = webhookUrl || envWebhookBaseUrl || null;
  return res.json({
    ok: true,
    active: !!effectiveWebhookUrl,
    url: effectiveWebhookUrl
  });
});

/** Encerra o túnel ngrok (ex.: ao fechar o app Electron em modo fork). */
app.post('/api/dashboard/ngrok-disconnect', async (req, res) => {
  try {
    await shutdownNgrokTunnel();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.post('/api/dashboard/catalog-price/set', async (req, res) => {
  try {
    const sku = String(req.body?.sku || '').trim();
    const priceRaw = String(req.body?.price ?? '').trim();
    if (!sku || !priceRaw) {
      return res.status(400).json({ ok: false, error: 'sku e price são obrigatórios' });
    }
    if (!CATALOGO_UNIFICADO_BASE[sku]) {
      return res.status(404).json({ ok: false, error: 'SKU não encontrado no catálogo base' });
    }
    const price = normalizePriceText(priceRaw);
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO catalog_price_data (sku, price, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(sku) DO UPDATE SET
         price=excluded.price,
         updated_at=excluded.updated_at`,
      [sku, price, now]
    );
    return res.json({ ok: true, sku, price, updatedAt: now });
  } catch (err) {
    console.error('[Dashboard] catalog-price/set:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar preço' });
  }
});

app.post('/api/dashboard/stock/set', async (req, res) => {
  try {
    const sku = String(req.body?.sku || '').trim();
    const quantity = Number(req.body?.quantity);
    if (!sku || !Number.isFinite(quantity) || quantity < 0) {
      return res.status(400).json({ ok: false, error: 'sku e quantity (>= 0) são obrigatórios' });
    }
    const qty = Math.floor(quantity);
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO stock_data (sku, quantity, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(sku) DO UPDATE SET
         quantity=excluded.quantity,
         updated_at=excluded.updated_at`,
      [sku, qty, now]
    );
    return res.json({ ok: true, sku, quantity: qty, updatedAt: now });
  } catch (err) {
    console.error('[Dashboard] stock/set:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar estoque' });
  }
});

app.post('/api/dashboard/shipping-status', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    const shippingStatus = String(req.body?.shippingStatus || '').trim().toUpperCase();
    const allowed = new Set(['PENDING_SHIPMENT', 'SHIPPED', 'DELIVERED']);
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId é obrigatório' });
    }
    if (!allowed.has(shippingStatus)) {
      return res.status(400).json({ ok: false, error: 'shippingStatus inválido' });
    }
    await getOrCreateSession(chatId);
    const now = new Date().toISOString();
    await db.run(
      `UPDATE sessions
       SET shipping_status = ?, updated_at = ?
       WHERE chat_id = ?`,
      [shippingStatus, now, chatId]
    );
    return res.json({ ok: true, chatId, shippingStatus, updatedAt: now });
  } catch (err) {
    console.error('[Dashboard] shipping-status:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar status de envio' });
  }
});

app.post('/api/dashboard/pause-bot', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    const permanent = req.body?.permanent !== false;
    const durationMinutes = Number(req.body?.durationMinutes);
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId é obrigatório' });
    }

    const pausedUntil =
      !permanent && Number.isFinite(durationMinutes) && durationMinutes > 0
        ? new Date(Date.now() + durationMinutes * 60000).toISOString()
        : null;
    await getOrCreateSession(chatId);
    await db.run(
      'UPDATE sessions SET isPaused = 1, pausedUntil = ?, updated_at = ? WHERE chat_id = ?',
      [pausedUntil, new Date().toISOString(), chatId]
    );
    return res.json({
      ok: true,
      chatId,
      isPaused: true,
      pausedUntil,
      pauseMode: pausedUntil ? 'temporary' : 'permanent'
    });
  } catch (err) {
    console.error('[Dashboard] pause-bot:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao pausar bot' });
  }
});

app.post('/api/dashboard/unpause-bot', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId é obrigatório' });
    }
    await getOrCreateSession(chatId);
    await db.run(
      'UPDATE sessions SET isPaused = 0, pausedUntil = NULL, updated_at = ? WHERE chat_id = ?',
      [new Date().toISOString(), chatId]
    );
    return res.json({ ok: true, chatId, isPaused: false, pausedUntil: null });
  } catch (err) {
    console.error('[Dashboard] unpause-bot:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao reativar bot' });
  }
});

/** Boss resolveu pendência: remove alerta de transbordo/risco na conversa. */
app.post('/api/dashboard/clear-risk-alert', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId é obrigatório' });
    }
    const now = new Date().toISOString();
    await db.run(
      `UPDATE sessions
       SET risk_alert = 0, risk_reason = NULL, risk_at = NULL, updated_at = ?
       WHERE chat_id = ?`,
      [now, chatId]
    );
    return res.json({ ok: true, chatId, riskAlert: false });
  } catch (err) {
    console.error('[Dashboard] clear-risk-alert:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao limpar alerta' });
  }
});

app.post('/api/dashboard/emergency-unlock-message', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    const text = String(req.body?.text || '').trim();
    const unpauseBot = req.body?.unpauseBot !== false;
    const clearRiskAlert = req.body?.clearRiskAlert !== false;
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId é obrigatório' });
    }
    if (!text) {
      return res.status(400).json({ ok: false, error: 'Mensagem é obrigatória' });
    }

    const session = await getOrCreateSession(chatId);
    let sent = await safeSendMessage(chatId, text, 'dashboard_emergency_unlock');
    if (!sent && /@lid$/i.test(chatId)) {
      const fallbackChatId = session?.phoneNumber
        ? `${String(session.phoneNumber).replace(/\D/g, '')}@c.us`
        : null;
      if (fallbackChatId) {
        pushDebugLog('warn', `[dashboard-unlock] fallback envio ${chatId} -> ${fallbackChatId}`);
        sent = await safeSendMessage(fallbackChatId, text, 'dashboard_emergency_unlock_fallback_cus');
      }
    }
    if (!sent) {
      return res.status(502).json({ ok: false, error: 'Não foi possível enviar a mensagem para este contato' });
    }

    await appendMessageHistory(chatId, 'human', text);

    const now = new Date().toISOString();
    if (unpauseBot || clearRiskAlert) {
      const updates = [];
      const params = [];
      if (unpauseBot) {
        updates.push('isPaused = 0', 'pausedUntil = NULL');
      }
      if (clearRiskAlert) {
        updates.push('risk_alert = 0', 'risk_reason = NULL', 'risk_at = NULL');
      }
      updates.push('updated_at = ?');
      params.push(now, chatId);
      await db.run(`UPDATE sessions SET ${updates.join(', ')} WHERE chat_id = ?`, params);
    }

    const row = await db.get(
      'SELECT chat_id AS chatId, COALESCE(isPaused, 0) AS isPaused, pausedUntil, COALESCE(risk_alert, 0) AS riskAlert FROM sessions WHERE chat_id = ? LIMIT 1',
      [chatId]
    );

    return res.json({
      ok: true,
      chatId,
      delivered: true,
      isPaused: Number(row?.isPaused || 0) === 1,
      pausedUntil: row?.pausedUntil || null,
      riskAlert: Number(row?.riskAlert || 0) === 1,
      updatedAt: now
    });
  } catch (err) {
    console.error('[Dashboard] emergency-unlock-message:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar mensagem de destravamento' });
  }
});

app.get('/api/dashboard/emergency-pause', async (req, res) => {
  try {
    return res.json({ ok: true, paused: emergencyPauseGlobal });
  } catch (err) {
    console.error('[Dashboard] emergency-pause:get', err);
    return res.status(500).json({ ok: false, error: 'Falha ao consultar pausa global' });
  }
});

app.post('/api/dashboard/emergency-pause', async (req, res) => {
  try {
    const paused = !!req.body?.paused;
    await saveEmergencyPauseGlobal(paused);
    return res.json({ ok: true, paused: emergencyPauseGlobal, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[Dashboard] emergency-pause:set', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar pausa global' });
  }
});

async function handleMercadoPagoNotification(req, res) {
  const topic = String(req.query?.topic || req.body?.topic || req.body?.type || '').trim();
  const paymentIdPreview = extractMercadoPagoPaymentId(req);
  console.log(
    `[Webhook MP] Recebido | method=${req.method} | topic/type=${topic || 'N/A'} | paymentId=${paymentIdPreview || 'N/A'}`
  );

  if (!mercadoPagoWebhookSignatureIsValid(req)) {
    const xSignature = req.get('x-signature') || req.headers['x-signature'];
    const xRequestId = req.get('x-request-id') || req.headers['x-request-id'];
    const dataIdForSignature = mercadoPagoDataIdForSignature(req);
    console.warn(
      `[Webhook MP] Assinatura inválida | has_x_signature=${!!xSignature} | has_x_request_id=${!!xRequestId} | data.id=${dataIdForSignature || 'N/A'}`
    );
    await notificarCanalOperacoes(
      'webhook_mp_assinatura_invalida',
      `Webhook MP inválido. has_x_signature=${!!xSignature}, has_x_request_id=${!!xRequestId}, data.id=${dataIdForSignature || 'N/A'}.`,
      WEBHOOK_INVALID_ALERT_COOLDOWN_MS
    );
    return res.status(403).send('Invalid Signature');
  }

  res.sendStatus(200);

  const mpPaymentId = paymentIdPreview;
  if (!mpPaymentId) {
    console.log('[Webhook MP] Ignorado: notificação sem paymentId.');
    return;
  }

  const payment = await buscarPagamentoMercadoPago(mpPaymentId);
  if (!payment || payment.status !== 'approved') {
    console.log(`[Webhook MP] Pagamento não aprovado | paymentId=${mpPaymentId} | status=${payment?.status || 'N/A'}`);
    return;
  }

  const extRef = typeof payment.external_reference === 'string' ? payment.external_reference.trim() : '';
  let chatIdFromPayment = null;
  if (extRef.startsWith('chat_')) {
    chatIdFromPayment = extRef.replace(/^chat_/, '');
  } else if (extRef.startsWith('direct_')) {
    const body = extRef.replace(/^direct_/, '');
    const parts = body.split('_');
    if (parts.length >= 2) {
      chatIdFromPayment = parts.slice(0, -1).join('_');
    }
  }
  if (!chatIdFromPayment) {
    chatIdFromPayment = await getChatIdByPaymentId(mpPaymentId);
  }

  if (!chatIdFromPayment) {
    console.warn('[Mercado Pago Webhook] Pagamento aprovado sem external_reference/chatId:', mpPaymentId);
    return;
  }

  const valorPago = Number(payment.transaction_amount ?? 0);
  const session = await getOrCreateSession(chatIdFromPayment);
  const jaEnviouBoasVindasPagamento = !!session.paymentWelcomeSent;

  await saveSession(chatIdFromPayment, {
    ...session,
    paymentStatus: 'PAID',
    shippingStatus: 'PENDING_SHIPMENT',
    paymentWelcomeSent: true,
    checkoutState: 'COMPLETED',
    checkoutFollowupCount: 0,
    checkoutLastFollowupAt: null,
    checkoutSnoozedUntil: null
  });
  await setPaymentSession(mpPaymentId, chatIdFromPayment, {
    status: 'PAID',
    value: valorPago,
    invoiceUrl: session.lastLink || null
  });
  await refreshCustomerPurchaseStats(chatIdFromPayment);

  await deletePaymentStockReservationsForChat(chatIdFromPayment);

  if (!jaEnviouBoasVindasPagamento) {
    await sendHumanizedMessage(chatIdFromPayment, MSG_BOAS_VINDAS_POS_PAGAMENTO);
  }

  const stakeholderTargets = getStakeholderAlertTargets();
  if (stakeholderTargets.length > 0) {
    const valorPagoFmt = Number.isFinite(valorPago)
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorPago)
      : `R$ ${String(valorPago || 0)}`;
    const approvedAt = payment?.date_approved || payment?.date_created || null;
    const approvedAtFmt = approvedAt
      ? new Date(approvedAt).toLocaleString('pt-BR', { hour12: false })
      : 'N/A';
    const nomeContato = session?.contactName || chatIdFromPayment;
    for (const targetId of stakeholderTargets) {
      await safeSendMessage(
        targetId,
        `💰 *PAGAMENTO APROVADO* 💰\n\n*Cliente:* ${nomeContato}\n*Telefone:* ${session?.phoneNumber || 'N/A'}\n*Chat:* ${chatIdFromPayment}\n*Payment ID:* ${mpPaymentId}\n*External Ref:* ${extRef || 'N/A'}\n*Valor:* ${valorPagoFmt}\n*Aprovado em:* ${approvedAtFmt}`,
        'pagamento-aprovado-admin'
      );
    }
  }
  console.log(`[Webhook MP] Pagamento aprovado processado | paymentId=${mpPaymentId} | chatId=${chatIdFromPayment}`);
}

app.post('/api/v1/priority-client-update', handleMercadoPagoNotification);

const PORT = Number(process.env.PORT) || 3000;
const DASHBOARD_DIST = path.join(__dirname, 'dashboard', 'dist');
let serverInstance = null;
let checkoutFollowupTimer = null;
let operationalAlertsTimer = null;

function startCheckoutFollowupScheduler() {
  if (checkoutFollowupTimer) clearInterval(checkoutFollowupTimer);
  checkoutFollowupTimer = setInterval(() => {
    runCheckoutFollowupSweep().catch((err) => {
      console.error('[Checkout Followup] sweep error:', err);
    });
  }, 60 * 1000);
}

async function runOperationalAlertsSweep() {
  try {
    // 1) Webhook/túnel indisponível em runtime.
    const effectiveWebhook = getEffectiveWebhookBaseUrl();
    if (!effectiveWebhook) {
      await notificarCanalOperacoes(
        'webhook_offline_runtime',
        'Webhook base indisponível em runtime (WEBHOOK_BASE_URL vazio e sem túnel ativo).'
      );
    }

    // 2) Pico de alertas clínicos/risco.
    const riskRow = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE COALESCE(risk_alert, 0) = 1');
    const riskCount = Number(riskRow?.n || 0);
    if (riskCount >= 5) {
      await notificarCanalOperacoes(
        'risk_alert_pico',
        `Pico de conversas em risco detectado: ${riskCount} chats com risk_alert ativo.`
      );
    }

    // 3) Pagamento aprovado no MP sem reconciliação no bot.
    const pendingRows = await db.all(
      `SELECT chat_id, last_payment_id, updated_at
       FROM sessions
       WHERE UPPER(TRIM(COALESCE(payment_status, ''))) = 'PENDING'
         AND COALESCE(TRIM(last_payment_id), '') <> ''
       ORDER BY updated_at DESC
       LIMIT 10`
    );
    const staleCutoffMs = Date.now() - 5 * 60 * 1000;
    for (const row of pendingRows || []) {
      const chatId = String(row?.chat_id || '').trim();
      if (!chatId) continue;
      const updatedMs = new Date(row?.updated_at || 0).getTime();
      if (!Number.isFinite(updatedMs) || updatedMs > staleCutoffMs) continue;
      const approved = await buscarPagamentoAprovadoPorChat(chatId);
      if (!approved) continue;
      const approvedId = approved?.id != null ? String(approved.id) : 'N/A';
      await notificarCanalOperacoes(
        `pagamento_aprovado_nao_reconciliado_${chatId}`,
        `Pagamento aprovado no MP e ainda PENDING no bot. chatId=${chatId}, payment_mp=${approvedId}, last_payment_id_sessao=${String(row?.last_payment_id || 'N/A')}`,
        30 * 60 * 1000
      );
    }
  } catch (err) {
    console.error('[Ops Alert] sweep error:', err?.message || err);
  }
}

function startOperationalAlertsScheduler() {
  if (operationalAlertsTimer) clearInterval(operationalAlertsTimer);
  operationalAlertsTimer = setInterval(() => {
    runOperationalAlertsSweep().catch((err) => {
      console.error('[Ops Alert] scheduler error:', err?.message || err);
    });
  }, 2 * 60 * 1000);
  void runOperationalAlertsSweep();
}

async function startServer() {
  setWhatsAppEvent('booting');
  await initDatabase();
  await rebuildCustomerPurchaseStats();
  await loadEmergencyPauseGlobal();
  console.log(`[SQLite] Banco inicializado em ${DB_FILE}`);

  if (fs.existsSync(DASHBOARD_DIST)) {
    app.use(express.static(DASHBOARD_DIST));
    // Express 5 / path-to-regexp v6: não usar app.get('*') — ver PathError "Missing parameter name"
    app.use((req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/debug')) {
        return next();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      if (res.headersSent) {
        return next();
      }
      return res.sendFile(path.join(DASHBOARD_DIST, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
    console.log(`[Dashboard] UI estática em ${DASHBOARD_DIST}`);
  }

  await new Promise((resolve, reject) => {
    serverInstance = app.listen(PORT, async () => {
      console.log(`Servidor rodando na porta ${PORT}`);
      await initNgrok(PORT);
      try {
        await runSyncLink({ preferredUrl: webhookUrl });
      } catch (e) {
        console.warn('[sync-link] Erro não fatal:', e?.message || e);
      }
      console.log('[WhatsApp] LocalAuth:', { dataPath: WWEBJS_DATA_ROOT, clientId: WWEBJS_CLIENT_ID });
      console.log('Iniciando o WhatsApp Web Invisível...');
      setWhatsAppEvent('initialize_called');
      startWhatsAppHealthMonitor();
      startCheckoutFollowupScheduler();
      startOperationalAlertsScheduler();
      try {
        await client.initialize();
      } catch (err) {
        console.error('[WhatsApp Init Error]:', err);
        setWhatsAppError(err, 'start_initialize');
      }
      resolve();
    });
    serverInstance.on('error', reject);
  });

  return { app, client, server: serverInstance, port: PORT };
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Startup Error] Falha ao iniciar aplicação:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  client,
  startServer,
  shutdownNgrok: shutdownNgrokTunnel
};