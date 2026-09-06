// =========================================================================
// MÓDULO DE INTEGRAÇÃO: META CLOUD API (WHATSAPP BUSINESS PLATFORM)
// Dr. André Calazans | Assessoria em Cálculos Trabalhistas PJe-Calc
// =========================================================================
// Status atual: MODO DE ESPERA / SIMULAÇÃO (ATIVO: false)
//
// Para ativar quando assinar a Meta:
// 1. Altere ATIVO para: true
// 2. Cole seu PHONE_NUMBER_ID e ACCESS_TOKEN gerados em developers.facebook.com
// =========================================================================

const META_WHATSAPP_CONFIG = {
  ATIVO: false, // <-- Deixe false por enquanto. Mude para true quando contratar a Meta.
  PHONE_NUMBER_ID: "SEU_PHONE_NUMBER_ID_META",
  ACCESS_TOKEN: "SEU_BEARER_TOKEN_META",
  VERSAO_API: "v19.0"
};

/**
 * Higieniza e formata o número para o padrão internacional (E.164)
 * Ex: (21) 99999-8888 -> 5521999998888
 */
function formatarNumeroWhatsApp(numeroOriginal) {
  if (!numeroOriginal) return null;
  let limpo = String(numeroOriginal).replace(/\D/g, "");

  // Se o advogado digitou sem o DDI do Brasil (55), adiciona automaticamente
  if (limpo.length === 10 || limpo.length === 11) {
    limpo = "55" + limpo;
  }

  // Validação mínima de comprimento com DDI
  if (limpo.length < 12 || limpo.length > 14) {
    return null;
  }

  return limpo;
}

/**
 * Função central de despacho para a Meta Cloud API
 * @param {string} telefoneDestino Telefone do advogado ou cliente
 * @param {string} textoMensagem Texto estruturado da notificação
 * @param {string} tipoEvento Tipo do evento para rastreio
 * @param {string} pedidoId Identificador único do processo no Supabase
 * @param {object} supabaseClient Instância do cliente Supabase para gravação de logs
 */
