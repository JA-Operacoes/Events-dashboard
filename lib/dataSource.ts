/**
 * Camada de dados do template. Cada módulo (financeiro, operacional,
 * credenciamento) tem
 * um contrato de retorno próprio e uma função de fetch isolada — trocar de
 * evento/edição não muda nenhuma tela, apenas o `ModuleContext` repassado a
 * essas funções.
 *
 * Para plugar a API externa: implemente o `fetch(...)` comentado dentro de
 * cada função, usando `ctx.eventId` / `ctx.editionId` para montar a URL ou
 * os query params.
 */

export type ModuleContext = {
  eventId: string | null;
  editionId: string | null;
};

/* ---------------------------- Financeiro ---------------------------- */

/** "cortesia" é o ingresso/convite liberado sem cobrança — valor zero, mas nem pago nem pendente. */
export type InvoiceStatus = "pago" | "pendente" | "cortesia" | "cancelado";

/**
 * De onde vem a receita, para o recorte da tela. A origem vem da coluna
 * "Origem" da planilha ou da escolha feita no import. Duplicata que não se
 * encaixa em nenhuma das três (o ERP manda "FINANCEIRO" em algumas linhas)
 * fica sem classificação e aparece só na visão geral — melhor não aparecer num
 * recorte do que aparecer no recorte errado.
 */
export type OrigemReceita = "expositor" | "ingresso";

export type Invoice = {
  numero: string;
  cliente: string;
  cnpj: string;
  /** Mantido para as linhas já gravadas; o painel não usa mais esta data. */
  vencimento: string;
  pagamento: string | null;
  forma: string;
  valor: number;
  status: InvoiceStatus;
  /**
   * Quantos ingressos a duplicata representa. Só existe nas planilhas de
   * ingresso que trazem a coluna; sem ela, a duplicata conta como 1.
   */
  quantidade?: number | null;
  /**
   * Campos que só a planilha de ingresso traz (relatório de credenciamento).
   * Ficam num objeto à parte porque não existem em contas a receber — e é ele
   * que alimenta os painéis exclusivos do recorte de ingressos.
   */
  ingresso?: DadosIngresso | null;
  /** Texto cru da coluna "Origem" da planilha — preservado para a tabela. */
  origem?: string;
  /** Classificação da origem usada pelo filtro; nula quando não se encaixa em nenhuma. */
  origemTipo?: OrigemReceita | null;
  /** Rateio de contas/centro de custo — opcionais, algumas planilhas de ERP trazem até 4 por duplicata. */
  centroCusto?: string | null;
  conta1?: string | null;
  conta2?: string | null;
  conta3?: string | null;
  /** Preenchido apenas no modo planilha — identifica qual arquivo importado gerou esta linha. */
  sourceFile?: string;
  /**
   * De qual das três planilhas do financeiro a linha veio (ver FINANCEIRO_TIPOS).
   * É o que permite ter as duas fontes de ingresso carregadas ao mesmo tempo sem
   * cobrar a mesma venda duas vezes: o dinheiro sai do contas a receber, e do
   * credenciamento vem só contagem, perfil e presença.
   */
  fonte?: string;
};

export type DadosIngresso = {
  /** Se a pessoa passou pela catraca. Nulo quando a planilha não informa. */
  compareceu?: boolean | null;
  /** Valor devido (total a pagar), que pode ser maior que o pago. */
  valorDevido?: number | null;
  /** Lote/origem do convite — no relatório, a coluna "Edição" ("… - LIDER - CONVIDADO VIP"). */
  convite?: string;
  categoria?: string;
  cargo?: string;
  segmento?: string;
  estado?: string;
  pais?: string;
  /** Data do cadastro, texto cru da planilha. */
  cadastro?: string;
  /**
   * Dia em que a pessoa compareceu. No relatório de credenciamento é a data de
   * impressão do crachá — é quando ela passou no balcão.
   */
  dataComparecimento?: string;
  /** Hora em que passou no balcão ("14:25:03"), da mesma origem da data. */
  horaComparecimento?: string;
};

