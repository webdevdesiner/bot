require('dotenv').config();
const axios = require('axios');
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const BIBLIOTECA_TECNICA_EXTRA = require('./biblioteca-tecnica-orion');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Erro: Configure a GEMINI_API_KEY no arquivo .env');
  process.exit(1);
}
console.log('--- Configuração Carregada ---');
console.log('Asaas API:', !!process.env.ASAAS_API_KEY);
console.log('Asaas Webhook Token:', !!process.env.ASAAS_WEBHOOK_TOKEN);

// ========== CONFIGURAÇÃO DO BOT ==========
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Catálogo estruturado para atualização rápida de preços/produtos.
const PRODUTOS_ORION = {
  '#OR-2026-028': { nome: 'Tirzepatide', dosagem: '20mg', preco: 'R$ 800,00', categoria: 'Emagrecimento', descricaoTecnica: 'Agonista GLP-1/GIP com foco em emagrecimento e controle glicêmico.' },
  '#OR-2026-040': { nome: 'Tirzepatide', dosagem: '40mg', preco: 'R$ 1.500,00', categoria: 'Emagrecimento', descricaoTecnica: 'Alta concentração para protocolos avançados de performance metabólica.' },
  '#OR-2026-060': { nome: 'Tirzepatide', dosagem: '60mg', preco: 'R$ 1.900,00', categoria: 'Emagrecimento', descricaoTecnica: 'Frasco de maior rendimento para protocolos prolongados.' },
  '#OR-2026-025': { nome: 'Retatrutide', dosagem: '10mg', preco: 'R$ 1.100,00', categoria: 'Emagrecimento', descricaoTecnica: 'Agonista triplo com foco em redução de gordura e metabolismo.' },
  '#OR-2026-020-20': { nome: 'Retatrutide', dosagem: '20mg', preco: 'R$ 1.700,00', categoria: 'Emagrecimento', descricaoTecnica: 'Versão de maior concentração para protocolos de alta performance.' },
  '#OR-2026-021': { nome: 'BPC-157', dosagem: '10mg', preco: 'R$ 600,00', categoria: 'Reparação e Recovery', descricaoTecnica: 'Foco em regeneração tecidual e recuperação acelerada.' },
  '#OR-2026-020': { nome: 'TB-500', dosagem: '10mg', preco: 'R$ 600,00', categoria: 'Reparação e Recovery', descricaoTecnica: 'Suporte à recuperação muscular e articular.' },
  '#OR-2026-021-BT': { nome: 'BPC-157 + TB-500', dosagem: '5mg + 5mg', preco: '[A DEFINIR]', categoria: 'Reparação e Recovery', descricaoTecnica: 'Blend para protocolos integrados de recuperação.' },
  '#OR-2026-016': { nome: 'GHK-Cu', dosagem: '50mg', preco: 'R$ 500,00', categoria: 'Reparação e Recovery', descricaoTecnica: 'Peptídeo com foco em reparação e suporte dérmico.' },
  '#OR-2026-KL80': { nome: 'KLOW Blend (Recovery Stack)', dosagem: '80mg', preco: '[A DEFINIR]', categoria: 'Reparação e Recovery', descricaoTecnica: 'Stack orientado para recuperação física ampla.' },
  '#OR-2026-019-CI': { nome: 'CJC-1295 + Ipamorelin', dosagem: '5mg + 5mg', preco: '[A DEFINIR]', categoria: 'Anti-aging e Ganho Muscular', descricaoTecnica: 'Blend com foco em suporte hormonal e composição corporal.' },
  '#OR-2026-015': { nome: 'Tesamorelin', dosagem: '10mg', preco: 'R$ 650,00', categoria: 'Anti-aging e Ganho Muscular', descricaoTecnica: 'Peptídeo para suporte metabólico e performance.' },
  '#OR-2026-018': { nome: 'NAD+', dosagem: '500mg', preco: 'R$ 450,00', categoria: 'Cognitivo e Nootrópicos', descricaoTecnica: 'Foco em energia celular e suporte cognitivo.' },
  '#OR-2026-017': { nome: 'MOTS-C', dosagem: '40mg', preco: 'R$ 1.200,00', categoria: 'Cognitivo e Nootrópicos', descricaoTecnica: 'Peptídeo mitocondrial para energia e performance metabólica.' },
  '#OR-2026-014': { nome: 'Água Estéril', dosagem: '10ml', preco: 'R$ 40,00', categoria: 'Suprimentos', descricaoTecnica: 'Diluente estéril para preparo de peptídeos liofilizados.' }
};

