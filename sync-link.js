'use strict';

/**
 * Sincroniza a URL pública do ngrok com api-link.json na Hostinger.
 *
 * 1) Descobre a URL: API local do ngrok (http://127.0.0.1:4040/api/tunnels), ou preferredUrl, ou WEBHOOK_BASE_URL.
 * 2) Publica via ORION_SYNC_LINK_URL (POST JSON) ou FTP (ORION_FTP_*).
 *
 * Variáveis de ambiente: ver .env.example
 */

require('dotenv').config();

const axios = require('axios');
const { Readable } = require('stream');

const DEFAULT_TUNNELS_API = 'http://127.0.0.1:4040/api/tunnels';

function normalizeBaseUrl(u) {
  const s = String(u || '')
    .trim()
    .replace(/\/+$/, '');
  if (!s) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function buildPayload(baseUrl) {
  return { baseUrl: normalizeBaseUrl(baseUrl) };
}

/**
 * Lê a URL HTTPS do túnel ativo (ngrok rodando na máquina, API na porta 4040).
 * @param {string} [tunnelsUrl]
 */
async function fetchNgrokUrlFromLocalApi(tunnelsUrl = DEFAULT_TUNNELS_API) {
  const { data } = await axios.get(tunnelsUrl, {
    timeout: 8000,
    validateStatus: (s) => s === 200,
    headers: { Accept: 'application/json' }
  });
  const tunnels = Array.isArray(data?.tunnels) ? data.tunnels : [];
  const https = tunnels.find((t) => t.proto === 'https');
  const first = https || tunnels[0];
  const raw = first?.public_url ? String(first.public_url).trim() : '';
  return normalizeBaseUrl(raw);
}

async function publishViaHttpPost(baseUrl) {
  const endpoint = String(process.env.ORION_SYNC_LINK_URL || '').trim();
  if (!endpoint) return { method: null };

  const secret = String(process.env.ORION_SYNC_LINK_SECRET || '').trim();
  const payload = buildPayload(baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (secret) {
    headers['X-Orion-Secret'] = secret;
  }

  const res = await axios.post(endpoint, payload, {
    timeout: 20000,
    headers,
    validateStatus: () => true
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${String(res.data || '').slice(0, 200)}`);
  }
  return { method: 'http', status: res.status, data: res.data };
}

async function publishViaFtp(baseUrl) {
  const host = String(process.env.ORION_FTP_HOST || '').trim();
  const user = String(process.env.ORION_FTP_USER || '').trim();
  const password = String(process.env.ORION_FTP_PASSWORD || '').trim();
  const remotePath = String(process.env.ORION_FTP_REMOTE_PATH || '').trim();

  if (!host || !user || !password || !remotePath) {
    return { method: null };
  }

  let ftp;
  try {
    ftp = require('basic-ftp');
  } catch (e) {
    throw new Error('Pacote basic-ftp não instalado. Rode: npm install basic-ftp');
  }

  const Client = ftp.Client;
  if (typeof Client !== 'function') {
    throw new Error('basic-ftp: Client não encontrado');
  }

  const secure = String(process.env.ORION_FTP_SECURE || '1').trim() !== '0';
  const port = Number(process.env.ORION_FTP_PORT || 21) || 21;

  const body = `${JSON.stringify(buildPayload(baseUrl), null, 2)}\n`;
  const buf = Buffer.from(body, 'utf8');
  const stream = Readable.from(buf);

  const client = new Client();
  client.ftp.verbose = String(process.env.ORION_FTP_VERBOSE || '').trim() === '1';
  try {
    await client.access({
      host,
      port,
      user,
      password,
      secure: secure ? true : false
    });
    await client.uploadFrom(stream, remotePath);
  } finally {
    client.close();
  }

  return { method: 'ftp', remotePath };
}

/**
 * @param {{ preferredUrl?: string | null, tunnelsApiUrl?: string }} [options]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, baseUrl?: string, result?: unknown, error?: string }>}
 */
async function runSyncLink(options = {}) {
  const tunnelsApi = options.tunnelsApiUrl || process.env.ORION_NGROK_API_URL || DEFAULT_TUNNELS_API;

  let baseUrl = normalizeBaseUrl(options.preferredUrl);
  if (!baseUrl) {
    try {
      baseUrl = await fetchNgrokUrlFromLocalApi(tunnelsApi);
    } catch (err) {
      const msg = err?.message || String(err);
      console.warn('[sync-link] API local do ngrok (4040) indisponível:', msg);
    }
  }

  if (!baseUrl) {
    const fromEnv = normalizeBaseUrl(process.env.WEBHOOK_BASE_URL);
    if (fromEnv) {
      baseUrl = fromEnv;
      console.log('[sync-link] Usando WEBHOOK_BASE_URL como fallback.');
    }
  }

  if (!baseUrl) {
    console.log('[sync-link] Nenhuma URL pública disponível; sincronização ignorada.');
    return { ok: false, skipped: true, error: 'no_public_url' };
  }

  const hasHttp = !!String(process.env.ORION_SYNC_LINK_URL || '').trim();
  const hasFtp =
    !!String(process.env.ORION_FTP_HOST || '').trim() &&
    !!String(process.env.ORION_FTP_USER || '').trim() &&
    !!String(process.env.ORION_FTP_PASSWORD || '').trim() &&
    !!String(process.env.ORION_FTP_REMOTE_PATH || '').trim();

  if (!hasHttp && !hasFtp) {
    console.log(
      '[sync-link] ORION_SYNC_LINK_URL ou credenciais FTP (ORION_FTP_*) não configuradas; ignorando upload.'
    );
    return { ok: false, skipped: true, baseUrl, error: 'no_upload_target' };
  }

  try {
    if (hasHttp) {
      const r = await publishViaHttpPost(baseUrl);
      console.log('[sync-link] api-link.json atualizado via HTTP:', baseUrl);
      return { ok: true, baseUrl, result: r };
    }
    const r = await publishViaFtp(baseUrl);
    console.log('[sync-link] api-link.json enviado via FTP:', baseUrl);
    return { ok: true, baseUrl, result: r };
  } catch (err) {
    const msg = err?.response?.data != null ? JSON.stringify(err.response.data) : err?.message || String(err);
    console.error('[sync-link] Falha ao publicar:', msg);
    return { ok: false, baseUrl, error: msg };
  }
}

module.exports = {
  runSyncLink,
  fetchNgrokUrlFromLocalApi,
  normalizeBaseUrl,
  buildPayload
};

if (require.main === module) {
  runSyncLink()
    .then((out) => {
      if (!out.ok && out.skipped) process.exit(0);
      process.exit(out.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
