import { useCallback, useEffect, useState } from 'react';

const AVATAR_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
      <rect width='64' height='64' fill='#1b1b21'/>
      <circle cx='32' cy='24' r='12' fill='#3f3f46'/>
      <path d='M10 56c2-10 10-16 22-16s20 6 22 16' fill='#3f3f46'/>
    </svg>`
  );

const api = (path) =>
  fetch(path, { headers: { Accept: 'application/json' } }).then((r) => {
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
      <span className="inline-flex rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/40">
        {s || 'Aguardando pagamento'}
      </span>
    );
  }
  if (key === 'READY_TO_SHIP') {
    return (
      <span className="inline-flex rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-400/40">
        {s || 'Pronto para envio'}
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

function PhoneVerificationBadge({ verification }) {
  const v = String(verification || '').toUpperCase();
  if (v === 'VERIFIED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
        <span>✓</span>
        Verificado
      </span>
    );
  }
  if (v === 'INFERRED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/50 bg-zinc-700/40 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
        <span>⌕</span>
        Inferido
      </span>
    );
  }
  return null;
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

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [pauseLoadingByChat, setPauseLoadingByChat] = useState({});
  const [pauseSuccessByChat, setPauseSuccessByChat] = useState({});
  const [activeTab, setActiveTab] = useState('conversas');
  const [stockDraftBySku, setStockDraftBySku] = useState({});
  const [stockSavingBySku, setStockSavingBySku] = useState({});
  const [stockSavedBySku, setStockSavedBySku] = useState({});
  const [brokenAvatarByChat, setBrokenAvatarByChat] = useState({});

  const loadDashboardData = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    setErr(null);
    const [sum, ord, cat] = await Promise.all([
      api('/api/dashboard/summary'),
      api('/api/dashboard/orders'),
      api('/api/dashboard/catalog')
    ]);
    if (sum.ok) setSummary(sum);
    if (ord.ok) setOrders(ord.orders || []);
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

  const fmtMoney = (n) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

  const getRemainingPauseMinutes = (order) => {
    if (!order?.isPaused || !order?.pausedUntil) return 0;
    const diffMs = new Date(order.pausedUntil).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.max(1, Math.ceil(diffMs / 60000));
  };
  const urgentRiskCount = orders.filter((o) => o.riskAlert).length;

  const togglePauseBot = async (order) => {
    const chatId = String(order?.chatId || '').trim();
    if (!chatId) return;
    const currentlyPaused = getRemainingPauseMinutes(order) > 0;

    setPauseLoadingByChat((prev) => ({ ...prev, [chatId]: true }));
    setErr(null);
    try {
      const route = currentlyPaused ? '/api/dashboard/unpause-bot' : '/api/dashboard/pause-bot';
      const body = currentlyPaused
        ? { chatId }
        : { chatId, durationMinutes: 30 };
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
      const response = await fetch('/api/dashboard/stock/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <header className="border-b border-zinc-800/80 bg-[#0a0a0c]/95 backdrop-blur">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-6 sm:grid-cols-3 sm:items-center">
          <div className="flex items-center sm:justify-start">
            <img
              src="/logo-orion.png"
              alt="Logo Orion"
              className="h-12 w-auto object-contain drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]"
            />
          </div>

          <div className="text-left sm:text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400/90">Orion Peptides</p>
            <h1 className="text-2xl font-bold tracking-tight text-white">Painel de controle</h1>
            <p className="mt-1 text-sm text-zinc-500">Visão operacional integrada ao bot</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <div className="flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-[#151518] px-4 py-2 text-sm text-cyan-200/90">
              <span
                className={`h-2 w-2 rounded-full ${
                  summary?.bot?.online ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-zinc-600'
                }`}
              />
              {loading ? 'Carregando…' : summary?.bot?.label || 'Status'}
            </div>
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
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {err && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            Erro ao carregar dados: {err}. Confirme se o servidor Node está em execuição (porta 3000) e tente
            novamente.
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <Card title="Conversas pausadas">
            <p className="text-3xl font-bold tabular-nums text-cyan-300">
              {loading ? '—' : summary?.pausedConversations ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Silenciadas por intervenção humana</p>
          </Card>
          <Card title="SKUs com estoque baixo">
            <p className="text-3xl font-bold tabular-nums text-orange-300">
              {loading ? '—' : summary?.lowStockSkus ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Quantidade manual menor ou igual a 3</p>
          </Card>
        </section>

        {activeTab === 'conversas' && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">Conversas recentes</h2>
              {urgentRiskCount > 0 && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-200">
                  ⚠️ {urgentRiskCount} conversa(s) com risco clínico — intervir urgente
                </div>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#151518]">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/90 bg-zinc-900/40 text-zinc-400">
                      <th className="px-4 py-3 font-medium">ID</th>
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
                      orders.map((o, idx) => (
                        <tr
                          key={`${o.id || 'session'}-${o.chatId || 'chat'}-${idx}`}
                          className={`hover:bg-zinc-800/30 ${o.riskAlert ? 'bg-red-950/20' : ''}`}
                        >
                          <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-zinc-300">
                            {o.id || '—'}
                          </td>
                          <td className="max-w-[300px] truncate px-4 py-3">
                            <div className="flex items-start gap-2">
                              <img
                                src={o.profilePic && !brokenAvatarByChat[o.chatId] ? o.profilePic : AVATAR_PLACEHOLDER}
                                alt="Avatar do cliente"
                                className="h-10 w-10 rounded-full border border-cyan-400/35 object-cover shadow-[0_0_10px_rgba(34,211,238,0.25)]"
                                onError={() =>
                                  setBrokenAvatarByChat((prev) => ({ ...prev, [o.chatId]: true }))
                                }
                              />
                              <div className="min-w-0">
                                <p
                                  className="truncate text-xs font-semibold text-zinc-200"
                                  title={o.contactName || o.customerName || 'Cliente sem nome'}
                                >
                                  {o.contactName || o.customerName || 'Cliente sem nome'}
                                </p>
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
                                      className="truncate font-mono text-xs text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200"
                                      title="Abrir conversa no WhatsApp Web"
                                    >
                                      {o.contactNumber}
                                    </a>
                                  ) : (
                                    <p className="truncate font-mono text-xs text-zinc-400">{o.chatId || '—'}</p>
                                  )}
                                  <PhoneVerificationBadge verification={o.phoneVerification} />
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-zinc-200">
                            {typeof o.value === 'number' ? fmtMoney(o.value) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={o.journeyStatusLabel} statusKey={o.journeyStatusKey} />
                            {o.riskAlert && (
                              <div className="mt-1">
                                <RiskAlertBadge reason={o.riskReason} />
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(() => {
                              const mins = getRemainingPauseMinutes(o);
                              const paused = mins > 0;
                              const loadingPause = !!pauseLoadingByChat[o.chatId];
                              const successPause = !!pauseSuccessByChat[o.chatId];
                              return (
                                <div className="flex justify-end gap-2">
                                  {o.waLink ? (
                                    <a
                                      href={o.waLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/70 hover:bg-emerald-500/20"
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
                                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                      paused
                                        ? 'border border-red-500/60 bg-red-500/20 text-red-200 hover:border-red-400/80 hover:bg-red-500/30'
                                        : 'border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-500/20'
                                    }`}
                                  >
                                    {loadingPause && (
                                      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-r-transparent" />
                                    )}
                                    {!loadingPause && successPause && <span className="text-emerald-300">✓</span>}
                                    {!loadingPause && !successPause && paused && `BOT SILENCIADO (${mins} min)`}
                                    {!loadingPause && !successPause && !paused && 'Intervenção humana'}
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'catalogo' && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-white">Catálogo (SKUs e preços)</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Dados espelhados de <span className="font-mono text-zinc-400">catalogo-unificado.js</span> via API.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {loading && (
                <p className="col-span-full text-zinc-500">Carregando catálogo…</p>
              )}
              {!loading &&
                catalog.map((item) => (
                  <div
                    key={item.sku}
                    className="rounded-xl border border-zinc-800/80 bg-[#151518] p-4 transition hover:border-cyan-500/25"
                  >
                    <p className="font-mono text-xs text-cyan-400/90">{item.sku}</p>
                    <p className="mt-1 font-semibold text-white">
                      {item.nome}{' '}
                      <span className="font-normal text-zinc-400">{item.dosagem}</span>
                    </p>
                    <p className="mt-2 text-lg font-semibold text-emerald-400/95">{item.preco}</p>
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        Estoque manual
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={stockDraftBySku[item.sku] ?? String(Number(item.stockQuantity ?? 0))}
                          onChange={(e) =>
                            setStockDraftBySku((prev) => ({ ...prev, [item.sku]: e.target.value }))
                          }
                          className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-cyan-500/60"
                        />
                        <button
                          type="button"
                          onClick={() => saveStock(item.sku)}
                          disabled={!!stockSavingBySku[item.sku]}
                          className="rounded-md border border-cyan-500/45 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/70 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {stockSavingBySku[item.sku] ? 'Salvando…' : stockSavedBySku[item.sku] ? '✓ Salvo' : 'Salvar'}
                        </button>
                        <span className="text-[11px] text-zinc-500">Atual: {Number(item.stockQuantity ?? 0)}</span>
                      </div>
                    </div>
                    {item.categoria && (
                      <p className="mt-2 text-xs text-zinc-500">{item.categoria}</p>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-zinc-800/60 py-6 text-center text-xs text-zinc-600">
        Orion Peptides — painel interno
      </footer>
    </div>
  );
}