const CATALOGO_ORION_PROMPT = JSON.stringify(PRODUTOS_ORION, null, 2);

const BIBLIOTECA_TECNICA_ORION = {
  'MOTS-C': {
    resumo: "Peptídeo derivado da mitocôndria, conhecido como 'mimético de exercício'. Ativa a via AMPK.",
    beneficios: 'Queima de gordura visceral, melhora da sensibilidade à insulina e resistência física.',
    protocolo_pesquisa: 'Padrão: 5mg (25 unidades) 3x na semana. Manutenção: 5mg a 10mg 1x na semana.',
    reconstituicao: 'Frasco 40mg + 2ml de Água Bacteriostática. NÃO agitar vigorosamente.',
    detalhe_importante: "O 'MOTS-C Sting': é normal sentir ardência ou coceira no local por alguns minutos."
  },
  'GHK-Cu': {
    resumo: 'Padrão ouro da estética regenerativa. Íons de cobre para remodelamento dérmico.',
    beneficios: 'Estimula colágeno em 70%, crescimento capilar e cicatrização pós-cirúrgica.',
    protocolo_pesquisa: 'Iniciante: 1mg (4ui). Padrão: 2mg (8ui). Cicatrização: 3mg (12ui).',
    reconstituicao: 'Frasco 50mg + 2ml de Água. A solução fica Azul Royal intenso. Esperar 15 min para dissolver.',
    detalhe_importante: 'Evitar suplementos de Zinco próximos à aplicação (competem pela absorção).'
  },
  'BPC-157': {
    resumo: 'Composto regenerativo derivado do suco gástrico. Foco em tecidos moles.',
    beneficios: 'Cura de tendões, ligamentos, mucosa gástrica e modulação de inflamação.',
    protocolo_pesquisa: 'Padrão: 250mcg a 500mcg, 2x ao dia.',
    reconstituicao: 'Frasco 5mg + 2ml de Água. 10 unidades = 250mcg.'
  },
  Tirzepatide: {
    resumo: 'Agonista duplo dos receptores GIP e GLP-1.',
    beneficios: 'Controle glicêmico severo e redução drástica de peso (perda de apetite).',
    protocolo_pesquisa: 'Inicial: 2.5mg/semana. Ajustes conforme tolerância até 15mg/semana.',
    reconstituicao: 'Conforme dosagem do frasco (20mg/40mg/60mg) para 1ml ou 2ml.'
  },
  ghk_cu_50mg: {
    nome: 'GHK-Cu 50mg',
    categoria: 'Reparação e Recovery',
    resumo: 'Padrão ouro regenerativo Orion. Peptídeo Azul Royal com foco em reparação avançada.',
    pontosTecnicos: [
      'Apresentação de alta densidade (50mg) para protocolos de regeneração.',
      'Referência de pesquisa em protocolos de 1mg a 5mg.',
      'Após reconstituição, manter sob refrigeração obrigatória (2°C a 8°C).'
    ]
  },
  bpc_157_10mg: {
    nome: 'BPC-157 10mg',
    categoria: 'Reparação e Recovery',
    resumo: 'Foco em regeneração de tecidos, tendões e mucosa gástrica.',
    pontosTecnicos: [
      'Peptídeo de pesquisa para suporte reparador em tecidos moles.',
      'Usado em protocolos de recuperação estrutural e integridade gastrointestinal.'
    ]
  },
  tb_500_10mg: {
    nome: 'TB-500 10mg',
    categoria: 'Reparação e Recovery',
    resumo: 'Suporte de recuperação muscular e mobilidade articular.',
    pontosTecnicos: [
      'Aplicado em pesquisas de reparação e recuperação funcional.',
      'Frequentemente estudado em conjunto com BPC-157.'
    ]
  },
  blend_bpc_tb: {
    nome: 'BPC-157 + TB-500 (5mg + 5mg)',
    categoria: 'Reparação e Recovery',
    resumo: 'Blend de recuperação integrado para protocolos de reparação.',
    pontosTecnicos: [
      'Combina dois peptídeos de recovery em um único frasco.',
      'Foco em protocolos de suporte músculo-tendíneo e regeneração.'
    ]
  },
  tirzepatide: {
    nome: 'Tirzepatide (20mg/40mg/60mg)',
    categoria: 'Emagrecimento',
    resumo: 'Agonista metabólico GLP-1/GIP para pesquisas de emagrecimento e controle glicêmico.',
    pontosTecnicos: [
      'Atuação metabólica dual em protocolos de pesquisa para composição corporal.',
      'Foco em redução de apetite, melhora glicêmica e eficiência metabólica.'
    ]
  },
  retatrutide: {
    nome: 'Retatrutide (10mg/20mg)',
    categoria: 'Emagrecimento',
    resumo: 'Agonista metabólico de nova geração para protocolos de emagrecimento e glicemia.',
    pontosTecnicos: [
      'Aplicado em pesquisas de perda de gordura e modulação metabólica.',
      'Usado em protocolos avançados de controle glicêmico.'
    ]
  },
  nad_plus_500mg: {
    nome: 'NAD+ 500mg',
    categoria: 'Cognitivo e Nootrópicos',
    resumo: 'Suporte à bioenergia celular e desempenho mitocondrial.',
    pontosTecnicos: [
      'Pesquisa voltada para metabolismo energético e longevidade celular.'
    ]
  },
  mots_c_40mg: {
    nome: 'MOTS-C 40mg',
    categoria: 'Cognitivo e Nootrópicos',
    resumo: 'Peptídeo mitocondrial para performance metabólica e energia.',
    pontosTecnicos: [
      'Foco em pesquisas de eficiência metabólica e resistência energética.'
    ]
  },
  tesamorelin_10mg: {
    nome: 'Tesamorelin 10mg',
    categoria: 'Anti-aging e Ganho Muscular',
    resumo: 'Peptídeo para suporte de composição corporal e performance.',
    pontosTecnicos: [
      'Aplicado em protocolos de pesquisa com foco metabólico e físico.'
    ]
  },
  cjc_ipamorelin_blend: {
    nome: 'CJC-1295 + Ipamorelin (5mg + 5mg)',
    categoria: 'Anti-aging e Ganho Muscular',
    resumo: 'Blend de suporte hormonal para pesquisas de composição corporal.',
    pontosTecnicos: [
      'Foco em estudos de recuperação, qualidade de sono e performance.'
    ]
  },
  agua_esteril_10ml: {
    nome: 'Água Estéril 10ml',
    categoria: 'Suprimentos',
    resumo: 'Diluente para reconstituição de peptídeos liofilizados.',
    pontosTecnicos: [
      'Uso auxiliar no preparo técnico dos frascos liofilizados.'
    ]
  },
  protocolo_reconstituicao_oficial: {
    regra: 'Todos os peptídeos Orion são liofilizados e devem ser reconstituídos com Água Bacteriostática.',
    padrao: 'Padrão de diluição: 1ml ou 2ml conforme volume e concentração do frasco.',
    tempo_dissolucao: 'Para frascos densos (ex.: GHK-Cu 50mg), considerar até 15 minutos para dissolução completa.',
    armazenamento: {
      antes: 'Armazenar em local seco e fresco (ou freezer para longa duração).',
      depois: 'Após reconstituição, refrigeração obrigatória entre 2°C e 8°C.'
    }
  },
  seguranca_orion: {
    pureza: 'Padrão Orion >99.8% de pureza laboratorial com certificação.',
    aviso: 'Protocolos de dosagem citados são estritamente para fins de pesquisa e referência da plataforma Orion.'
  },
  ...BIBLIOTECA_TECNICA_EXTRA
};

