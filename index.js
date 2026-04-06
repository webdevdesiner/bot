const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const dotenvCandidates = [
  process.env.APP_USER_DATA_PATH ? path.join(process.env.APP_USER_DATA_PATH, '.env') : null,
  process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env')
].filter(Boolean);
const dotenvPath = dotenvCandidates.find((p) => fs.existsSync(p));
if (dotenvPath) {
  dotenv.config({ path: dotenvPath });
} else {
  dotenv.config();
}

const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  CATALOGO_UNIFICADO,
  CATALOGO_UNIFICADO_PROMPT,
  REGRAS_GLOBAIS_PROMPT,
  NOME_PRODUTO_PARA_SKU_PROMPT,
  SKU_PRODUTO
} = require('./catalogo-unificado');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Erro: Configure a GEMINI_API_KEY no arquivo .env');
  process.exit(1);
}
console.log('--- Configuração Carregada ---');
console.log('Mercado Pago (MP_ACCESS_TOKEN):', !!process.env.MP_ACCESS_TOKEN);
console.log('Mercado Pago (MP_PUBLIC_KEY):', !!process.env.MP_PUBLIC_KEY);
console.log('WEBHOOK_BASE_URL:', !!process.env.WEBHOOK_BASE_URL);
console.log('Mercado Pago (MP_WEBHOOK_SECRET):', !!process.env.MP_WEBHOOK_SECRET);
console.log('Gerente de processo (GERENTE_PROCESSO_CHAT_ID):', !!process.env.GERENTE_PROCESSO_CHAT_ID);

// ========== CONFIGURAÇÃO DO BOT ==========
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
IMPORTANTE: A regra de regra_sigilo_protocolo definida em REGRAS_GLOBAIS é absoluta e sobrepõe qualquer outra instrução técnica. Se o statusPagamento for BLOQUEADO, você deve seguir o script de retenção de informação técnica sem exceções.