/** Leituras que só fazem sentido no recorte de ingressos. */
export type IngressoStats = {
  compareceram: number;
  faltaram: number;
  /** Percentual de comparecimento (0-100); nulo quando a planilha não traz a coluna. */
  taxaComparecimento: number | null;
  /** Valor ainda em aberto: devido menos pago. */
  valorEmAberto: number | null;
  /** Comparecimento separado por situação de pagamento. */
  comparecimentoPorStatus: Array<{ status: InvoiceStatus; compareceu: number; faltou: number }>;
  /** Rankings completos e ordenados — a tela mostra o topo e abre o resto sob demanda. */
  convites: Array<{ name: string; value: number }>;
  categorias: Array<{ name: string; value: number }>;
  cargos: Array<{ name: string; value: number }>;
  segmentos: Array<{ name: string; value: number }>;
  estados: Array<{ name: string; value: number }>;
  paises: Array<{ name: string; value: number }>;
  /** Cadastros por dia, para a curva de inscrição. */
  cadastrosPorDia: Array<{ date: string; cadastros: number }>;
  /** Público por dia do evento, em ordem de data. */
  comparecimentoPorDia: Array<{ name: string; value: number }>;
  /** Público por dia e hora — alimenta o gráfico de fluxo do credenciamento. */
  comparecimentoPorHora: Array<{ dia: string; hora: number; pessoas: number }>;
  /** Documentos que aparecem em mais de um ingresso. */
  documentosRepetidos: number;
  documentosDistintos: number;
};

export type FinanceiroFilters = {
  period: "all" | "30d" | "7d" | "custom";
  /** "all" é a visão geral — expositor e ingresso somados, como era antes. */
  origem: "all" | OrigemReceita;
  method: "all" | "boleto" | "cartao" | "pix";
  status: "all" | InvoiceStatus;
  search: string;
};

export type FinanceiroData = {
  asOf: string | null;
  kpis: {
    totalRecebido: number | null;
    ticketMedio: number | null;
    qtdDuplicatas: number | null;
    /** Ingressos comprados — soma das quantidades (duplicata sem quantidade conta 1). */
    qtdIngressos: number | null;
    /**
     * Valor ainda não recebido dos ingressos (devido menos pago). Calculado
     * direto, sem a agregação completa de público — essa mora no
     * credenciamento desde que o módulo virou dono desses dados.
     */
    valorEmAberto: number | null;
  };
  /** Recebimentos por dia. Só o realizado: o previsto dependia do vencimento,
   *  que saiu do painel porque o ERP regera a duplicata ao vencer. */
  timeline: Array<{ date: string; recebido: number }>;
  paymentMethods: Array<{ label: string; value: number }>;
  topClients: Array<{ name: string; value: number }>;
  statusBreakdown: Array<{ label: InvoiceStatus; value: number }>;
  /** Rateio por conta/centro de custo — só existe quando a planilha importada traz alguma coluna "Conta". */
  contas: Array<{ name: string; value: number }>;
  /** Quanto cada origem representa — vazio quando a planilha não traz a coluna. */
  origens: Array<{ label: OrigemReceita; value: number }>;
  /** Preenchido quando há duplicatas com dados de ingresso; nulo caso contrário. */
  invoices: Invoice[];
};

export async function fetchFinanceiro(
  ctx: ModuleContext,
  _filters: FinanceiroFilters
): Promise<FinanceiroData | null> {
  // const res = await fetch(`https://api.exemplo.com/eventos/${ctx.eventId}/edicoes/${ctx.editionId}/financeiro?...`);
  // if (!res.ok) throw new Error("Falha ao carregar dados financeiros");
  // return res.json();
  return null;
}

/* ---------------------------- Operacional --------------------------- */

/**
 * Status de PAGAMENTO do pedido de serviço, como as planilhas de contratação
 * trazem. "isento" cobre tudo que não gera cobrança (isenção, cortesia, sem
 * débito/crédito) e "cancelado" cobre tudo que foi recusado ou desfeito —
 * separar esses casos criava status que ninguém usava para decidir nada.
 */
export type ServicoStatus = "pago" | "pendente" | "cancelado" | "isento";

/**
 * Um pedido de serviço operacional feito por um expositor (uma linha da
 * planilha de contratação: recepcionista, limpeza, segurança...). Cada
 * serviço tem sua planilha e nem todas trazem as mesmas colunas: algumas têm
 * data/hora de início e fim, outras só turno, muitas não têm quantidade. Só
 * expositor e status são exigidos no import — o resto é preenchido quando
 * existir, e a tela esconde as colunas que ficaram vazias.
 */