const BIBLIOTECA_TECNICA_ORION_PROMPT = JSON.stringify(BIBLIOTECA_TECNICA_ORION, null, 2);

const SKU_PRODUTO = {
  '#OR-2026-028': 'Tirzepatide 20mg',
  '#OR-2026-040': 'Tirzepatide 40mg',
  '#OR-2026-060': 'Tirzepatide 60mg',
  '#OR-2026-025': 'Retatrutide 10mg',
  '#OR-2026-020-20': 'Retatrutide 20mg',
  '#OR-2026-021': 'BPC-157 10mg',
  '#OR-2026-020': 'TB-500 10mg',
  '#OR-2026-021-BT': 'BPC-157 + TB-500 (5mg + 5mg)',
  '#OR-2026-016': 'GHK-Cu 50mg',
  '#OR-2026-KL80': 'KLOW Blend 80mg',
  '#OR-2026-019-CI': 'CJC-1295 + Ipamorelin (5mg + 5mg)',
  '#OR-2026-015': 'Tesamorelin 10mg',
  '#OR-2026-018': 'NAD+ 500mg',
  '#OR-2026-017': 'MOTS-C 40mg',
  '#OR-2026-014': 'Água Estéril 10ml'
};

const CAMPOS_ENTREGA = ['nome', 'rua', 'numero', 'cep', 'cidade', 'bairro'];
const CAMPOS_OBRIGATORIOS_ENTREGA = ['nome', 'rua', 'numero', 'cep', 'cidade'];
let db = null;
const DB_FILE = path.join(__dirname, 'orion.db');

