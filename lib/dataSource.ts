/**
 * Camada de dados do template. Cada módulo (financeiro, credenciamento) tem
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

