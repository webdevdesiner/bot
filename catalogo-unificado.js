'use strict';

/**
 * Fonte única da verdade por SKU oficial de venda.
 * Dados técnicos derivados de biblioteca-tecnica-orion.js com sku/substancia alinhados ao catálogo.
 */
const biblioteca = require('./biblioteca-tecnica-orion');

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function tecnicoFromBiblioteca(bibKey, skuOficial, substanciaOverride) {
  const src = biblioteca[bibKey];
  if (!src) {
    throw new Error(`[catalogo-unificado] Entrada ausente na biblioteca: ${bibKey}`);
  }
  const t = deepClone(src);
  t.sku = skuOficial;
  if (substanciaOverride != null && substanciaOverride !== '') {
    t.substancia = substanciaOverride;
  }
  return t;
}

/** BPC-157 venda oficial 10mg; ficha base era 5mg — escala matemática U-100 para frasco 10mg em 2ml. */
function tecnicoBpc157_10mgOficial() {
  const t = tecnicoFromBiblioteca('bpc_157_5mg_or_2026_001', '#OR-2026-021', 'BPC-157 (10mg)');
  t.matematica_u100_2ml = {
    regra_geral:
      'Com frasco oficial de venda de 10mg diluído em 2ml, cada 10 unidades U-100 equivalem a 500mcg.',
    dose_250mcg: 'Aspirar 5 unidades.',
    dose_500mcg: 'Aspirar 10 unidades.'
  };
  t.nota_catalogo_oficial =
    'Matemática de unidades ajustada ao frasco comercial 10mg (ficha herdada da base 5mg, concentrada em dobro em 2ml).';
  return t;
}

function tecnicoAguaEsteril() {
  return {
    sku: '#OR-2026-014',
    substancia: 'Água Estéril (10ml)',
    resumo_tecnico:
      'Diluente estéril para preparo técnico de frascos liofilizados em contexto de pesquisa.',
    uso: 'Auxiliar na reconstituição conforme protocolo do frasco principal.',
    reconstituicao: {
      solvente: 'Produto pronto para uso como diluente.',
      processo: 'Manter assepsia; utilizar conforme instruções do protocolo do peptídeo.'
    },
    armazenamento: {
      geral: 'Armazenar conforme rótulo e boas práticas do fabricante.'
    }
  };
}

function tecnicoKlowBlend80mg() {
  return {
    sku: '#OR-2026-KL80',
    substancia: 'KLOW Blend (80mg) — Protocolo de Recuperação Avançada',
    composicao_tecnica:
      'Blend sinérgico focado em regeneração tecidual, performance mitocondrial e modulação inflamatória.',
    resumo_tecnico:
      'KLOW Blend 80mg para protocolos de recuperação avançada; reconstituição oficial em 2ml de água bacteriostática.',
    reconstituicao: {
      solvente: 'Água Bacteriostática.',
      volume: '2ml',
      processo: 'Reconstituição oficial: 2ml de Água Bacteriostática no frasco de 80mg.'
    },
    matematica_u100: {
      contexto: 'Frasco com 80mg reconstituído em 2ml.',
      regra:
        'Cada 10 unidades (UI) na seringa U-100 equivalem a 4mg do blend.',
      dose_manutencao_4mg: 'Aspirar 10 unidades.',
      dose_ativa_8mg: 'Aspirar 20 unidades.'
    },
    protocolo_pesquisa:
      'Aplicação preferencialmente pós-treino ou antes de dormir para otimizar os processos de reparação celular.',
    beneficios:
      'Aceleração da recuperação muscular, melhora da densidade tecidual e suporte à homeostase metabólica.'
  };
}

function tecnicoKitOrion() {
  return {
    sku: '#OR-KIT-COMPLETO',
    substancia: 'Kit Orion (Insumos Completos)',
    resumo_tecnico:
      'Kit com insumos estéreis e dimensionados para reconstituição e aplicação em protocolos de pesquisa com peptídeos liofilizados.',
    conveniencia:
      'Reúne em um único pedido água bacteriostática, seringas de diluição e de aplicação U-100 adequadas, evitando improvisos que comprometam assepsia ou dosagem.',
    composicao: {
      agua_bacteriostatica: '10ml',
      seringas_aplicacao: '4x U-100',
      seringa_diluicao: '1x 5ml',
      frete: 'Grátis incluso na oferta do kit (conforme bloco comercial).'
    }
  };
}

