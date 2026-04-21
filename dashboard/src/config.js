/**
 * URL base da API (ngrok / backend). Definida por:
 * 1) GET em api-link.json na Hostinger (prioridade)
 * 2) Ou variável de build VITE_API_BASE (fallback se o JSON falhar ou vier vazio)
 *
 * api-link.json pode usar: baseUrl | BASE_URL | apiUrl | url
 * Exemplo: { "baseUrl": "https://xxxx.ngrok-free.app" }
 */
export const API_LINK_JSON_URL = 'https://atualhub.com.br/painel/api-link.json';

function normalizeApiRoot(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** URL embutida no build (dashboard/.env → VITE_API_BASE=...) quando não há JSON válido. */
const ENV_API_BASE = normalizeApiRoot(import.meta.env.VITE_API_BASE);

/** Valor atual usado nas requisições (binding vivo). */
export let BASE_URL = ENV_API_BASE || '';

function pickUrlFromJson(data) {
  if (!data || typeof data !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (data);
  const candidates = [o.baseUrl, o.BASE_URL, o.apiUrl, o.url];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

let loadPromise = null;

/**
 * Busca api-link.json; se falhar ou vier sem URL, mantém VITE_API_BASE (se existir).
 * @returns {Promise<string>}
 */
export function loadRemoteBaseUrl() {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch(API_LINK_JSON_URL, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'ngrok-skip-browser-warning': '1'
          },
          cache: 'no-store'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const picked = normalizeApiRoot(pickUrlFromJson(data));
        if (picked) {
          BASE_URL = picked;
        } else {
          BASE_URL = ENV_API_BASE || '';
        }
      } catch {
        BASE_URL = ENV_API_BASE || '';
      }
      return BASE_URL;
    })();
  }
  return loadPromise;
}

/**
 * Monta URL absoluta para a API (BASE_URL sem barra final + path com barra inicial).
 * @param {string} path
 */
export function apiUrl(path) {
  const base = String(BASE_URL || '').replace(/\/+$/, '');
  const p = String(path || '');
  const suffix = p.startsWith('/') ? p : `/${p}`;
  if (!base) return suffix;
  return `${base}${suffix}`;
}