export type PedidoServico = {
  /** Qual serviço a linha representa — vem do arquivo importado, não de uma coluna. */
  servico: string;
  /** Razão social do expositor. */
  expositor: string;
  nomeFantasia: string;
  cnpj: string;
  estande: string;
  /** Pavilhão/setor onde fica o estande. */
  localizacao: string;
  /**
   * Tipo/montagem do estande ("PROMOTOR BÁSICO", "static display", "challet
   * vilage"...). Vem da coluna "Montagem" / "Tipo de Montagem" / "Tipo de
   * Estande" da planilha, que nem todo serviço traz.
   */
  tipoEstande: string;
  /** Quantos itens do serviço (ex.: 2 recepcionistas). Sem coluna na planilha, cada linha conta como 1. */
  quantidade: number;
  /** Nº de dias contratados — informado na planilha ou calculado de dataInicio/dataFim. */
  dias: number | null;
  /** Texto cru da planilha ("03/09/2026" ou ISO) — os formatos variam demais pra converter no import. */
  dataInicio: string;
  dataFim: string;
  /** Texto cru da planilha ("08:00", "8h"). */
  horaInicio: string;
  horaFim: string;
  /** Manhã/tarde/integral — algumas planilhas usam isso no lugar de horário. */
  turno: string;
  status: ServicoStatus;
  /**
   * Valor total da linha, quando a planilha traz preço. Já multiplicado pela
   * quantidade nos casos em que a coluna é unitária ("Valor Unitário") — aqui
   * é sempre o total daquele pedido. Nulo quando a planilha não tem valor.
   */
  valor: number | null;
  /**
   * Potência elétrica contratada, em kVA. Só o relatório de elétrica traz —
   * é o número que dimensiona quadro, cabeamento e gerador do pavilhão.
   */
  kva: number | null;
  /** Área do estande em m², quando a planilha informa. */
  area: number | null;
  /**
   * O que foi contratado dentro do serviço: "Câmera de Monitoramento",
   * "Mesa redonda"... O serviço diz de qual planilha veio; o equipamento diz
   * qual item daquela planilha.
   */
  equipamento: string;
  /**
   * Variação do item — "220V" na elétrica, "Bilíngue" na recepcionista. Cada
   * serviço chama de um jeito, por isso o campo é genérico.
   */
  tipo: string;
  /** Preenchido apenas no modo planilha — identifica qual arquivo importado gerou esta linha. */
  sourceFile?: string;
};

export type OperacionalFilters = {
  /** Nome do serviço — texto livre vindo do arquivo, então "all" ou o valor exato. */
  servico: "all" | string;
  status: "all" | ServicoStatus;
  search: string;
};

/**
 * Expositor da edição, vindo da listagem geral (não de um serviço). É a base
 * usada para responder "quantos dos expositores contrataram alguma coisa" —
 * sem ela só dá para contar quem aparece nas planilhas de serviço.
 */
export type ExpositorBase = {
  expositor: string;
  nomeFantasia: string;
  cnpj: string;
  estande: string;
  localizacao: string;
  tipoEstande: string;
  area: number | null;
  sourceFile: string;
};

/** Cálculo de energia de um estande. */
export type EstandeEnergia = {
  estande: string;
  expositor: string;
  /** Área em m² usada no cálculo da franquia. */
  area: number | null;
  /** Áreas diferentes informadas para o mesmo estande, quando houver. */
  areasDivergentes: number[] | null;
  /**
   * Franquia do contrato de participação: 0,11 kVA/m², já arredondada para a
   * unidade inteira acima — a energia é fornecida em kVA não fracionado.
   */
  kvaIncluso: number | null;
  /** kVA que o expositor contratou por fora, direto no relatório de elétrica. */
  kvaAdicional: number;
  /** Franquia + adicional: a potência que o estande tem disponível. */
  kvaTotal: number | null;
  /** kvaAdicional × valor do kVA. */
  valorAdicional: number;
};

export type EnergiaPorEstande = {
  linhas: EstandeEnergia[];
  /** kVA/m² incluídos no contrato de participação. */
  kvaPorM2: number;
  valorPorKva: number;
  /** Estandes sem área informada — a franquia deles não dá para calcular. */
  semArea: number;
};