async function despacharWhatsApp(telefoneDestino, textoMensagem, tipoEvento, pedidoId, supabaseClient) {
  const numeroFormatado = formatarNumeroWhatsApp(telefoneDestino);

  if (!numeroFormatado) {
    console.warn(`[WhatsApp Service] Número inválido ignorado: "${telefoneDestino}" (Processo ID: ${pedidoId})`);
    return;
  }

  // -----------------------------------------------------------------------
  // 1. MODO SIMULAÇÃO (FEATURE FLAG = FALSE)
  // -----------------------------------------------------------------------
  if (!META_WHATSAPP_CONFIG.ATIVO) {
    console.groupCollapsed(`%c[WhatsApp Meta - SIMULAÇÃO] Evento: ${tipoEvento}`, "color: #00e599; font-weight: bold;");
    console.log(`Para: +${numeroFormatado}`);
    console.log(`Processo ID: ${pedidoId}`);
    console.log(`Mensagem:\n${textoMensagem}`);
    console.groupEnd();

    // Registra a tentativa simulada no banco de dados para conferência
    try {
      if (supabaseClient) {
        await supabaseClient.from('notificacoes_whatsapp_log').insert([{
          pedido_id: pedidoId,
          destinatario_numero: numeroFormatado,
          tipo_evento: tipoEvento,
          corpo_mensagem: textoMensagem,
          enviado: false,
          resposta_meta: { status: "simulado_feature_flag_inativa" }
        }]);
      }
    } catch (errLog) {
      console.error("[WhatsApp Service] Falha ao registrar log simulado no Supabase:", errLog);
    }
    return;
  }

  // -----------------------------------------------------------------------
  // 2. DISPARO REAL EM PRODUÇÃO (META GRAPH API)
  // -----------------------------------------------------------------------
  const urlEndpoint = `https://graph.facebook.com/${META_WHATSAPP_CONFIG.VERSAO_API}/${META_WHATSAPP_CONFIG.PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: numeroFormatado,
    type: "text",
    text: {
      preview_url: true,
      body: textoMensagem
    }
  };

  try {
    const resposta = await fetch(urlEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${META_WHATSAPP_CONFIG.ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const respostaDados = await resposta.json();

    // Log de auditoria no Supabase
    if (supabaseClient) {
      await supabaseClient.from('notificacoes_whatsapp_log').insert([{
        pedido_id: pedidoId,
        destinatario_numero: numeroFormatado,
        tipo_evento: tipoEvento,
        corpo_mensagem: textoMensagem,
        enviado: resposta.ok,
        resposta_meta: respostaDados
      }]);
    }

    if (!resposta.ok) {
      console.error("[WhatsApp Meta API] Erro no envio retornado pela Meta:", respostaDados);
    }
  } catch (erroRede) {
    console.error("[WhatsApp Meta API] Falha de comunicação com a rede da Meta:", erroRede);
  }
}

// =========================================================================
// GATILHOS DE NOTIFICAÇÃO ESPECÍFICOS DO FLUXO PERICIAL
// =========================================================================

/**
 * Gatilho 1: Notifica quando o perito orça o laudo e disponibiliza o checkout InfinitePay
 */
async function notificarCobrancaWhatsApp(pedido, linkPagamento, valorNumerico, supabaseClient) {
  if (!pedido) return;
  const valorFormatado = parseFloat(valorNumerico || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const mensagem = 
    `🏛️ *Dr. André Calazans | Cálculos Trabalhistas PJe-Calc*\n\n` +
    `Prezado(a) colega, os honorários periciais para elaboração dos cálculos dos autos *${pedido.numero_processo}* foram orçados.\n\n` +
    `💰 *Valor:* ${valorFormatado}\n` +
    `💳 *Condições:* Pix ou parcelado em até *12x no cartão*.\n\n` +
    `🔗 *Link seguro para pagamento:*\n${linkPagamento}\n\n` +
    `_Nota: Caso o custeio seja de responsabilidade do reclamante ou da empresa cliente, você pode repassar este mesmo link diretamente a ele._`;

  await despacharWhatsApp(pedido.cliente_whatsapp, mensagem, "cobranca_gerada", pedido.id, supabaseClient);
}

/**
 * Gatilho 2: Notifica a confirmação do pagamento (reconhecido via InfinitePay Webhook)
 */
async function notificarPagamentoConfirmadoWhatsApp(pedido, supabaseClient) {
  if (!pedido) return;
  const dataPrazo = pedido.prazo_fatal ? pedido.prazo_fatal.split('-').reverse().join('/') : 'a confirmar';

  const mensagem = 
    `✅ *Dr. André Calazans | Confirmação de Pagamento*\n\n` +
    `O pagamento referente aos cálculos dos autos *${pedido.numero_processo}* foi confirmado com sucesso!\n\n` +
    `O processo ingressou automaticamente na esteira de elaboração técnica, com prioridade alinhada ao prazo fatal de *${dataPrazo}*.\n\n` +
    `Você receberá o aviso de conclusão aqui assim que o laudo demonstrativo e o arquivo .PJC forem disponibilizados.`;

  await despacharWhatsApp(pedido.cliente_whatsapp, mensagem, "pagamento_confirmado", pedido.id, supabaseClient);
}

/**
 * Gatilho 3: Notifica novo apontamento técnico feito pelo perito no fórum (ex: Art. 840 CLT, divisor, reflexos)
 */
async function notificarComentarioWhatsApp(pedido, textoApontamento, supabaseClient) {
  if (!pedido) return;

  const mensagem = 
    `📋 *Dr. André Calazans | Alinhamento Técnico Pericial*\n\n` +
    `Há uma nova observação técnica registrada nos autos *${pedido.numero_processo}*:\n\n` +
    `_"${textoApontamento}"_\n\n` +
    `Acesse a plataforma para responder ou alinhar os parâmetros do cálculo:\n` +
    `https://andrecalazans.com.br/meus-pedidos.html`;

  await despacharWhatsApp(pedido.cliente_whatsapp, mensagem, "novo_apontamento_tecnico", pedido.id, supabaseClient);
}

/**
 * Gatilho 4: Notifica a entrega final dos arquivos do cálculo
 */
async function notificarEntregaWhatsApp(pedido, linkGoogleDrive, supabaseClient) {
  if (!pedido) return;

  const mensagem = 
    `🎉 *Dr. André Calazans | Cálculos Finalizados & Prontos!*\n\n` +
    `Os cálculos trabalhistas dos autos *${pedido.numero_processo}* foram concluídos com fundamentação jurídica completa.\n\n` +
    `📁 *Arquivos disponibilizados:*\n` +
    `• Relatório pericial em PDF formatado para juntada aos autos\n` +
    `• Arquivo nativo exportado do *PJe-Calc (.PJC)* para validação ou ajustes\n\n` +
    `🔗 *Acesse os arquivos no Google Drive:*\n${linkGoogleDrive}\n\n` +
    `Os documentos também estão disponíveis na sua área do cliente em https://andrecalazans.com.br/meus-pedidos.html.`;

  await despacharWhatsApp(pedido.cliente_whatsapp, mensagem, "calculo_entregue", pedido.id, supabaseClient);
}