// ========== PROMPTS DE SETOR ==========
const promptVendas = `
VOCÊ É O CONSULTOR DE LOGÍSTICA DA ORION PEPTIDES.
MANTENHA SEMPRE UM TOM PROFISSIONAL, EDUCADO E DIRETO.

REGRAS DE COMPORTAMENTO:
ACOLHIMENTO: Nunca dê o preço direto. Valide a dor/objetivo do cliente.
AUTORIDADE ORION: Mencione sempre a "pureza laboratorial" ou "padrão ouro" da Orion.
FOLLOW-UP: NUNCA termine a mensagem de forma passiva. Termine SEMPRE devolvendo uma pergunta.
FORMATAÇÃO WHATSAPP: Use APENAS as formatações do WhatsApp: *texto* para negrito e _texto_ para itálico. PROIBIDO USAR TAGS HTML. Para listas, use apenas o símbolo de traço (-).
LIMITAÇÃO: Responda apenas sobre os itens do PRODUTOS_ORION. Produto fora do catálogo? Diga que não trabalha com o item.
Se o cliente ainda estiver com dúvidas técnicas mesmo após o início do fluxo de vendas, responda de forma simples e direta sobre o benefício do produto antes de reforçar o link do carrinho.
Você tem acesso total à BIBLIOTECA_TECNICA_ORION. Se o cliente fizer uma pergunta técnica enquanto estiver no fluxo de compra, NÃO mude o setor e NÃO chame o humano. Responda a dúvida de forma clara e direta usando a biblioteca e, em seguida, retome gentilmente para o fechamento do pedido.
Confirmar definições biológicas (como "TB-500 é Timosina") é considerado suporte de vendas informativo, não consulta médica. Responda prontamente usando a biblioteca técnica.

REGRA DE ALTERAÇÃO DE PEDIDO E CARRINHO (ESTRITAMENTE OBRIGATÓRIA):
Você NÃO PODE gerar links de pagamento por conta própria. Se o cliente pedir para alterar o pedido (adicionar mais produtos, remover itens ou mudar dosagens), você deve elogiar a escolha, recalcular o valor total, mas OBRIGATORIAMENTE pedir para ele refazer o carrinho no site.
NUNCA use formato de link Markdown como [texto](url). No WhatsApp, envie somente URL pura.
Use esta orientação com este link exato:
"Para garantir a segurança total da sua transação e gerar o link com os itens atualizados, nossos pedidos são criptografados diretamente pelo carrinho. Por favor, acesse rapidamente https://green-koala-180415.hostingersite.com/, monte seu protocolo atualizado e clique em finalizar. O sistema vai me mandar os dados aqui e eu gero seu link Asaas na hora!"

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
Você é o Especialista Técnico da Orion Peptides, com tom científico, sério e acessível.
Você deve soar como um bioquímico da Orion Peptides.

FONTE ÚNICA:
Sua ÚNICA e EXCLUSIVA fonte de informação técnica é a constante BIBLIOTECA_TECNICA_ORION.
Você não deve usar conhecimentos externos da internet que conflitem com nossa base.
Se a informação estiver na biblioteca, use-a com autoridade científica.

REGRAS DE COMPORTAMENTO:
- Seu objetivo é EDUCAR o cliente. Se ele perguntar sobre benefícios, mecanismos de ação ou por que escolher a Orion, responda de forma detalhada e persuasiva usando a BIBLIOTECA_TECNICA_ORION.
- Confirmar definições biológicas (como "TB-500 é Timosina") é suporte informativo, não consulta médica. Responda de forma direta usando a BIBLIOTECA_TECNICA_ORION.
- Protocolo oficial Orion de reconstituição: liofilizado + Água Bacteriostática; diluição 1ml ou 2ml conforme frasco; em frascos densos (como GHK-Cu 50mg), considerar até 15 minutos para dissolução completa.
- Se o cliente perguntar "como usar", "como misturar" ou "onde guardar", responda com autoridade técnica baseada na BIBLIOTECA_TECNICA_ORION.
- Você está PROIBIDO de dizer "não sei" ou chamar o suporte para perguntas sobre "quantas unidades usar" ou "qual o protocolo".
- Para perguntas de protocolo/unidades, consulte a BIBLIOTECA_TECNICA_ORION e responda no formato:
"Conforme os protocolos de referência de pesquisa da Orion, a dosagem padrão é X mg, o que equivale a Y unidades na seringa U-100".
- Sempre adicione no final da resposta: "Lembrando que este dado é para fins de referência científica".
- Para Tirzepatide 20mg (SKU #OR-2026-028), quando o cliente perguntar "como usar" ou "qual a dose", use os números exatos da BIBLIOTECA_TECNICA_ORION (2.5mg/semana na indução; exemplo de 25 unidades U-100 com 2ml de diluição), cite "Protocolos de Referência de Pesquisa Orion" e NÃO acione suporte humano para isso.
- Se houver dúvida sobre desconforto local com MOTS-C (ardência/coceira), acalme o cliente informando que o "MOTS-C Sting" pode ocorrer por alguns minutos e é um efeito local esperado em alguns casos.
- Protocolos de dosagem citados são estritamente para fins de pesquisa e referência da plataforma Orion.
- Se a pergunta exigir dosagem médica específica para caso clínico individual, diagnóstico, ajuste terapêutico personalizado ou qualquer decisão médica, responda EXATAMENTE:
"Essa é uma excelente pergunta técnica. Para sua segurança, vou encaminhar esse ponto agora mesmo para o nosso especialista responsável, que te dará o suporte detalhado em instantes. Um momento, por favor."

SÓ use a tag [MUDAR_PARA_VENDAS] quando o cliente disser explicitamente "quero comprar", "como eu pago" ou "manda o link". NÃO mude para vendas apenas porque ele demonstrou interesse em um produto.
`.trim();

