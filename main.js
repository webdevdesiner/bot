const path = require('path');
const { fork } = require('child_process');
const { app, BrowserWindow, Menu } = require('electron');

const APP_PORT = Number(process.env.PORT) || 3000;
const API_BASE = `http://127.0.0.1:${APP_PORT}`;

let backendProcess = null;
let backendRuntime = null;
let mainWindow = null;
let qrWindow = null;
let statusPollTimer = null;
let appQuitInProgress = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForBackendReady(maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await fetchJson(`${API_BASE}/api/whatsapp/status`);
      if (data?.ok) return;
    } catch {}
    await sleep(1200);
  }
  throw new Error('Timeout ao aguardar backend do Orion');
}

function buildQrWindowHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Orion - QR WhatsApp</title>
  <style>
    body { margin:0; font-family: Inter, Arial, sans-serif; background:#0a0a0c; color:#e5e7eb; }
    .wrap { padding:16px; display:flex; min-height:100vh; box-sizing:border-box; flex-direction:column; gap:12px; align-items:center; justify-content:center; }
    .card { width:100%; background:#151518; border:1px solid #23232a; border-radius:12px; padding:14px; box-sizing:border-box; text-align:center; }
    .title { font-size:14px; color:#67e8f9; font-weight:700; letter-spacing:.06em; text-transform:uppercase; margin-bottom:8px; }
    .desc { font-size:12px; color:#a1a1aa; margin-bottom:12px; }
    .qr { width:260px; height:260px; border-radius:10px; background:#fff; object-fit:contain; display:none; margin:0 auto; }
    .loading { font-size:12px; color:#a1a1aa; }
    .meta { margin-top:10px; font-size:11px; color:#71717a; line-height:1.4; }
    .warn { margin-top:8px; font-size:11px; color:#fca5a5; }
    .err { margin-top:8px; font-size:11px; color:#fca5a5; word-break:break-word; }
    .btn { margin-top:10px; border:1px solid #22d3ee55; background:#22d3ee22; color:#a5f3fc; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:11px; font-weight:600; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="title">Orion Peptides</div>
      <div class="desc">Escaneie o QR Code com seu WhatsApp para autenticar.</div>
      <img id="qr" class="qr" alt="QR WhatsApp" />
      <div id="loading" class="loading">Aguardando QR Code...</div>
      <div id="meta" class="meta"></div>
      <div id="warn" class="warn" style="display:none;"></div>
      <div id="err" class="err" style="display:none;"></div>
      <button id="btnRestart" class="btn" type="button">Reiniciar conexão</button>
    </div>
  </div>
  <script>
    let bootAt = Date.now();
    let restarting = false;
    const warn = document.getElementById('warn');
    const errEl = document.getElementById('err');
    const meta = document.getElementById('meta');
    const btnRestart = document.getElementById('btnRestart');

    async function restartWhatsApp(reasonText) {
      if (restarting) return;
      restarting = true;
      warn.style.display = 'block';
      warn.textContent = reasonText || 'Reiniciando conexão...';
      try {
        await fetch('${API_BASE}/api/whatsapp/restart', { method: 'POST' });
        bootAt = Date.now();
      } catch {
        warn.textContent = 'Falha ao reiniciar automaticamente. Feche e abra o app.';
      } finally {
        restarting = false;
      }
    }

    btnRestart.addEventListener('click', () => {
      restartWhatsApp('Reiniciando conexão manualmente...');
    });

    async function tick() {
      try {
        const [qrResp, stResp] = await Promise.all([
          fetch('${API_BASE}/api/whatsapp/qr'),
          fetch('${API_BASE}/api/whatsapp/status')
        ]);
        const d = await qrResp.json();
        const st = await stResp.json();
        const img = document.getElementById('qr');
        const loading = document.getElementById('loading');
        if (d && d.authenticated) {
          loading.textContent = 'Autenticado com sucesso. Carregando painel...';
          meta.textContent = '';
          warn.style.display = 'none';
          errEl.style.display = 'none';
          return;
        }
        const secs = Math.floor((Date.now() - bootAt) / 1000);
        const updated = st?.lastEventAt ? (' | evento: ' + st.lastEventAt) : '';
        meta.textContent = 'Status: ' + (st?.lastEvent || 'iniciando') + ' | ' + secs + 's' + updated;
        if (st?.lastError) {
          errEl.style.display = 'block';
          errEl.textContent = 'Último erro: ' + st.lastError;
        } else {
          errEl.style.display = 'none';
        }

        if (d && d.qrBase64) {
          img.src = d.qrBase64;
          img.style.display = 'block';
          loading.style.display = 'none';
          warn.style.display = 'none';
        } else {
          img.style.display = 'none';
          loading.style.display = 'block';
          loading.textContent = 'Aguardando QR Code...';
          if (secs > 60 && !restarting) {
            restartWhatsApp('QR demorou mais de 60s. Reiniciando conexão automaticamente...');
          }
        }
      } catch {
        const loading = document.getElementById('loading');
        loading.style.display = 'block';
        loading.textContent = 'Conectando ao servidor local...';
      }
    }
    setInterval(tick, 1500);
    tick();
  </script>
</body>
</html>`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0c',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openQrWindow() {
  if (qrWindow && !qrWindow.isDestroyed()) return;
  qrWindow = new BrowserWindow({
    width: 360,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: 'Autenticação WhatsApp',
    backgroundColor: '#0a0a0c',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  qrWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildQrWindowHtml())}`);
  qrWindow.on('closed', () => {
    qrWindow = null;
  });
}

function closeQrWindow() {
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.close();
  }
  qrWindow = null;
}

async function syncWindowsByAuthStatus() {
  const status = await fetchJson(`${API_BASE}/api/whatsapp/status`);
  const authenticated = !!status?.authenticated;
  if (authenticated) {
    closeQrWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.webContents.getURL()) {
        await mainWindow.loadURL(API_BASE);
      }
      if (!mainWindow.isVisible()) mainWindow.show();
    }
  } else {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    }
    openQrWindow();
  }
}

function startStatusPolling() {
  if (statusPollTimer) clearInterval(statusPollTimer);
  statusPollTimer = setInterval(() => {
    syncWindowsByAuthStatus().catch(() => {});
  }, 2000);
}

function stopStatusPolling() {
  if (statusPollTimer) clearInterval(statusPollTimer);
  statusPollTimer = null;
}

function startBackend() {
  process.env.PORT = String(APP_PORT);
  process.env.APP_USER_DATA_PATH = app.getPath('userData');

  if (app.isPackaged) {
    // Em app instalado, iniciar backend no mesmo processo evita erro ENOENT em spawn/fork.
    const backend = require('./index.js');
    return backend.startServer().then((runtime) => {
      backendRuntime = runtime;
    });
  }

  const childEnv = {
    ...process.env,
    PORT: String(APP_PORT),
    APP_USER_DATA_PATH: app.getPath('userData')
  };
  backendProcess = fork(path.join(__dirname, 'index.js'), [], {
    cwd: __dirname,
    env: childEnv,
    stdio: 'inherit'
  });
  return Promise.resolve();
}

async function stopBackend() {
  try {
    if (app.isPackaged && backendRuntime) {
      const mod = require('./index.js');
      if (typeof mod.shutdownNgrok === 'function') {
        await mod.shutdownNgrok();
      }
    } else if (backendProcess && !backendProcess.killed) {
      await fetch(`${API_BASE}/api/dashboard/ngrok-disconnect`, { method: 'POST' });
    }
  } catch (_) {
    /* túnel já encerrado ou servidor indisponível */
  }

  if (backendRuntime && backendRuntime.server) {
    try {
      backendRuntime.server.close();
    } catch {}
  }
  if (backendRuntime && backendRuntime.client) {
    try {
      backendRuntime.client.destroy();
    } catch {}
  }
  backendRuntime = null;

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  backendProcess = null;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await startBackend();
  await waitForBackendReady();
  createMainWindow();
  await syncWindowsByAuthStatus();
  startStatusPolling();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (e) => {
  if (appQuitInProgress) return;
  e.preventDefault();
  appQuitInProgress = true;
  stopStatusPolling();
  stopBackend()
    .catch(() => {})
    .finally(() => {
      app.exit(0);
    });
});

app.on('will-quit', () => {
  void (async () => {
    try {
      await require('ngrok').kill();
    } catch (_) {}
  })();
});

app.on('activate', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  try {
    await syncWindowsByAuthStatus();
  } catch {}
});