function tecnicoKitOrionBrinde() {
  const base = tecnicoKitOrion();
  return {
    ...base,
    sku: '#OR-KIT-BRINDE',
    substancia: 'Kit Orion de Boas-Vindas (Cortesia)',
    natureza:
      'Brinde/cortesia (preço R$ 0,00 no catálogo): mesma lógica de conveniência do kit completo — materiais estéreis adequados ao protocolo, sem cobrança nesta linha promocional.',
    resumo_tecnico:
      'Kit de boas-vindas com insumos estéreis para reconstituição e aplicação; pensado para o cliente iniciar o protocolo com os acessórios corretos.',
    composicao: {
      ...base.composicao,
      frete: 'Grátis incluso no pedido principal (brinde enviado junto ao produto; conforme bloco comercial).'
    }
  };
}

/** NAD+ #OR-2026-018 — protocolo exato da sócia (somente 5ml AB; sem 2ml/3ml neste SKU). */
function tecnicoNadPlus_5ml_Socia() {
  return {
    sku: '#OR-2026-018',
    substancia: 'NAD+ (500mg)',
    resumo_tecnico:
      'Protocolo da sócia: reconstituição exclusivamente com 5ml de água bacteriostática (não usar volumes de 2ml ou 3ml para este frasco).',
    reconstituicao: {
      solvente: 'Água Bacteriostática.',
      volume: '5ml',
      processo: 'Reconstituir o frasco liofilizado com 5ml de Água Bacteriostática.'
    },
    matematica_u100: {
      escala: '10 UI = 10mg | 50 UI = 50mg (seringa U-100, referência deste protocolo).'
    },
    protocolo_pesquisa: {
      fase_inicial: '10–20 UI/dia por 7 dias.',
      fase_ativa: '20–50 UI/dia.'
    },
    alertas_e_sinais: {
      texto:
        'Náusea, sensação de pressão no peito e mal-estar podem ocorrer, em especial se a aplicação for rápida ou em dose alta.'
    },
    horario: {
      regra: 'Aplicar obrigatoriamente pela manhã para evitar insônia.'
    }
  };
}

const REGRAS_GLOBAIS = {
  protocolo_reconstituicao_oficial: {
    regra: 'Todos os peptídeos Orion são liofilizados e devem ser reconstituídos com Água Bacteriostática.',
    padrao: 'Padrão de diluição: 1ml ou 2ml conforme volume e concentração do frasco.',
    tempo_dissolucao:
      'Para frascos densos (ex.: GHK-Cu 50mg), considerar até 15 minutos para dissolução completa.',
    armazenamento: {
      antes: 'Armazenar em local seco e fresco (ou freezer para longa duração).',
      depois: 'Após reconstituição, refrigeração obrigatória entre 2°C e 8°C.'
    }
  },
  seguranca_orion: {
    pureza: 'Padrão Orion >99.8% de pureza laboratorial com certificação.',
    aviso:
      'Protocolos de dosagem citados são estritamente para fins de pesquisa e referência da plataforma Orion.'
  },
  regra_sigilo_protocolo: {
    verificacao_obrigatoria:
      'Verifique sempre o campo statusPagamento enviado no contexto do prompt (STATUS DE PAGAMENTO DESTE CLIENTE).',
    se_bloqueado: {
      proibicoes:
        'Você está terminantemente PROIBIDO de informar quantidades de unidades (UI), cálculos de seringa (U-100) ou detalhes específicos de diluição/reconstituição.',
      resposta_sugerida:
        'Para sua segurança e precisão nos resultados, o protocolo detalhado de reconstituição e as tabelas de dosagem (unidades) são liberados automaticamente aqui no chat assim que o sistema confirmar o recebimento do seu pedido. Deseja que eu gere o link para o seu protocolo agora?'
    },
    se_liberado:
      'Forneça todas as informações técnicas, cálculos de UI e protocolos de pesquisa normalmente.'
  },
  regra_operacao_global: {
    identidade: 'A Orion é uma facilitadora internacional.',
    documentacao:
      'Emitimos apenas Commercial Invoice para insumos de pesquisa laboratorial.',
    logistica:
      'Operação e envios em rede global; não forneça endereços físicos localizáveis de operações nas respostas sobre envio ou rotas.'
  },
  precos_oficiais_landing: {
    tabela:
      'Os valores em comercial.preco do CATÁLOGO_UNIFICADO são fixos e correspondem à tabela oficial da facilitadora internacional (paridade com a landing page).',
    descontos:
      'Não ofereça descontos manuais, negociação ad hoc ou alteração de preço fora dessa tabela; preserve a integridade da oferta publicada na LP.'
  },
  regra_oferta_kit_orion: {
    gatilho:
      'Sempre que o cliente perguntar o preço de um peptídeo ou demonstrar intenção de compra, anuncie que a Orion está com uma condição especial: na compra de qualquer item, o cliente ganha inteiramente grátis o Kit Orion Completo em cortesia (SKU #OR-KIT-BRINDE — água bacteriostática + seringas).',
    destaque_frete:
      'Enfatize que o Frete Grátis é um benefício ativado pelo envio do Kit junto ao produto principal.',
    argumento_pureza:
      'Reforce que utilizar as seringas corretas e a água bacteriostática da Orion garante a pureza e a eficácia do protocolo de pesquisa.',
    fechador:
      "Fechador de vendas sugerido: 'E o melhor de tudo: para garantir que sua pesquisa comece com perfeição, eu vou incluir de presente para você o nosso Kit Orion com todos os insumos e o frete por nossa conta. Posso fechar seu pedido com esse brinde?'"
  }
};