export type OperacionalData = {
  asOf: string | null;
  kpis: {
    /** Soma das quantidades pedidas (ex.: 12 recepcionistas). */
    totalItens: number | null;
    /**
     * Média de serviços distintos por expositor que contratou (ex.: 2,4).
     * Mede se quem contrata leva mais de um serviço — a leitura de isenção que
     * ficava aqui já é visível no painel de status.
     */
    servicosPorExpositor: number | null;
    /** Quantos expositores diferentes têm pedido nesta edição. */
    qtdExpositores: number | null;
    /**
     * Total de expositores da edição, da listagem geral importada. Nulo
     * quando essa listagem não foi importada — aí o KPI mostra só quantos
     * contrataram, sem o "de X".
     */
    qtdExpositoresBase: number | null;
    /**
     * Potência total disponível no evento: franquia de contrato de todos os
     * estandes + adicional contratado. Nulo quando nenhuma planilha traz kVA.
     */
    kvaTotal: number | null;
  };
  servicos: Array<{ label: string; value: number }>;
  /** Ranking completo de expositores por quantidade — a tela recorta o topo. */
  topExpositores: Array<{ name: string; value: number }>;
  statusBreakdown: Array<{ label: ServicoStatus; value: number }>;
  /** Itens contratados por tipo de estande — só existe quando a planilha traz a coluna. */
  tiposEstande: Array<{ name: string; value: number }>;
  /** Itens por equipamento contratado — vazio quando a planilha não tem a coluna. */
  equipamentos: Array<{ name: string; value: number }>;
  /** Itens por variação/tipo do item — vazio quando a planilha não tem a coluna. */
  tipos: Array<{ name: string; value: number }>;
  /**
   * Energia elétrica por estande: o que o contrato já inclui (0,11 kVA/m²),
   * o que foi contratado e quanto disso é excedente a cobrar. Nulo quando as
   * planilhas não trazem kVA e área — é o caso de todo serviço que não seja
   * o relatório de elétrica.
   */
  energia: EnergiaPorEstande | null;
  /**
   * Expositores da listagem geral sem nenhum serviço contratado. Vazio quando
   * a listagem não foi importada.
   */
  expositoresSemContratacao: ExpositorBase[];
  pedidos: PedidoServico[];
};

export async function fetchOperacional(
  ctx: ModuleContext,
  _filters: OperacionalFilters
): Promise<OperacionalData | null> {
  // const res = await fetch(`https://api.exemplo.com/eventos/${ctx.eventId}/edicoes/${ctx.editionId}/operacional?...`);
  // if (!res.ok) throw new Error("Falha ao carregar dados operacionais");
  // return res.json();
  return null;
}

/* -------------------------- Credenciamento -------------------------- */

export type CredenciamentoStatus = "credenciado" | "pendente" | "cancelado";

export type Participante = {
  nome: string;
  documento: string;
  categoria: string;
  credenciadoEm: string | null;
  checkinEm: string | null;
  status: CredenciamentoStatus;
  /**
   * Perfil e presença do participante, quando a planilha de credenciamento
   * traz essas colunas (comparecimento, cargo, segmento, estado/país...). É o
   * mesmo formato usado no relatório de ingressos — a leitura do público vive
   * neste módulo, e o financeiro fica só com o dinheiro.
   */
  ingresso?: DadosIngresso | null;
  /** Valor pago pelo ingresso, quando informado. */
  valor?: number | null;
  /** Situação de pagamento do ingresso — separada do status de credenciamento. */
  statusPagamento?: InvoiceStatus | null;
  /** Preenchido apenas no modo planilha — identifica qual arquivo importado gerou esta linha. */
  sourceFile?: string;
};

export type CredenciamentoFilters = {
  period: "all" | "30d" | "7d" | "custom";
  categoria: "all" | string;
  status: "all" | CredenciamentoStatus;
  search: string;
};

export type CredenciamentoData = {
  asOf: string | null;
  kpis: {
    totalCredenciados: number | null;
    presencaConfirmada: number | null;
    checkinsRealizados: number | null;
    taxaComparecimento: number | null; // percentual 0-100
  };
  timeline: Array<{ date: string; credenciados: number; checkins: number }>;
  /**
   * Leitura do público: comparecimento, fluxo por dia/hora, perfil (cargo,
   * segmento, categoria) e origem geográfica. Nulo quando a planilha
   * importada não traz nenhuma dessas colunas.
   */
  publico: IngressoStats | null;
  categorias: Array<{ label: string; value: number }>;
  statusBreakdown: Array<{ label: CredenciamentoStatus; value: number }>;
  participantes: Participante[];
};

export async function fetchCredenciamento(
  ctx: ModuleContext,
  _filters: CredenciamentoFilters
): Promise<CredenciamentoData | null> {
  // const res = await fetch(`https://api.exemplo.com/eventos/${ctx.eventId}/edicoes/${ctx.editionId}/credenciamento?...`);
  // if (!res.ok) throw new Error("Falha ao carregar dados de credenciamento");
  // return res.json();
  return null;
}