// ========== ASAAS – Pagamentos automáticos ==========
async function criarPagamentoAsaas(valor, descricao, chatId = null) {
  const cleanAsaasKey = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjZhYTNkZjkxLWExZDMtNGFlNC05OGQ2LTE3ZWY0Njg2ZTdmMTo6JGFhY2hfNTViNzFkYjYtYWMyZi00NDRlLWI5MjAtN2RlZjQxZTZmMzdm';
  const apiUrl = "https://sandbox.asaas.com/api/v3";
  const customerId = "cus_000007677917"; 

  const asaasHeaders = {
    'access_token': cleanAsaasKey,
    'User-Agent': 'orion-bot/1.0',
    'Content-Type': 'application/json'
  };

  const payloadBase = {
    customer: customerId,
    billingType: 'UNDEFINED',
    value: Number(valor),
    dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    description: descricao || 'Pedido Orion - Protocolo Personalizado',
    externalReference: chatId ? `chat_${chatId}` : undefined
  };

  try {
    const { data: responseData } = await axios.post(`${apiUrl}/payments`, payloadBase, { headers: asaasHeaders });
    return { invoiceUrl: responseData.invoiceUrl ?? null, paymentId: responseData.id ?? null };
  } catch (error) {
    console.error('[Asaas Error] Falha ao criar pagamento!');
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
  `);
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
      message_history, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

async function notificarFernandoTransbordo(chatId, motivo) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const alerta = `⚠️ ALERTA ORION: O cliente ${chatId} precisa de suporte humano/técnico. Motivo: ${motivo}.`;

  try {
    if (!adminChatId) {
      console.log(`[Transbordo] ADMIN_CHAT_ID inválido. Alerta pendente: ${alerta}`);
      return;
    }
    await client.sendMessage(adminChatId, alerta);
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
    normalized.includes('manda o link')
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

  try {
    const result = await model.generateContent(promptExtracao);
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

// ========== INICIALIZAÇÃO WHATSAPP ==========
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // <--- Resolve o engasgo de memória da Hostinger
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('🤖 ESCANEIE O QR CODE ABAIXO COM SEU WHATSAPP:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot do WhatsApp conectado e pronto para vender!');
});

async function sendHumanizedMessage(chatId, text) {
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    // Delay de 3 a 5 segundos para simular humano digitando
    const delay = Math.floor(Math.random() * (5000 - 3000 + 1) + 3000);
    await new Promise(resolve => setTimeout(resolve, delay));
    await client.sendMessage(chatId, text);
    await appendMessageHistory(chatId, 'assistant', text);
  } catch (err) {
    console.error('Erro ao enviar mensagem humanizada:', err);
  }
}

// ========== PROCESSAMENTO DE MENSAGENS ==========
client.on('message', async (msg) => {
  const chatId = msg?.from || '';
  if (!chatId) return;

  // Ignora status, canais e newsletters para evitar crash no getChat()
  if (chatId === 'status@broadcast' || chatId.endsWith('@newsletter')) return;

  const rawBody = typeof msg?.body === 'string' ? msg.body : '';
  const userMessage = rawBody.trim();
  if (!userMessage && !msg.hasMedia) return;

  let session = await getOrCreateSession(chatId);
  if (userMessage) {
    await appendMessageHistory(chatId, 'user', userMessage);
  }

  // Transição automática: perguntas de logística/comercial saem do técnico para vendas.
  const termosVendas = ['envia', 'entrega', 'frete', 'valor', 'preço', 'preco', 'comprar', 'ribeirão', 'ribeirao', 'cep'];
  const userMessageLower = userMessage.toLowerCase();
  if (session.setorAtual === 'TECNICO' && termosVendas.some((t) => userMessageLower.includes(t))) {
    console.log('[Fluxo] Detectada intenção de logística/venda. Mudando para VENDAS.');
    session = await updateSession(chatId, { setorAtual: 'VENDAS' });
    logBotEmAtendimento(chatId, 'VENDAS', 'transicao-automatica-logistica');
  }

  // --- SUPORTE A ÁUDIO ---
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    if (media && media.mimetype.includes('audio')) {
      await sendHumanizedMessage(chatId, 'Recebi seu áudio. Um instante enquanto analiso com precisão laboratorial... 🧬');
      try {
        const promptTranscricao = `Transcreva e entenda o áudio do cliente. ${session.paymentStatus === 'PAID' ? 'Pagamento confirmado. Solicite dados de entrega.' : ''}`;
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: promptTranscricao }, { inlineData: { mimeType: media.mimetype, data: media.data } }] }]
        });
        const textResponse = result.response?.text?.() || '';
        await sendHumanizedMessage(chatId, textResponse);
      } catch (err) {
        await sendHumanizedMessage(chatId, 'Recebi seu áudio, mas não consegui processar com segurança. Por favor, envie em texto.');
      }
      return;
    }
  }

  if (!userMessage) return;

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
      const paymentResult = await criarPagamentoAsaas(valorTotal, 'Pedido Orion', chatId);
      if (paymentResult?.invoiceUrl) {
        invoiceUrl = paymentResult.invoiceUrl;
        linkPagamento = invoiceUrl;
      }
      if (paymentResult?.paymentId) {
        paymentId = paymentResult.paymentId;
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
      setorAtual: 'VENDAS',
      messageHistory: []
    });

    // Envia para o Admin no WhatsApp
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
      const adminReport = `🚨 *NOVA VENDA INICIADA!* 🚨\n\n*Cliente:* ${msg._data.notifyName || chatId}\n\n*Pedido:*\n${decodedMessage}\n\n*Link:* ${linkPagamento}`;
      client.sendMessage(adminChatId, adminReport);
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
      await sendHumanizedMessage(chatId, '✅ Pagamento Confirmado! Recebemos sua confirmação aqui no sistema da Orion Peptides. Agora, para garantirmos a agilidade no seu envio, por favor, envie seu endereço completo (Nome, Rua, Número, CEP e Cidade).');
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
              client.sendMessage(adminChatId, `📦 *ENDEREÇO RECEBIDO!* Cliente: ${msg._data.notifyName || chatId}\n${enderecoFormatado}`);
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
  const bibliotecaTecnicaContexto = `\n--- BIBLIOTECA_TECNICA_ORION (JSON) ---\n${BIBLIOTECA_TECNICA_ORION_PROMPT}`;
  const faltantesEntregaNoPrompt = getMissingDeliveryFields(session.dadosEntrega || { nome: '', rua: '', numero: '', cep: '', cidade: '', bairro: '' });
  const instrucaoPosCadastroConcluido = session.paymentStatus === 'PAID' && faltantesEntregaNoPrompt.length === 0
    ? `\n--- INSTRUÇÃO EXTRA PÓS-CADASTRO ---\nO cadastro de endereço já foi finalizado com sucesso. Se o cliente perguntar qual é o endereço, confirme os dados que temos de forma organizada:\nNome: ${session.dadosEntrega?.nome || ''}\nRua: ${session.dadosEntrega?.rua || ''}\nNúmero: ${session.dadosEntrega?.numero || ''}\nCEP: ${session.dadosEntrega?.cep || ''}\nCidade: ${session.dadosEntrega?.cidade || ''}\nBairro: ${session.dadosEntrega?.bairro || 'N/I'}\nSe ele apenas agradecer ou fizer um comentário aleatório, seja breve e profissional.`
    : '';
  const statusPagamento = session.paymentStatus === 'PAID' ? 'O pagamento já foi CONFIRMADO.' : 'O pagamento AINDA NÃO foi confirmado.';
  
  const prompt = `
  --- BASE DE DADOS ---
  PRODUTOS_ORION (JSON):
  ${CATALOGO_ORION_PROMPT}
  --- PROMPT DO SETOR ---
  ${promptSetorAtivo}
  ${contextoPedido}
  ${dadosEntregaContexto}
  ${historicoRecenteContexto}
  ${bibliotecaTecnicaContexto}
  ${instrucaoPosCadastroConcluido}
  --- STATUS ---
  ${statusPagamento}
  MENSAGEM DO CLIENTE: ${userMessage}
  `;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    if (text) {
      if (text.includes('[MUDAR_PARA_VENDAS]')) {
        text = text.replace('[MUDAR_PARA_VENDAS]', '').trim();
        if (hasExplicitPurchaseIntent(userMessage)) {
          const roteiroVendas = 'Para escolher seu protocolo, acesse nossa página oficial: https://green-koala-180415.hostingersite.com/ -- Após escolher, basta me mandar um "Pronto" aqui para gerarmos seu pedido e link de pagamento.';
          text = `${text}\n\n${roteiroVendas}`.trim();
          await updateSession(chatId, { setorAtual: 'VENDAS' });
          setorAtivo = 'VENDAS';
          logBotEmAtendimento(chatId, 'VENDAS', 'transicao-tecnico-para-vendas');
        } else {
          logBotEmAtendimento(chatId, 'TECNICO', 'tag-ignorada-sem-intencao-clara');
        }
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

// ========== EXPRESS & WEBHOOK ASAAS ==========
const app = express();
app.use(express.json());

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

app.post('/webhook/asaas', async (req, res) => {
  const webhookToken = req.headers['asaas-access-token'];
  if (!process.env.ASAAS_WEBHOOK_TOKEN || webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) return res.sendStatus(401);

  const event = req.body?.event;
  const payment = req.body?.payment;

  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    const paymentId = payment?.id;
    let chatIdFromPayment = await getChatIdByPaymentId(paymentId);
    
    if (!chatIdFromPayment && typeof payment?.externalReference === 'string') {
      chatIdFromPayment = payment.externalReference.replace('chat_', '');
    }

    if (chatIdFromPayment) {
      const session = await getOrCreateSession(chatIdFromPayment);
      const jaEnviouBoasVindasPagamento = !!session.paymentWelcomeSent;
      await saveSession(chatIdFromPayment, { ...session, paymentStatus: 'PAID', paymentWelcomeSent: true });
      await setPaymentSession(paymentId, chatIdFromPayment, {
        status: 'PAID',
        value: Number(payment?.value || 0),
        invoiceUrl: payment?.invoiceUrl || session.lastLink || null
      });
      // Envia confirmação automática apenas uma vez por conversa
      if (!jaEnviouBoasVindasPagamento) {
        await sendHumanizedMessage(chatIdFromPayment, '✅ Pagamento Confirmado! Recebemos sua confirmação aqui no sistema da Orion Peptides. Agora, para garantirmos a agilidade no seu envio, por favor, envie seu endereço completo (Nome, Rua, Número, CEP e Cidade).');
      }
    }

    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
      client.sendMessage(adminChatId, `💰 *PAGAMENTO APROVADO!* \nValor: R$ ${payment?.value}\nID: ${paymentId}`);
    }
  }
  return res.sendStatus(200);
});

const PORT = Number(process.env.PORT) || 3000;
async function startServer() {
  await initDatabase();
  console.log(`[SQLite] Banco inicializado em ${DB_FILE}`);

  app.listen(PORT, async () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log('Iniciando o WhatsApp Web Invisível...');
    client.initialize();
  });
}

startServer().catch((err) => {
  console.error('[Startup Error] Falha ao iniciar aplicação:', err);
  process.exit(1);
});