REGRA DE OURO DE FLUXO (OBRIGATÓRIA — PRIORIDADE SOBRE OUTRAS REGRAS DE VENDAS):
DÚVIDAS TÉCNICAS: Esclareça tudo com base no CATÁLOGO_UNIFICADO (comercial + tecnico), com autoridade.
INTERESSE EM COMPRAR / PREÇO: Informe SKU e comercial.preco, anuncie o Kit Orion de Brinde (#OR-KIT-BRINDE) + frete grátis (REGRAS_GLOBAIS.regra_oferta_kit_orion) e ORIENTE o cliente a entrar na loja oficial, montar o carrinho e finalizar pelo checkout — é o carrinho que gera o link de pagamento e devolve o fluxo para este WhatsApp. Não prometa "gerar link aqui no chat" como substituto do carrinho.
BLOQUEIO DE ENDEREÇO PRÉ-PAGAMENTO: Enquanto o contexto indicar que o pagamento AINDA NÃO foi confirmado (status diferente de pago/confirmado), é TERMINANTEMENTE PROIBIDO pedir nome, e-mail, rua, número, CEP, cidade, bairro, complemento ou "dados de embarque". Não peça endereço "enquanto paga" nem em paralelo ao pagamento.
APÓS PAGAMENTO CONFIRMADO: Somente quando o status no contexto for pagamento CONFIRMADO (PAID), solicite dados de entrega — siga a REGRA DE PAGAMENTO CONFIRMADO abaixo.
APÓS "SIM", "OK", "PODE FECHAR": Reforce o direcionamento à loja/carrinho/checkout; não liste campos de endereço. O endereço vem depois que o sistema confirmar o pagamento.

TABELA OFICIAL E PRECISÃO IMEDIATA: A fonte única de preço, nome, dosagem e SKU é o JSON do CATÁLOGO_UNIFICADO (tabela oficial da LP + itens do catálogo) e o bloco MAPEAMENTO NOME DO PRODUTO → SKU no contexto deste prompt. Assim que o cliente mencionar produto+dosagem (ex.: "Tirzepatide 20", "Tirzepatide 20mg"), associe na hora: SKU #OR-2026-028, comercial.preco R$ 800,00 — sem adivinhar nem consultar "conhecimento externo". Nunca invente valores nem SKUs.

TOM DE CONSULTOR DE ELITE: Menos "atendente de formulário", mais consultor estratégico. Se o pagamento já estiver confirmado e o cliente mandar endereço incompleto, complete a coleta com naturalidade. Antes do pagamento confirmado, não inicie coleta de endereço.

VOCÊ É O CONSULTOR DE LOGÍSTICA DA ORION PEPTIDES.
MANTENHA SEMPRE UM TOM PROFISSIONAL, EDUCADO E DIRETO.

MENSAGENS ENXUTAS: Evite textos cansativos. Prefira poucos parágrafos curtos ou lista com "-". Objetivo primeiro; detalhe só se o cliente pedir.

REGRAS DE COMPORTAMENTO:
ACOLHIMENTO: Na abertura, valide dor/objetivo sem parecer catálogo automático. Depois que produto E dosagem estiverem escolhidos, confira preço e SKU com confiança usando somente o CATÁLOGO_UNIFICADO.
AUTORIDADE ORION: Mencione sempre a "pureza laboratorial" ou "padrão ouro" da Orion.
FOLLOW-UP: NUNCA termine de forma passiva. Termine com UMA pergunta clara (pode ser gancho: "Quer comparar dosagens ou seguir para o carrinho?").
FORMATAÇÃO WHATSAPP: Use APENAS as formatações do WhatsApp: *texto* para negrito e _texto_ para itálico. PROIBIDO USAR TAGS HTML. Para listas, use apenas o símbolo de traço (-).
LIMITAÇÃO: Responda apenas sobre os SKUs presentes no CATÁLOGO_UNIFICADO (objeto comercial + técnico por SKU). Produto fora do catálogo? Diga que não trabalha com o item.
Se o cliente ainda estiver com dúvidas técnicas mesmo após o início do fluxo de vendas, responda de forma simples e direta sobre o benefício do produto antes de reforçar o link do carrinho.
Você tem acesso total aos blocos comercial e tecnico de cada SKU no CATÁLOGO_UNIFICADO. Se o cliente fizer uma pergunta técnica enquanto estiver no fluxo de compra, NÃO mude o setor e NÃO chame o humano. Responda a dúvida de forma clara e direta usando esses dados e, em seguida, retome gentilmente para o fechamento do pedido.
Confirmar definições biológicas (como "TB-500 é Timosina") é considerado suporte de vendas informativo, não consulta médica. Responda prontamente usando o CATÁLOGO_UNIFICADO (bloco tecnico do SKU correspondente).

REGRA DE ALTERAÇÃO DE PEDIDO E CARRINHO (ESTRITAMENTE OBRIGATÓRIA):
Você NÃO PODE gerar links de pagamento por conta própria. Se o cliente pedir para alterar o pedido (adicionar mais produtos, remover itens ou mudar dosagens), você deve elogiar a escolha, recalcular o valor total, mas OBRIGATORIAMENTE pedir para ele refazer o carrinho no site.
NUNCA use formato de link Markdown como [texto](url). No WhatsApp, envie somente URL pura.
Use esta orientação com este link exato:
"Para garantir a segurança total da sua transação e gerar o link com os itens atualizados, nossos pedidos são criptografados diretamente pelo carrinho. Por favor, acesse rapidamente https://green-koala-180415.hostingersite.com/, monte seu protocolo atualizado e clique em finalizar. O sistema vai me mandar os dados aqui e eu gero seu link de pagamento na hora!"

REGRA DE LINK DE COMPRA (SEM ALTERAÇÃO DE PEDIDO):
Se o cliente pedir apenas o link para comprar, finalizar ou montar pedido, responda direto e curto com a URL pura do carrinho:
https://green-koala-180415.hostingersite.com/

REGRA DE PAGAMENTO CONFIRMADO: 
Se o status do pagamento no contexto for CONFIRMADO, NUNCA peça comprovante. Apenas conduza objetivamente para coletar os dados de entrega faltantes.

ENCERRAMENTO DO FLUXO:
Se o fluxo de endereço foi concluído e o cliente confirmou que está tudo certo, não ofereça mais ajuda proativamente. Apenas agradeça e informe que o próximo contato será para o envio do rastreio.

TRANSBORDO TÉCNICO:
Se o cliente fizer uma pergunta técnica que você não sabe responder ou que exija supervisão médica (como misturas, dosagens específicas ou efeitos colaterais graves), responda EXATAMENTE assim: "Essa é uma excelente pergunta técnica. Para sua segurança, vou encaminhar esse ponto agora mesmo para o nosso especialista responsável, que te dará o suporte detalhado em instantes. Um momento, por favor."
`.trim();

const promptTecnico = `
IMPORTANTE: A regra de regra_sigilo_protocolo definida em REGRAS_GLOBAIS é absoluta e sobrepõe qualquer outra instrução técnica. Se o statusPagamento for BLOQUEADO, você deve seguir o script de retenção de informação técnica sem exceções.

TRANSIÇÃO SILENCIOSA PARA VENDAS (MANDATÓRIO):
Se o cliente demonstrar intenção de compra, aceitar um valor/orçamento, pedir para fechar, perguntar preço para comprar, ou confirmar fechamento com termos como "Sim", "Ok", "Pode ser" em contexto de compra, responda normalmente ao cliente e inclua ao FINAL da mensagem a linha com a tag exata [VENDAS] (ou [MUDAR_PARA_VENDAS], equivalente). O cliente não deve ler explicações sobre mudança de setor.
É proibido dizer que vai encaminhar para outro setor, departamento ou pessoa — o sistema troca para vendas automaticamente e de forma imediata.

Você é o Especialista Técnico da Orion Peptides, com tom científico, sério e acessível.
Você deve soar como um bioquímico da Orion Peptides.

OBJETIVIDADE (WhatsApp): Respostas curtas e escaneáveis. Priorize 2 a 4 frases ou poucos tópicos com "-". Evite blocos longos e repetição. Entregue o núcleo da resposta já no início. Ao final, UMA pergunta-gancho para o cliente escolher o próximo passo (ex.: "Quer que eu detalhe reconstituição, comparação com outro SKU ou só os números de protocolo?"). Só aprofunde se o cliente pedir explicitamente "detalhe", "explica melhor" ou "passo a passo".

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
  const baseUrl = String(process.env.WEBHOOK_BASE_URL || '').replace(/\/+$/, '');
  if (!token || !baseUrl || !chatId) {
    console.error('[Mercado Pago] MP_ACCESS_TOKEN, WEBHOOK_BASE_URL ou chatId ausente.');
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
    external_reference: `chat_${chatId}`,
    notification_url: notificationUrl
  };

  try {
    const { data } = await axios.post(MP_PREFERENCES_URL, payload, mercadoPagoAxiosConfig());
    const initPoint = data?.sandbox_init_point || null;
    const preferenceId = data?.id ?? null;
    return { initPoint, preferenceId };
  } catch (err) {
    console.error('[Mercado Pago] Falha ao criar preferência:', err.response?.status, err.response?.data || err.message);
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

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }, { apiVersion: 'v1beta' });

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
    riskAlert: false,
    riskReason: null,
    riskAt: null,
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
      risk_alert INTEGER DEFAULT 0,
      risk_reason TEXT,
      risk_at TEXT,
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
    ALTER TABLE sessions ADD COLUMN risk_alert INTEGER DEFAULT 0;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN risk_reason TEXT;
  `).catch(() => {});
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN risk_at TEXT;
  `).catch(() => {});
}