const CATALOGO_UNIFICADO = {
  '#OR-2026-028': {
    comercial: {
      nome: 'Tirzepatide',
      dosagem: '20mg',
      preco: 'R$ 800,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('tirzepatide_20mg_or_2026_028', '#OR-2026-028')
  },
  '#OR-2026-040': {
    comercial: {
      nome: 'Tirzepatide',
      dosagem: '40mg',
      preco: 'R$ 1.500,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('tirzepatide_40mg_or_2026_040', '#OR-2026-040')
  },
  '#OR-2026-060': {
    comercial: {
      nome: 'Tirzepatide',
      dosagem: '60mg',
      preco: 'R$ 1.900,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('tirzepatide_60mg_or_2026_060', '#OR-2026-060')
  },
  '#OR-2026-120': {
    comercial: {
      nome: 'Tirzepatide',
      dosagem: '120mg',
      preco: 'R$ 2.500,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('tirzepatide_120mg_or_2026_120', '#OR-2026-120')
  },
  '#OR-2026-025': {
    comercial: {
      nome: 'Retatrutide',
      dosagem: '10mg',
      preco: 'R$ 1.100,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('retatrutide_10mg_or_2026_030', '#OR-2026-025', 'Retatrutide (10mg)')
  },
  '#OR-2026-020-20': {
    comercial: {
      nome: 'Retatrutide',
      dosagem: '20mg',
      preco: 'R$ 1.700,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('retatrutide_20mg_or_2026_031', '#OR-2026-020-20')
  },
  '#OR-2026-AOD5': {
    comercial: {
      nome: 'AOD-9604',
      dosagem: '5mg',
      preco: 'R$ 650,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('aod_9604_5mg_or_2026_005', '#OR-2026-AOD5')
  },
  '#OR-2026-021': {
    comercial: {
      nome: 'BPC-157',
      dosagem: '10mg',
      preco: 'R$ 600,00',
      categoria: 'Reparação e Recovery'
    },
    tecnico: tecnicoBpc157_10mgOficial()
  },
  '#OR-2026-020': {
    comercial: {
      nome: 'TB-500',
      dosagem: '10mg',
      preco: 'R$ 600,00',
      categoria: 'Reparação e Recovery'
    },
    tecnico: tecnicoFromBiblioteca('tb_500_10mg_or_2026_002', '#OR-2026-020', 'TB-500 (10mg)')
  },
  '#OR-2026-021-BT': {
    comercial: {
      nome: 'BPC-157 + TB-500',
      dosagem: '5mg + 5mg',
      preco: 'R$ 800,00',
      categoria: 'Reparação e Recovery'
    },
    tecnico: tecnicoFromBiblioteca('blend_bpc_157_tb_500_or_2026_003', '#OR-2026-021-BT')
  },
  '#OR-2026-016': {
    comercial: {
      nome: 'GHK-Cu',
      dosagem: '50mg',
      preco: 'R$ 500,00',
      categoria: 'Reparação e Recovery'
    },
    tecnico: tecnicoFromBiblioteca('ghk_cu_50mg_or_2026_016', '#OR-2026-016')
  },
  '#OR-2026-KL80': {
    comercial: {
      nome: 'KLOW Blend (Recovery Stack)',
      dosagem: '80mg',
      preco: 'R$ 800,00',
      categoria: 'Reparação e Recovery'
    },
    tecnico: tecnicoKlowBlend80mg()
  },
  '#OR-2026-019-CI': {
    comercial: {
      nome: 'CJC-1295 + Ipamorelin',
      dosagem: '5mg + 5mg',
      preco: 'R$ 800,00',
      categoria: 'Anti-aging e Ganho Muscular'
    },
    tecnico: tecnicoFromBiblioteca('blend_cjc_1295_ipamorelin_or_2026_008', '#OR-2026-019-CI')
  },
  '#OR-2026-015': {
    comercial: {
      nome: 'Tesamorelin',
      dosagem: '10mg',
      preco: 'R$ 650,00',
      categoria: 'Anti-aging e Ganho Muscular'
    },
    tecnico: tecnicoFromBiblioteca('tesamorelin_10mg_or_2026_009', '#OR-2026-015', 'Tesamorelin (10mg)')
  },
  '#OR-2026-018': {
    comercial: {
      nome: 'NAD+',
      dosagem: '500mg',
      preco: 'R$ 450,00',
      categoria: 'Cognitivo e Nootrópicos'
    },
    tecnico: tecnicoNadPlus_5ml_Socia()
  },
  '#OR-2026-017': {
    comercial: {
      nome: 'MOTS-C',
      dosagem: '40mg',
      preco: 'R$ 1.200,00',
      categoria: 'Cognitivo e Nootrópicos'
    },
    tecnico: tecnicoFromBiblioteca('mots_c_40mg_or_2026_017', '#OR-2026-017')
  },
  '#OR-2026-HGH15': {
    comercial: {
      nome: 'HGH FRAG',
      dosagem: '15mg',
      preco: 'R$ 750,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('hgh_frag_15mg_or_2026_hgh15', '#OR-2026-HGH15')
  },
  '#OR-2026-SLK11': {
    comercial: {
      nome: 'Selank',
      dosagem: '11mg',
      preco: 'R$ 550,00',
      categoria: 'Cognitivo e Nootrópicos'
    },
    tecnico: tecnicoFromBiblioteca('selank_11mg_or_2026_slk11', '#OR-2026-SLK11')
  },
  '#OR-2026-SMX11': {
    comercial: {
      nome: 'Semax',
      dosagem: '11mg',
      preco: 'R$ 550,00',
      categoria: 'Cognitivo e Nootrópicos'
    },
    tecnico: tecnicoFromBiblioteca('semax_11mg_or_2026_smx11', '#OR-2026-SMX11')
  },
  '#OR-2026-PT141': {
    comercial: {
      nome: 'PT-141',
      dosagem: '10mg',
      preco: 'R$ 650,00',
      categoria: 'Performance e Metabolismo'
    },
    tecnico: tecnicoFromBiblioteca('pt_141_10mg_or_2026_pt141', '#OR-2026-PT141')
  },
  '#OR-2026-IPA10': {
    comercial: {
      nome: 'Ipamorelin',
      dosagem: '10mg',
      preco: 'R$ 600,00',
      categoria: 'Anti-aging e Ganho Muscular'
    },
    tecnico: tecnicoFromBiblioteca('ipamorelin_10mg_or_2026_ipa10', '#OR-2026-IPA10')
  },
  '#OR-2026-SLU5': {
    comercial: {
      nome: 'SLU-PP-332',
      dosagem: '5mg',
      preco: 'R$ 600,00',
      categoria: 'Emagrecimento'
    },
    tecnico: tecnicoFromBiblioteca('slu_pp_332_5mg_or_2026_033_slu', '#OR-2026-SLU5', 'SLU-PP-332 (5mg)')
  },
  '#OR-2026-SS10': {
    comercial: {
      nome: 'SS-31',
      dosagem: '10mg',
      preco: 'R$ 550,00',
      categoria: 'Reparação e Recovery'
    },
    tecnico: tecnicoFromBiblioteca('ss_31_elamipretide_10mg_or_2026_031_ss', '#OR-2026-SS10', 'SS-31 (Elamipretide) (10mg)')
  },
  '#OR-2026-BAC10': {
    comercial: {
      nome: 'Água Bacteriostática',
      dosagem: '10ml',
      preco: 'R$ 40,00',
      categoria: 'Suprimentos'
    },
    tecnico: tecnicoFromBiblioteca('agua_bacteriostatica_10ml_or_2026_bac10', '#OR-2026-BAC10')
  },
  '#OR-2026-014': {
    comercial: {
      nome: 'Água Estéril',
      dosagem: '10ml',
      preco: 'R$ 40,00',
      categoria: 'Suprimentos'
    },
    tecnico: tecnicoAguaEsteril()
  },
  '#OR-KIT-COMPLETO': {
    comercial: {
      nome: 'Kit Orion (Insumos Completos)',
      dosagem: 'Kit p/ 1 Frasco',
      preco: 'R$ 49,90',
      categoria: 'Acessórios e Insumos',
      descricao:
        'Água Bacteriostática (10ml) + 4 seringas de aplicação (U-100) + 1 seringa de diluição (5ml) + Frete Grátis.'
    },
    tecnico: tecnicoKitOrion()
  },
  '#OR-KIT-BRINDE': {
    comercial: {
      nome: 'Kit Orion de Boas-Vindas (Cortesia)',
      dosagem: 'Kit Completo p/ 1 Frasco',
      preco: 'R$ 0,00 (Cortesia)',
      categoria: 'Brindes e Insumos',
      descricao:
        'BRINDE EXCLUSIVO: 01 Água Bacteriostática (10ml) + 04 seringas de aplicação (U-100) + 01 seringa de diluição (5ml) + Frete Grátis incluso no pedido principal.'
    },
    tecnico: tecnicoKitOrionBrinde()
  }
};

function buildSkuProduto(catalogo) {
  const o = {};
  for (const [sku, row] of Object.entries(catalogo)) {
    const c = row.comercial;
    o[sku] = `${c.nome} ${c.dosagem}`.replace(/\s+/g, ' ').trim();
  }
  return o;
}

/** Nome amigável (nome + dosagem) → SKU — base para cliques LP/WhatsApp. */
function buildNomeProdutoParaSku(catalogo) {
  const o = {};
  for (const [sku, row] of Object.entries(catalogo)) {
    const c = row.comercial;
    const nome = `${c.nome} ${c.dosagem}`.replace(/\s+/g, ' ').trim();
    o[nome] = sku;
  }
  return o;
}

/** Rotulos extras alinhados à LP (24 produtos + sinónimos curtos). */
const ALIASES_NOME_LP_PARA_SKU = {
  'Blend BPC+TB': '#OR-2026-021-BT',
  'BPC+TB': '#OR-2026-021-BT',
  'KLOW Blend': '#OR-2026-KL80',
  'CJC-1295 + Ipamorelin': '#OR-2026-019-CI',
  'Água Bacteriostática': '#OR-2026-BAC10'
};

const SKU_PRODUTO = buildSkuProduto(CATALOGO_UNIFICADO);
const NOME_PRODUTO_PARA_SKU = {
  ...buildNomeProdutoParaSku(CATALOGO_UNIFICADO),
  ...ALIASES_NOME_LP_PARA_SKU
};

const CATALOGO_UNIFICADO_PROMPT = JSON.stringify(CATALOGO_UNIFICADO, null, 2);
const REGRAS_GLOBAIS_PROMPT = JSON.stringify(REGRAS_GLOBAIS, null, 2);
const NOME_PRODUTO_PARA_SKU_PROMPT = JSON.stringify(NOME_PRODUTO_PARA_SKU, null, 2);

module.exports = {
  CATALOGO_UNIFICADO,
  REGRAS_GLOBAIS,
  CATALOGO_UNIFICADO_PROMPT,
  REGRAS_GLOBAIS_PROMPT,
  SKU_PRODUTO,
  NOME_PRODUTO_PARA_SKU,
  NOME_PRODUTO_PARA_SKU_PROMPT
};
