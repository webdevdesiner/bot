import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, BASE_URL } from './config.js';

const AVATAR_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
      <rect width='64' height='64' fill='#1b1b21'/>
      <circle cx='32' cy='24' r='12' fill='#3f3f46'/>
      <path d='M10 56c2-10 10-16 22-16s20 6 22 16' fill='#3f3f46'/>
    </svg>`
  );

/** Plano free do ngrok: sem isto, pedidos `fetch` à API podem receber HTML da página intersticial em vez de JSON. */
const NGROK_SKIP_HEADER = { 'ngrok-skip-browser-warning': '1' };

const jsonHeaders = (extra = {}) => ({
  Accept: 'application/json',
  ...NGROK_SKIP_HEADER,
  ...extra
});

const api = (path) =>
  fetch(apiUrl(path), { headers: jsonHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });

function StatusBadge({ status, statusKey }) {
  const s = String(status || '').trim();
  const key = String(statusKey || '').toUpperCase().trim();
  if (key === 'PAID') {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-400/50 shadow-[0_0_10px_rgba(52,211,153,0.35)]">
        {s || 'Pagamento aprovado'}
      </span>
    );
  }
  if (key === 'WAITING_PAYMENT') {
    return (
      <span className="inline-flex rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-300 ring-1 ring-indigo-400/40">
        {s || 'Aguardando pagamento'}
      </span>
    );
  }
  if (key === 'READY_TO_SHIP') {
    return (
      <span className="inline-flex animate-pulse items-center gap-1 rounded-full border border-amber-300/70 bg-gradient-to-r from-amber-500/30 via-yellow-400/25 to-amber-500/30 px-2.5 py-0.5 text-xs font-semibold text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.45)] ring-1 ring-yellow-300/60">
        <span className="drop-shadow-[0_0_4px_rgba(255,215,0,0.9)]">🪙</span>
        {s || 'Pronto para envio'}
      </span>
    );
  }
  if (key === 'SHIPPED') {
    return (
      <span className="inline-flex rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-300 ring-1 ring-blue-400/40">
        {s || 'Enviado'}
      </span>
    );
  }
  if (key === 'DELIVERED') {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40">
        {s || 'Entregue'}
      </span>
    );
  }
  if (key === 'CHECKOUT_STARTED') {
    return (
      <span className="inline-flex rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-semibold text-violet-300 ring-1 ring-violet-400/40">
        {s || 'Pedido iniciado'}
      </span>
    );
  }
  if (key === 'CATALOG_SENT') {
    return (
      <span className="inline-flex rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-400/40">
        {s || 'Escolha de produtos'}
      </span>
    );
  }
  if (key === 'NEW_CHAT') {
    return (
      <span className="inline-flex rounded-full bg-zinc-700/80 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
        {s || 'Novo contato'}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-zinc-700/80 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
      {s || '—'}
    </span>
  );
}

function normalizeReferralLabel(raw) {
  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  text = text
    .replace(/\b(e|que)\s+(gostaria|queria|quero|vim|vindo|preciso|para|pra)\b[\s\S]*$/i, '')
    .replace(/\b(da orion|orion peptideos?)\b[\s\S]*$/i, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const words = text.split(' ').filter(Boolean).slice(0, 3);
  return words
    .join(' ')
    .replace(/\b\p{L}/gu, (m) => m.toUpperCase());
}

function ReferralBadge({ referralName, referralSource }) {
  const label = normalizeReferralLabel(referralName);
  if (!label) return null;
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] text-emerald-300/90">indicada por:</span>
      <span
        className="inline-flex max-w-[120px] items-center rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200"
        title={`Indicação: ${label}${referralSource ? ` (${referralSource})` : ''}`}
      >
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

function RiskAlertBadge({ reason }) {
  return (
    <span
      className="inline-flex animate-pulse items-center gap-1 rounded-full border border-red-400/60 bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-200 shadow-[0_0_12px_rgba(248,113,113,0.35)]"
      title={reason || 'Risco clínico identificado. Intervenção humana urgente.'}
    >
      ⚠️ Risco
    </span>
  );
}

function Card({ title, children, accent }) {
  return (
    <div
      className={`rounded-xl border border-zinc-800/80 bg-[#151518] p-5 shadow-lg ${
        accent ? 'ring-1 ring-cyan-500/20' : ''
      }`}
    >
      <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

const MP_WEBHOOK_PATH = '/api/v1/priority-client-update';
const SALES_PAGE_URL = 'https://green-koala-180415.hostingersite.com/';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [pauseLoadingByChat, setPauseLoadingByChat] = useState({});
  const [pauseSuccessByChat, setPauseSuccessByChat] = useState({});
  const [shippingLoadingByChat, setShippingLoadingByChat] = useState({});
  const [riskClearLoadingByChat, setRiskClearLoadingByChat] = useState({});
  const [emergencyPauseSaving, setEmergencyPauseSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('conversas');
  const [stockDraftBySku, setStockDraftBySku] = useState({});
  const [stockSavingBySku, setStockSavingBySku] = useState({});
  const [stockSavedBySku, setStockSavedBySku] = useState({});
  const [priceDraftBySku, setPriceDraftBySku] = useState({});
  const [priceSavingBySku, setPriceSavingBySku] = useState({});
  const [priceSavedBySku, setPriceSavedBySku] = useState({});
  const [brokenAvatarByChat, setBrokenAvatarByChat] = useState({});
  const [devLogsUnlocked, setDevLogsUnlocked] = useState(false);
  const [devLogsLoading, setDevLogsLoading] = useState(false);
  const [devLogsData, setDevLogsData] = useState({ status: null, lines: [] });
  const [conversationModal, setConversationModal] = useState(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState(null);
  const [secretTapCount, setSecretTapCount] = useState(0);
  const [unlockPanelOpen, setUnlockPanelOpen] = useState(false);
  const [unlockMessageText, setUnlockMessageText] = useState('');
  const [unlockUnpauseBot, setUnlockUnpauseBot] = useState(true);
  const [unlockClearRiskAlert, setUnlockClearRiskAlert] = useState(true);
  const [unlockSending, setUnlockSending] = useState(false);
  const [unlockFeedback, setUnlockFeedback] = useState('');
  const [whatsAppUi, setWhatsAppUi] = useState({
    loading: true,
    authenticated: false,
    qrBase64: null,
    lastEvent: null,
    lastError: null,
    ready: false,
    apiDown: false
  });
  const [waRestarting, setWaRestarting] = useState(false);
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(true);
  const [isMobileView, setIsMobileView] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [mobileConversationFilter, setMobileConversationFilter] = useState('all');
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedSessionMessages, setSelectedSessionMessages] = useState([]);
  const [selectedSessionLoading, setSelectedSessionLoading] = useState(false);
  const [selectedSessionError, setSelectedSessionError] = useState(null);
  const lastSeenOrdersUpdateRef = useRef(0);
  const hasBootstrappedOrdersRef = useRef(false);
  const notificationAudioRef = useRef(null);

  const formatConversationTimestamp = (value) => {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString('pt-BR');
  };

  const formatLastMessageTime = (value) => {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatContactNumber = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '—';

    // Brasil: oculta DDI 55 e aplica máscara nacional.
    if (digits.startsWith('55')) {
      const local = digits.slice(2);
      if (local.length === 11) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
      }
      if (local.length === 10) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
      }
      return local;
    }

    // Internacional: mantém DDI visível.
    if (digits.length > 3) {
      const ddi = digits.slice(0, 2);
      const rest = digits.slice(2);
      return `+${ddi} ${rest}`;
    }
    return `+${digits}`;
  };

  const getMobileJourneyStage = (order) => {
    const key = String(order?.journeyStatusKey || '').toUpperCase().trim();
    if (key === 'NEW_CHAT') return { label: 'Novo', tone: 'zinc' };
    if (key === 'CATALOG_SENT') return { label: 'Escolhendo', tone: 'sky' };
    if (key === 'WAITING_PAYMENT' || key === 'CHECKOUT_STARTED') {
      return { label: 'Aguard. pgto', tone: 'amber' };
    }
    if (key === 'PAID' || key === 'READY_TO_SHIP' || key === 'SHIPPED' || key === 'DELIVERED') {
      return { label: 'Venda + envio', tone: 'emerald' };
    }
    return { label: 'Novo', tone: 'zinc' };
  };

  const fetchConversationData = useCallback(async (chatId) => {
    const response = await fetch(apiUrl(`/api/dashboard/conversation/${encodeURIComponent(chatId)}`), {
      headers: jsonHeaders()
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Falha ao carregar conversa');
    return data.conversation || {};
  }, []);

  const refreshWhatsAppPairing = useCallback(async () => {
    try {
      const [st, qr] = await Promise.all([
        api('/api/whatsapp/status'),
        api('/api/whatsapp/qr')
      ]);
      setWhatsAppUi({
        loading: false,
        authenticated: !!(st?.authenticated),
        qrBase64: qr?.qrBase64 || null,
        lastEvent: st?.lastEvent || null,
        lastError: st?.lastError || null,
        ready: !!st?.ready,
        apiDown: false
      });
    } catch {
      setWhatsAppUi((prev) => ({
        ...prev,
        loading: false,
        apiDown: true,
        qrBase64: null
      }));
    }
  }, []);

  useEffect(() => {
    void refreshWhatsAppPairing();
    const id = setInterval(() => void refreshWhatsAppPairing(), 2500);
    return () => clearInterval(id);
  }, [refreshWhatsAppPairing]);

  const restartWhatsAppConnection = async () => {
    setWaRestarting(true);
    try {
      const res = await fetch(apiUrl('/api/whatsapp/restart'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' })
      });
      if (!res.ok) throw new Error(String(res.status));
      await refreshWhatsAppPairing();
    } catch (e) {
      setErr(`Falha ao reiniciar WhatsApp (${e.message || e})`);
    } finally {
      setWaRestarting(false);
    }
  };

  const loadDashboardData = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    setErr(null);
    const [sum, ord, cat, wh] = await Promise.all([
      api('/api/dashboard/summary'),
      api('/api/dashboard/orders'),
      api('/api/dashboard/catalog'),
      api('/api/dashboard/webhook-status').catch(() => ({ ok: false }))
    ]);
    if (sum.ok) setSummary(sum);
    if (ord.ok) setOrders(ord.orders || []);
    if (wh.ok) {
      setWebhookStatus({ active: !!wh.active, url: wh.url || null });
    } else if (initial) {
      setWebhookStatus({ active: false, url: null });
    }
    if (cat.ok) {
      const items = cat.items || [];
      setCatalog(items);
      setStockDraftBySku((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (next[item.sku] == null) {
            next[item.sku] = String(Number(item.stockQuantity ?? 0));
          }
        }
        return next;
      });
      setPriceDraftBySku((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (next[item.sku] == null) {
            next[item.sku] = String(item.preco || '').trim();
          }
        }
        return next;
      });
    }
    if (initial) setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = async (isInitial = false) => {
      try {
        await loadDashboardData({ initial: isInitial });
      } catch (e) {
        if (alive) {
          setErr(String(e.message || e));
          if (isInitial) setLoading(false);
        }
      }
    };

    run(true);
    const intervalId = setInterval(() => {
      run(false);
    }, 8000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        run(false);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const onResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('orion_dev_logs_unlocked');
      if (saved === '1') setDevLogsUnlocked(true);
    } catch {}
  }, []);

  useEffect(() => {
    const onKeyDown = (ev) => {
      if (ev.ctrlKey && ev.shiftKey && String(ev.key || '').toLowerCase() === 'l') {
        const next = !devLogsUnlocked;
        setDevLogsUnlocked(next);
        try {
          window.localStorage.setItem('orion_dev_logs_unlocked', next ? '1' : '0');
        } catch {}
        if (next) {
          setActiveTab('logs');
        } else if (activeTab === 'logs') {
          setActiveTab('conversas');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [devLogsUnlocked, activeTab]);

  const loadDevLogs = useCallback(async () => {
    if (!devLogsUnlocked) return;
    setDevLogsLoading(true);
    try {
      const [status, logs] = await Promise.all([
        api('/api/whatsapp/status').catch(() => ({ ok: false })),
        api('/api/whatsapp/logs').catch(() => ({ ok: false }))
      ]);
      setDevLogsData({
        status: status?.ok ? status : null,
        lines: logs?.ok ? logs.lines || [] : []
      });
    } finally {
      setDevLogsLoading(false);
    }
  }, [devLogsUnlocked]);

  useEffect(() => {
    if (!devLogsUnlocked || activeTab !== 'logs') return;
    void loadDevLogs();
    const id = setInterval(() => {
      void loadDevLogs();
    }, 4000);
    return () => clearInterval(id);
  }, [devLogsUnlocked, activeTab, loadDevLogs]);

  const fmtMoney = (n) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

  const playFallbackBeep = useCallback(() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  }, []);

  const playNewMessageBeep = useCallback(() => {
    try {
      if (!notificationAudioRef.current) {
        const base = String(import.meta.env.BASE_URL || '/');
        const normalizedBase = base.endsWith('/') ? base : `${base}/`;
        notificationAudioRef.current = new Audio(`${normalizedBase}sounds/som.mp3`);
        notificationAudioRef.current.preload = 'auto';
      }
      const audio = notificationAudioRef.current;
      audio.currentTime = 0;
      void audio.play().catch(() => {
        playFallbackBeep();
      });
    } catch {
      // Melhor esforço: se o navegador bloquear áudio automático, segue sem quebrar o painel.
      playFallbackBeep();
    }
  }, [playFallbackBeep]);

  useEffect(() => {
    const newestTs = orders.reduce((acc, item) => {
      const ts = new Date(item?.lastCustomerMessageAt || 0).getTime();
      return Number.isFinite(ts) ? Math.max(acc, ts) : acc;
    }, 0);
    if (!hasBootstrappedOrdersRef.current) {
      hasBootstrappedOrdersRef.current = true;
      lastSeenOrdersUpdateRef.current = newestTs;
      return;
    }
    if (newestTs > (lastSeenOrdersUpdateRef.current || 0)) {
      lastSeenOrdersUpdateRef.current = newestTs;
      if (soundAlertsEnabled && document.visibilityState === 'visible') {
        playNewMessageBeep();
      }
    }
  }, [orders, soundAlertsEnabled, playNewMessageBeep]);

  const getRemainingPauseMinutes = (order) => {
    if (!order?.isPaused || !order?.pausedUntil) return 0;
    const diffMs = new Date(order.pausedUntil).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.max(1, Math.ceil(diffMs / 60000));
  };

  const isConversationPaused = (order) => {
    if (!order?.isPaused) return false;
    if (!order?.pausedUntil) return true; // pausa manual definitiva
    return new Date(order.pausedUntil).getTime() > Date.now();
  };
  const getPauseModalLabel = (pausedUntil) => {
    if (!pausedUntil) return 'Conversa pausada (manual)';
    const dt = new Date(pausedUntil);
    if (Number.isNaN(dt.getTime())) return 'Conversa pausada';
    return `Conversa pausada até ${formatConversationTimestamp(pausedUntil)}`;
  };
  const urgentRiskCount = orders.filter((o) => o.riskAlert).length;

  const mobileFilteredOrders = useMemo(() => {
    const normalize = (value) => String(value || '').toUpperCase().trim();
    const isPaidOrder = (order) =>
      ['PAID', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'].includes(normalize(order?.journeyStatusKey));
    const isPendingOrder = (order) =>
      ['WAITING_PAYMENT', 'CHECKOUT_STARTED'].includes(normalize(order?.journeyStatusKey));
    const isShippingPendingOrder = (order) =>
      !!order?.isShipmentPending || normalize(order?.journeyStatusKey) === 'READY_TO_SHIP';

    if (mobileConversationFilter === 'sales') return orders.filter(isPaidOrder);
    if (mobileConversationFilter === 'pending') return orders.filter(isPendingOrder);
    if (mobileConversationFilter === 'risk') return orders.filter((o) => !!o?.riskAlert);
    if (mobileConversationFilter === 'shipping') return orders.filter(isShippingPendingOrder);
    return orders;
  }, [orders, mobileConversationFilter]);

  const fullMercadoPagoWebhookUrl =
    webhookStatus?.active && webhookStatus?.url
      ? `${String(webhookStatus.url).replace(/\/+$/, '')}${MP_WEBHOOK_PATH}`
      : '';

  const copyWebhookUrl = async () => {
    if (!fullMercadoPagoWebhookUrl) return;
    try {
      await navigator.clipboard.writeText(fullMercadoPagoWebhookUrl);
    } catch {
      setErr('Não foi possível copiar. Copie manualmente a URL exibida.');
    }
  };

  const togglePauseBot = async (order) => {
    const chatId = String(order?.chatId || '').trim();
    if (!chatId) return;
    const currentlyPaused = isConversationPaused(order);

    setPauseLoadingByChat((prev) => ({ ...prev, [chatId]: true }));
    setErr(null);
    try {
      const route = currentlyPaused ? '/api/dashboard/unpause-bot' : '/api/dashboard/pause-bot';
      const body = currentlyPaused ? { chatId } : { chatId, permanent: true };
      const response = await fetch(apiUrl(route), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao salvar');

      setOrders((prev) =>
        prev.map((item) =>
          item.chatId === chatId
            ? {
                ...item,
                isPaused: data.isPaused ? 1 : 0,
                pausedUntil: data.pausedUntil || null
              }
            : item
        )
      );
      setPauseSuccessByChat((prev) => ({ ...prev, [chatId]: true }));
      setTimeout(() => {
        setPauseSuccessByChat((prev) => ({ ...prev, [chatId]: false }));
      }, 1600);
    } catch (e) {
      setErr(`Falha ao controlar intervenção humana (${e.message || e})`);
    } finally {
      setPauseLoadingByChat((prev) => ({ ...prev, [chatId]: false }));
    }
  };

  const clearRiskAlert = async (order) => {
    const chatId = String(order?.chatId || '').trim();
    if (!chatId) return;
    setRiskClearLoadingByChat((prev) => ({ ...prev, [chatId]: true }));
    setErr(null);
    try {
      const response = await fetch(apiUrl('/api/dashboard/clear-risk-alert'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ chatId })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao limpar alerta');

      setOrders((prev) =>
        prev.map((item) =>
          item.chatId === chatId
            ? { ...item, riskAlert: false, riskReason: null, riskAt: null }
            : item
        )
      );
      setSummary((prev) =>
        prev && typeof prev.riskAlerts === 'number' && prev.riskAlerts > 0
          ? { ...prev, riskAlerts: Math.max(0, prev.riskAlerts - 1) }
          : prev
      );
    } catch (e) {
      setErr(`Falha ao marcar pendência como resolvida (${e.message || e})`);
    } finally {
      setRiskClearLoadingByChat((prev) => ({ ...prev, [chatId]: false }));
    }
  };

  const updateShippingStatus = async (order, shippingStatus) => {
    const chatId = String(order?.chatId || '').trim();
    if (!chatId) return;
    const contactLabel = order?.contactName || order?.customerName || 'este cliente';
    const nextLabel = shippingStatus === 'DELIVERED' ? 'Entregue' : 'Enviado';
    const confirmed = window.confirm(
      `Confirmar alteração para "${nextLabel}" em ${contactLabel}?`
    );
    if (!confirmed) return;
    setShippingLoadingByChat((prev) => ({ ...prev, [chatId]: true }));
    setErr(null);
    try {
      const response = await fetch(apiUrl('/api/dashboard/shipping-status'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ chatId, shippingStatus })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao atualizar envio');
      await loadDashboardData({ initial: false });
    } catch (e) {
      setErr(`Falha ao atualizar envio (${e.message || e})`);
    } finally {
      setShippingLoadingByChat((prev) => ({ ...prev, [chatId]: false }));
    }
  };

  const openConversationModal = async (order) => {
    const chatId = String(order?.chatId || '').trim();
    if (!chatId) return;
    setConversationModal({
      chatId,
      contactName: order?.contactName || order?.customerName || 'Cliente sem nome',
      contactNumber: order?.contactNumber || null,
      profilePic: order?.profilePic || null,
      isPaused: isConversationPaused(order),
      pausedUntil: order?.pausedUntil || null,
      messages: []
    });
    setConversationError(null);
    setSecretTapCount(0);
    setUnlockPanelOpen(false);
    setUnlockMessageText('');
    setUnlockUnpauseBot(true);
    setUnlockClearRiskAlert(true);
    setUnlockFeedback('');
    setConversationLoading(true);
    try {
      const conv = await fetchConversationData(chatId);
      setConversationModal((prev) =>
        prev
          ? {
              ...prev,
              contactName: conv.contactName || prev.contactName,
              contactNumber: conv.phoneNumber || prev.contactNumber,
              profilePic: conv.profilePic ?? prev.profilePic,
              messages: Array.isArray(conv.messageHistory) ? conv.messageHistory : []
            }
          : prev
      );
    } catch (e) {
      setConversationError(`Falha ao abrir conversa (${e.message || e})`);
    } finally {
      setConversationLoading(false);
    }
  };

  useEffect(() => {
    const chatId = String(conversationModal?.chatId || '').trim();
    if (!chatId) return;

    const intervalId = setInterval(() => {
      void (async () => {
        try {
          const conv = await fetchConversationData(chatId);
          setConversationModal((prev) => {
            if (!prev || String(prev.chatId || '').trim() !== chatId) return prev;
            return {
              ...prev,
              contactName: conv.contactName || prev.contactName,
              contactNumber: conv.phoneNumber || prev.contactNumber,
              profilePic: conv.profilePic ?? prev.profilePic,
              messages: Array.isArray(conv.messageHistory) ? conv.messageHistory : prev.messages
            };
          });
          setConversationError(null);
        } catch {
          // Mantém a última versão em tela sem interromper o uso do modal.
        }
      })();
    }, 3000);

    return () => clearInterval(intervalId);
  }, [conversationModal?.chatId, fetchConversationData]);

  useEffect(() => {
    const chatId = String(conversationModal?.chatId || '').trim();
    if (!chatId) return;
    const row = orders.find((o) => String(o?.chatId || '').trim() === chatId);
    if (!row) return;
    setConversationModal((prev) =>
      prev && String(prev.chatId || '').trim() === chatId
        ? {
            ...prev,
            isPaused: isConversationPaused(row),
            pausedUntil: row?.pausedUntil || null,
            profilePic: row?.profilePic ?? prev.profilePic
          }
        : prev
    );
  }, [orders, conversationModal?.chatId]);

  const sendEmergencyUnlockMessage = async () => {
    const chatId = String(conversationModal?.chatId || '').trim();
    const text = String(unlockMessageText || '').trim();
    if (!chatId) return;
    if (!text) {
      setUnlockFeedback('Digite a mensagem antes de enviar.');
      return;
    }
    setUnlockSending(true);
    setUnlockFeedback('');
    setErr(null);
    try {
      const response = await fetch(apiUrl('/api/dashboard/emergency-unlock-message'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          chatId,
          text,
          unpauseBot: unlockUnpauseBot,
          clearRiskAlert: unlockClearRiskAlert
        })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao enviar');

      setUnlockFeedback('Mensagem enviada com sucesso.');
      setUnlockMessageText('');
      setConversationModal((prev) =>
        prev && String(prev.chatId || '').trim() === chatId
          ? { ...prev, isPaused: !!data.isPaused, pausedUntil: data.pausedUntil || null }
          : prev
      );
      setOrders((prev) =>
        prev.map((item) =>
          String(item?.chatId || '').trim() === chatId
            ? {
                ...item,
                isPaused: data.isPaused ? 1 : 0,
                pausedUntil: data.pausedUntil || null,
                riskAlert: !!data.riskAlert,
                riskReason: data.riskAlert ? item.riskReason : null,
                riskAt: data.riskAlert ? item.riskAt : null
              }
            : item
        )
      );
      if (unlockClearRiskAlert) {
        setSummary((prev) =>
          prev && typeof prev.riskAlerts === 'number' && prev.riskAlerts > 0
            ? { ...prev, riskAlerts: Math.max(0, prev.riskAlerts - 1) }
            : prev
        );
      }
      const conv = await fetchConversationData(chatId);
      setConversationModal((prev) =>
        prev && String(prev.chatId || '').trim() === chatId
          ? { ...prev, messages: Array.isArray(conv.messageHistory) ? conv.messageHistory : prev.messages }
          : prev
      );
    } catch (e) {
      setUnlockFeedback(`Falha no envio (${e.message || e})`);
    } finally {
      setUnlockSending(false);
    }
  };

  const openSelectedSession = useCallback(
    async (order) => {
      const chatId = String(order?.chatId || '').trim();
      if (!chatId) return;
      setSelectedSession({
        chatId,
        contactName: order?.contactName || order?.customerName || 'Cliente sem nome',
        contactNumber: order?.contactNumber || null,
        profilePic: order?.profilePic || null,
        waLink: order?.waLink || null,
        isPaused: isConversationPaused(order),
        pausedUntil: order?.pausedUntil || null
      });
      setSelectedSessionMessages([]);
      setSelectedSessionError(null);
      setSelectedSessionLoading(true);
      try {
        const conv = await fetchConversationData(chatId);
        setSelectedSession((prev) =>
          prev && String(prev.chatId || '').trim() === chatId
            ? {
                ...prev,
                contactName: conv.contactName || prev.contactName,
                contactNumber: conv.phoneNumber || prev.contactNumber,
                profilePic: conv.profilePic ?? prev.profilePic
              }
            : prev
        );
        setSelectedSessionMessages(Array.isArray(conv.messageHistory) ? conv.messageHistory : []);
      } catch (e) {
        setSelectedSessionError(`Falha ao carregar conversa (${e.message || e})`);
      } finally {
        setSelectedSessionLoading(false);
      }
    },
    [fetchConversationData]
  );

  useEffect(() => {
    const chatId = String(selectedSession?.chatId || '').trim();
    if (!chatId) return;
    const intervalId = setInterval(() => {
      void (async () => {
        try {
          const conv = await fetchConversationData(chatId);
          setSelectedSession((prev) =>
            prev && String(prev.chatId || '').trim() === chatId
              ? {
                  ...prev,
                  contactName: conv.contactName || prev.contactName,
                  contactNumber: conv.phoneNumber || prev.contactNumber,
                  profilePic: conv.profilePic ?? prev.profilePic
                }
              : prev
          );
          setSelectedSessionMessages((prev) =>
            Array.isArray(conv.messageHistory) ? conv.messageHistory : prev
          );
          setSelectedSessionError(null);
        } catch {
          // mantém última versão em tela
        }
      })();
    }, 3000);
    return () => clearInterval(intervalId);
  }, [selectedSession?.chatId, fetchConversationData]);

  useEffect(() => {
    const chatId = String(selectedSession?.chatId || '').trim();
    if (!chatId) return;
    const row = orders.find((o) => String(o?.chatId || '').trim() === chatId);
    if (!row) return;
    setSelectedSession((prev) =>
      prev && String(prev.chatId || '').trim() === chatId
        ? {
            ...prev,
            contactName: row?.contactName || row?.customerName || prev.contactName,
            contactNumber: row?.contactNumber || prev.contactNumber,
            profilePic: row?.profilePic ?? prev.profilePic,
            waLink: row?.waLink || prev.waLink,
            isPaused: isConversationPaused(row),
            pausedUntil: row?.pausedUntil || null
          }
        : prev
    );
  }, [orders, selectedSession?.chatId]);

  useEffect(() => {
    if (activeTab !== 'conversas') {
      setSelectedSession(null);
      setSelectedSessionMessages([]);
      setSelectedSessionError(null);
    }
  }, [activeTab]);

  const toggleEmergencyPause = async () => {
    if (emergencyPauseSaving) return;
    setEmergencyPauseSaving(true);
    setErr(null);
    try {
      const currentlyPaused = !!summary?.bot?.emergencyPaused;
      const response = await fetch(apiUrl('/api/dashboard/emergency-pause'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ paused: !currentlyPaused })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao atualizar pausa global');
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              bot: {
                ...(prev.bot || {}),
                emergencyPaused: !!data.paused
              }
            }
          : prev
      );
    } catch (e) {
      setErr(`Falha ao alternar pausa global (${e.message || e})`);
    } finally {
      setEmergencyPauseSaving(false);
    }
  };

  const saveStock = async (sku) => {
    const raw = String(stockDraftBySku[sku] ?? '').trim();
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity < 0) {
      setErr('Estoque inválido. Use um número inteiro maior ou igual a zero.');
      return;
    }
    setStockSavingBySku((prev) => ({ ...prev, [sku]: true }));
    setErr(null);
    try {
      const response = await fetch(apiUrl('/api/dashboard/stock/set'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sku, quantity: Math.floor(quantity) })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao salvar estoque');
      setCatalog((prev) =>
        prev.map((item) => (item.sku === sku ? { ...item, stockQuantity: data.quantity } : item))
      );
      setStockDraftBySku((prev) => ({ ...prev, [sku]: String(data.quantity) }));
      setStockSavedBySku((prev) => ({ ...prev, [sku]: true }));
      setTimeout(() => {
        setStockSavedBySku((prev) => ({ ...prev, [sku]: false }));
      }, 1400);
    } catch (e) {
      setErr(`Falha ao salvar estoque (${e.message || e})`);
    } finally {
      setStockSavingBySku((prev) => ({ ...prev, [sku]: false }));
    }
  };

  const savePrice = async (sku) => {
    const price = String(priceDraftBySku[sku] ?? '').trim();
    if (!price) {
      setErr('Preço inválido. Informe um valor.');
      return;
    }
    setPriceSavingBySku((prev) => ({ ...prev, [sku]: true }));
    setErr(null);
    try {
      const response = await fetch(apiUrl('/api/dashboard/catalog-price/set'), {
        method: 'POST',
        headers: jsonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sku, price })
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Falha ao salvar preço');
      setCatalog((prev) =>
        prev.map((item) => (item.sku === sku ? { ...item, preco: data.price } : item))
      );
      setPriceDraftBySku((prev) => ({ ...prev, [sku]: String(data.price || '') }));
      setPriceSavedBySku((prev) => ({ ...prev, [sku]: true }));
      setTimeout(() => {
        setPriceSavedBySku((prev) => ({ ...prev, [sku]: false }));
      }, 1400);
    } catch (e) {
      setErr(`Falha ao salvar preço (${e.message || e})`);
    } finally {
      setPriceSavingBySku((prev) => ({ ...prev, [sku]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <header className="border-b border-zinc-700/80 bg-[#11141b]/95 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-3 px-3 py-5 sm:grid-cols-3 sm:items-center sm:gap-3 sm:px-4 sm:py-6">
          <div className="hidden items-center sm:flex sm:justify-start">
            <img
              src={`${import.meta.env.BASE_URL}logo-orion.png`}
              alt="Logo Orion"
              className="h-12 w-auto object-contain drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]"
            />
          </div>

          <div className="relative flex min-w-0 items-center pb-1 text-left sm:block sm:pb-0 sm:text-center">
            <img
              src={`${import.meta.env.BASE_URL}logo-orion.png`}
              alt="Logo Orion"
              className="h-6 w-auto shrink-0 object-contain drop-shadow-[0_0_8px_rgba(34,211,238,0.28)] sm:hidden"
            />
            <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-sm font-semibold tracking-tight text-zinc-200 sm:hidden">
              Painel de controle
            </p>
            <div className="ml-auto sm:hidden">
              <div className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/25 bg-[#151518] px-2 py-1 text-[11px] text-cyan-200/90">
                <span
                  className={`h-2 w-2 rounded-full ${
                    summary?.bot?.online
                      ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]'
                      : 'bg-zinc-600'
                  }`}
                />
                <span>
                  {loading
                    ? 'Carregando…'
                    : summary?.bot?.emergencyPaused
                      ? `${summary?.bot?.label || 'Online'} (PAUSADO)`
                      : summary?.bot?.label || 'Status'}
                </span>
              </div>
            </div>
            <p className="hidden text-xs font-semibold uppercase tracking-widest text-cyan-400/90 sm:block">
              Orion Peptides
            </p>
            <h1 className="hidden text-2xl font-bold tracking-tight text-white sm:block">Painel de controle</h1>
            <p className="mt-1 hidden text-sm text-zinc-500 sm:block">Visão operacional integrada ao bot</p>
          </div>

          <div className="pt-1 sm:pt-0">
            <div className="grid grid-cols-3 gap-2 sm:hidden">
              <button
                type="button"
                onClick={() => void toggleEmergencyPause()}
                disabled={loading || emergencyPauseSaving}
                className={`rounded-lg px-2 py-2 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  summary?.bot?.emergencyPaused
                    ? 'animate-pulse border border-amber-300/80 bg-amber-500/25 text-amber-50 shadow-[0_0_14px_rgba(251,191,36,0.45)]'
                    : 'border border-red-500/50 bg-red-500/15 text-red-200'
                }`}
                title={
                  summary?.bot?.emergencyPaused
                    ? 'Retomar operação automática do robô'
                    : 'Pausar imediatamente as respostas automáticas do robô'
                }
              >
                {emergencyPauseSaving ? 'Salvando...' : summary?.bot?.emergencyPaused ? 'Retomar' : 'Pausar'}
              </button>
              <button
                type="button"
                onClick={() => setSoundAlertsEnabled((prev) => !prev)}
                className={`rounded-lg px-2 py-2 text-[10px] font-semibold transition ${
                  soundAlertsEnabled
                    ? 'border border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                    : 'border border-zinc-700 bg-zinc-900/60 text-zinc-400'
                }`}
                title="Ativar/desativar som de nova mensagem no painel"
              >
                Som: {soundAlertsEnabled ? 'ON' : 'OFF'}
              </button>
              <a
                href={SALES_PAGE_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2 py-2 text-[10px] font-semibold text-emerald-200 transition hover:border-emerald-400/80 hover:bg-emerald-500/25"
                title="Abrir página de vendas (site Orion)"
              >
                Vendas
              </a>

              <button
                type="button"
                onClick={() => setActiveTab('revendedores')}
                className={`rounded-xl px-2 py-2 text-[10px] font-semibold tracking-wide transition-all duration-150 ${
                  activeTab === 'revendedores'
                    ? 'border border-cyan-300/70 bg-gradient-to-b from-cyan-500/30 to-cyan-500/15 text-cyan-100 shadow-[0_6px_16px_rgba(34,211,238,0.25)] ring-1 ring-cyan-300/35'
                    : 'border border-zinc-500/90 bg-gradient-to-b from-zinc-700/95 to-zinc-900/95 text-zinc-100 shadow-[0_8px_16px_rgba(0,0,0,0.35)]'
                }`}
              >
                Revendedores
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('catalogo')}
                className={`rounded-xl px-2 py-2 text-[10px] font-semibold tracking-wide transition-all duration-150 ${
                  activeTab === 'catalogo'
                    ? 'border border-cyan-300/70 bg-gradient-to-b from-cyan-500/30 to-cyan-500/15 text-cyan-100 shadow-[0_6px_16px_rgba(34,211,238,0.25)] ring-1 ring-cyan-300/35'
                    : 'border border-zinc-500/90 bg-gradient-to-b from-zinc-700/95 to-zinc-900/95 text-zinc-100 shadow-[0_8px_16px_rgba(0,0,0,0.35)]'
                }`}
              >
                Catálogo
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('conversas')}
                className={`rounded-xl px-2 py-2 text-[10px] font-semibold tracking-wide transition-all duration-150 ${
                  activeTab === 'conversas'
                    ? 'border border-cyan-300/70 bg-gradient-to-b from-cyan-500/30 to-cyan-500/15 text-cyan-100 shadow-[0_6px_16px_rgba(34,211,238,0.25)] ring-1 ring-cyan-300/35'
                    : 'border border-zinc-500/90 bg-gradient-to-b from-zinc-700/95 to-zinc-900/95 text-zinc-100 shadow-[0_8px_16px_rgba(0,0,0,0.35)]'
                }`}
              >
                Conversas
              </button>
            </div>

            <div className="hidden flex-wrap items-center gap-2 sm:flex sm:justify-end">
            <div className="hidden items-center gap-2 rounded-lg border border-cyan-500/25 bg-[#151518] px-4 py-2 text-sm text-cyan-200/90 sm:flex">
              <span
                className={`h-2 w-2 rounded-full ${
                  summary?.bot?.online ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-zinc-600'
                }`}
              />
              <span>
                {loading
                  ? 'Carregando…'
                  : summary?.bot?.emergencyPaused
                    ? `${summary?.bot?.label || 'Online'} (PAUSADO)`
                    : summary?.bot?.label || 'Status'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void toggleEmergencyPause()}
              disabled={loading || emergencyPauseSaving}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                summary?.bot?.emergencyPaused
                  ? 'animate-pulse border border-amber-300/80 bg-amber-500/25 text-amber-50 shadow-[0_0_14px_rgba(251,191,36,0.45)] hover:bg-amber-500/35'
                  : 'border border-red-500/50 bg-red-500/15 text-red-200 hover:bg-red-500/25'
              }`}
              title={
                summary?.bot?.emergencyPaused
                  ? 'Retomar operação automática do robô'
                  : 'Pausar imediatamente as respostas automáticas do robô'
              }
            >
              {emergencyPauseSaving
                ? 'Salvando...'
                : summary?.bot?.emergencyPaused
                  ? 'Retomar operação'
                  : 'Pausar operação'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('conversas')}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeTab === 'conversas'
                  ? 'border border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              Conversas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('catalogo')}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeTab === 'catalogo'
                  ? 'border border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('revendedores')}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeTab === 'revendedores'
                  ? 'border border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              Revendedores
            </button>
            <button
              type="button"
              onClick={() => setSoundAlertsEnabled((prev) => !prev)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                soundAlertsEnabled
                  ? 'border border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                  : 'border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
              title="Ativar/desativar som de nova mensagem no painel"
            >
              Som: {soundAlertsEnabled ? 'ON' : 'OFF'}
            </button>
            <a
              href={SALES_PAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400/80 hover:bg-emerald-500/25"
              title="Abrir página de vendas (site Orion)"
            >
              Vendas
            </a>
            {devLogsUnlocked && (
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  activeTab === 'logs'
                    ? 'border border-amber-400/70 bg-amber-500/20 text-amber-200'
                    : 'border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                }`}
                title="Aba técnica para desenvolvimento"
              >
                Logs (Dev)
              </button>
            )}
            </div>
          </div>
        </div>

        <div className="hidden border-t border-zinc-700/70 bg-[#171b24]/90 px-4 py-2.5 sm:block sm:py-3">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap sm:flex-wrap sm:overflow-visible sm:whitespace-normal">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  webhookStatus?.active
                    ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.85)]'
                    : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.55)]'
                }`}
                title={webhookStatus?.active ? 'Túnel ngrok ativo' : 'Webhook offline'}
              />
              <span
                className={`text-[11px] font-semibold sm:hidden ${
                  webhookStatus?.active ? 'text-zinc-300' : 'text-zinc-500'
                }`}
              >
                Mercado Pago
              </span>
              <span className="hidden text-xs font-semibold uppercase tracking-wide text-zinc-400 sm:inline">
                Webhook Mercado Pago (ngrok)
              </span>
              {!webhookStatus?.active && (
                <span className="hidden text-sm font-medium text-red-300/95 sm:inline">Webhook Offline</span>
              )}
              <div className="ml-1 flex shrink-0 items-center gap-2 sm:hidden">
                <span
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-zinc-800/70 bg-zinc-900/35 px-2 text-[11px] font-medium text-zinc-300 cursor-default"
                  title={whatsAppUi.apiDown ? 'WhatsApp desconectado' : 'WhatsApp conectado'}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${whatsAppUi.apiDown ? 'bg-red-400' : 'bg-emerald-400'}`}
                    aria-hidden
                  />
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 fill-current ${whatsAppUi.apiDown ? 'text-zinc-500' : 'text-zinc-300'}`}
                  >
                    <path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.56 0 .26 5.3.26 11.8c0 2.08.54 4.11 1.57 5.9L0 24l6.5-1.71a11.75 11.75 0 0 0 5.56 1.42h.01c6.5 0 11.8-5.3 11.8-11.8 0-3.15-1.23-6.12-3.35-8.43Zm-8.45 18.2h-.01a9.77 9.77 0 0 1-4.98-1.36l-.36-.22-3.86 1.01 1.03-3.76-.24-.39a9.73 9.73 0 0 1-1.49-5.16c0-5.39 4.39-9.78 9.79-9.78 2.61 0 5.07 1.02 6.92 2.87a9.72 9.72 0 0 1 2.86 6.92c0 5.4-4.4 9.79-9.8 9.79Zm5.37-7.35c-.29-.14-1.72-.85-1.98-.94-.27-.1-.46-.14-.66.14-.19.29-.75.94-.92 1.13-.17.19-.33.22-.62.08-.29-.14-1.2-.44-2.29-1.4-.85-.76-1.43-1.7-1.59-1.98-.17-.29-.02-.44.12-.58.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.08-.14-.66-1.58-.9-2.17-.24-.57-.48-.49-.66-.5h-.56c-.19 0-.5.07-.76.36-.26.29-.99.97-.99 2.37 0 1.4 1.01 2.75 1.15 2.94.14.19 1.97 3.01 4.78 4.23.67.29 1.2.47 1.61.6.67.21 1.29.18 1.78.11.54-.08 1.72-.7 1.97-1.37.24-.67.24-1.25.17-1.37-.08-.11-.27-.18-.56-.32Z" />
                  </svg>
                  <span className={whatsAppUi.apiDown ? 'text-zinc-500' : 'text-zinc-300'}>WhatsApp</span>
                </span>
                {err && (
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-zinc-800/70 bg-zinc-900/35 px-2 text-[11px] font-medium text-zinc-300 cursor-default"
                    title={`Erro de carregamento: ${String(err)}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400" aria-hidden />
                    <span className="text-zinc-500" aria-hidden>
                      ⚠️
                    </span>
                    <span className="text-zinc-500">Banco de dados</span>
                  </span>
                )}
              </div>
            </div>
            {webhookStatus?.active && fullMercadoPagoWebhookUrl ? (
              <div className="hidden flex-wrap items-center gap-2 sm:justify-end md:flex">
                <code className="max-w-[min(100%,42rem)] truncate rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-100/95">
                  {fullMercadoPagoWebhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyWebhookUrl()}
                  className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
                >
                  Copiar URL
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-2 px-4 py-4 sm:space-y-8 sm:py-8">
        {!whatsAppUi.apiDown && !whatsAppUi.loading && !whatsAppUi.authenticated && (
          <section className="rounded-xl border border-cyan-500/35 bg-gradient-to-br from-[#151518] to-[#0f1218] p-6 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <h2 className="text-lg font-semibold text-white">Conectar WhatsApp (QR)</h2>
                <p className="text-sm text-zinc-400">
                  Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho → escaneie o código
                  abaixo. Quem estiver com o painel aberto na internet pode fazer o login sem usar o terminal do
                  servidor.
                </p>
                {whatsAppUi.lastError && (
                  <p className="text-xs text-amber-300/95">Último aviso: {whatsAppUi.lastError}</p>
                )}
                <p className="text-xs text-zinc-500">
                  Estado: {whatsAppUi.lastEvent || '—'}
                  {whatsAppUi.ready ? ' · cliente pronto' : ''}
                </p>
                <button
                  type="button"
                  onClick={() => void restartWhatsAppConnection()}
                  disabled={waRestarting}
                  className="mt-2 rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/70 hover:bg-cyan-500/20 disabled:opacity-60"
                >
                  {waRestarting ? 'Reiniciando…' : 'Gerar novo QR / reiniciar conexão'}
                </button>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-2">
                {whatsAppUi.qrBase64 ? (
                  <img
                    src={whatsAppUi.qrBase64}
                    alt="QR Code WhatsApp"
                    className="h-56 w-56 rounded-xl border border-zinc-700 bg-white p-2 shadow-lg"
                  />
                ) : (
                  <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-dashed border-zinc-600 bg-zinc-950/80 px-4 text-center text-sm text-zinc-500">
                    Aguardando QR do servidor…
                  </div>
                )}
                <span className="text-[10px] text-zinc-600">
                  Atualiza automaticamente a cada poucos segundos.
                </span>
              </div>
            </div>
          </section>
        )}

        {false && !whatsAppUi.apiDown && !whatsAppUi.loading && whatsAppUi.authenticated && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200/95">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            WhatsApp conectado ao bot — sessão ativa.
            <button
              type="button"
              onClick={() => void restartWhatsAppConnection()}
              disabled={waRestarting}
              className="ml-auto rounded border border-emerald-400/40 px-2 py-0.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {waRestarting ? '…' : 'Reiniciar conexão'}
            </button>
          </div>
        )}

        {whatsAppUi.apiDown && (
          <div className="hidden rounded-lg border border-zinc-700 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400 sm:block">
            Não foi possível obter o QR do WhatsApp: API do bot inacessível (confirme ngrok e se o{' '}
            <code className="text-zinc-300">npm run dev</code> está rodando).
          </div>
        )}

        {summary?.bot?.emergencyPaused && (
          <div className="rounded-lg border border-amber-400/60 bg-amber-500/15 px-4 py-3 text-sm font-semibold text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.25)]">
            ⏸️ Pausa global ativa: o bot está online, mas não responde automaticamente até clicar em
            <span className="ml-1 underline decoration-amber-300/70 underline-offset-2">Retomar operação</span>.
          </div>
        )}
        {err && (
          <div className="hidden rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200 sm:block">
            <p>
              Erro ao carregar dados: {err}. API configurada em{' '}
              <span className="font-mono text-red-100/95">{BASE_URL}</span>. Confirme o bot + ngrok no ar,
              teste essa URL no navegador com <span className="font-mono">/api/whatsapp/status</span> e
              atualize <span className="font-mono">api-link.json</span> ou <span className="font-mono">VITE_API_BASE</span>{' '}
              se o túnel mudou.
            </p>
          </div>
        )}

        {activeTab === 'conversas' && (
          <section className="relative z-20 py-0.5 md:hidden">
          <div className="grid min-w-0 grid-cols-4 gap-1.5 overflow-x-auto px-0 py-1">
            <button
              type="button"
              onClick={() =>
                setMobileConversationFilter((prev) => (prev === 'sales' ? 'all' : 'sales'))
              }
              className={`relative min-w-[5.25rem] rounded-xl border px-1.5 py-1.5 text-left transition-colors duration-150 ${
                mobileConversationFilter === 'sales'
                  ? 'border-cyan-300/90 bg-cyan-500/25 shadow-[inset_0_0_14px_rgba(34,211,238,0.22)] animate-[pulse_2.2s_ease-in-out_infinite]'
                  : 'border-zinc-500/85 bg-[#1b1f2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
              }`}
            >
              {mobileConversationFilter === 'sales' && (
                <span className="absolute right-1.5 top-1 text-[10px] text-cyan-300">●</span>
              )}
              <p
                className={`truncate text-[10px] font-medium ${
                  mobileConversationFilter === 'sales' ? 'text-cyan-200' : 'text-zinc-500'
                }`}
              >
                Vendas de hj
              </p>
              <p
                className={`mt-0.5 text-xs font-bold tabular-nums ${
                  mobileConversationFilter === 'sales' ? 'text-white' : 'text-zinc-400'
                }`}
              >
                {loading ? '—' : fmtMoney(summary?.totalSalesToday ?? 0)}
              </p>
            </button>
            <button
              type="button"
              onClick={() =>
                setMobileConversationFilter((prev) => (prev === 'pending' ? 'all' : 'pending'))
              }
              className={`relative min-w-[5.25rem] rounded-xl border px-1.5 py-1.5 text-left transition-colors duration-150 ${
                mobileConversationFilter === 'pending'
                  ? 'border-amber-300/90 bg-amber-500/25 shadow-[inset_0_0_14px_rgba(251,191,36,0.2)] animate-[pulse_2.2s_ease-in-out_infinite]'
                  : 'border-zinc-500/85 bg-[#1b1f2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
              }`}
            >
              {mobileConversationFilter === 'pending' && (
                <span className="absolute right-1.5 top-1 text-[10px] text-amber-300">●</span>
              )}
              <p
                className={`truncate text-[10px] font-medium ${
                  mobileConversationFilter === 'pending' ? 'text-amber-200' : 'text-zinc-500'
                }`}
              >
                Pendentes
              </p>
              <p
                className={`mt-0.5 text-[11px] font-bold tabular-nums ${
                  mobileConversationFilter === 'pending' ? 'text-amber-300' : 'text-zinc-400'
                }`}
              >
                {loading
                  ? '—'
                  : `${summary?.pendingPayments?.count ?? 0} / ${fmtMoney(summary?.pendingPayments?.totalValue ?? 0)}`}
              </p>
            </button>
            <button
              type="button"
              onClick={() =>
                setMobileConversationFilter((prev) => (prev === 'risk' ? 'all' : 'risk'))
              }
              className={`relative min-w-[5.25rem] rounded-xl border px-1.5 py-1.5 text-left transition-colors duration-150 ${
                mobileConversationFilter === 'risk'
                  ? 'border-red-300/90 bg-red-500/25 shadow-[inset_0_0_14px_rgba(248,113,113,0.18)] animate-[pulse_2.2s_ease-in-out_infinite]'
                  : 'border-zinc-500/85 bg-[#1b1f2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
              }`}
            >
              {mobileConversationFilter === 'risk' && (
                <span className="absolute right-1.5 top-1 text-[10px] text-red-300">●</span>
              )}
              <p
                className={`truncate text-[10px] font-medium ${
                  mobileConversationFilter === 'risk' ? 'text-red-200' : 'text-zinc-500'
                }`}
              >
                Riscos
              </p>
              <p
                className={`mt-0.5 text-xs font-bold tabular-nums ${
                  mobileConversationFilter === 'risk' ? 'text-red-300' : 'text-zinc-400'
                }`}
              >
                {loading ? '—' : summary?.riskAlerts ?? 0}
              </p>
            </button>
            <button
              type="button"
              onClick={() =>
                setMobileConversationFilter((prev) => (prev === 'shipping' ? 'all' : 'shipping'))
              }
              className={`relative min-w-[5.25rem] rounded-xl border px-1.5 py-1.5 text-left transition-colors duration-150 ${
                mobileConversationFilter === 'shipping'
                  ? 'border-emerald-300/90 bg-emerald-500/25 shadow-[inset_0_0_14px_rgba(52,211,153,0.18)] animate-[pulse_2.2s_ease-in-out_infinite]'
                  : 'border-zinc-500/85 bg-[#1b1f2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
              }`}
            >
              {mobileConversationFilter === 'shipping' && (
                <span className="absolute right-1.5 top-1 text-[10px] text-emerald-300">●</span>
              )}
              <p
                className={`truncate text-[10px] font-medium ${
                  mobileConversationFilter === 'shipping' ? 'text-emerald-200' : 'text-zinc-500'
                }`}
              >
                Para envio
              </p>
              <p
                className={`mt-0.5 text-xs font-bold tabular-nums ${
                  mobileConversationFilter === 'shipping' ? 'text-emerald-300' : 'text-zinc-400'
                }`}
              >
                {loading ? '—' : summary?.pendingShipment ?? 0}
              </p>
            </button>
          </div>
          </section>
        )}

        <section className="hidden grid-cols-2 gap-3 sm:grid sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          <Card title="Vendas hoje" accent>
            <p className="text-3xl font-bold tabular-nums text-white">
              {loading ? '—' : fmtMoney(summary?.totalSalesToday ?? 0)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Pagamentos aprovados desde 00:00</p>
          </Card>
          <Card title="Pendentes (qtd / valor)">
            <p className="text-2xl font-bold tabular-nums text-amber-300">
              {loading
                ? '—'
                : `${summary?.pendingPayments?.count ?? 0} / ${fmtMoney(summary?.pendingPayments?.totalValue ?? 0)}`}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Checkouts aguardando aprovação</p>
          </Card>
          <Card title="Alertas de risco">
            <p className="text-3xl font-bold tabular-nums text-red-300">
              {loading ? '—' : summary?.riskAlerts ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Conversas com intervenção urgente</p>
          </Card>
          <Card title="Pagos sem endereço">
            <p className="text-3xl font-bold tabular-nums text-violet-300">
              {loading ? '—' : summary?.paidWithoutAddress ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Pagamento ok, dados de envio pendentes</p>
          </Card>
          <Card title="Pendentes de envio">
            <p className="text-3xl font-bold tabular-nums text-amber-300">
              {loading ? '—' : summary?.pendingShipment ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Pagos com endereço completo aguardando expedição</p>
          </Card>
          <Card title="Conversas pausadas">
            <p className="text-3xl font-bold tabular-nums text-cyan-300">
              {loading ? '—' : summary?.pausedConversations ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Silenciadas por intervenção humana</p>
          </Card>
          <Card title="Conversas totais">
            <p className="text-3xl font-bold tabular-nums text-sky-300">
              {loading ? '—' : summary?.totalConversations ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Total real de conversas registradas</p>
          </Card>
          <Card title="SKUs com estoque baixo">
            <p className="text-3xl font-bold tabular-nums text-orange-300">
              {loading ? '—' : summary?.lowStockSkus ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Quantidade manual menor ou igual a 3</p>
          </Card>
        </section>

        {activeTab === 'conversas' && (
          <section className="max-md:-mt-1 pt-0 sm:pt-0">
            <div className="mb-1 flex items-center justify-between gap-2 sm:mb-4">
              <h2 className="hidden text-lg font-semibold text-white sm:block">Conversas recentes</h2>
              {urgentRiskCount > 0 && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-200">
                  ⚠️ {urgentRiskCount} conversa(s) com risco clínico — intervir urgente
                </div>
              )}
            </div>
            <div className="mb-3 hidden rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/95 sm:block">
              ⭐ na coluna <span className="font-semibold">Recorrência</span> = cliente com pagamento aprovado
              registrado. O número ao lado da estrela indica quantas compras aprovadas ele já tem.
            </div>
            {isMobileView ? (
              <div className="overflow-hidden rounded-2xl border border-zinc-600/70 bg-gradient-to-b from-[#1a2130] to-[#111722] shadow-[0_14px_30px_rgba(0,0,0,0.35)]">
                <div className="flex h-[calc(100vh-16.75rem)] flex-col md:h-[calc(100vh-15.25rem)] md:flex-row">
                  <div className="w-full overflow-y-auto">
                      {loading && (
                        <p className="px-4 py-6 text-center text-sm text-zinc-500">Carregando sessões…</p>
                      )}
                      {!loading && mobileFilteredOrders.length === 0 && (
                        <p className="px-4 py-6 text-center text-sm text-zinc-500">
                          Nenhuma conversa para este filtro.
                        </p>
                      )}
                      {!loading &&
                        mobileFilteredOrders.map((o, idx) => {
                          const rowPaused = isConversationPaused(o);
                          const rowRisk = !!o.riskAlert;
                          const isSelected = selectedSession?.chatId === o.chatId;
                          const loadingPause = !!pauseLoadingByChat[o.chatId];
                          const stage = getMobileJourneyStage(o);
                          const filterBorderClass =
                            mobileConversationFilter === 'sales'
                              ? 'border-cyan-400/70'
                              : mobileConversationFilter === 'pending'
                                ? 'border-amber-400/70'
                                : mobileConversationFilter === 'risk'
                                  ? 'border-red-400/70'
                                  : mobileConversationFilter === 'shipping'
                                    ? 'border-emerald-400/70'
                                    : 'border-zinc-800/70';
                          return (
                            <div
                              key={`${o.id || 'session'}-${o.chatId || 'chat'}-${idx}`}
                              className={`w-full rounded-xl border-2 bg-gradient-to-b from-[#1b2130] to-[#161a24] px-4 py-4 text-left shadow-[0_10px_22px_rgba(0,0,0,0.32)] transition-all duration-150 hover:shadow-[0_12px_24px_rgba(0,0,0,0.38)] ${filterBorderClass} ${
                                isSelected ? 'bg-cyan-500/10 ring-1 ring-cyan-300/35' : ''
                              } ${
                                rowPaused ? 'grayscale saturate-0 opacity-80' : ''
                              }`}
                            >
                              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate text-sm font-semibold text-zinc-200">
                                      {o.contactName || o.customerName || 'Cliente sem nome'}
                                    </p>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {rowRisk && (
                                      <span className="inline-flex rounded-full border border-red-400/50 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
                                        Risco
                                      </span>
                                    )}
                                    {rowPaused && (
                                      <span className="inline-flex rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                        Pausada
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="self-center">
                                  <span
                                    className={`inline-flex min-w-[84px] justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                      stage.tone === 'sky'
                                        ? 'border-sky-400/45 bg-sky-500/15 text-sky-200'
                                        : stage.tone === 'amber'
                                          ? 'border-amber-400/45 bg-amber-500/15 text-amber-200'
                                          : stage.tone === 'emerald'
                                            ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
                                            : 'border-zinc-600/70 bg-zinc-800/70 text-zinc-300'
                                    }`}
                                  >
                                    {stage.label}
                                  </span>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  <span className="shrink-0 text-[11px] text-zinc-500">
                                    {formatLastMessageTime(o.lastCustomerMessageAt || o.updatedAt)}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void openSelectedSession(o)}
                                    className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-violet-400/60 bg-violet-500/15 px-2 text-violet-200"
                                    title="Ver conversa"
                                  >
                                    👁
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void togglePauseBot(o)}
                                    disabled={loadingPause || !o.chatId}
                                    className={`inline-flex min-h-[36px] items-center justify-center rounded-lg border px-2.5 text-[11px] font-semibold ${
                                      rowPaused
                                        ? 'border-emerald-500/55 bg-emerald-500/20 text-emerald-200'
                                        : 'border-red-500/55 bg-red-500/15 text-red-200'
                                    } disabled:opacity-60`}
                                  >
                                    {loadingPause ? '...' : rowPaused ? 'START' : 'STOP'}
                                  </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                  </div>

                  {selectedSession && (
                    <div className="fixed inset-0 z-40 flex min-w-0 items-center justify-center bg-black/45 px-4 py-6">
                      <div className="flex h-[78vh] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#111116] shadow-2xl">
                        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-zinc-100">
                                {selectedSession.contactName || 'Conversa'}
                              </p>
                              <p className="truncate text-xs text-zinc-400">
                                {selectedSession.contactNumber
                                  ? formatContactNumber(selectedSession.contactNumber)
                                  : selectedSession.chatId}
                              </p>
                            </div>
                            {selectedSession.waLink && (
                              <a
                                href={selectedSession.waLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center self-center rounded-lg border border-emerald-500/45 bg-emerald-500/10 text-emerald-200 transition hover:border-emerald-400/70 hover:bg-emerald-500/20"
                                title="Ver no WhatsApp"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                                  <path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.56 0 .26 5.3.26 11.8c0 2.08.54 4.11 1.57 5.9L0 24l6.5-1.71a11.75 11.75 0 0 0 5.56 1.42h.01c6.5 0 11.8-5.3 11.8-11.8 0-3.15-1.23-6.12-3.35-8.43Zm-8.45 18.2h-.01a9.77 9.77 0 0 1-4.98-1.36l-.36-.22-3.86 1.01 1.03-3.76-.24-.39a9.73 9.73 0 0 1-1.49-5.16c0-5.39 4.39-9.78 9.79-9.78 2.61 0 5.07 1.02 6.92 2.87a9.72 9.72 0 0 1 2.86 6.92c0 5.4-4.4 9.79-9.8 9.79Zm5.37-7.35c-.29-.14-1.72-.85-1.98-.94-.27-.1-.46-.14-.66.14-.19.29-.75.94-.92 1.13-.17.19-.33.22-.62.08-.29-.14-1.2-.44-2.29-1.4-.85-.76-1.43-1.7-1.59-1.98-.17-.29-.02-.44.12-.58.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.08-.14-.66-1.58-.9-2.17-.24-.57-.48-.49-.66-.5h-.56c-.19 0-.5.07-.76.36-.26.29-.99.97-.99 2.37 0 1.4 1.01 2.75 1.15 2.94.14.19 1.97 3.01 4.78 4.23.67.29 1.2.47 1.61.6.67.21 1.29.18 1.78.11.54-.08 1.72-.7 1.97-1.37.24-.67.24-1.25.17-1.37-.08-.11-.27-.18-.56-.32Z" />
                                </svg>
                              </a>
                            )}
                          </div>
                          {isMobileView && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSession(null);
                                setSelectedSessionMessages([]);
                                setSelectedSessionError(null);
                              }}
                              className="inline-flex min-h-[44px] shrink-0 items-center self-center rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3 text-sm font-semibold text-cyan-100 shadow-[0_4px_12px_rgba(34,211,238,0.2)] transition hover:border-cyan-300 hover:bg-cyan-500/25"
                            >
                              <span aria-hidden>←</span>
                              <span className="ml-1">Voltar</span>
                            </button>
                          )}
                        </div>
                        <div className="scrolling-touch min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 [-webkit-overflow-scrolling:touch]">
                        {selectedSessionLoading && (
                          <p className="break-words text-sm text-zinc-400">Carregando histórico da conversa…</p>
                        )}
                        {!selectedSessionLoading && selectedSessionError && (
                          <p className="break-words rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                            {selectedSessionError}
                          </p>
                        )}
                        {!selectedSessionLoading &&
                          !selectedSessionError &&
                          selectedSessionMessages.length === 0 && (
                            <p className="break-words text-sm text-zinc-500">Sem mensagens registradas para este contato.</p>
                          )}
                        {!selectedSessionLoading &&
                          !selectedSessionError &&
                          selectedSessionMessages.length > 0 && (
                            <div className="min-w-0 space-y-3">
                              {[...selectedSessionMessages].reverse().map((msg, idx) => {
                                const role = String(msg?.role || '').toLowerCase();
                                const isBot = role === 'assistant';
                                const isHuman = role === 'human';
                                const roleLabel = isBot ? 'Bot' : isHuman ? 'Atendente humano' : 'Cliente';
                                const roleIcon = isBot ? '🤖' : isHuman ? '🧑‍💼' : '👤';
                                return (
                                  <div
                                    key={`${idx}-${msg?.at || 'sem-data'}`}
                                    className={`max-w-full min-w-0 rounded-lg border px-3 py-2 ${
                                      isBot
                                        ? 'ml-auto w-[90%] border-cyan-500/35 bg-cyan-500/10'
                                        : isHuman
                                          ? 'mr-auto w-[90%] border-amber-500/35 bg-amber-500/10'
                                          : 'mr-auto w-[90%] border-zinc-700 bg-zinc-900/80'
                                    }`}
                                  >
                                    <p
                                      className={`break-words text-[11px] font-semibold ${
                                        isBot ? 'text-cyan-300' : isHuman ? 'text-amber-300' : 'text-zinc-300'
                                      }`}
                                    >
                                      {roleIcon} {roleLabel}
                                      {msg?.at ? ` · ${formatConversationTimestamp(msg.at)}` : ''}
                                    </p>
                                    <p className="mt-1 max-w-full break-words whitespace-pre-wrap text-sm text-zinc-100 [overflow-wrap:anywhere]">
                                      {String(msg?.text || '').trim() || '—'}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                      </div>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#151518]">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/90 bg-zinc-900/40 text-zinc-400">
                      <th className="px-4 py-3 font-medium">Recorrência</th>
                      <th className="px-4 py-3 font-medium">Contato</th>
                      <th className="px-4 py-3 font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Etapa</th>
                      <th className="px-4 py-3 font-medium text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {loading && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                          Carregando pedidos…
                        </td>
                      </tr>
                    )}
                    {!loading && orders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                          Nenhum pedido registrado.
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      orders.map((o, idx) => {
                        const rowPaused = isConversationPaused(o);
                        const rowRisk = !!o.riskAlert;
                        const rowShipmentPending = !!o.isShipmentPending;
                        const rowMuted = rowPaused && !rowRisk;
                        const canAdvanceShipping = String(o.journeyStatusKey || '').toUpperCase() === 'READY_TO_SHIP';
                        return (
                        <tr
                          key={`${o.id || 'session'}-${o.chatId || 'chat'}-${idx}`}
                          className={`transition-colors hover:bg-zinc-800/40 ${
                            rowRisk
                              ? 'bg-red-950/25'
                              : rowMuted
                                ? 'bg-[#0a0a0c]'
                                : rowShipmentPending
                                ? 'bg-amber-950/25'
                                : ''
                          } ${rowPaused ? 'border-l-2 border-amber-400/70' : ''}`}
                        >
                          <td className="max-w-[140px] px-4 py-3 text-xs">
                            {o.isReturningCustomer ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-200"
                                title={`${Number(o.totalPaidOrders || 0)} compra(s) aprovada(s)`}
                              >
                                ⭐
                                <span>{Number(o.totalPaidOrders || 0)}</span>
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-zinc-700 bg-zinc-800/70 px-2 py-0.5 text-zinc-400">
                                Novo
                              </span>
                            )}
                          </td>
                          <td className="max-w-[320px] px-4 py-3">
                            <div className="flex items-start gap-2">
                              <img
                                src={o.profilePic && !brokenAvatarByChat[o.chatId] ? o.profilePic : AVATAR_PLACEHOLDER}
                                alt="Avatar do cliente"
                                className={`h-10 w-10 rounded-full object-cover ${
                                  rowMuted
                                    ? 'border border-zinc-700 grayscale'
                                    : 'border border-cyan-400/35 shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                                }`}
                                onError={() =>
                                  setBrokenAvatarByChat((prev) => ({ ...prev, [o.chatId]: true }))
                                }
                              />
                              <div className="min-w-0">
                                <p
                                  className={`truncate text-xs font-semibold ${
                                    rowMuted ? 'text-zinc-500' : 'text-zinc-200'
                                  }`}
                                  title={o.contactName || o.customerName || 'Cliente sem nome'}
                                >
                                  {o.contactName || o.customerName || 'Cliente sem nome'}
                                </p>
                                {(o.lastCustomerMessageAt || o.updatedAt) && (
                                  <p
                                    className={`truncate text-[10px] ${rowMuted ? 'text-zinc-700' : 'text-zinc-500'}`}
                                    title={
                                      o.lastCustomerMessageAt
                                        ? `Última mensagem do cliente: ${formatConversationTimestamp(o.lastCustomerMessageAt)}`
                                        : `Última atividade (sem msg no histórico): ${formatConversationTimestamp(o.updatedAt)}`
                                    }
                                  >
                                    Última msg:{' '}
                                    {formatLastMessageTime(o.lastCustomerMessageAt || o.updatedAt)}
                                  </p>
                                )}
                                {rowPaused && (
                                  <span className="mt-0.5 inline-flex w-fit items-center rounded-full border border-red-400/50 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200/95">
                                    Conversa pausada
                                  </span>
                                )}
                                {o.contactName &&
                                  o.customerName &&
                                  o.contactName.trim().toLowerCase() !== o.customerName.trim().toLowerCase() && (
                                    <p className="truncate text-[10px] text-zinc-500" title={`Entrega: ${o.customerName}`}>
                                      Entrega: {o.customerName}
                                    </p>
                                  )}
                                <div className="mt-1 flex items-center gap-2">
                                  {o.contactNumber ? (
                                    <a
                                      href={o.waLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`truncate font-mono text-xs ${
                                        rowMuted
                                          ? 'text-zinc-500 underline decoration-zinc-700/40 underline-offset-2 hover:text-zinc-400'
                                          : 'text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200'
                                      }`}
                                      title="Abrir conversa no WhatsApp Web"
                                    >
                                      {formatContactNumber(o.contactNumber)}
                                    </a>
                                  ) : (
                                    <p className="truncate font-mono text-xs text-zinc-400">{o.chatId || '—'}</p>
                                  )}
                                  <div className={rowMuted ? 'opacity-80' : ''}>
                                    <ReferralBadge referralName={o.referralName} referralSource={o.referralSource} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className={`px-4 py-3 tabular-nums ${rowMuted ? 'text-zinc-500' : 'text-zinc-200'}`}>
                            {typeof o.value === 'number' ? (
                              <span className="relative inline-flex items-center">
                                {String(o.journeyStatusKey || '').toUpperCase() === 'READY_TO_SHIP' && (
                                  <span
                                    className="absolute -right-3 -top-2 text-[12px] leading-none text-emerald-300 drop-shadow-[0_0_6px_rgba(74,222,128,0.85)]"
                                    title="Pagamento confirmado e pronto para expedição"
                                  >
                                    ✓
                                  </span>
                                )}
                                <span>{fmtMoney(o.value)}</span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div
                              className={
                                rowMuted && String(o.journeyStatusKey || '').toUpperCase() !== 'READY_TO_SHIP'
                                  ? 'grayscale opacity-80'
                                  : ''
                              }
                            >
                              <StatusBadge status={o.journeyStatusLabel} statusKey={o.journeyStatusKey} />
                            </div>
                            {o.riskAlert && (
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <RiskAlertBadge reason={o.riskReason} />
                                <button
                                  type="button"
                                  onClick={() => void clearRiskAlert(o)}
                                  disabled={!!riskClearLoadingByChat[o.chatId] || !o.chatId}
                                  className="rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700/90 disabled:cursor-not-allowed disabled:opacity-60"
                                  title="Remover alerta após a pendência ser resolvida"
                                >
                                  {riskClearLoadingByChat[o.chatId] ? '…' : 'Resolver'}
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(() => {
                              const mins = getRemainingPauseMinutes(o);
                              const paused = isConversationPaused(o);
                              const permanentPause = paused && !o.pausedUntil;
                              const loadingPause = !!pauseLoadingByChat[o.chatId];
                              const successPause = !!pauseSuccessByChat[o.chatId];
                              return (
                                <div className={`flex justify-end gap-2 ${rowMuted ? 'saturate-0' : ''}`}>
                                  <button
                                    type="button"
                                    onClick={() => void openConversationModal(o)}
                                    disabled={!o.chatId}
                                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-violet-400/70 bg-violet-500/20 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-violet-100 shadow-[0_0_10px_rgba(167,139,250,0.35)] transition hover:border-violet-300 hover:bg-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Visualizar conversa"
                                  >
                                    <span className="text-lg leading-none">👁</span>
                                    <span className="leading-none">Ver</span>
                                  </button>
                                  {canAdvanceShipping && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void updateShippingStatus(o, 'SHIPPED')}
                                        disabled={
                                          !o.chatId ||
                                          !!shippingLoadingByChat[o.chatId] ||
                                          String(o.shippingStatus || '') === 'SHIPPED' ||
                                          String(o.shippingStatus || '') === 'DELIVERED'
                                        }
                                        className="min-h-[44px] rounded-lg border border-sky-500/45 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 transition hover:border-sky-400/70 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                                        title="Marcar pedido como enviado"
                                      >
                                        {shippingLoadingByChat[o.chatId] ? '...' : 'Enviado'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void updateShippingStatus(o, 'DELIVERED')}
                                        disabled={
                                          !o.chatId ||
                                          !!shippingLoadingByChat[o.chatId] ||
                                          String(o.shippingStatus || '') === 'DELIVERED'
                                        }
                                        className="min-h-[44px] rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/70 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                                        title="Marcar pedido como entregue"
                                      >
                                        {shippingLoadingByChat[o.chatId] ? '...' : 'Entregue'}
                                      </button>
                                    </>
                                  )}
                                  {o.waLink ? (
                                    <a
                                      href={o.waLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-[44px] items-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/70 hover:bg-emerald-500/20"
                                    >
                                      Falar
                                    </a>
                                  ) : (
                                    <span className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-500">
                                      Sem contato
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => togglePauseBot(o)}
                                    disabled={loadingPause || !o.chatId}
                                    className={`min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                      paused
                                        ? 'border border-emerald-500/55 bg-emerald-500/20 text-emerald-200 hover:border-emerald-400/80 hover:bg-emerald-500/30'
                                        : 'border border-red-500/55 bg-red-500/15 text-red-200 hover:border-red-400/80 hover:bg-red-500/25'
                                    }`}
                                  >
                                    {loadingPause && (
                                      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-r-transparent" />
                                    )}
                                    {!loadingPause && successPause && <span className="text-emerald-300">✓</span>}
                                    {!loadingPause && !successPause && paused && permanentPause && 'START BOT'}
                                    {!loadingPause && !successPause && paused && !permanentPause && `START BOT (${mins} min)`}
                                    {!loadingPause && !successPause && !paused && 'STOP BOT'}
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'catalogo' && (
          <section className="min-w-0 max-w-full overflow-x-hidden">
            <h2 className="mb-4 text-lg font-semibold text-white">Catálogo (SKUs e preços)</h2>
            <p className="mb-4 break-words text-sm text-zinc-500">
              Dados espelhados de{' '}
              <span className="break-all font-mono text-zinc-400">catalogo-unificado.js</span> via API.
            </p>
            <div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {loading && (
                <p className="col-span-full text-zinc-500">Carregando catálogo…</p>
              )}
              {!loading &&
                catalog.map((item) => {
                  const isZeroStock = Number(item.stockQuantity ?? 0) <= 0;
                  return (
                  <div
                    key={item.sku}
                    className={`min-w-0 max-w-full rounded-xl border-2 bg-gradient-to-b from-[#1b2130] to-[#161a24] p-3 shadow-[0_10px_22px_rgba(0,0,0,0.32)] transition-all duration-150 hover:border-cyan-400/40 hover:shadow-[0_12px_24px_rgba(0,0,0,0.38)] sm:p-4 ${
                      isZeroStock
                        ? 'border-zinc-600/75 saturate-0 hover:border-zinc-500/80'
                        : 'border-zinc-700/80'
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                      <p
                        className={`min-w-0 text-base font-semibold leading-snug sm:truncate sm:text-[15px] ${
                          isZeroStock ? 'text-zinc-300' : 'text-white'
                        }`}
                      >
                        {item.nome}{' '}
                        <span className="font-normal text-zinc-400">{item.dosagem}</span>
                      </p>
                      <p
                        className={`shrink-0 text-lg font-bold tabular-nums sm:text-right sm:text-sm sm:font-semibold ${
                          isZeroStock ? 'text-zinc-300' : 'text-emerald-400/95'
                        }`}
                      >
                        {item.preco}
                      </p>
                    </div>
                    <div className="mt-3 rounded-xl border border-zinc-700/80 bg-zinc-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:mt-2 sm:rounded-lg sm:p-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-400 sm:mb-1 sm:text-[11px] sm:font-medium sm:text-zinc-500">
                        Preço comercial
                      </label>
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={priceDraftBySku[item.sku] ?? String(item.preco ?? '')}
                          onChange={(e) =>
                            setPriceDraftBySku((prev) => ({ ...prev, [item.sku]: e.target.value }))
                          }
                          className="min-h-[48px] min-w-0 w-full rounded-xl border border-zinc-600 bg-zinc-950 px-3 py-2.5 text-center text-lg font-semibold tabular-nums text-zinc-100 outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30 sm:min-h-0 sm:rounded-md sm:px-2 sm:py-1 sm:text-left sm:text-sm sm:font-normal sm:focus:ring-0 sm:w-36 sm:flex-none"
                        />
                        <p className="order-2 text-center text-sm text-zinc-400 sm:order-none sm:hidden">
                          Valor atual no catálogo:{' '}
                          <span className="font-semibold text-zinc-200">{item.preco}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => savePrice(item.sku)}
                          disabled={!!priceSavingBySku[item.sku]}
                          className={`order-3 min-h-[48px] w-full rounded-xl border text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 sm:order-none sm:min-h-0 sm:w-auto sm:rounded-md sm:px-2.5 sm:py-1 sm:text-xs ${
                            isZeroStock
                              ? 'border-zinc-600 bg-zinc-800/80 text-zinc-300'
                              : 'border-emerald-500/55 bg-emerald-500/20 text-emerald-100 hover:border-emerald-400/80 hover:bg-emerald-500/30'
                          }`}
                        >
                          {priceSavingBySku[item.sku]
                            ? 'Salvando…'
                            : priceSavedBySku[item.sku]
                              ? '✓ Salvo'
                              : 'Salvar preço'}
                        </button>
                        <span className="order-1 hidden min-w-0 truncate text-[11px] text-zinc-500 sm:order-none sm:inline sm:flex-initial">
                          Atual: {item.preco}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-zinc-700/80 bg-zinc-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:mt-2 sm:rounded-lg sm:p-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-400 sm:mb-1 sm:text-[11px] sm:font-medium sm:text-zinc-500">
                        Estoque manual
                      </label>
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={stockDraftBySku[item.sku] ?? String(Number(item.stockQuantity ?? 0))}
                          onChange={(e) =>
                            setStockDraftBySku((prev) => ({ ...prev, [item.sku]: e.target.value }))
                          }
                          className="min-h-[52px] min-w-0 w-full rounded-xl border border-zinc-600 bg-zinc-950 px-3 py-2.5 text-center text-2xl font-bold tabular-nums tracking-tight text-zinc-100 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30 sm:min-h-0 sm:rounded-md sm:px-2 sm:py-1 sm:text-left sm:text-sm sm:font-normal sm:focus:ring-0 sm:w-24 sm:flex-none"
                        />
                        <p className="order-2 text-center text-sm text-zinc-400 sm:order-none sm:hidden">
                          Quantidade atual:{' '}
                          <span className="font-semibold text-zinc-200">{Number(item.stockQuantity ?? 0)}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => saveStock(item.sku)}
                          disabled={!!stockSavingBySku[item.sku]}
                          className={`order-3 min-h-[48px] w-full rounded-xl border text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 sm:order-none sm:min-h-0 sm:w-auto sm:rounded-md sm:px-2.5 sm:py-1 sm:text-xs ${
                            isZeroStock
                              ? 'border-zinc-600 bg-zinc-800/80 text-zinc-300'
                              : 'border-cyan-500/55 bg-cyan-500/20 text-cyan-100 hover:border-cyan-400/80 hover:bg-cyan-500/30'
                          }`}
                        >
                          {stockSavingBySku[item.sku]
                            ? 'Salvando…'
                            : stockSavedBySku[item.sku]
                              ? '✓ Salvo'
                              : 'Salvar estoque'}
                        </button>
                        <span className="order-1 hidden min-w-0 truncate text-[11px] text-zinc-500 sm:order-none sm:inline sm:flex-initial">
                          Atual: {Number(item.stockQuantity ?? 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                )})}
            </div>
          </section>
        )}

        {activeTab === 'revendedores' && (
          <section>
            <div className="rounded-xl border border-zinc-800/80 bg-[#151518] p-6">
              <h2 className="text-lg font-semibold text-white">Revendedores</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Esta área está em construção. Em breve você poderá acompanhar indicações, conversões e comissões por
                revendedor.
              </p>
            </div>
          </section>
        )}

        {devLogsUnlocked && activeTab === 'logs' && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">Logs técnicos (desenvolvimento)</h2>
              <button
                type="button"
                onClick={() => void loadDevLogs()}
                className="rounded-lg border border-amber-500/45 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:border-amber-400/70 hover:bg-amber-500/25"
              >
                {devLogsLoading ? 'Atualizando...' : 'Atualizar'}
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-zinc-800/80 bg-[#151518] p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Atalho</p>
              <p className="mt-1 text-sm text-zinc-300">
                Pressione <span className="font-mono text-amber-300">Ctrl + Shift + L</span> para mostrar/ocultar esta aba.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-800/80 bg-[#151518] p-4 lg:col-span-1">
                <p className="text-xs uppercase tracking-wide text-zinc-500">WhatsApp Runtime</p>
                <div className="mt-2 space-y-1 text-sm text-zinc-200">
                  <p>Conectado: {devLogsData.status?.ready ? 'sim' : 'não'}</p>
                  <p>Autenticado: {devLogsData.status?.authenticated ? 'sim' : 'não'}</p>
                  <p>Estado: {devLogsData.status?.connectionState || '—'}</p>
                  <p>Último evento: {devLogsData.status?.lastEvent || '—'}</p>
                  <p className="break-all text-red-300">
                    Último erro: {devLogsData.status?.lastError || 'nenhum'}
                  </p>
                </div>
                <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-2">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Eventos recentes</p>
                  <div className="space-y-1 text-xs text-zinc-300">
                    {(devLogsData.status?.recentDebug || []).slice(-8).map((item, idx) => (
                      <p key={`${item?.at || 'at'}-${idx}`} className="break-all">
                        <span className="text-zinc-500">[{item?.level || 'info'}]</span> {item?.message || '—'}
                      </p>
                    ))}
                    {(!devLogsData.status?.recentDebug || devLogsData.status.recentDebug.length === 0) && (
                      <p className="text-zinc-500">Sem eventos recentes.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800/80 bg-[#151518] p-4 lg:col-span-2">
                <p className="text-xs uppercase tracking-wide text-zinc-500">App Log (últimas linhas)</p>
                <div className="mt-2 max-h-[28rem] overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
                  <div className="space-y-1 font-mono text-[11px] text-zinc-300">
                    {devLogsData.lines.slice(-160).map((line, idx) => (
                      <p key={`${idx}-${line.slice(0, 24)}`} className="break-all">
                        {line}
                      </p>
                    ))}
                    {devLogsData.lines.length === 0 && (
                      <p className="text-zinc-500">Sem logs disponíveis.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {conversationModal && (
        <div className="fixed inset-0 z-50 flex min-w-0 items-center justify-center bg-black/70 px-4 py-6">
          <div className="flex max-h-[85vh] w-full min-w-0 max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#111116] shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <img
                  src={
                    conversationModal.profilePic && !brokenAvatarByChat[conversationModal.chatId]
                      ? conversationModal.profilePic
                      : AVATAR_PLACEHOLDER
                  }
                  alt="Avatar do cliente"
                  className="h-11 w-11 shrink-0 rounded-full border border-cyan-400/35 object-cover shadow-[0_0_10px_rgba(34,211,238,0.25)]"
                  onError={() =>
                    setBrokenAvatarByChat((prev) => ({ ...prev, [conversationModal.chatId]: true }))
                  }
                />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-zinc-100">
                    <button
                      type="button"
                      onClick={() => {
                        const next = secretTapCount + 1;
                        setSecretTapCount(next);
                        if (next >= 5) {
                          setUnlockPanelOpen(true);
                          setSecretTapCount(0);
                          setUnlockFeedback('Modo secreto ativado.');
                        }
                      }}
                      className="truncate text-left"
                      title="Contato"
                    >
                      {conversationModal.contactName || 'Conversa'}
                    </button>
                  </h3>
                  <p className="truncate text-xs text-zinc-400">
                    {conversationModal.contactNumber
                      ? formatContactNumber(conversationModal.contactNumber)
                      : conversationModal.chatId}
                  </p>
                  {conversationModal.isPaused && (
                    <span className="mt-1 inline-flex rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                      {getPauseModalLabel(conversationModal.pausedUntil)}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConversationModal(null);
                  setConversationError(null);
                  setUnlockPanelOpen(false);
                  setSecretTapCount(0);
                  setUnlockFeedback('');
                }}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                Fechar
              </button>
            </div>

            {unlockPanelOpen && (
              <div className="border-b border-zinc-800 bg-zinc-950/60 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">
                  Modo secreto: destravar atendimento
                </p>
                <textarea
                  value={unlockMessageText}
                  onChange={(e) => setUnlockMessageText(e.target.value)}
                  rows={3}
                  placeholder="Digite a mensagem que será enviada diretamente ao cliente..."
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/70"
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={unlockUnpauseBot}
                      onChange={(e) => setUnlockUnpauseBot(e.target.checked)}
                    />
                    Retomar bot desta conversa
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={unlockClearRiskAlert}
                      onChange={(e) => setUnlockClearRiskAlert(e.target.checked)}
                    />
                    Limpar alerta de risco
                  </label>
                  <button
                    type="button"
                    onClick={() => void sendEmergencyUnlockMessage()}
                    disabled={unlockSending}
                    className="rounded-md border border-violet-400/55 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {unlockSending ? 'Enviando…' : 'Enviar mensagem de destravamento'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUnlockPanelOpen(false);
                      setUnlockFeedback('');
                    }}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                  >
                    Ocultar
                  </button>
                </div>
                {unlockFeedback && <p className="mt-2 text-xs text-zinc-400">{unlockFeedback}</p>}
              </div>
            )}

            <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4">
              {conversationLoading && (
                <p className="break-words text-sm text-zinc-400">Carregando histórico da conversa…</p>
              )}
              {!conversationLoading && conversationError && (
                <p className="break-words rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {conversationError}
                </p>
              )}
              {!conversationLoading && !conversationError && conversationModal.messages.length === 0 && (
                <p className="break-words text-sm text-zinc-500">Sem mensagens registradas para este contato.</p>
              )}
              {!conversationLoading && !conversationError && conversationModal.messages.length > 0 && (
                <div className="min-w-0 space-y-3">
                  {[...conversationModal.messages].reverse().map((msg, idx) => {
                    const role = String(msg?.role || '').toLowerCase();
                    const isBot = role === 'assistant';
                    const isHuman = role === 'human';
                    const roleLabel = isBot ? 'Bot' : isHuman ? 'Atendente humano' : 'Cliente';
                    const roleIcon = isBot ? '🤖' : isHuman ? '🧑‍💼' : '👤';
                    return (
                      <div
                        key={`${idx}-${msg?.at || 'sem-data'}`}
                        className={`max-w-full min-w-0 rounded-lg border px-3 py-2 ${
                          isBot
                            ? 'border-cyan-500/35 bg-cyan-500/10'
                            : isHuman
                              ? 'border-amber-500/35 bg-amber-500/10'
                            : 'border-zinc-700 bg-zinc-900/80'
                        }`}
                      >
                        <p
                          className={`break-words text-[11px] font-semibold ${
                            isBot ? 'text-cyan-300' : isHuman ? 'text-amber-300' : 'text-zinc-300'
                          }`}
                        >
                          <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
                            <span>{roleIcon}</span>
                            <span>{roleLabel}</span>
                            {isHuman && (
                              <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
                                Humano
                              </span>
                            )}
                          </span>
                          {msg?.at ? ` · ${formatConversationTimestamp(msg.at)}` : ''}
                        </p>
                        <p className="mt-1 max-w-full break-words whitespace-pre-wrap text-sm text-zinc-100 [overflow-wrap:anywhere]">
                          {String(msg?.text || '').trim() || '—'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-zinc-800/60 py-6 text-center text-xs text-zinc-600">
        Orion Peptides — painel interno
      </footer>
    </div>
  );
}
