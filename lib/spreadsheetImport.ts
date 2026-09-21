/**
 * "Modo planilha" — plano B enquanto a API oficial não é liberada por algum
 * evento. Em vez de uma IA normalizando cada formato de planilha (como o
 * Lovable fazia), o admin mapeia as colunas UMA VEZ por evento — como a
 * estrutura da planilha tende a se repetir edição após edição do mesmo
 * evento, o mapeamento salvo continua valendo quando eles sobem a versão
 * atualizada no mês seguinte.
 *
 * Isso nunca sai do navegador: parsing e agregação acontecem no cliente,
 * o admin nunca envia a planilha para nenhum servidor nosso — importante
 * porque planilhas financeiras internas não devem transitar por lugares
 * desnecessários (minimização de dados / LGPD).
 */

import * as XLSX from "xlsx";
import { parseDateLoose } from "./period";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import type {
  FinanceiroData,
  Invoice,
  InvoiceStatus,
  CredenciamentoData,
  Participante,
  CredenciamentoStatus,
  OperacionalData,
  PedidoServico,
  ServicoStatus,
} from "./dataSource";

// .xls binário antigo (BIFF) guarda texto acentuado num codepage (ex.: CP1252),
// não em UTF-8 — sem a tabela de codepages carregada, o SheetJS decodifica
// errado e caracteres acentuados viram símbolos (ex.: "Bancário" -> "Bancℵo").
(XLSX as unknown as { set_cptable: (table: unknown) => void }).set_cptable(cptable);

export type SheetTable = {
  headers: string[];
  rows: string[][];
};

// Alguns ERPs exportam relatório em HTML puro com extensão .xls (não é um
// binário Excel de verdade). Detectamos pela assinatura "<" nos primeiros
// bytes — arquivos Excel reais (BIFF/ZIP) nunca começam assim.
function sniffIsHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("ascii").decode(bytes.slice(0, 512)).trimStart();
  return head.startsWith("<");
}

// Esses HTMLs geralmente não declaram (ou mentem sobre) o charset, mas na
// prática saem em Windows-1252/ISO-8859-1 — daí o texto acentuado virar
// símbolos quando decodificado como UTF-8 (ex.: "Bancário" -> "Bancℵo").
// Se a página realmente declarar utf-8, respeitamos isso.
function decodeHtmlBytes(bytes: Uint8Array): string {
  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 1024));
  const declaresUtf8 = /charset\s*=\s*["']?utf-8/i.test(head);
  return new TextDecoder(declaresUtf8 ? "utf-8" : "windows-1252").decode(bytes);
}

export function parseSpreadsheetFile(file: File): Promise<SheetTable> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = sniffIsHtml(data)
          ? XLSX.read(decodeHtmlBytes(data), { type: "string" })
          : XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

        // acha a primeira linha com pelo menos 2 células não vazias e usa como cabeçalho
        const headerIdx = matrix.findIndex((r) => r.filter((c) => String(c).trim() !== "").length >= 2);
        if (headerIdx === -1) throw new Error("Planilha vazia ou sem cabeçalho reconhecível");

        const headers = matrix[headerIdx].map((h) => String(h).trim());
        const rows = matrix
          .slice(headerIdx + 1)
          .filter((r) => r.some((c) => String(c).trim() !== ""))
          .map((r) => headers.map((_, i) => String(r[i] ?? "").trim()));

        resolve({ headers, rows });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Falha ao interpretar a planilha"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ------------------------------ Financeiro ----------------------------- */

export const FINANCEIRO_FIELDS = [
  { key: "cliente", label: "Cliente", required: true },
  { key: "valor", label: "Valor", required: true },
  { key: "forma", label: "Forma de pagamento", required: true },
  { key: "status", label: "Status", required: true },
  { key: "numero", label: "Número da duplicata", required: false },
  { key: "cnpj", label: "CNPJ", required: false },
  { key: "vencimento", label: "Data de vencimento", required: false },
  { key: "pagamento", label: "Data de pagamento", required: false },
  { key: "centroCusto", label: "Centro de custo", required: false },
  { key: "conta1", label: "Conta nível 1", required: false },
  { key: "conta2", label: "Conta nível 2", required: false },
  { key: "conta3", label: "Conta nível 3", required: false },
] as const;