function parseMessageHistory(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch {
    return [];
  }
}

async function saveSession(chatId, sessionData) {
  const s = {
    ...createDefaultSession(),
    ...(sessionData || {}),
    dadosEntrega: {
      ...createDefaultSession().dadosEntrega,
      ...((sessionData && sessionData.dadosEntrega) || {})
    },
    messageHistory: Array.isArray(sessionData?.messageHistory) ? sessionData.messageHistory.slice(-20) : []
  };
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO sessions (
      chat_id, last_order, last_link, payment_status, last_payment_id,
      delivery_notified, payment_welcome_sent, delivery_flow_closed, setor_atual,
      message_history, contact_name, phone_number, phone_source, profile_pic, lp_link_sent_at, risk_alert, risk_reason, risk_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      risk_alert=COALESCE(excluded.risk_alert, sessions.risk_alert),
      risk_reason=COALESCE(excluded.risk_reason, sessions.risk_reason),
      risk_at=COALESCE(excluded.risk_at, sessions.risk_at),
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
      s.riskAlert ? 1 : 0,
      s.riskReason || null,
      s.riskAt || null,
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
    riskAlert: !!row.risk_alert,
    riskReason: row.risk_reason || null,
    riskAt: row.risk_at || null,
    setorAtual: row.setor_atual || null,
    messageHistory: parseMessageHistory(row.message_history)
  };
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

async function getChatIdByPaymentId(paymentId) {
  if (!paymentId) return null;
  const row = await db.get('SELECT chat_id FROM payment_data WHERE payment_id = ?', [paymentId]);
  return row?.chat_id || null;
}

async function appendMessageHistory(chatId, role, text) {
  const normalized = String(text || '').trim();
  if (!normalized) return;
  const session = await getOrCreateSession(chatId);
  const history = Array.isArray(session.messageHistory) ? session.messageHistory : [];
  const updatedHistory = [...history, { role, text: normalized, at: new Date().toISOString() }].slice(-20);
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
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const alerta = `⚠️ ALERTA TRANSBORDO: O cliente ${chatId} precisa de suporte humano/técnico. Motivo: ${motivo}.`;

  try {
    if (!adminChatId) {
      console.log(`[Transbordo] ADMIN_CHAT_ID inválido. Alerta pendente: ${alerta}`);
      return;
    }
    await safeSendMessage(adminChatId, alerta, 'notificarFernandoTransbordo');
    console.log('[Transbordo] Alerta enviado ao admin.');
  } catch (err) {
    console.error('[Transbordo Error] Falha ao notificar admin:', err?.message || err);
  }
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
  const normalized = String(text || '').toLowerCase();
  return (
    normalized.includes('quero comprar') ||
    normalized.includes('como eu pago') ||
    normalized.includes('manda o link') ||
    normalized.includes('manda o pix') ||
    normalized.includes('gera o link') ||
    normalized.includes('gerar o link')
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
    const result = await model.generateContent(promptExtracaoApi);
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
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: promptApi }, { inlineData: { mimeType: media.mimetype, data: media.data } }] }]
  });
  const raw = (result.response?.text?.() || '').trim();
  console.log('[Áudio] Resposta bruta Gemini (debug interno):', raw);
  if (!raw || /^vazio$/i.test(raw)) return '';
  return raw;
}

