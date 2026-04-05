module.exports = {
  tirzepatide_20mg_or_2026_028: {
    substancia: 'Tirzepatide (20mg)',
    sku: '#OR-2026-028',
    resumo_tecnico:
      'Peptídeo sintético agonista duplo de GIP e GLP-1, voltado para gerenciamento metabólico e perda de peso.',
    mecanismo:
      'Ativação sinérgica de GIP e GLP-1: melhora secreção e sensibilidade à insulina, retarda esvaziamento gástrico e aumenta sinalização de saciedade no hipotálamo.',
    beneficios: [
      'Perda ponderal significativa',
      'Controle glicêmico superior',
      'Redução de gordura visceral',
      'Melhora de perfis lipídicos',
      'Redução de inflamação sistêmica'
    ],
    reconstituicao: {
      solvente: '1ml ou 2ml de Água Bacteriostática',
      processo:
        'Injetar o solvente lentamente pela parede do frasco, sem agitar vigorosamente; usar movimentos circulares suaves.'
    },
    armazenamento: {
      pre_reconstituicao:
        'Local seco e fresco (até 25°C). Freezer para longa duração.',
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      inducao: '2.5mg por semana durante 4 semanas para adaptação.',
      escalonamento:
        'Aumento gradual conforme tolerância: 5mg, 7.5mg, até 15mg semanais em casos avançados.'
    },
    unidades_u100_exemplo:
      'Com diluição em 2ml: dose de 2.5mg equivale a 25 unidades na seringa U-100.',
    efeitos_observacoes: [
      'Redução drástica do apetite ("ruído mental" por comida pode diminuir).',
      'Náusea leve inicial pode ocorrer como adaptação.'
    ],
    alertas: [
      'Não aplicar se houver histórico familiar de carcinoma medular de tireoide.',
      'Manter hidratação rigorosa.'
    ],
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/tirzepatide/',
    frase_operacional:
      'Para dúvidas de "como usar" ou "qual a dose", responder com estes números exatos como Protocolos de Referência de Pesquisa Orion, sem acionar suporte humano.'
  },
  tirzepatide_40mg_or_2026_040: {
    substancia: 'Tirzepatide (40mg)',
    sku: '#OR-2026-040',
    resumo_tecnico:
      'Versão de alta concentração do agonista duplo GIP/GLP-1, ideal para protocolos de médio/longo prazo após fase de indução.',
    mecanismo:
      'Ativação sinérgica de GIP e GLP-1, com regulação da glicemia pós-prandial, supressão de glucagon e saciedade prolongada por sinalização hipotalâmica.',
    beneficios: [
      'Maior custo-benefício para doses acima de 5mg/semana',
      'Redução de gordura visceral profunda',
      'Otimização da composição corporal',
      'Melhora de sensibilidade à insulina'
    ],
    reconstituicao: {
      solvente: 'Recomendado 2ml de Água Bacteriostática para precisão de microvolumes',
      processo:
        'Gotejar o solvente suavemente pela parede interna do frasco. Não agitar para evitar degradação das cadeias peptídicas.'
    },
    armazenamento: {
      pre_reconstituicao:
        'Ambiente seco e fresco. Freezer para estocagem prolongada.',
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      intermediario: '5mg por semana',
      avancado: '7.5mg a 10mg por semana'
    },
    matematica_u100_2ml: {
      regra_geral: 'Com frasco de 40mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 2mg.',
      dose_5mg: 'Aspirar 25 unidades (0.25ml) na seringa U-100.',
      dose_10mg: 'Aspirar 50 unidades (0.50ml) na seringa U-100.',
      comparativo_20mg:
        'Com o mesmo volume de 2ml, o frasco de 40mg é 2x mais concentrado que o de 20mg; por isso as unidades mudam e exigem precisão.'
    },
    efeitos_observacoes: [
      'Melhora notável na sensibilidade à insulina.',
      'Esvaziamento gástrico retardado pode prolongar saciedade por vários dias após aplicação.'
    ],
    alertas: [
      'Evitar consumo excessivo de álcool durante o uso.',
      'Monitorar níveis de hidratação.'
    ],
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/tirzepatide-40mg/',
    frase_operacional:
      'Para dúvidas de dose/unidades, explicar com precisão a matemática específica do frasco de 40mg e a diferença versus 20mg, citando Protocolos de Referência de Pesquisa Orion.'
  },
  tirzepatide_60mg_or_2026_060: {
    substancia: 'Tirzepatide (60mg)',
    sku: '#OR-2026-060',
    resumo_tecnico:
      'Versão de ultra concentração do agonista duplo GIP/GLP-1, voltada para protocolos avançados de longo prazo e otimização de custos em doses elevadas.',
    mecanismo:
      'Modulação robusta de apetite e glicemia. A alta concentração permite entregar doses potentes em menor volume de injeção.',
    beneficios: [
      'Melhor custo-benefício da linha em protocolos intensivos',
      'Redução de resistência insulínica',
      'Forte impacto em lipólise (queima de gordura)',
      'Saciedade sustentada por período prolongado'
    ],
    reconstituicao: {
      solvente:
        'Recomendado 2ml (padrão para matemática simples) ou até 3ml de Água Bacteriostática.',
      processo:
        'Adicionar solvente com paciência. O pó de 60mg pode levar mais tempo para dissolver completamente. Nunca agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C. Estabilidade estimada em 30-40 dias sob refrigeração correta.'
    },
    protocolo_referencia_pesquisa: {
      avancado: '10mg a 15mg por semana'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 60mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 3mg.',
      dose_10mg:
        'Aspirar aproximadamente 33 unidades (0.33ml) na seringa U-100.',
      dose_15mg:
        'Aspirar 50 unidades (0.50ml) na seringa U-100.',
      observacao:
        'Por ser alta concentração, pequenos erros de unidade alteram significativamente a dose. Medir com máxima precisão.'
    },
    efeitos_observacoes: [
      'Controle de apetite pode ser percebido de forma rápida.',
      'Pode ser útil em pesquisa para quebrar platôs de perda de peso.'
    ],
    alertas: [
      'Monitorar sinais de hipoglicemia se houver uso concomitante de outros fármacos metabólicos.',
      'Manter hidratação adequada para reduzir risco de constipação associada ao retardo gástrico.'
    ],
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/tirzepatide-60mg/',
    frase_operacional:
      'Se o cliente pedir cálculo rápido de dose, usar a regra 10 UI = 3mg (com 2ml) e converter com precisão em unidades U-100, citando Protocolos de Referência de Pesquisa Orion.'
  },
  aod_9604_5mg_or_2026_005: {
    substancia: 'AOD-9604 (5mg)',
    sku: '#OR-2026-AOD5',
    resumo_tecnico:
      'Fragmento peptídico C-terminal do HGH (176-191), conhecido como peptídeo da queima de gordura por perfil altamente lipolítico.',
    mecanismo:
      'Estimula lipólise e inibe lipogênese sem impactar glicose ou sensibilidade à insulina. Diferente do GH completo, não apresenta efeito sobre IGF-1.',
    beneficios: [
      'Redução de gordura localizada, com destaque para região abdominal',
      'Aumento do gasto metabólico',
      'Suporte em pesquisas de reparação de cartilagem (osteoartrite)'
    ],
    reconstituicao: {
      solvente:
        'Utilizar 2ml de Água Bacteriostática para precisão em doses de microgramas (mcg).',
      processo:
        'Dissolução rápida. Injetar água suavemente pela parede do frasco. Nunca agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      padrao:
        '250mcg a 500mcg por dia.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 5mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 250mcg.',
      dose_250mcg:
        'Aspirar 10 unidades (0.1ml) na seringa U-100.',
      dose_500mcg:
        'Aspirar 20 unidades (0.2ml) na seringa U-100.'
    },
    efeitos_observacoes: [
      'Costuma ser utilizado em jejum ou antes de aeróbico para potencializar oxidação lipídica.',
      'Não causa fome nem retenção hídrica em protocolos de referência.'
    ],
    alertas: [
      'Não apresenta os riscos clássicos de hiperglicemia associados ao HGH completo.',
      'Perfil considerado mais seguro para foco em perda de gordura, dentro de protocolos de pesquisa.'
    ],
    diferencial_orion:
      'Explicar que o AOD-9604 é o fragmento 176-191 do GH e atua focado em queima de gordura, sem modular insulina — diferente da Tirzepatide, que atua no eixo metabólico GIP/GLP-1.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/aod9604-5mg/',
    frase_operacional:
      'Quando perguntarem diferença para Tirzepatide, destacar que AOD-9604 é fragmento 176-191 do GH com foco exclusivo em lipólise, enquanto Tirzepatide age em receptores incretínicos com impacto glicêmico/apetite.'
  },
  retatrutide_10mg_or_2026_030: {
    substancia: 'Retatrutide (10mg)',
    sku: '#OR-2026-030',
    resumo_tecnico:
      'Peptídeo de última geração com agonismo triplo (GLP-1, GIP e Glucagon), destaque em pesquisas avançadas de obesidade e diabetes tipo 2.',
    mecanismo:
      'Além dos eixos GLP-1 e GIP, ativa receptor de Glucagon, acelerando gasto energético basal (termogênese) enquanto mantém supressão de apetite e melhora de sensibilidade insulínica.',
    beneficios: [
      'Potencial de perda de peso superior em protocolos comparativos',
      'Aumento da taxa metabólica basal',
      'Redução rápida de gordura hepática',
      'Melhora de marcadores cardiometabólicos'
    ],
    reconstituicao: {
      solvente:
        'Utilizar 2ml de Água Bacteriostática para precisão em doses de miligramas.',
      processo:
        'Adicionar o solvente suavemente pelas laterais do frasco. Não agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      inducao: '2mg por semana durante 4 semanas.',
      ajuste: '4mg por semana conforme tolerância.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 10mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 0.5mg.',
      dose_2mg:
        'Aspirar 40 unidades (0.4ml) na seringa U-100.',
      dose_4mg:
        'Aspirar 80 unidades (0.8ml) na seringa U-100.'
    },
    efeitos_observacoes: [
      'Pode ocorrer leve aumento de frequência cardíaca em função da ativação metabólica via glucagon.',
      'Supressão de apetite tende a ser bastante intensa em protocolos de referência.'
    ],
    alertas: [
      'Reforçar hidratação durante o protocolo.',
      'Monitoramento calórico é importante devido à forte supressão de apetite.'
    ],
    diferencial_orion:
      'Enfatizar que Retatrutide é agonista TRIPLO (GLP-1/GIP/Glucagon), enquanto Tirzepatide é agonista DUPLO (GLP-1/GIP), justificando maior potência metabólica em pesquisas.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/retatrutide/',
    frase_operacional:
      'Quando o cliente comparar com Tirzepatide, explicar com autoridade que o diferencial central do Retatrutide é a terceira via (Glucagon), associada a maior termogênese e gasto energético basal.'
  },
  retatrutide_20mg_or_2026_031: {
    substancia: 'Retatrutide (20mg)',
    sku: '#OR-2026-020-20',
    resumo_tecnico:
      'Versão de concentração intermediária do agonista triplo (GLP-1, GIP e Glucagon), desenhada para protocolos com escalonamento de dose e maior rendimento por frasco.',
    mecanismo:
      'Atuação simultânea em GLP-1, GIP e Glucagon. GLP-1/GIP auxiliam controle de apetite e resposta insulínica; Glucagon aumenta gasto energético basal em repouso.',
    beneficios: [
      'Potencializa queima de gordura visceral',
      'Acelera metabolismo basal',
      'Oferece controle glicêmico avançado',
      'Ajuda a superar platôs de perda de peso'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Adicionar o solvente gotejando pela parede interna do frasco com extremo cuidado. Não agitar (molécula sensível).'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      manutencao_inicial: '4mg por semana.',
      escalonamento: '6mg a 8mg por semana, conforme tolerância do pesquisador.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 20mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 1mg.',
      dose_4mg:
        'Aspirar 40 unidades (0.4ml) na seringa U-100.',
      dose_8mg:
        'Aspirar 80 unidades (0.8ml) na seringa U-100.'
    },
    efeitos_observacoes: [
      'Saciedade tende a surgir de forma rápida devido ao agonismo triplo.',
      'Leve elevação de temperatura corporal pode ocorrer por aumento de termogênese.'
    ],
    alertas: [
      'Monitorar hidratação e eletrólitos em protocolos com supressão importante de apetite.',
      'Manter rotina de acompanhamento do estado geral durante o protocolo de pesquisa.'
    ],
    diferencial_orion:
      'Frasco de 20mg oferece o dobro de rendimento da versão 10mg, sendo ideal para fases de manutenção/escalonamento com doses a partir de 4mg semanais.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/retatrutide-20mg/',
    frase_operacional:
      'Destacar em atendimento que o Retatrutide 20mg é indicado para continuidade de protocolo com melhor rendimento, especialmente quando as doses sobem para 4mg+ por semana.'
  },
  bpc_157_5mg_or_2026_001: {
    substancia: 'BPC-157 (5mg)',
    sku: '#OR-2026-001',
    resumo_tecnico:
      'Pentadecapeptídeo de 15 aminoácidos derivado do composto de proteção corporal (BPC) isolado do suco gástrico, reconhecido por aceleração de reparo tecidual.',
    mecanismo:
      'Estimula angiogênese e modula vias inflamatórias sem bloqueio completo da inflamação, favorecendo reparo estrutural. Em pesquisas, também há associação com aumento de expressão de receptores de GH em fibroblastos tendíneos.',
    beneficios: [
      'Regeneração acelerada de tendões, ligamentos e músculos',
      'Suporte à mucosa gástrica e saúde intestinal',
      'Redução de inflamação sistêmica',
      'Potencial neuroprotetor em pesquisas pré-clínicas'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Injetar a água suavemente. Apesar de ser estável, manter manuseio delicado para preservar padrão de pureza.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C. Mesmo com boa estabilidade térmica relativa, o padrão Orion é geladeira.'
    },
    protocolo_referencia_pesquisa: {
      padrao:
        '250mcg a 500mcg, 2x ao dia (total de 500mcg a 1mg/dia).'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 5mg diluído em 2ml, cada 10 unidades U-100 equivalem a 250mcg.',
      dose_250mcg:
        'Aspirar 10 unidades.',
      dose_500mcg:
        'Aspirar 20 unidades.'
    },
    efeitos_observacoes: [
      'Em pesquisas de lesões agudas, respostas podem surgir em poucos dias.',
      'Não apresenta perfil típico de efeitos hormonais sistêmicos.'
    ],
    alertas: [
      'Uso orientado para períodos de recuperação de lesões ou suporte digestivo.',
      'Manter consistência de protocolo e técnica correta de aplicação.'
    ],
    sinergia: {
      com_tb_500:
        'Sinergia clássica de pesquisa com TB-500 para recuperação músculo-tendínea e funcional.',
      posicionamento:
        'Pode ser apresentado como regenerador por excelência dentro da linha Orion.'
    },
    diferencial_orion:
      'Por ser derivado do suco gástrico, além do foco músculo-tendíneo, também se destaca em suporte de saúde intestinal.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/bpc-157/',
    frase_operacional:
      'Em atendimento, destacar BPC-157 como regenerador por excelência, com excelente sinergia com TB-500 e benefício adicional para mucosa/saúde intestinal.'
  },
  blend_bpc_157_tb_500_or_2026_003: {
    substancia: 'Blend BPC-157 (5mg) + TB-500 (5mg)',
    sku: '#OR-2026-003',
    resumo_tecnico:
      'Formulação combinada de dois peptídeos regenerativos de alta potência para atuação simultânea em múltiplas frentes de reparação tecidual.',
    mecanismo: {
      bpc_157:
        'Atua em angiogênese e reparo estrutural de tendões, além de suporte à mucosa gástrica.',
      tb_500:
        'Favorece migração celular, formação de novas fibras musculares e neovascularização.',
      sinergia:
        'BPC foca em estrutura/inflamação e TB-500 em mobilidade/velocidade de regeneração celular.'
    },
    beneficios: [
      'Recuperação acelerada de lesões agudas e crônicas',
      'Suporte a músculos, tendões e ligamentos',
      'Apoio à saúde articular',
      'Efeito anti-inflamatório sistêmico em protocolos de pesquisa'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Adicionar água lentamente pelas paredes internas do frasco. Como há duas moléculas no mesmo vial, a dissolução suave é crítica para estabilidade. Não agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      padrao:
        '250mcg a 500mcg de cada peptídeo por aplicação.',
      frequencia:
        'Dose padrão de 10 UI (0.1ml) a 20 UI (0.2ml), 1 ou 2 vezes ao dia.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Frasco total 10mg (5mg + 5mg) em 2ml: cada 10 unidades U-100 entregam 250mcg de BPC + 250mcg de TB-500.',
      dose_10_ui:
        '10 unidades (0.1ml) = 250mcg BPC + 250mcg TB-500.',
      dose_20_ui:
        '20 unidades (0.2ml) = 500mcg BPC + 500mcg TB-500.'
    },
    efeitos_observacoes: [
      'Escolha frequente para contextos de alta demanda de cicatrização (ex.: atletas e pós-operatório em protocolos de pesquisa).',
      'Pode haver melhora rápida de dor por controle inflamatório, mas reparo estrutural exige continuidade do protocolo.'
    ],
    alertas: [
      'Monitorar evolução funcional da lesão durante todo o protocolo.',
      'Não interromper precocemente apenas por melhora inicial de dor.'
    ],
    diferencial_orion:
      'Entrega praticidade e sinergia: cliente recebe os dois ativos no mesmo frasco, sem necessidade de dois vials separados.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/blend-bpc-tb/',
    frase_operacional:
      'Em atendimento, enfatizar praticidade + sinergia e explicar de forma clara que 10 unidades na seringa já entregam a dose combinada dos dois ativos.'
  },
  tb_500_10mg_or_2026_002: {
    substancia: 'TB-500 (10mg)',
    sku: '#OR-2026-002',
    resumo_tecnico:
      'Versão sintética da Timosina Beta-4 (Tβ4), proteína endógena ligada à autorregulação de actina e reparação tecidual.',
    mecanismo:
      'Atua fortemente em migração celular, angiogênese e organização do citoesqueleto, com potencial de reduzir fibrose e rigidez pós-lesão.',
    beneficios: [
      'Aumento de flexibilidade e amplitude de movimento',
      'Recuperação acelerada de lesões musculares',
      'Redução de inflamação articular crônica',
      'Potencial proteção cardiovascular e neurológica em pesquisa avançada'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Dissolução geralmente rápida. Adicionar solvente com cuidado, sem agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      fase_carga:
        '2.5mg a 5mg por aplicação, 2x na semana (total de 5mg a 10mg semanais por 4 a 6 semanas).',
      manutencao:
        '2.5mg a 5mg uma vez por mês ou quinzenalmente.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 10mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 0.5mg.',
      dose_2_5mg:
        'Aspirar 50 unidades (0.5ml) na seringa U-100.',
      dose_5mg:
        'Aspirar 100 unidades (1.0ml / seringa cheia) na seringa U-100.'
    },
    efeitos_observacoes: [
      'Muito eficaz para recuperar mobilidade em articulações rígidas após lesões antigas.',
      'Em protocolos combinados, pode acelerar retorno funcional.'
    ],
    alertas: [
      'Por atuar em migração celular e angiogênese, evitar em pesquisas com processos oncológicos (tumores).'
    ],
    diferencial_orion:
      'Diferencial principal: devolução de mobilidade articular e organização funcional do tecido.',
    comparativo_bpc:
      "Explicar que, de forma prática, o BPC-157 foca em reparo estrutural da 'ferida', enquanto o TB-500 ajuda a 'devolver o movimento' e a funcionalidade do tecido.",
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/tb-500/',
    frase_operacional:
      'Em atendimento, destacar que TB-500 é Timosina Beta-4 sintética e enfatizar seu papel em mobilidade articular e recuperação funcional.'
  },
  blend_cjc_1295_ipamorelin_or_2026_008: {
    substancia: 'Blend CJC-1295 (5mg) + Ipamorelin (5mg)',
    sku: '#OR-2026-008',
    resumo_tecnico:
      'Combinação sinérgica de CJC-1295 (análogo de GHRH, sem DAC) com Ipamorelin (mimetizador de grelina) para liberação pulsátil fisiológica de GH.',
    mecanismo: {
      cjc_1295:
        'Estimula a hipófise a produzir/liberar Hormônio do Crescimento.',
      ipamorelin:
        'Reduz o freio da somatostatina e potencializa o pulso de GH.',
      sinergia:
        "CJC 'dá o sinal' e Ipamorelin 'abre as portas', elevando o pico de GH em relação ao uso isolado."
    },
    beneficios: [
      'Aumento de massa muscular magra',
      'Redução de gordura corporal',
      'Melhora da qualidade do sono',
      'Recuperação tecidual acelerada',
      'Suporte anti-aging (pele, cabelo e vitalidade)'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Adicionar a água muito lentamente. Não agitar; usar apenas movimentos circulares leves (peptídeos de liberação de GH são sensíveis).'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      padrao:
        '100mcg a 250mcg de cada ativo por aplicação.',
      frequencia:
        'Geralmente aplicado antes de dormir, em jejum de 2 horas, para aproveitar pico fisiológico de GH.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Frasco total 10mg (5mg + 5mg) em 2ml: cada 10 unidades U-100 entregam 250mcg de CJC + 250mcg de Ipamorelin.',
      dose_comum:
        '4 a 10 unidades por aplicação (100mcg a 250mcg de cada ativo).'
    },
    efeitos_observacoes: [
      'Pode ocorrer leve flush (calor no rosto) logo após aplicação, associado ao pulso de GH.',
      'Resultados tendem a ser melhores quando protocolo respeita janela de jejum e rotina de sono.'
    ],
    alertas: [
      'Aplicar com estômago vazio; presença de carboidratos/gorduras pode reduzir eficiência do pulso de GH.',
      'Manter consistência de horário e rotina para melhor resposta em pesquisa.'
    ],
    diferencial_orion:
      'Foco em estimular produção endógena de GH (fisiológica), abordagem mais segura que uso direto de GH sintético em protocolos de pesquisa.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/blend-cjc-ipamorelin/',
    frase_operacional:
      'Em atendimento, enfatizar sinergia CJC + Ipamorelin, segurança por estímulo endógeno de GH e importância do jejum pré-aplicação para máxima eficácia.'
  },
  ghk_cu_50mg_or_2026_016: {
    substancia: 'GHK-Cu (50mg) - Copper Peptide',
    sku: '#OR-2026-016',
    resumo_tecnico:
      'Complexo natural GHK-Cu (Glicil-L-Histidil-L-Lisina-Cobre), considerado padrão ouro em estética regenerativa e reparo tecidual profundo.',
    mecanismo:
      'Modula remodelação dérmica: estimula colágeno tipos I e III, elastina e glicosaminoglicanos, com ação antioxidante relevante (via SOD) e suporte a células dérmicas.',
    beneficios: [
      'Aumento expressivo de produção de colágeno (referências de até 70%)',
      'Redução de linhas finas e melhora de textura dérmica',
      'Aceleração de cicatrização em contexto pós-procedimento',
      'Aumento de densidade capilar por estímulo folicular',
      'Melhora de elasticidade da pele'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática (solução concentrada de 25mg/ml).',
      processo:
        'Adicionar solvente e aguardar dissolução completa; por alta densidade de 50mg, pode levar até 15 minutos. Não agitar.',
      identificacao:
        'Após mistura, a solução fica Azul Royal intenso, característica natural dos íons de cobre em alta pureza.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      estetico_iniciante: '1mg a 2mg por dia.',
      cicatrizacao_ataque:
        '3mg a 5mg por dia por cerca de 2 semanas (fase de ataque).'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 50mg em 2ml, cada 0.1ml (10 unidades U-100) equivale a 2.5mg.',
      dose_2mg:
        'Aspirar 8 unidades na seringa U-100.',
      dose_5mg:
        'Aspirar 20 unidades na seringa U-100.'
    },
    efeitos_observacoes: [
      'Pode ocorrer leve ardência local; aplicar lentamente reduz desconforto.',
      'Concentração de 50mg favorece protocolos de longa duração com menos troca de frascos.'
    ],
    alertas: [
      'Evitar excesso de suplementação de zinco em horários próximos à aplicação (competição com cobre).'
    ],
    diferencial_orion:
      'Frasco Orion com 50mg entrega concentração superior ao padrão de mercado (muitos concorrentes trabalham com 10mg/20mg), aumentando rendimento e potência de protocolo.',
    credibilidade_visual:
      'Mencionar Azul Royal pós-reconstituição como marcador técnico de cobre em alta pureza.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/ghk-cu/',
    frase_operacional:
      'Em atendimento, reforçar concentração de 50mg, solução Azul Royal e rendimento superior para protocolos prolongados.'
  },
  tesamorelin_10mg_or_2026_009: {
    substancia: 'Tesamorelin (10mg)',
    sku: '#OR-2026-009',
    resumo_tecnico:
      'Análogo sintético de GHRH, reconhecido em pesquisas clínicas para redução de lipodistrofia e gordura visceral profunda.',
    mecanismo:
      'Estimula síntese e liberação pulsátil de GH endógeno com afinidade relevante em vias de metabolismo lipídico visceral.',
    beneficios: [
      'Redução expressiva da gordura visceral abdominal',
      'Melhora de definição corporal',
      'Elevação estável de IGF-1 em protocolos de pesquisa',
      'Potenciais benefícios cognitivos em estudos de neuroproteção'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Adicionar solvente com extrema delicadeza. Tesamorelin é molécula mais longa e sensível; não agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      padrao: '1mg a 2mg por dia.',
      frequencia:
        'Aplicação 1x ao dia, preferencialmente à noite ou ao acordar em jejum.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 10mg diluído em 2ml, cada 0.1ml (10 unidades U-100) equivale a 0.5mg.',
      dose_1mg:
        'Aspirar 20 unidades (0.2ml) na seringa U-100.',
      dose_2mg:
        'Aspirar 40 unidades (0.4ml) na seringa U-100.'
    },
    efeitos_observacoes: [
      'Considerado referência para gordura visceral resistente (intra-abdominal).',
      'Resultados tendem a depender de consistência de protocolo e janela de jejum.'
    ],
    alertas: [
      'Aplicar em jejum (mínimo 2h sem ingestão calórica) para evitar bloqueio do pulso de GH por insulina.'
    ],
    diferencial_orion:
      'Posicionamento premium para gordura visceral profunda; excelente opção quando objetivo é reduzir gordura interna abdominal.',
    comparativo_aod_9604:
      'AOD-9604 é focado em lipólise mais periférica/subcutânea, enquanto Tesamorelin é focado em gordura visceral profunda via eixo GH.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/tesamorelin/',
    frase_operacional:
      'Em atendimento, destacar que Tesamorelin é referência máxima para gordura visceral e diferenciar claramente do AOD-9604.'
  },
  nad_plus_500mg_or_2026_020: {
    substancia: 'NAD+ (500mg)',
    sku: '#OR-2026-020',
    resumo_tecnico:
      'Coenzima essencial presente em todas as células, derivada de vitamina B3, fundamental para bioenergia mitocondrial e processos de reparo celular.',
    mecanismo:
      'Participa da cadeia respiratória para geração de ATP e atua como cofator de sirtuínas/PARP, com papel em manutenção de integridade do DNA e resposta ao estresse oxidativo.',
    beneficios: [
      'Aumento de energia física e mental',
      'Melhora de foco e clareza cognitiva',
      'Suporte de reparo celular profundo',
      'Apoio a protocolos de desintoxicação e recuperação metabólica',
      'Melhora de marcadores de envelhecimento em contexto de pesquisa'
    ],
    reconstituicao: {
      solvente:
        'Utilizar 5ml de Água Bacteriostática devido à alta gramatura (500mg).',
      processo:
        'Adicionar água lentamente. A solução tende a ficar densa; não agitar vigorosamente.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C. Proteger de luz e calor para evitar degradação.'
    },
    protocolo_referencia_pesquisa: {
      iniciante:
        '50mg a 100mg por aplicação, 2 a 3 vezes por semana.',
      anti_aging:
        '100mg a 200mg em dias alternados ou conforme necessidade de performance.'
    },
    matematica_u100_5ml: {
      regra_geral:
        'Com frasco de 500mg diluído em 5ml, cada 1ml (100 unidades U-100) contém 100mg.',
      dose_50mg:
        'Aspirar 50 unidades na seringa U-100.',
      dose_100mg:
        'Aspirar 100 unidades (seringa cheia).'
    },
    efeitos_observacoes: [
      'Pode ocorrer NAD flush (calor, aperto torácico leve ou náusea) quando aplicação é rápida.',
      'Aplicação lenta tende a reduzir desconforto e melhorar tolerância.'
    ],
    alertas: [
      'Se houver sensibilidade a estímulo energético, evitar aplicação próximo do horário de dormir.',
      'Manter hidratação e ritmo de aplicação controlado.'
    ],
    sinergia: {
      com_mots_c:
        'Sinergia relevante para protocolos de restauração mitocondrial.'
    },
    diferencial_orion:
      "Posicionar NAD+ como 'combustível celular' com papel central em energia e limpeza/reparo do DNA.",
    orientacao_cliente:
      "Se o cliente relatar NAD flush, explicar que pode ser uma reação normal e passageira da ativação celular, reforçando aplicação lenta.",
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/nad-plus/',
    frase_operacional:
      "Em atendimento, apresentar NAD+ como combustível celular e acalmar o cliente sobre NAD flush como resposta transitória, sem alarmismo."
  },
  ss_31_elamipretide_10mg_or_2026_031_ss: {
    substancia: 'SS-31 (Elamipretide) - 10mg',
    sku: '#OR-2026-SS10',
    resumo_tecnico:
      'Peptídeo de quarta geração voltado para proteção e estabilização mitocondrial, com afinidade pela cardiolipina da membrana interna.',
    mecanismo:
      'Liga-se à cardiolipina, reduz sua oxidação e ajuda a restaurar a arquitetura das cristas mitocondriais. Como efeito, reduz ROS e melhora eficiência de ATP sem sobrecarga celular.',
    beneficios: [
      'Recuperação muscular acelerada',
      'Redução de dano oxidativo associado ao envelhecimento',
      'Melhora de função renal e cardíaca em pesquisas',
      'Aumento de endurance e tolerância ao esforço',
      'Redução de estresse oxidativo sistêmico'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Dissolve com facilidade. Adicionar solvente pelas paredes do frasco e realizar apenas movimentos circulares leves. Não agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      padrao:
        '400mcg a 1mg por dia, conforme intensidade do protocolo de recuperação.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 10mg diluído em 2ml, cada 10 unidades U-100 equivalem a 500mcg.',
      dose_500mcg:
        'Aspirar 10 unidades.',
      dose_1mg:
        'Aspirar 20 unidades.'
    },
    efeitos_observacoes: [
      'Tende a ser percebido como redução de fadiga e aumento de capacidade sustentada, não como pico estimulante.',
      'Perfil interessante para protocolos de recuperação e performance mitocondrial.'
    ],
    alertas: [
      'Ajustar protocolo conforme objetivo de recuperação e tolerância individual em pesquisa.',
      'Manter armazenamento e manipulação corretos para estabilidade da molécula.'
    ],
    sinergia: {
      com_nad_e_mots_c:
        "Sinergia máxima com NAD+ e MOTS-C (conhecido internamente como combo de restauração mitocondrial Orion).",
      analogia_comercial:
        "MOTS-C = 'exercício em frasco', NAD+ = 'combustível', SS-31 = 'manutenção do motor'."
    },
    diferencial_orion:
      'Posicionar SS-31 como protetor estrutural da mitocôndria, complementando energia e eficiência metabólica.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/ss-31-10mg/',
    frase_operacional:
      "Em atendimento, destacar SS-31 como 'protetor da mitocôndria' e usar a analogia do motor para facilitar entendimento do combo com MOTS-C e NAD+."
  },
  mots_c_40mg_or_2026_017: {
    substancia: 'MOTS-C (40mg)',
    sku: '#OR-2026-017',
    resumo_tecnico:
      'Peptídeo derivado da mitocôndria (MDP), 16 aminoácidos, conhecido como mimético de exercício por replicar adaptações metabólicas de alta intensidade.',
    mecanismo:
      'Ativa via AMPK, promove homeostase metabólica, aumenta oxidação de ácidos gordos e favorece biogénese mitocondrial, com modulação de expressão gênica metabólica.',
    beneficios: [
      'Queima acentuada de gordura visceral',
      'Aumento de resistência física e endurance',
      'Melhora de sensibilidade insulínica',
      'Suporte contra declínio metabólico relacionado à idade',
      'Apoio à longevidade celular em protocolos de pesquisa'
    ],
    reconstituicao: {
      solvente:
        'Utilizar 2ml (200 unidades) de Água Bacteriostática.',
      processo:
        'Peptídeo sensível: injetar água e realizar apenas movimentos circulares suaves (swirl). NÃO agitar.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      ciclo_metabolico_performance:
        '5mg por aplicação, 3x por semana (ex.: Seg/Qua/Sex).',
      longevidade:
        '5mg a 10mg, 1x por semana.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Frasco de 40mg em 2ml = 20mg por ml.',
      dose_5mg:
        'Aspirar 25 unidades (0.25ml) na seringa U-100.'
    },
    efeitos_observacoes: [
      'MOTS-C Sting: leve ardência ou prurido local por alguns minutos pode ser normal e esperado.',
      'Retirar o frasco da geladeira cerca de 15 minutos antes da aplicação pode reduzir desconforto.'
    ],
    alertas: [
      'Aplicação 30 minutos antes de exercício pode potencializar ativação de AMPK em protocolos de pesquisa.',
      'Se houver sinais sistêmicos intensos fora do padrão local, reavaliar protocolo.'
    ],
    diferencial_orion:
      'Por alta carga de 40mg, exigir cuidado técnico máximo no preparo: nunca agitar, apenas swirl suave.',
    orientacao_cliente:
      'A ardência local (Sting) geralmente é característica esperada do produto e não necessariamente reação alérgica.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/mots-c/',
    frase_operacional:
      'Em atendimento, ser enfático sobre NÃO agitar o frasco e educar sobre o MOTS-C Sting para reduzir insegurança do cliente.'
  },
  slu_pp_332_5mg_or_2026_033_slu: {
    substancia: 'SLU-PP-332 (5mg)',
    sku: '#OR-2026-SLU5',
    resumo_tecnico:
      'Agonista pan-ERR (ERRα/ERRβ/ERRγ), considerado mimético de exercício de nova geração para modulação metabólica avançada.',
    mecanismo:
      "Ativa recetores ERR e desloca o metabolismo de glicose para oxidação de ácidos gordos, com aumento de biogénese mitocondrial no músculo esquelético — simulando adaptações de treino de resistência prolongado.",
    beneficios: [
      'Aumento significativo de resistência física em modelos de pesquisa',
      'Melhoria da função metabólica global',
      'Proteção contra ganho de peso em contexto de dieta hipercalórica',
      'Fortalecimento funcional de fibras musculares tipo I (resistência)'
    ],
    reconstituicao: {
      solvente: 'Utilizar 2ml de Água Bacteriostática.',
      processo:
        'Adicionar solvente com cuidado. Evitar agitação mecânica; usar apenas movimentos circulares lentos.'
    },
    armazenamento: {
      pos_reconstituicao:
        'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      padrao:
        '500mcg a 1mg por dia.'
    },
    matematica_u100_2ml: {
      regra_geral:
        'Com frasco de 5mg diluído em 2ml, cada 10 unidades U-100 equivalem a 250mcg.',
      dose_500mcg:
        'Aspirar 20 unidades.',
      dose_1mg:
        'Aspirar 40 unidades.'
    },
    efeitos_observacoes: [
      'Muito útil para protocolos de body recomposition (redução de gordura com manutenção/ganho de performance).',
      'Pode ampliar tolerância ao treino e reduzir sensação de fadiga precoce em protocolos de pesquisa.'
    ],
    alertas: [
      'Não substitui treino de força; atua como potencializador de adaptação metabólica.',
      'Monitorar resposta individual em protocolos de endurance.'
    ],
    sinergia: {
      com_gw_501516:
        'Sinergia relevante em estratégias de resistência e oxidação lipídica.',
      com_mots_c:
        'Combinação de alto valor para performance mitocondrial e eficiência metabólica.'
    },
    diferencial_orion:
      'Posicionar como avanço recente em resistência muscular via eixo ERR, ideal para atletas com foco em performance sem fadiga prematura.',
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/slu-pp-332-5mg/',
    frase_operacional:
      'Em atendimento, explicar que o SLU-PP-332 atua nos recetores ERR para favorecer uso de gordura como combustível e elevar capacidade de treino.'
  },
  tirzepatide_120mg_or_2026_120: {
    substancia: 'Tirzepatide (120mg)',
    sku: '#OR-2026-120',
    resumo_tecnico:
      'Apresentação de alta carga do agonista duplo GIP/GLP-1 para protocolos de pesquisa com escalonamento avançado e maior rendimento por frasco.',
    reconstituicao: {
      solvente: 'Recomendado 2ml de Água Bacteriostática; ajustar volume conforme precisão desejada em microdoses.',
      processo: 'Diluir sem agitar vigorosamente; movimentos circulares suaves até dissolução completa.'
    },
    armazenamento: {
      pos_reconstituicao: 'Refrigeração obrigatória entre 2°C e 8°C.'
    },
    protocolo_referencia_pesquisa: {
      nota: 'Seguir protocolos de referência Orion para Tirzepatide com ajuste proporcional à concentração do frasco de 120mg.'
    },
    link_ficha_tecnica: 'https://orionpeptideos.com/substancias/tirzepatide/',
    frase_operacional:
      'Posicionar como linha de máximo rendimento para pesquisadores que já dominam titulação em frascos menores.'
  },
  hgh_frag_15mg_or_2026_hgh15: {
    substancia: 'HGH Fragment 176-191 (15mg)',
    sku: '#OR-2026-HGH15',
    resumo_tecnico:
      'Fragmento lipolítico associado ao eixo do hormônio do crescimento; foco em pesquisas de composição corporal e oxidação de gordura.',
    reconstituicao: {
      solvente: '2ml de Água Bacteriostática (referência comum para doses em mcg/mg).',
      processo: 'Swirl suave; evitar agitação mecânica.'
    },
    armazenamento: { pos_reconstituicao: 'Refrigeração entre 2°C e 8°C.' },
    protocolo_referencia_pesquisa: {
      nota: 'Dosagens típicas em pesquisa ficam na faixa de microgramas; calibrar conforme concentração final pós-reconstituição.'
    },
    frase_operacional: 'Diferenciar de GH completo: fragmento sem eixo de IGF-1 sistêmico típico do GH nativo.'
  },
  selank_11mg_or_2026_slk11: {
    substancia: 'Selank (11mg)',
    sku: '#OR-2026-SLK11',
    resumo_tecnico:
      'Peptídeo anxiolítico nootrópico de pesquisa (análogo sintético relacionado a tuftsin), com foco em eixo GABA/modulação do humor.',
    reconstituicao: {
      solvente: '1–2ml de Água Bacteriostática conforme precisão de volume.',
      processo: 'Reconstituição delicada; não agitar.'
    },
    armazenamento: { pos_reconstituicao: 'Refrigeração entre 2°C e 8°C.' },
    protocolo_referencia_pesquisa: {
      nota: 'Protocolos de pesquisa costumam usar doses baixas (mcg); ajustar à concentração final.'
    },
    frase_operacional: 'Enfatizar perfil cognitivo/ansiedade experimental em modelos de pesquisa.'
  },
  semax_11mg_or_2026_smx11: {
    substancia: 'Semax (11mg)',
    sku: '#OR-2026-SMX11',
    resumo_tecnico:
      'Peptídeo nootrópico derivado de ACTH (fragmento 4-7), estudado em foco, neuroproteção e fluxo cerebral em pesquisa.',
    reconstituicao: {
      solvente: '1–2ml de Água Bacteriostática.',
      processo: 'Swirl suave até dissolução.'
    },
    armazenamento: { pos_reconstituicao: 'Refrigeração entre 2°C e 8°C.' },
    protocolo_referencia_pesquisa: {
      nota: 'Doses de referência em pesquisa são frequentemente intranasais ou injetáveis em microgramas; seguir protocolo do laboratório.'
    },
    frase_operacional: 'Comparar com Selank: Semax com viés mais cognitivo/energia; Selank mais ansiolítico em relatos de pesquisa.'
  },
  pt_141_10mg_or_2026_pt141: {
    substancia: 'PT-141 (Bremelanotide) (10mg)',
    sku: '#OR-2026-PT141',
    resumo_tecnico:
      'Agonista de receptores MC (melanocortina) estudado em contextos de resposta sexual e libido em modelos de pesquisa.',
    reconstituicao: {
      solvente: '2ml de Água Bacteriostática (referência típica para titulação).',
      processo: 'Evitar calor e agitação vigorosa.'
    },
    armazenamento: { pos_reconstituicao: 'Refrigeração entre 2°C e 8°C.' },
    protocolo_referencia_pesquisa: {
      nota: 'Respeitar intervalos mínimos entre protocolos em estudos; hipertensão/flush são pontos de atenção em literatura.'
    },
    alertas: ['Monitorar pressão arterial em protocolos sensíveis.'],
    frase_operacional: 'Uso estritamente para pesquisa laboratorial; não prometer uso clínico.'
  },
  ipamorelin_10mg_or_2026_ipa10: {
    substancia: 'Ipamorelin (10mg)',
    sku: '#OR-2026-IPA10',
    resumo_tecnico:
      'Secretagogo de GH (pentapeptídeo) com alta especificidade no receptor GHS-1a; estímulo pulsátil de GH com baixo impacto em cortisol/prolactina em modelos de pesquisa.',
    reconstituicao: {
      solvente: '2ml de Água Bacteriostática.',
      processo: 'Swirl suave.'
    },
    armazenamento: { pos_reconstituicao: 'Refrigeração entre 2°C e 8°C.' },
    protocolo_referencia_pesquisa: {
      nota: 'Frequências comuns em pesquisa: 1–3x/dia; ajustar mcg conforme solução final.'
    },
    frase_operacional: 'Diferenciar do blend CJC+IPA: aqui apenas Ipamorelin isolado para pesquisa.'
  },
  agua_bacteriostatica_10ml_or_2026_bac10: {
    substancia: 'Água Bacteriostática (10ml)',
    sku: '#OR-2026-BAC10',
    resumo_tecnico:
      'Solvente estéril com conservante para reconstituição de peptídeos liofilizados em laboratório de pesquisa.',
    uso: 'Diluente para preparo de frascos liofilizados; não é o mesmo produto que água estéril para irrigação sem conservante.',
    reconstituicao: {
      aplicacao: 'Utilizar agulha/seringa estéril; manter assepsia ao perfurar o frasco.',
      armazenamento: 'Conforme rótulo; tipicamente local fresco após aberto, respeitando validade.'
    },
    frase_operacional: 'Enfatizar uso exclusivo como diluente para insumos de pesquisa, nunca como veículo injetável isolado sem protocolo.'
  }
};