export type FinanceiroFieldKey = (typeof FINANCEIRO_FIELDS)[number]["key"];
export type ColumnMapping<K extends string = string> = Partial<Record<K, string>>;
export type StatusMapping<V extends string = string> = Record<string, V>;

/**
 * Detecta sozinho se o número veio no formato BR ("11.456,50") ou US
 * ("11,456.50") em vez de assumir um fixo — o Excel exibe formatado pro
 * idioma do Windows, mas o texto que a biblioteca de leitura extrai da
 * célula segue o código de formato salvo no arquivo, que costuma ser o
 * literal americano independente do que aparece na tela. Assumir só BR
 * fazia "11,456.50" virar 11.456 em vez de 11456.50 (erro de ~1000x).
 *
 * Regra: entre "," e ".", o que aparecer por último na string é o separador
 * decimal; o outro (se existir) é separador de milhar e é descartado. Se só
 * um dos dois aparecer, 2 dígitos depois dele = decimal, 3 dígitos = milhar.
 */
function parseValor(raw: string): number {
  let s = raw.replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimalSep: "," | "." | null = null;

  if (lastComma !== -1 && lastDot !== -1) {
    decimalSep = lastComma > lastDot ? "," : ".";
  } else if (lastComma !== -1) {
    decimalSep = s.length - lastComma - 1 === 2 ? "," : null;
  } else if (lastDot !== -1) {
    decimalSep = s.length - lastDot - 1 === 2 ? "." : null;
  }

  if (decimalSep) {
    const thousandsSep = decimalSep === "," ? "." : ",";
    s = s.split(thousandsSep).join("").replace(decimalSep, ".");
  } else {
    s = s.replace(/[,.]/g, "");
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Cada coluna geralmente já dá pra adivinhar pelo nome — evita obrigar o
 * admin a escolher manualmente as opções em toda planilha nova. A ordem dos
 * keyword-sets importa: campos mais específicos primeiro, pra "Forma
 * Pagamento" não roubar a coluna que deveria ir para "pagamento" (data), por
 * exemplo. Genérico o suficiente pra ser reaproveitado por qualquer módulo
 * (financeiro, credenciamento, e os que vierem depois).
 */
export function suggestMapping<K extends string>(
  headers: string[],
  fieldKeywords: { key: K; patterns: RegExp[] }[]
): ColumnMapping<K> {
  const mapping: ColumnMapping<K> = {};
  const used = new Set<string>();
  for (const { key, patterns } of fieldKeywords) {
    const match = headers.find((h) => !used.has(h) && patterns.some((p) => p.test(normalize(h))));
    if (match) {
      mapping[key] = match;
      used.add(match);
    }
  }
  return mapping;
}

export function suggestValueMapping<V extends string>(
  values: string[],
  valueKeywords: { value: V; patterns: RegExp[] }[]
): StatusMapping<V> {
  const mapping: StatusMapping<V> = {};
  for (const v of values) {
    const norm = normalize(v);
    const hit = valueKeywords.find(({ patterns }) => patterns.some((p) => p.test(norm)));
    if (hit) mapping[v] = hit.value;
  }
  return mapping;
}

const FINANCEIRO_FIELD_KEYWORDS: { key: FinanceiroFieldKey; patterns: RegExp[] }[] = [
  { key: "cnpj", patterns: [/cnpj/, /documento/] },
  { key: "numero", patterns: [/\bn[uú]mero\b/, /\bnf\b/, /duplicata/, /fatura/, /invoice/, /\bnº\b/, /\bn°\b/] },
  { key: "vencimento", patterns: [/vencimento/, /due ?date/] },
  { key: "pagamento", patterns: [/data.*pag/, /pag.*data/, /pago em/, /paid ?on/] },
  { key: "forma", patterns: [/forma.*pag/, /m[eé]todo/, /payment.*method/] },
  { key: "status", patterns: [/status/, /situa[cç][aã]o/] },
  { key: "valor", patterns: [/valor/, /montante/, /total/, /amount/] },
  { key: "cliente", patterns: [/empresa/, /cliente/, /raz[aã]o social/, /expositor/, /client/] },
  { key: "centroCusto", patterns: [/centro.*custo/, /cost.*center/] },
  { key: "conta1", patterns: [/^conta$/, /^conta ?1$/, /^conta ?n[ií]vel ?1$/] },
  { key: "conta2", patterns: [/^conta ?2$/, /^conta ?n[ií]vel ?2$/] },
  { key: "conta3", patterns: [/^conta ?3$/, /^conta ?n[ií]vel ?3$/] },
];

export function suggestFinanceiroMapping(headers: string[]): ColumnMapping<FinanceiroFieldKey> {
  return suggestMapping(headers, FINANCEIRO_FIELD_KEYWORDS);
}

const FINANCEIRO_STATUS_KEYWORDS: { value: InvoiceStatus; patterns: RegExp[] }[] = [
  { value: "cancelado", patterns: [/cancelad/, /anulad/, /estornad/, /void/] },
  { value: "pago", patterns: [/pago/, /quitad/, /pay?d/, /liquidad/] },
  { value: "atrasado", patterns: [/atrasad/, /vencid/, /overdue/, /late/] },
  { value: "pendente", patterns: [/pendente/, /aberto/, /open/, /pending/] },
];

export function suggestFinanceiroStatusMapping(values: string[]): StatusMapping<InvoiceStatus> {
  return suggestValueMapping(values, FINANCEIRO_STATUS_KEYWORDS);
}

export function distinctValues(table: SheetTable, column: string): string[] {
  const idx = table.headers.indexOf(column);
  if (idx === -1) return [];
  return Array.from(new Set(table.rows.map((r) => r[idx]).filter((v) => v !== ""))).sort();
}

/**
 * Converte as linhas de UM arquivo em `Invoice[]`. Cada linha ganha um
 * `sourceFile` — isso é o que permite re-importar o mesmo arquivo (atualização
 * mensal) substituindo só a contribuição dele, e importar arquivos diferentes
 * lado a lado sem um sobrescrever o outro.
 */
export function mapRowsToInvoices(
  table: SheetTable,
  mapping: ColumnMapping<FinanceiroFieldKey>,
  statusMapping: StatusMapping<InvoiceStatus>,
  sourceFile: string
): Invoice[] {
  const idx = (key: FinanceiroFieldKey) => {
    const col = mapping[key];
    return col ? table.headers.indexOf(col) : -1;
  };
  const iCliente = idx("cliente");
  const iValor = idx("valor");
  const iForma = idx("forma");
  const iStatus = idx("status");
  const iNumero = idx("numero");
  const iCnpj = idx("cnpj");
  const iVenc = idx("vencimento");
  const iPag = idx("pagamento");
  const iCentroCusto = idx("centroCusto");
  const iConta1 = idx("conta1");
  const iConta2 = idx("conta2");
  const iConta3 = idx("conta3");

  return table.rows.map((r, i) => {
    const rawStatus = iStatus >= 0 ? r[iStatus] : "";
    return {
      numero: iNumero >= 0 && r[iNumero] ? r[iNumero] : `${sourceFile}#${i + 1}`,
      cliente: iCliente >= 0 ? r[iCliente] : "",
      cnpj: iCnpj >= 0 ? r[iCnpj] : "",
      vencimento: iVenc >= 0 ? r[iVenc] : "",
      pagamento: iPag >= 0 && r[iPag] ? r[iPag] : null,
      forma: iForma >= 0 ? r[iForma] : "",
      valor: iValor >= 0 ? parseValor(r[iValor]) : 0,
      status: statusMapping[rawStatus] ?? "pendente",
      centroCusto: iCentroCusto >= 0 && r[iCentroCusto] ? r[iCentroCusto] : null,
      conta1: iConta1 >= 0 && r[iConta1] ? r[iConta1] : null,
      conta2: iConta2 >= 0 && r[iConta2] ? r[iConta2] : null,
      conta3: iConta3 >= 0 && r[iConta3] ? r[iConta3] : null,
      sourceFile,
    };
  });
}

/**
 * Junta o resultado de um novo import na lista acumulada. Linhas do MESMO
 * arquivo (`sourceFile` igual) são substituídas pelas novas — é assim que
 * subir a versão atualizada da mesma planilha funciona como atualização, não
 * como duplicação. Arquivos diferentes convivem lado a lado.
 */
export function mergeImportedInvoices(existing: Invoice[], incoming: Invoice[], sourceFile: string): Invoice[] {
  return [...existing.filter((inv) => inv.sourceFile !== sourceFile), ...incoming];
}

export function aggregateFinanceiro(invoices: Invoice[]): FinanceiroData {
  const totalRecebido = invoices.filter((i) => i.status === "pago").reduce((s, i) => s + i.valor, 0);
  const pagos = invoices.filter((i) => i.status === "pago");
  const ticketMedio = pagos.length ? totalRecebido / pagos.length : 0;

  const methodTotals = new Map<string, number>();
  for (const inv of invoices) methodTotals.set(inv.forma, (methodTotals.get(inv.forma) ?? 0) + inv.valor);

  const clientTotals = new Map<string, number>();
  for (const inv of invoices) clientTotals.set(inv.cliente, (clientTotals.get(inv.cliente) ?? 0) + inv.valor);

  const statusTotals = new Map<InvoiceStatus, number>();
  for (const inv of invoices) statusTotals.set(inv.status, (statusTotals.get(inv.status) ?? 0) + 1);

  // opcional — só populado quando a planilha traz colunas de rateio (Conta/Conta 2/Conta 3).
  // uma duplicata pode aparecer em mais de uma conta ao mesmo tempo (rateio entre centros de
  // custo), então o valor dela entra na soma de cada conta que ela referencia.
  const contaTotals = new Map<string, number>();
  for (const inv of invoices) {
    for (const conta of [inv.centroCusto, inv.conta1, inv.conta2, inv.conta3]) {
      if (conta) contaTotals.set(conta, (contaTotals.get(conta) ?? 0) + inv.valor);
    }
  }

  // timeline e pontualidade só existem quando a planilha traz vencimento/pagamento —
  // opcionais no mapeamento, então ficam nulos/vazios se não vierem preenchidos.
  const recebidoPorDia = new Map<string, number>();
  const previstoPorDia = new Map<string, number>();
  let pontualidadeSoma = 0;
  let pontualidadeQtd = 0;

  for (const inv of invoices) {
    if (inv.pagamento) recebidoPorDia.set(inv.pagamento, (recebidoPorDia.get(inv.pagamento) ?? 0) + inv.valor);
    if (inv.vencimento) previstoPorDia.set(inv.vencimento, (previstoPorDia.get(inv.vencimento) ?? 0) + inv.valor);
    if (inv.pagamento && inv.vencimento) {
      const dPag = Date.parse(inv.pagamento);
      const dVenc = Date.parse(inv.vencimento);
      if (Number.isFinite(dPag) && Number.isFinite(dVenc)) {
        pontualidadeSoma += (dVenc - dPag) / 86_400_000; // dias de antecedência (negativo = atraso)
        pontualidadeQtd++;
      }
    }
  }

  const dates = Array.from(new Set([...recebidoPorDia.keys(), ...previstoPorDia.keys()])).sort();
  const timeline = dates.map((date) => ({
    date,
    recebido: recebidoPorDia.get(date) ?? 0,
    previsto: previstoPorDia.get(date) ?? 0,
  }));

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalRecebido,
      ticketMedio,
      qtdDuplicatas: invoices.length,
      pontualidadeDias: pontualidadeQtd ? pontualidadeSoma / pontualidadeQtd : null,
    },
    timeline,
    paymentMethods: Array.from(methodTotals, ([label, value]) => ({ label, value })),
    topClients: Array.from(clientTotals, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    statusBreakdown: Array.from(statusTotals, ([label, value]) => ({ label, value })),
    contas: Array.from(contaTotals, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    invoices,
  };
}

/* --------------------------- Mapeamento salvo --------------------------- */

function storageKey(module: string, eventId: string) {
  return `import-mapping:${module}:${eventId}`;
}

export function saveMapping<K extends string, V extends string>(
  module: string,
  eventId: string,
  mapping: ColumnMapping<K>,
  statusMapping: StatusMapping<V>
) {
  window.localStorage.setItem(storageKey(module, eventId), JSON.stringify({ mapping, statusMapping }));
}

export function loadMapping<K extends string, V extends string>(
  module: string,
  eventId: string
): { mapping: ColumnMapping<K>; statusMapping: StatusMapping<V> } | null {
  const raw = window.localStorage.getItem(storageKey(module, eventId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* --------------------------- Credenciamento ----------------------------- */

export const CREDENCIAMENTO_FIELDS = [
  { key: "nome", label: "Nome", required: true },
  { key: "documento", label: "Documento (CPF/RG)", required: true },
  { key: "status", label: "Status", required: true },
  { key: "categoria", label: "Categoria", required: false },
  { key: "credenciadoEm", label: "Data de credenciamento", required: false },
  { key: "checkinEm", label: "Data/hora do check-in", required: false },
] as const;

export type CredenciamentoFieldKey = (typeof CREDENCIAMENTO_FIELDS)[number]["key"];

const CREDENCIAMENTO_FIELD_KEYWORDS: { key: CredenciamentoFieldKey; patterns: RegExp[] }[] = [
  { key: "documento", patterns: [/documento/, /\bcpf\b/, /\brg\b/, /identidade/] },
  { key: "checkinEm", patterns: [/check.?in/, /entrada/, /presen[cç]a/] },
  { key: "credenciadoEm", patterns: [/credenciad/, /inscri[cç][aã]o/, /cadastro/, /registro/] },
  { key: "categoria", patterns: [/categoria/, /\btipo\b/, /perfil/] },
  { key: "status", patterns: [/status/, /situa[cç][aã]o/] },
  { key: "nome", patterns: [/nome/, /participante/, /visitante/, /convidado/] },
];

export function suggestCredenciamentoMapping(headers: string[]): ColumnMapping<CredenciamentoFieldKey> {
  return suggestMapping(headers, CREDENCIAMENTO_FIELD_KEYWORDS);
}

const CREDENCIAMENTO_STATUS_KEYWORDS: { value: CredenciamentoStatus; patterns: RegExp[] }[] = [
  { value: "cancelado", patterns: [/cancelad/, /negad/, /recusad/, /removid/] },
  { value: "credenciado", patterns: [/credenciad/, /confirmad/, /ativo/, /aprovad/] },
  { value: "pendente", patterns: [/pendente/, /aguardando/, /aberto/] },
];

export function suggestCredenciamentoStatusMapping(values: string[]): StatusMapping<CredenciamentoStatus> {
  return suggestValueMapping(values, CREDENCIAMENTO_STATUS_KEYWORDS);
}

export function mapRowsToParticipantes(
  table: SheetTable,
  mapping: ColumnMapping<CredenciamentoFieldKey>,
  statusMapping: StatusMapping<CredenciamentoStatus>,
  sourceFile: string
): Participante[] {
  const idx = (key: CredenciamentoFieldKey) => {
    const col = mapping[key];
    return col ? table.headers.indexOf(col) : -1;
  };
  const iNome = idx("nome");
  const iDoc = idx("documento");
  const iCategoria = idx("categoria");
  const iCredenciadoEm = idx("credenciadoEm");
  const iCheckinEm = idx("checkinEm");
  const iStatus = idx("status");

  return table.rows.map((r, i) => {
    const rawStatus = iStatus >= 0 ? r[iStatus] : "";
    return {
      nome: iNome >= 0 ? r[iNome] : "",
      documento: iDoc >= 0 && r[iDoc] ? r[iDoc] : `${sourceFile}#${i + 1}`,
      categoria: iCategoria >= 0 ? r[iCategoria] : "",
      credenciadoEm: iCredenciadoEm >= 0 && r[iCredenciadoEm] ? r[iCredenciadoEm] : null,
      checkinEm: iCheckinEm >= 0 && r[iCheckinEm] ? r[iCheckinEm] : null,
      status: statusMapping[rawStatus] ?? "pendente",
      sourceFile,
    };
  });
}

export function mergeImportedParticipantes(
  existing: Participante[],
  incoming: Participante[],
  sourceFile: string
): Participante[] {
  return [...existing.filter((p) => p.sourceFile !== sourceFile), ...incoming];
}

export function aggregateCredenciamento(participantes: Participante[]): CredenciamentoData {
  const totalCredenciados = participantes.filter((p) => p.status === "credenciado").length;
  const checkinsRealizados = participantes.filter((p) => !!p.checkinEm).length;
  // não há um campo separado de "presença confirmada" na planilha — usamos o
  // check-in como proxy até existir uma fonte melhor (ex.: RSVP na API real).
  const presencaConfirmada = checkinsRealizados;

  const categoriaTotals = new Map<string, number>();
  for (const p of participantes) if (p.categoria) categoriaTotals.set(p.categoria, (categoriaTotals.get(p.categoria) ?? 0) + 1);

  const statusTotals = new Map<CredenciamentoStatus, number>();
  for (const p of participantes) statusTotals.set(p.status, (statusTotals.get(p.status) ?? 0) + 1);

  const credenciadosPorDia = new Map<string, number>();
  const checkinsPorDia = new Map<string, number>();
  for (const p of participantes) {
    if (p.credenciadoEm) credenciadosPorDia.set(p.credenciadoEm, (credenciadosPorDia.get(p.credenciadoEm) ?? 0) + 1);
    if (p.checkinEm) checkinsPorDia.set(p.checkinEm, (checkinsPorDia.get(p.checkinEm) ?? 0) + 1);
  }
  const dates = Array.from(new Set([...credenciadosPorDia.keys(), ...checkinsPorDia.keys()])).sort();
  const timeline = dates.map((date) => ({
    date,
    credenciados: credenciadosPorDia.get(date) ?? 0,
    checkins: checkinsPorDia.get(date) ?? 0,
  }));

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalCredenciados,
      presencaConfirmada,
      checkinsRealizados,
      taxaComparecimento: totalCredenciados ? (checkinsRealizados / totalCredenciados) * 100 : null,
    },
    timeline,
    categorias: Array.from(categoriaTotals, ([label, value]) => ({ label, value })),
    statusBreakdown: Array.from(statusTotals, ([label, value]) => ({ label, value })),
    participantes,
  };
}

/* ----------------------------- Operacional ------------------------------ */

export const OPERACIONAL_FIELDS = [
  { key: "expositor", label: "Expositor (razão social)", required: true },
  { key: "status", label: "Status", required: true },
  // Daqui pra baixo é tudo opcional de propósito: cada serviço tem sua
  // planilha e elas não trazem as mesmas colunas — muitas não têm quantidade
  // (uma linha = um pedido), algumas usam data/hora e outras só turno.
  { key: "quantidade", label: "Quantidade", required: false },
  { key: "nomeFantasia", label: "Nome fantasia", required: false },
  { key: "cnpj", label: "CNPJ / CPF", required: false },
  { key: "estande", label: "Nº do estande", required: false },
  { key: "localizacao", label: "Localização (pavilhão/setor)", required: false },
  { key: "dias", label: "Nº de dias", required: false },
  { key: "dataInicio", label: "Data inicial", required: false },
  { key: "dataFim", label: "Data final", required: false },
  { key: "horaInicio", label: "Hora inicial", required: false },
  { key: "horaFim", label: "Hora final", required: false },
  { key: "turno", label: "Turno", required: false },
] as const;

export type OperacionalFieldKey = (typeof OPERACIONAL_FIELDS)[number]["key"];

const OPERACIONAL_FIELD_KEYWORDS: { key: OperacionalFieldKey; patterns: RegExp[] }[] = [
  { key: "cnpj", patterns: [/cnpj/, /\bcpf\b/, /documento/] },
  // "nome fantasia" antes de "expositor": senão o padrão de razão social/nome
  // roubaria a coluna fantasia e sobraria a errada pro expositor.
  { key: "nomeFantasia", patterns: [/fantasia/, /nome comercial/] },
  { key: "expositor", patterns: [/raz[aã]o social/, /expositor/, /empresa/, /cliente/, /contratante/] },
  { key: "estande", patterns: [/estande/, /stand/, /\bbox\b/, /booth/] },
  { key: "localizacao", patterns: [/localiza/, /pavilh/, /setor/, /\brua\b/, /local/] },
  { key: "dias", patterns: [/dias/, /di[aá]ria/, /days/] },
  // hora antes de data: "Hora Final" não pode ser capturada pelo padrão de
  // data final, e "Data Início" não pode ser capturada pelo de hora.
  { key: "horaInicio", patterns: [/hor(a|ário|ario).*(in[ií]cio|inicial|entrada)/, /(in[ií]cio|inicial|entrada).*hora/] },
  { key: "horaFim", patterns: [/hor(a|ário|ario).*(fim|final|t[eé]rmino|sa[ií]da)/, /(fim|final|t[eé]rmino|sa[ií]da).*hora/] },
  { key: "dataInicio", patterns: [/data .*(in[ií]cio|inicial|entrada)/, /(in[ií]cio|inicial).*data/, /^in[ií]cio$/, /^data$/] },
  { key: "dataFim", patterns: [/data .*(fim|final|t[eé]rmino|sa[ií]da)/, /(fim|final|t[eé]rmino).*data/, /^(fim|final|t[eé]rmino)$/] },
  { key: "turno", patterns: [/turno/, /per[ií]odo/] },
  { key: "quantidade", patterns: [/quantidade/, /\bqtd\b/, /\bqtde\b/, /\bqty\b/] },
  { key: "status", patterns: [/status/, /situa[cç][aã]o/] },
];

/**
 * O serviço não vem de coluna nenhuma — cada planilha É um serviço, então o
 * nome sai do arquivo ("Contratação Recepcionista.xls" → "Recepcionista").
 * Tira extensão, o verbo do começo ("contratação de", "pedido de"...) e
 * sufixos de versão que o pessoal costuma anexar ("... 2026", "... (2)").
 * O admin ainda pode corrigir o resultado antes de confirmar o import.
 */
export function servicoFromFileName(fileName: string): string {
  let s = fileName.replace(/\.[^.]+$/, "");
  s = s.replace(/^\s*(contrata[cç][aã]o|contrato|pedidos?|solicita[cç][aã]o|planilha|relat[oó]rio)\s*(de|da|do)?\s*/i, "");
  s = s.replace(/\s*[-–]?\s*(v?\d{1,4}|\(\d+\))\s*$/i, "");
  s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return fileName;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function suggestOperacionalMapping(headers: string[]): ColumnMapping<OperacionalFieldKey> {
  return suggestMapping(headers, OPERACIONAL_FIELD_KEYWORDS);
}

const OPERACIONAL_STATUS_KEYWORDS: { value: ServicoStatus; patterns: RegExp[] }[] = [
  { value: "cancelado", patterns: [/cancelad/, /desistiu/, /recusad/, /estornad/] },
  { value: "atendido", patterns: [/atendid/, /entregue/, /conclu[ií]d/, /finalizad/, /executad/, /done/] },
  { value: "confirmado", patterns: [/confirmad/, /aprovad/, /fechad/, /contratad/, /pago/] },
  { value: "pendente", patterns: [/pendente/, /em aberto/, /aberto/, /aguardando/, /an[aá]lise/, /solicitad/] },
];

export function suggestOperacionalStatusMapping(values: string[]): StatusMapping<ServicoStatus> {
  return suggestValueMapping(values, OPERACIONAL_STATUS_KEYWORDS);
}

/** Quantidade e nº de dias são contagens inteiras — "5", "5 dias", "05". */
function parseQuantidade(raw: string): number | null {
  const n = parseInt(raw.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Nº de dias quando a planilha não tem essa coluna mas tem as datas — a
 * contagem é inclusiva (03/09 a 05/09 = 3 dias de operação, não 2).
 */
function diasEntre(inicio: string, fim: string): number | null {
  const a = parseDateLoose(inicio);
  const b = parseDateLoose(fim);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function mapRowsToPedidos(
  table: SheetTable,
  mapping: ColumnMapping<OperacionalFieldKey>,
  statusMapping: StatusMapping<ServicoStatus>,
  sourceFile: string,
  servico?: string
): PedidoServico[] {
  const idx = (key: OperacionalFieldKey) => {
    const col = mapping[key];
    return col ? table.headers.indexOf(col) : -1;
  };
  const iExpositor = idx("expositor");
  const iNomeFantasia = idx("nomeFantasia");
  const iCnpj = idx("cnpj");
  const iEstande = idx("estande");
  const iLocalizacao = idx("localizacao");
  const iQuantidade = idx("quantidade");
  const iDias = idx("dias");
  const iDataInicio = idx("dataInicio");
  const iDataFim = idx("dataFim");
  const iHoraInicio = idx("horaInicio");
  const iHoraFim = idx("horaFim");
  const iTurno = idx("turno");
  const iStatus = idx("status");

  // sem nome informado, cai pro derivado do arquivo — é sempre o arquivo que
  // diz qual serviço é, nunca uma coluna da planilha.
  const nomeServico = servico?.trim() || servicoFromFileName(sourceFile);

  return table.rows.map((r) => {
    const rawStatus = iStatus >= 0 ? r[iStatus] : "";
    const dataInicio = iDataInicio >= 0 ? r[iDataInicio] : "";
    const dataFim = iDataFim >= 0 ? r[iDataFim] : "";
    // sem coluna de dias, tenta deduzir do intervalo de datas antes de desistir.
    const dias =
      (iDias >= 0 && r[iDias] ? parseQuantidade(r[iDias]) : null) ??
      (dataInicio && dataFim ? diasEntre(dataInicio, dataFim) : null);
    // planilha sem coluna de quantidade (ou com a célula vazia): a própria
    // linha é o pedido, então vale 1 — zerar aqui apagaria o pedido dos KPIs.
    const quantidade = (iQuantidade >= 0 ? parseQuantidade(r[iQuantidade]) : null) ?? 1;
    return {
      servico: nomeServico,
      expositor: iExpositor >= 0 ? r[iExpositor] : "",
      nomeFantasia: iNomeFantasia >= 0 ? r[iNomeFantasia] : "",
      cnpj: iCnpj >= 0 ? r[iCnpj] : "",
      estande: iEstande >= 0 ? r[iEstande] : "",
      localizacao: iLocalizacao >= 0 ? r[iLocalizacao] : "",
      quantidade,
      dias,
      dataInicio,
      dataFim,
      horaInicio: iHoraInicio >= 0 ? r[iHoraInicio] : "",
      horaFim: iHoraFim >= 0 ? r[iHoraFim] : "",
      turno: iTurno >= 0 ? r[iTurno] : "",
      status: statusMapping[rawStatus] ?? "pendente",
      sourceFile,
    };
  });
}

export function mergeImportedPedidos(
  existing: PedidoServico[],
  incoming: PedidoServico[],
  sourceFile: string
): PedidoServico[] {
  return [...existing.filter((p) => p.sourceFile !== sourceFile), ...incoming];
}

export function aggregateOperacional(pedidos: PedidoServico[]): OperacionalData {
  // pedido cancelado não vira operação — fica fora dos totais e dos gráficos
  // de volume, mas continua na tabela e na contagem por status.
  const ativos = pedidos.filter((p) => p.status !== "cancelado");
  const totalItens = ativos.reduce((s, p) => s + p.quantidade, 0);
  // sem coluna de dias a planilha não descreve diária nenhuma — conta 1 dia
  // por item pra não zerar o KPI (e fica igual ao total de itens).
  const totalDiarias = ativos.reduce((s, p) => s + p.quantidade * (p.dias ?? 1), 0);

  const servicoTotals = new Map<string, number>();
  for (const p of ativos) if (p.servico) servicoTotals.set(p.servico, (servicoTotals.get(p.servico) ?? 0) + p.quantidade);

  const expositorTotals = new Map<string, number>();
  for (const p of ativos) if (p.expositor) expositorTotals.set(p.expositor, (expositorTotals.get(p.expositor) ?? 0) + p.quantidade);

  const statusTotals = new Map<ServicoStatus, number>();
  for (const p of pedidos) statusTotals.set(p.status, (statusTotals.get(p.status) ?? 0) + 1);

  const localTotals = new Map<string, number>();
  for (const p of ativos) if (p.localizacao) localTotals.set(p.localizacao, (localTotals.get(p.localizacao) ?? 0) + p.quantidade);

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalItens,
      totalDiarias,
      qtdPedidos: pedidos.length,
      qtdExpositores: new Set(ativos.map((p) => p.expositor).filter(Boolean)).size,
    },
    servicos: Array.from(servicoTotals, ([label, value]) => ({ label, value })),
    topExpositores: Array.from(expositorTotals, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    statusBreakdown: Array.from(statusTotals, ([label, value]) => ({ label, value })),
    localizacoes: Array.from(localTotals, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    pedidos,
  };
}
