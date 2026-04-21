export default function MissingApiBase() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0c] px-6 py-12 text-center text-zinc-300">
      <h1 className="mb-4 text-xl font-semibold text-white">API do bot não configurada</h1>
      <p className="mb-6 max-w-lg text-sm leading-relaxed text-zinc-400">
        O painel precisa da URL pública do Node (ngrok). Não há mais URL fixa no código — use uma das opções:
      </p>
      <ol className="mb-8 max-w-lg list-decimal space-y-3 text-left text-sm text-zinc-400">
        <li>
          Publique em{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-cyan-300">painel/api-link.json</code>{' '}
          na Hostinger:
          <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs text-emerald-300/95">
            {`{\n  "baseUrl": "https://SEU-SUBDOMINIO.ngrok-free.app"\n}`}
          </pre>
        </li>
        <li>
          Ou crie{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-cyan-300">dashboard/.env</code> com:
          <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs text-emerald-300/95">
            VITE_API_BASE=https://SEU-SUBDOMINIO.ngrok-free.app
          </pre>
          Depois rode <code className="font-mono text-cyan-300">npm run dashboard:build</code> e envie o{' '}
          <code className="font-mono text-zinc-300">dist/</code> de novo.
        </li>
      </ol>
      <p className="max-w-lg text-xs text-zinc-600">
        Com o bot rodando, você pode usar o sync do projeto (sync-link) para atualizar o JSON na Hostinger
        automaticamente quando o ngrok subir.
      </p>
    </div>
  );
}
