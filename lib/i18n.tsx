"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Locale = "pt" | "en";

const DICT = {
  pt: {
    "shell.brand.title": "Portal JA",
    "shell.brand.subtitle": "template",
    "shell.nav.overview": "Visão geral",
    "shell.nav.financeiro": "Financeiro",
    "shell.nav.credenciamento": "Credenciamento",
    "shell.loadingEvents": "carregando eventos…",
    "shell.noEvents": "nenhum evento disponível",
    "shell.theme": "Tema",
    "shell.language": "Idioma",

    "common.all": "Tudo",
    "common.last30": "30 dias",
    "common.last7": "7 dias",
    "common.custom": "Personalizado",
    "common.allMethods": "Todas formas",
    "common.boleto": "Boleto",
    "common.cartao": "Cartão",
    "common.pix": "PIX",
    "common.allStatus": "Todos",
    "common.allCategories": "Todas categorias",
    "common.sync": "Sincronizar",
    "common.page": "página 1",
    "common.pending": "aguardando API",
    "common.connected": "conectado",
    "common.error": "erro de conexão",
    "common.kpi.waitingFeed": "aguardando feed",
    "common.kpi.noDataNow": "sem dados no momento",
    "common.kpi.updatedNow": "atualizado agora",
    "common.checkins": "check-ins",
    "common.leads": "leads",

    "col.numero": "Nº",
    "col.cliente": "Cliente",
    "col.cnpj": "CNPJ",
    "col.vencimento": "Vencimento",
    "col.pagamento": "Pagamento",
    "col.forma": "Forma",
    "col.valor": "Valor",
    "col.status": "Status",
    "col.nome": "Nome",
    "col.documento": "Documento",
    "col.categoria": "Categoria",
    "col.credenciadoEm": "Credenciado em",
    "col.checkin": "Check-in",
    "col.empresa": "Empresa",
    "col.expositor": "Expositor",
    "col.capturadoEm": "Capturado em",
    "col.origem": "Origem",
    "col.codigo": "Código",
    "col.retiradoEm": "Retirado em",
    "col.devolvidoEm": "Devolvido em",
    "col.leadsLidos": "Leads lidos",

    "overview.timeline.empty": "as datas de início e fim desta edição aparecem aqui assim que a API responder",

    "overview.kicker": "visão geral",
    "overview.subtitle": "acompanhamento consolidado do evento",
    "overview.statusTitle": "Status dos módulos",
    "overview.statusDesc": "conexão de cada módulo com a API externa",
    "overview.modulesTitle": "Módulos",
    "overview.modulesDesc": "acesse os painéis específicos de cada área do evento",
    "overview.timelineTitle": "Linha do tempo do evento",
    "overview.timelineDesc": "período de operação desta edição",
    "overview.footnote":
      "Este é o template padrão do painel — cada módulo puxa seus dados de lib/dataSource.ts, já escopados pelo evento e edição selecionados no menu lateral.",

    "module.financeiro.title": "Financeiro",
    "module.financeiro.desc": "Contas a receber, formas de pagamento e conciliação de duplicatas.",
    "module.credenciamento.title": "Credenciamento",
    "module.credenciamento.desc": "Credenciados, check-ins e taxa de comparecimento no evento.",

    "financeiro.title": "Contas a receber",
    "financeiro.kpi.total": "Total recebido",
    "financeiro.kpi.ticket": "Ticket médio",
    "financeiro.kpi.duplicatas": "Duplicatas",
    "financeiro.kpi.pontualidade": "Pontualidade média",
    "financeiro.timeline.title": "Recebimentos no período",
    "financeiro.timeline.desc": "recebido vs. previsto, por dia",
    "financeiro.timeline.empty.title": "sem série temporal",
    "financeiro.timeline.empty.desc": "a curva de recebido vs. previsto aparece aqui assim que a API responder",
    "financeiro.donut.title": "Canal de pagamento",
    "financeiro.donut.desc": "participação por método",
    "financeiro.ranking.title": "Top expositores",
    "financeiro.ranking.desc": "maior valor pago no período",
    "financeiro.ranking.empty.title": "sem ranking",
    "financeiro.ranking.empty.desc": "os maiores expositores por valor pago aparecem aqui",
    "financeiro.status.title": "Status das duplicatas",
    "financeiro.status.desc": "distribuição por situação",
    "financeiro.table.title": "Duplicatas",
    "financeiro.table.desc": "lançamentos individuais",
    "financeiro.table.empty.title": "nenhuma duplicata carregada",
    "financeiro.table.empty.desc": "os lançamentos de contas a receber aparecem aqui após conectar a API",
    "financeiro.table.count": "duplicata(s)",
    "financeiro.table.countZero": "0 duplicatas",
    "financeiro.footnote": "Painel sem dados de produção — conecte a API externa em lib/dataSource.ts (função fetchFinanceiro).",
    "financeiro.search": "cliente, CNPJ ou nº de duplicata",
    "status.pago": "Pago",
    "status.pendente": "Pendente",
    "status.atrasado": "Atrasado",

    "credenciamento.title": "Credenciamento",
    "credenciamento.kpi.total": "Credenciados",
    "credenciamento.kpi.presenca": "Presença confirmada",
    "credenciamento.kpi.checkins": "Check-ins realizados",
    "credenciamento.kpi.taxa": "Taxa de comparecimento",
    "credenciamento.timeline.title": "Credenciamento no período",
    "credenciamento.timeline.desc": "credenciados vs. check-ins realizados, por dia",
    "credenciamento.timeline.empty.title": "sem série temporal",
    "credenciamento.timeline.empty.desc": "a curva de credenciamento vs. check-in aparece aqui assim que a API responder",
    "credenciamento.categorias.title": "Por categoria",
    "credenciamento.categorias.desc": "participação por tipo de credencial",
    "credenciamento.categorias.empty.title": "sem categorias",
    "credenciamento.categorias.empty.desc": "a distribuição por categoria (visitante, expositor, imprensa...) aparece aqui",
    "credenciamento.status.title": "Status do credenciamento",
    "credenciamento.status.desc": "distribuição por situação",
    "credenciamento.table.title": "Participantes",
    "credenciamento.table.desc": "credenciamento individual",
    "credenciamento.table.empty.title": "nenhum participante carregado",
    "credenciamento.table.empty.desc": "a lista de credenciados aparece aqui após conectar a API",
    "credenciamento.table.count": "participante(s)",
    "credenciamento.table.countZero": "0 participantes",
    "credenciamento.footnote": "Painel sem dados de produção — conecte a API externa em lib/dataSource.ts (função fetchCredenciamento).",
    "credenciamento.search": "participante ou documento",
    "status.credenciado": "Credenciado",
    "status.cancelado": "Cancelado",
  },
  en: {
    "shell.brand.title": "Portal JA",
    "shell.brand.subtitle": "template",
    "shell.nav.overview": "Overview",
    "shell.nav.financeiro": "Finance",
    "shell.nav.credenciamento": "Accreditation",
    "shell.loadingEvents": "loading events…",
    "shell.noEvents": "no events available",
    "shell.theme": "Theme",
    "shell.language": "Language",

    "common.all": "All",
    "common.last30": "30 days",
    "common.last7": "7 days",
    "common.custom": "Custom",
    "common.allMethods": "All methods",
    "common.boleto": "Bank slip",
    "common.cartao": "Card",
    "common.pix": "PIX",
    "common.allStatus": "All",
    "common.allCategories": "All categories",
    "common.sync": "Sync",
    "common.page": "page 1",
    "common.pending": "waiting for API",
    "common.connected": "connected",
    "common.error": "connection error",
    "common.kpi.waitingFeed": "waiting for feed",
    "common.kpi.noDataNow": "no data right now",
    "common.kpi.updatedNow": "updated just now",
    "common.checkins": "check-ins",
    "common.leads": "leads",

    "col.numero": "No.",
    "col.cliente": "Client",
    "col.cnpj": "Tax ID",
    "col.vencimento": "Due date",
    "col.pagamento": "Paid on",
    "col.forma": "Method",
    "col.valor": "Amount",
    "col.status": "Status",
    "col.nome": "Name",
    "col.documento": "Document",
    "col.categoria": "Category",
    "col.credenciadoEm": "Accredited on",
    "col.checkin": "Check-in",
    "col.empresa": "Company",
    "col.expositor": "Exhibitor",
    "col.capturadoEm": "Captured on",
    "col.origem": "Source",
    "col.codigo": "Code",
    "col.retiradoEm": "Checked out on",
    "col.devolvidoEm": "Returned on",
    "col.leadsLidos": "Leads read",

    "overview.timeline.empty": "this edition's start and end dates appear here once the API responds",

    "overview.kicker": "overview",
    "overview.subtitle": "consolidated tracking for this event",
    "overview.statusTitle": "Module status",
    "overview.statusDesc": "each module's connection to the external API",
    "overview.modulesTitle": "Modules",
    "overview.modulesDesc": "jump into each area's dedicated dashboard",
    "overview.timelineTitle": "Event timeline",
    "overview.timelineDesc": "operating window for this edition",
    "overview.footnote":
      "This is the dashboard's default template — every module pulls its data from lib/dataSource.ts, already scoped to the event and edition selected in the sidebar.",

    "module.financeiro.title": "Finance",
    "module.financeiro.desc": "Receivables, payment methods and invoice reconciliation.",
    "module.credenciamento.title": "Accreditation",
    "module.credenciamento.desc": "Accredited attendees, check-ins and attendance rate.",

    "financeiro.title": "Receivables",
    "financeiro.kpi.total": "Total collected",
    "financeiro.kpi.ticket": "Average ticket",
    "financeiro.kpi.duplicatas": "Invoices",
    "financeiro.kpi.pontualidade": "Average punctuality",
    "financeiro.timeline.title": "Collections over time",
    "financeiro.timeline.desc": "collected vs. expected, per day",
    "financeiro.timeline.empty.title": "no time series yet",
    "financeiro.timeline.empty.desc": "the collected vs. expected curve appears here once the API responds",
    "financeiro.donut.title": "Payment channel",
    "financeiro.donut.desc": "share by method",
    "financeiro.ranking.title": "Top exhibitors",
    "financeiro.ranking.desc": "highest amount paid in the period",
    "financeiro.ranking.empty.title": "no ranking yet",
    "financeiro.ranking.empty.desc": "the exhibitors with the highest paid amounts appear here",
    "financeiro.status.title": "Invoice status",
    "financeiro.status.desc": "breakdown by status",
    "financeiro.table.title": "Invoices",
    "financeiro.table.desc": "individual line items",
    "financeiro.table.empty.title": "no invoices loaded",
    "financeiro.table.empty.desc": "receivable line items appear here once the API is connected",
    "financeiro.table.count": "invoice(s)",
    "financeiro.table.countZero": "0 invoices",
    "financeiro.footnote": "No production data — wire up the external API in lib/dataSource.ts (fetchFinanceiro).",
    "financeiro.search": "client, tax ID or invoice number",
    "status.pago": "Paid",
    "status.pendente": "Pending",
    "status.atrasado": "Overdue",

    "credenciamento.title": "Accreditation",
    "credenciamento.kpi.total": "Accredited",
    "credenciamento.kpi.presenca": "Confirmed attendance",
    "credenciamento.kpi.checkins": "Check-ins completed",
    "credenciamento.kpi.taxa": "Attendance rate",
    "credenciamento.timeline.title": "Accreditation over time",
    "credenciamento.timeline.desc": "accredited vs. check-ins completed, per day",
    "credenciamento.timeline.empty.title": "no time series yet",
    "credenciamento.timeline.empty.desc": "the accreditation vs. check-in curve appears here once the API responds",
    "credenciamento.categorias.title": "By category",
    "credenciamento.categorias.desc": "share by credential type",
    "credenciamento.categorias.empty.title": "no categories yet",
    "credenciamento.categorias.empty.desc": "the breakdown by category (visitor, exhibitor, press...) appears here",
    "credenciamento.status.title": "Accreditation status",
    "credenciamento.status.desc": "breakdown by status",
    "credenciamento.table.title": "Attendees",
    "credenciamento.table.desc": "individual accreditation records",
    "credenciamento.table.empty.title": "no attendees loaded",
    "credenciamento.table.empty.desc": "the list of accredited attendees appears here once the API is connected",
    "credenciamento.table.count": "attendee(s)",
    "credenciamento.table.countZero": "0 attendees",
    "credenciamento.footnote": "No production data — wire up the external API in lib/dataSource.ts (fetchCredenciamento).",
    "credenciamento.search": "attendee or document",
    "status.credenciado": "Accredited",
    "status.cancelado": "Cancelled",
  },
} as const;

export type Key = keyof (typeof DICT)["pt"];

type I18nContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: Key) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "dashboard.locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("pt");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "pt" || saved === "en") setLocaleState(saved);
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  }

  function t(key: Key): string {
    return DICT[locale][key] ?? DICT.pt[key] ?? key;
  }

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