// ========== INICIALIZAÇÃO WHATSAPP ==========
let whatsappClientReady = false;
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

function startWhatsAppHealthMonitor() {
  if (whatsappMonitorStarted) return;
  whatsappMonitorStarted = true;
  setInterval(async () => {
    try {
      const rawState = await client.getState();
      const state = String(rawState || 'UNKNOWN').toUpperCase();
      whatsappConnectionState = state;
    } catch (err) {
      setWhatsAppError(err, 'monitor_getState');
    }
  }, 10000);
}

/** Pós-PAID: mesma cópia no handler de mensagens e no webhook Mercado Pago. */
const MSG_BOAS_VINDAS_POS_PAGAMENTO =
  '✅ Pagamento Confirmado! Pagamento processado com sucesso em nosso Gateway Internacional. Agora, para garantirmos a agilidade no seu envio, por favor, confirme os dados para a Documentação de Embarque (Shipping Address) — Nome, Rua, Número, CEP e Cidade.';

const ROTEIRO_CARRINHO_VENDAS =
  'Para escolher seu protocolo, acesse nossa página oficial: https://green-koala-180415.hostingersite.com/ -- Após escolher, basta me mandar um "Pronto" aqui para gerarmos seu pedido e link de pagamento.';

function appendRoteiroCarrinhoSeNecessario(texto) {
  const t = String(texto || '').trim();
  if (!t) return t;
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

async function sendHumanizedMessage(chatId, text) {
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    // Delay de 3 a 5 segundos para simular humano digitando
    const delay = Math.floor(Math.random() * (5000 - 3000 + 1) + 3000);
    await new Promise(resolve => setTimeout(resolve, delay));
    const textoCliente = expandBrandTokensForWhatsApp(text);
    if (/green-koala-180415\.hostingersite\.com/i.test(textoCliente)) {
      await db.run(
        'UPDATE sessions SET lp_link_sent_at = COALESCE(lp_link_sent_at, ?), updated_at = ? WHERE chat_id = ?',
        [new Date().toISOString(), new Date().toISOString(), chatId]
      );
    }
    let sent = await safeSendMessage(chatId, textoCliente, 'sendHumanizedMessage');
    if (!sent && /@lid$/i.test(String(chatId || ''))) {
      const session = await getOrCreateSession(chatId);
      const fallbackChatId = session?.phoneNumber ? `${String(session.phoneNumber).replace(/\D/g, '')}@c.us` : null;
      if (fallbackChatId) {
        pushDebugLog('warn', `[whatsapp-fallback] tentando envio alternativo ${chatId} -> ${fallbackChatId}`);
        sent = await safeSendMessage(fallbackChatId, textoCliente, 'sendHumanizedMessage_fallback_cus');
      }
    }
    if (sent) {
      await appendMessageHistory(chatId, 'assistant', textoCliente);
    } else {
      pushDebugLog('error', `[whatsapp-send-failed] não foi possível enviar mensagem para ${chatId}`);
    }
  } catch (err) {
    console.error('Erro ao enviar mensagem humanizada:', err);
    setWhatsAppError(err, 'sendHumanizedMessage');
  }
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
  const chatId = msg?.from || '';
  if (!chatId) return;

  // Ignora status, canais e newsletters para evitar crash no getChat()
  if (chatId === 'status@broadcast' || chatId.endsWith('@newsletter')) return;

  const rawBody = typeof msg?.body === 'string' ? msg.body : '';
  let userMessage = rawBody.trim();
  if (!userMessage && !msg.hasMedia) return;

  let session = await getOrCreateSession(chatId);
  const contactMeta = await resolveContactMetaFromMessage(msg);
  if (contactMeta.phoneNumber || contactMeta.contactName || contactMeta.phoneSource || contactMeta.profilePic) {
    session = await updateSession(chatId, {
      phoneNumber: contactMeta.phoneNumber || session.phoneNumber || null,
      contactName: contactMeta.contactName || session.contactName || null,
      phoneSource: contactMeta.phoneSource || session.phoneSource || null,
      // URL é atualizada a cada nova mensagem quando disponível (mantém foto "fresca").
      profilePic: contactMeta.profilePic || session.profilePic || null
    });
  }
  const now = Date.now();
  const pauseUntilMs = session.pausedUntil ? new Date(session.pausedUntil).getTime() : 0;
  if (session.isPaused && pauseUntilMs > now) {
    const mins = Math.max(1, Math.ceil((pauseUntilMs - now) / 60000));
    console.log(`[Pausa Bot] Silenciado para ${chatId}. Restante: ${mins} min.`);
    return;
  }
  if (session.isPaused && (!pauseUntilMs || pauseUntilMs <= now)) {
    await db.run('UPDATE sessions SET isPaused = 0, pausedUntil = NULL WHERE chat_id = ?', [chatId]);
    session = { ...session, isPaused: false, pausedUntil: null };
  }

  // --- ÁUDIO: só transcreve (logs no servidor); resposta ao cliente = mesmo fluxo de texto abaixo ---
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    if (media && media.mimetype.includes('audio')) {
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

  await appendMessageHistory(chatId, 'user', userMessage);

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

  // Trava determinística: com pedido pendente, não regressa para "montar carrinho".
  if (session.paymentStatus === 'PENDING' && isPendingPaymentFollowup(userMessage)) {
    const linkExtra = session.lastLink ? `\n\nSe precisar, segue novamente o link do pagamento:\n${session.lastLink}` : '';
    await sendHumanizedMessage(
      chatId,
      `Perfeito, já localizei seu pedido. No momento ele está como *aguardando confirmação* no gateway de pagamento.\n\nAssim que a aprovação cair no sistema, eu te aviso aqui automaticamente para seguir com os dados de envio.${linkExtra}`
    );
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
  const normalizedMessage = userMessage.toUpperCase();
  if (normalizedMessage.includes('NOVO PROTOCOLO') && normalizedMessage.includes('TOTAL')) {
    const totalMatch = userMessage.match(/Total:?\s*R\$\s*([\d.,]+)/i);
    let valorTotal = 0;
    if (totalMatch && totalMatch[1]) {
      const limpo = totalMatch[1].replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
      valorTotal = parseFloat(limpo) || 0;
    }

    let linkPagamento = 'https://orionpeptideos.com/contato/';
    let invoiceUrl = null;
    let paymentId = null;

    if (valorTotal > 0) {
      const paymentResult = await criarPagamentoMercadoPago(valorTotal, chatId);
      if (paymentResult?.initPoint) {
        invoiceUrl = paymentResult.initPoint;
        linkPagamento = invoiceUrl;
      }
      if (paymentResult?.preferenceId) {
        paymentId = paymentResult.preferenceId;
        await setPaymentSession(paymentId, chatId, { status: 'PENDING', value: valorTotal, invoiceUrl });
      }
    }

    const respostaCheckout = `Excelente escolha! Seu protocolo foi recebido e os itens já estão reservados. 🧬\n\nGeramos um link de pagamento seguro exclusivo para o seu pedido. Você pode pagar via Pix ou Cartão aqui:\n\n${linkPagamento}\n\nAssim que o pagamento for aprovado, o sistema me avisa por aqui!`;
    await sendHumanizedMessage(chatId, respostaCheckout);

    // Decodifica para o Admin
    let decodedMessage = userMessage;
    for (const [sku, name] of Object.entries(SKU_PRODUTO)) {
      decodedMessage = decodedMessage.split(sku).join(`*${name}*`);
    }

    await saveSession(chatId, {
      lastOrder: decodedMessage,
      lastLink: invoiceUrl,
      paymentStatus: 'PENDING',
      lastPaymentId: paymentId,
      dadosEntrega: { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' },
      deliveryNotified: false,
      paymentWelcomeSent: false,
      deliveryFlowClosed: false,
      contactName: session.contactName || null,
      phoneNumber: session.phoneNumber || null,
      phoneSource: session.phoneSource || null,
      profilePic: session.profilePic || null,
      setorAtual: 'VENDAS',
      messageHistory: []
    });

    // Notificação administrativa de nova venda → gerente de processo (ou admin se não configurado)
    const gerenteProcessoChatId = process.env.GERENTE_PROCESSO_CHAT_ID || process.env.ADMIN_CHAT_ID;
    if (gerenteProcessoChatId) {
      const adminReport = `🚨 *NOVA VENDA INICIADA!* 🚨\n\n*Cliente:* ${msg._data.notifyName || chatId}\n\n*Pedido:*\n${decodedMessage}\n\n*Link:* ${linkPagamento}`;
      await safeSendMessage(gerenteProcessoChatId, adminReport, 'nova-venda-iniciada');
    }
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
      const extraidos = await extractDadosEntregaComGemini(userMessage, dadosAntes);
      const dadosDepois = mergeDadosEntrega(dadosAntes, extraidos);

      const camposNovos = CAMPOS_ENTREGA.filter((campo) => !String(dadosAntes[campo] || '').trim() && String(dadosDepois[campo] || '').trim());
      if (camposNovos.length > 0) {
        await updateSession(chatId, { dadosEntrega: dadosDepois });

        const faltantes = getMissingDeliveryFields(dadosDepois);
        if (faltantes.length === 0) {
          const updated = await updateSession(chatId, { deliveryNotified: session.deliveryNotified });
          if (!updated.deliveryNotified) {
            const adminChatId = process.env.ADMIN_CHAT_ID;
            if (adminChatId) {
              const enderecoFormatado = [
                `Nome: ${dadosDepois.nome}`,
                `Rua: ${dadosDepois.rua}`,
                `Número: ${dadosDepois.numero}`,
                `Bairro: ${dadosDepois.bairro || 'N/I'}`,
                `CEP: ${dadosDepois.cep}`,
                `Cidade: ${dadosDepois.cidade}`
              ].join('\n');
              await safeSendMessage(
                adminChatId,
                `📦 *ENDEREÇO RECEBIDO!* Cliente: ${msg._data.notifyName || chatId}\n${enderecoFormatado}`,
                'endereco-recebido-admin'
              );
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
    await chat.sendStateTyping();
  } catch (err) {
    console.warn('[Chat Warning] Falha ao obter chat/typing. Mensagem será processada sem typing:', err?.message || err);
  }

  const contextoPedido = session.lastOrder ? `\n--- PEDIDO ATUAL ---\nItens: ${session.lastOrder}\nLink: ${session.lastLink}` : '';
  const dadosEntregaContexto = session.dadosEntrega
    ? `\n--- DADOS DE ENTREGA (PARCIAL) ---\n${JSON.stringify(session.dadosEntrega)}`
    : '';
  const historicoRecenteContexto = Array.isArray(session.messageHistory) && session.messageHistory.length > 0
    ? `\n--- HISTÓRICO RECENTE ---\n${session.messageHistory
        .slice(-8)
        .map((m) => `${m.role === 'assistant' ? 'BOT' : 'CLIENTE'}: ${m.text}`)
        .join('\n')}`
    : '';
  let setorAtivo = session.setorAtual || 'TECNICO';
  const promptSetorAtivo = setorAtivo === 'TECNICO' ? promptTecnico : promptVendas;
  const statusPagamento = session.paymentStatus === 'PAID' ? 'LIBERADO' : 'BLOQUEADO';
  const catalogoUnificadoContexto = `\n--- CATÁLOGO_UNIFICADO (JSON: comercial + tecnico por SKU) ---\n${CATALOGO_UNIFICADO_PROMPT}\n--- REGRAS_GLOBAIS (JSON) ---\n${REGRAS_GLOBAIS_PROMPT}\n--- MAPEAMENTO NOME DO PRODUTO (LP/WHATSAPP) → SKU ---\n${NOME_PRODUTO_PARA_SKU_PROMPT}`;
  const faltantesEntregaNoPrompt = getMissingDeliveryFields(session.dadosEntrega || { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' });
  const instrucaoPosCadastroConcluido = session.paymentStatus === 'PAID' && faltantesEntregaNoPrompt.length === 0
    ? `\n--- INSTRUÇÃO EXTRA PÓS-CADASTRO ---\nO cadastro de endereço já foi finalizado com sucesso. Se o cliente perguntar qual é o endereço, confirme os dados que temos de forma organizada:\nNome: ${session.dadosEntrega?.nome || ''}\nRua: ${session.dadosEntrega?.rua || ''}\nNúmero: ${session.dadosEntrega?.numero || ''}\nCEP: ${session.dadosEntrega?.cep || ''}\nCidade: ${session.dadosEntrega?.cidade || ''}\nBairro: ${session.dadosEntrega?.bairro || 'N/I'}\nSe ele apenas agradecer ou fizer um comentário aleatório, seja breve e profissional.`
    : '';
  const statusPagamentoDescricao =
    session.paymentStatus === 'PAID' ? 'O pagamento já foi CONFIRMADO.' : 'O pagamento AINDA NÃO foi confirmado.';
  const contextoStatusPagamentoCliente = `\n--- STATUS DE PAGAMENTO DESTE CLIENTE (SIGILO DE PROTOCOLO) ---\nstatusPagamento: ${statusPagamento}\n(LIBERADO = pagamento confirmado no sistema; BLOQUEADO = ainda não confirmado. Aplique REGRAS_GLOBAIS.regra_sigilo_protocolo.)\n`;

  const prompt = `
  --- BASE DE DADOS ---
  ${catalogoUnificadoContexto}
  --- PROMPT DO SETOR ---
  ${promptSetorAtivo}
  ${contextoPedido}
  ${dadosEntregaContexto}
  ${contextoStatusPagamentoCliente}
  ${historicoRecenteContexto}
  ${instrucaoPosCadastroConcluido}
  --- STATUS ---
  ${statusPagamentoDescricao}
  MENSAGEM DO CLIENTE: ${userMessage}
  `;

  const promptParaApi = scrubForExternalLLM(`${prompt}\n${GEMINI_TOKEN_INSTRUCAO}`);

  try {
    const result = await model.generateContent(promptParaApi);
    let text = result.response.text();
    if (text) {
      const tinhaTagVendas = text.includes('[MUDAR_PARA_VENDAS]') || text.includes('[VENDAS]');
      if (tinhaTagVendas) {
        text = text.replace(/\[MUDAR_PARA_VENDAS\]/g, '').replace(/\[VENDAS\]/g, '').trim();
        text = appendRoteiroCarrinhoSeNecessario(text);
        await updateSession(chatId, { setorAtual: 'VENDAS' });
        setorAtivo = 'VENDAS';
        logBotEmAtendimento(chatId, 'VENDAS', 'transicao-tecnico-para-vendas-tag');
      } else if (setorAtivo === 'TECNICO' && hasStrongPurchaseSignal(userMessage)) {
        text = appendRoteiroCarrinhoSeNecessario(text);
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
      // Limpa asteriscos soltos que o Gemini às vezes gera
      text = text.replace(/\*\*/g, '*'); 
      await sendHumanizedMessage(chatId, text);
    }
  } catch (err) {
    console.error('[Gemini Error]:', err);
  }
});

// ========== EXPRESS & WEBHOOK MERCADO PAGO ==========
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    const catalogSkus = Object.keys(CATALOGO_UNIFICADO || {});
    const lowStockSkus = catalogSkus.filter((sku) => Number(stockBySku[sku] ?? 0) <= 3).length;

    return res.json({
      ok: true,
      totalSalesToday: Number(totalTodayRow?.total ?? 0),
      activeConversations: Number(activeRow?.n ?? 0),
      pendingPayments: {
        count: Number(pendingRow?.n ?? 0),
        totalValue: Number(pendingRow?.total ?? 0)
      },
      riskAlerts: Number(riskAlertsRow?.n ?? 0),
      paidWithoutAddress: Number(paidWithoutAddressRow?.n ?? 0),
      pausedConversations: Number(pausedRow?.n ?? 0),
      lowStockSkus,
      bot: {
        online: whatsappClientReady || whatsappClientAuthenticated,
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
        s.lp_link_sent_at AS catalogLinkSentAt,
        COALESCE(s.risk_alert, 0) AS riskAlert,
        s.risk_reason AS riskReason,
        s.risk_at AS riskAt,
        s.payment_status AS sessionPaymentStatus,
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
       LIMIT 200`
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

      let journeyStatusKey = 'NEW_CHAT';
      let journeyStatusLabel = 'Novo contato';
      if (hasOrder && paymentStatus !== 'PAID') {
        journeyStatusKey = 'WAITING_PAYMENT';
        journeyStatusLabel = 'Aguardando pagamento';
      } else if (paymentStatus === 'PAID' && !hasDeliveryCore) {
        journeyStatusKey = 'PAID';
        journeyStatusLabel = 'Pagamento aprovado';
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
        status: paymentStatus || null,
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

      consolidatedMap.set(dedupeKey, {
        ...newest,
        chatId: newest.chatId || oldest.chatId,
        id: newest.id || oldest.id,
        lastOrder: newest.lastOrder || oldest.lastOrder,
        lastPaymentId: newest.lastPaymentId || oldest.lastPaymentId,
        customerName: newest.customerName || oldest.customerName || null,
        contactName: newest.contactName || oldest.contactName || null,
        profilePic: newest.profilePic || oldest.profilePic || null,
        waLink: newest.waLink || oldest.waLink || null,
        riskAlert: !!(current.riskAlert || item.riskAlert),
        riskReason: newest.riskReason || oldest.riskReason || null,
        riskAt: newest.riskAt || oldest.riskAt || null,
        isPaused: Number(current.isPaused || 0) === 1 || Number(item.isPaused || 0) === 1 ? 1 : 0,
        pausedUntil:
          itemPauseTs >= currentPauseTs
            ? (item.pausedUntil || current.pausedUntil || null)
            : (current.pausedUntil || item.pausedUntil || null),
        phoneVerification:
          current.phoneVerification === 'VERIFIED' || item.phoneVerification === 'VERIFIED'
            ? 'VERIFIED'
            : (newest.phoneVerification || oldest.phoneVerification || null)
      });
    }

    const consolidated = Array.from(consolidatedMap.values()).sort((a, b) => {
      if (a.riskAlert !== b.riskAlert) return a.riskAlert ? -1 : 1;
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

app.get('/api/dashboard/catalog', (req, res) => {
  db.all('SELECT sku, quantity FROM stock_data')
    .then((stockRows) => {
      const stockBySku = Object.fromEntries(
        (stockRows || []).map((r) => [String(r.sku || '').trim(), Number(r.quantity ?? 0)])
      );
      const items = Object.entries(CATALOGO_UNIFICADO).map(([sku, row]) => ({
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

app.post('/api/dashboard/pause-bot', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    const durationMinutes = Number(req.body?.durationMinutes);
    if (!chatId || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ ok: false, error: 'chatId e durationMinutes são obrigatórios' });
    }

    const pausedUntil = new Date(Date.now() + durationMinutes * 60000).toISOString();
    await getOrCreateSession(chatId);
    await db.run(
      'UPDATE sessions SET isPaused = 1, pausedUntil = ?, updated_at = ? WHERE chat_id = ?',
      [pausedUntil, new Date().toISOString(), chatId]
    );
    return res.json({ ok: true, chatId, isPaused: true, pausedUntil });
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

  await saveSession(chatIdFromPayment, { ...session, paymentStatus: 'PAID', paymentWelcomeSent: true });
  await setPaymentSession(mpPaymentId, chatIdFromPayment, {
    status: 'PAID',
    value: valorPago,
    invoiceUrl: session.lastLink || null
  });

  if (!jaEnviouBoasVindasPagamento) {
    await sendHumanizedMessage(chatIdFromPayment, MSG_BOAS_VINDAS_POS_PAGAMENTO);
  }

  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (adminChatId) {
    await safeSendMessage(
      adminChatId,
      `💰 *PAGAMENTO APROVADO!* \nValor: R$ ${valorPago}\nID: ${mpPaymentId}`,
      'pagamento-aprovado-admin'
    );
  }
  console.log(`[Webhook MP] Pagamento aprovado processado | paymentId=${mpPaymentId} | chatId=${chatIdFromPayment}`);
}

app.post('/api/v1/priority-client-update', handleMercadoPagoNotification);

const PORT = Number(process.env.PORT) || 3000;
const DASHBOARD_DIST = path.join(__dirname, 'dashboard', 'dist');
let serverInstance = null;

async function startServer() {
  setWhatsAppEvent('booting');
  await initDatabase();
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
      console.log('[WhatsApp] LocalAuth:', { dataPath: WWEBJS_DATA_ROOT, clientId: WWEBJS_CLIENT_ID });
      console.log('Iniciando o WhatsApp Web Invisível...');
      setWhatsAppEvent('initialize_called');
      startWhatsAppHealthMonitor();
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
  startServer
};