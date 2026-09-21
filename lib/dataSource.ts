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

export type InvoiceStatus = "pago" | "pendente" | "atrasado" | "cancelado";

export type Invoice = {
  numero: string;
  cliente: string;
  cnpj: string;
  vencimento: string;
  pagamento: string | null;
  forma: string;
  valor: number;
  status: InvoiceStatus;
  /** Rateio de contas/centro de custo — opcionais, algumas planilhas de ERP trazem até 4 por duplicata. */
  centroCusto?: string | null;
  conta1?: string | null;
  conta2?: string | null;
  conta3?: string | null;
  /** Preenchido apenas no modo planilha — identifica qual arquivo importado gerou esta linha. */
  sourceFile?: string;
};

export type FinanceiroFilters = {
  period: "all" | "30d" | "7d" | "custom";
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
    pontualidadeDias: number | null;
  };
  timeline: Array<{ date: string; recebido: number; previsto: number }>;
  paymentMethods: Array<{ label: string; value: number }>;
  topClients: Array<{ name: string; value: number }>;
  statusBreakdown: Array<{ label: InvoiceStatus; value: number }>;
  /** Rateio por conta/centro de custo — só existe quando a planilha importada traz alguma coluna "Conta". */
  contas: Array<{ name: string; value: number }>;
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

export type ServicoStatus = "pendente" | "confirmado" | "atendido" | "cancelado";

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
  /** Preenchido apenas no modo planilha — identifica qual arquivo importado gerou esta linha. */
  sourceFile?: string;
};

export type OperacionalFilters = {
  /** Nome do serviço — texto livre vindo do arquivo, então "all" ou o valor exato. */
  servico: "all" | string;
  status: "all" | ServicoStatus;
  search: string;
};

export type OperacionalData = {
  asOf: string | null;
  kpis: {
    /** Soma das quantidades pedidas (ex.: 12 recepcionistas). */
    totalItens: number | null;
    /** Soma de quantidade × dias — o volume real de operação. */
    totalDiarias: number | null;
    qtdPedidos: number | null;
    qtdExpositores: number | null;
  };
  servicos: Array<{ label: string; value: number }>;
  topExpositores: Array<{ name: string; value: number }>;
  statusBreakdown: Array<{ label: ServicoStatus; value: number }>;
  /** Distribuição por pavilhão/setor — só existe quando a planilha traz a coluna. */
  localizacoes: Array<{ name: string; value: number }>;
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

