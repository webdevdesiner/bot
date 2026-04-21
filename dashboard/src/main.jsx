import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import MissingApiBase from './MissingApiBase.jsx';
import './index.css';
import { loadRemoteBaseUrl, BASE_URL } from './config.js';

const PAINEL_PASSWORD = 'orion2020';
const PAINEL_AUTH_STORAGE_KEY = 'orion_painel_unlocked';

/**
 * Bloqueio antes do painel. Em mobile, `window.prompt` costuma falhar ou retornar null → redireciona
 * indevidamente; por isso usamos um formulário em tela cheia (touch-friendly).
 */
function ensurePainelAccessAsync() {
  return new Promise((resolve) => {
    try {
      if (window.localStorage.getItem(PAINEL_AUTH_STORAGE_KEY) === '1') {
        resolve(true);
        return;
      }
    } catch {
      /* localStorage indisponível — pede senha na UI */
    }

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Acesso ao painel');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
      'box-sizing:border-box',
      'background:#0a0a0c',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif'
    ].join(';');

    overlay.innerHTML = `
      <form id="orion-painel-form" style="width:100%;max-width:340px;padding:24px;border-radius:12px;border:1px solid #27272a;background:#151518;box-shadow:0 0 24px rgba(34,211,238,0.12)">
        <h1 style="margin:0 0 8px;font-size:18px;color:#fafafa;font-weight:600">Orion Peptides</h1>
        <p style="margin:0 0 16px;font-size:13px;line-height:1.45;color:#a1a1aa">Digite a senha para acessar o painel.</p>
        <label for="orion-painel-pw" style="display:block;font-size:12px;color:#71717a;margin-bottom:6px">Senha</label>
        <input id="orion-painel-pw" name="password" type="password" autocomplete="current-password" inputmode="text"
          style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:8px;border:1px solid #3f3f46;background:#09090b;color:#e4e4e7;font-size:16px;margin-bottom:16px;-webkit-appearance:none;appearance:none" />
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
          <button type="submit" style="flex:1;min-width:120px;padding:12px 16px;border-radius:8px;border:1px solid #22d3ee55;background:#22d3ee22;color:#a5f3fc;font-weight:600;font-size:16px;cursor:pointer">Entrar</button>
          <button type="button" id="orion-painel-cancel" style="padding:12px 8px;font-size:14px;color:#71717a;background:transparent;border:none;text-decoration:underline;cursor:pointer">Cancelar</button>
        </div>
      </form>
    `;

    document.body.appendChild(overlay);

    const form = overlay.querySelector('#orion-painel-form');
    const input = overlay.querySelector('#orion-painel-pw');
    const btnCancel = overlay.querySelector('#orion-painel-cancel');

    const goGoogle = () => {
      window.location.href = 'https://google.com';
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = String(input.value || '').trim();
      if (val === PAINEL_PASSWORD) {
        try {
          window.localStorage.setItem(PAINEL_AUTH_STORAGE_KEY, '1');
        } catch {
          /* segue */
        }
        overlay.remove();
        resolve(true);
      } else {
        goGoogle();
      }
    });

    btnCancel.addEventListener('click', goGoogle);

    requestAnimationFrame(() => {
      try {
        input.focus();
      } catch {
        /* alguns mobile só focam após gesto */
      }
    });
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));

ensurePainelAccessAsync().then(() => {
  loadRemoteBaseUrl().then(() => {
    if (!String(BASE_URL || '').trim()) {
      root.render(
        <React.StrictMode>
          <MissingApiBase />
        </React.StrictMode>
      );
      return;
    }
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
});
