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
import { parseDateLoose, separarDataHora } from "./period";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import type {
  FinanceiroData,
  Invoice,
  InvoiceStatus,
  OrigemReceita,
  DadosIngresso,
  IngressoStats,
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
  { key: "cliente", label: "Cliente", required: true, grupo: "Quem" },
  { key: "cnpj", label: "CNPJ", required: false, grupo: "Quem" },
  { key: "numero", label: "Número da duplicata", required: false, grupo: "Quem" },

  { key: "valor", label: "Valor", required: true, grupo: "Cobrança" },
  { key: "forma", label: "Forma de pagamento", required: true, grupo: "Cobrança" },
  { key: "status", label: "Status", required: true, grupo: "Cobrança" },
  { key: "pagamento", label: "Data de pagamento", required: false, grupo: "Cobrança" },

  { key: "origem", label: "Origem (expositor/ingresso)", required: false, grupo: "Classificação" },
  { key: "quantidade", label: "Quantidade de ingressos", required: false, grupo: "Classificação" },

  { key: "centroCusto", label: "Centro de custo", required: false, grupo: "Rateio contábil" },
  { key: "conta1", label: "Conta nível 1", required: false, grupo: "Rateio contábil" },
  { key: "conta2", label: "Conta nível 2", required: false, grupo: "Rateio contábil" },
  { key: "conta3", label: "Conta nível 3", required: false, grupo: "Rateio contábil" },
] as const;

/**
 * Planilha de ingresso é outro mundo: vem do sistema de credenciamento, tem
 * dezenas de colunas de cadastro (endereço, LGPD, impressão de crachá) e cada
 * linha é um ingresso, não uma duplicata. Pedir centro de custo, rateio ou
 * vencimento ali só faria o admin procurar coluna que não existe — por isso o
 * import mostra apenas o que essa planilha realmente tem.
 */
export const FINANCEIRO_INGRESSO_FIELDS = [
  { key: "cliente", label: "Nome do participante", required: true, grupo: "Quem" },
  { key: "cnpj", label: "CPF / CNPJ", required: false, grupo: "Quem" },
  { key: "numero", label: "Código do ingresso", required: false, grupo: "Quem" },

  { key: "valor", label: "Valor pago", required: true, grupo: "Cobrança" },
  { key: "valorDevido", label: "Valor a pagar (devido)", required: false, grupo: "Cobrança" },
  { key: "status", label: "Situação do pagamento", required: true, grupo: "Cobrança" },
  { key: "forma", label: "Forma de pagamento", required: false, grupo: "Cobrança" },

  { key: "pagamento", label: "Data do cadastro", required: false, grupo: "Presença" },
  { key: "compareceu", label: "Compareceu", required: false, grupo: "Presença" },
  { key: "dataComparecimento", label: "Data do comparecimento", required: false, grupo: "Presença" },
  { key: "horaComparecimento", label: "Hora do comparecimento", required: false, grupo: "Presença" },

  { key: "convite", label: "Origem do convite / lote", required: false, grupo: "Perfil do público" },
  { key: "categoria", label: "Categoria", required: false, grupo: "Perfil do público" },
  { key: "cargo", label: "Cargo", required: false, grupo: "Perfil do público" },
  { key: "segmento", label: "Segmento", required: false, grupo: "Perfil do público" },
  { key: "estado", label: "Estado", required: false, grupo: "Perfil do público" },
  { key: "pais", label: "País", required: false, grupo: "Perfil do público" },
] as const;

export type FinanceiroIngressoFieldKey = (typeof FINANCEIRO_INGRESSO_FIELDS)[number]["key"];

/**
 * Chaves que o import do financeiro aceita, seja qual for a origem escolhida.
 * Os dois conjuntos se cruzam mas nenhum contém o outro: contas a receber tem
 * vencimento e rateio de contas; ingresso tem comparecimento, cargo e afins.
 */
export type FinanceiroImportKey = FinanceiroFieldKey | FinanceiroIngressoFieldKey;

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
    // Percorre os PADRÕES na ordem declarada e, para cada um, procura a coluna.
    // O contrário (varrer as colunas e aceitar a primeira que casa qualquer
    // padrão) fazia a posição da coluna decidir: numa planilha com "TOTAL A
    // PAGAR" antes de "TOTAL PAGO", o valor saía da coluna errada mesmo com
    // "total pago" declarado como preferência.
    let match: string | undefined;
    for (const p of patterns) {
      match = headers.find((h) => !used.has(h) && p.test(normalize(h)));
      if (match) break;
    }
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
  { key: "pagamento", patterns: [/data.*pag/, /pag.*data/, /pago em/, /paid ?on/] },
  { key: "forma", patterns: [/forma.*pag/, /m[eé]todo/, /payment.*method/] },
  { key: "status", patterns: [/status/, /situa[cç][aã]o/] },
  // "TOTAL DA DUPLICATA" é o valor da linha; "VALOR TOTAL DOCUMENTO" pode
  // somar várias duplicatas do mesmo documento e inflaria o total.
  { key: "valor", patterns: [/total da duplicata/, /valor da duplicata/, /^valor$/, /valor total/, /montante/, /^total$/, /amount/, /valor/] },
  { key: "cliente", patterns: [/empresa/, /cliente/, /raz[aã]o social/, /expositor/, /client/] },
  { key: "origem", patterns: [/^origem$/, /origem/, /procedencia/, /tipo.*receita/] },
  { key: "quantidade", patterns: [/quantidade/, /\bqtd\b/, /\bqtde\b/, /ingressos?/, /\bqty\b/] },
  { key: "centroCusto", patterns: [/centro.*custo/, /cost.*center/] },
  { key: "conta1", patterns: [/^conta$/, /^conta ?1$/, /^conta ?n[ií]vel ?1$/] },
  { key: "conta2", patterns: [/^conta ?2$/, /^conta ?n[ií]vel ?2$/] },
  { key: "conta3", patterns: [/^conta ?3$/, /^conta ?n[ií]vel ?3$/] },
];

export function suggestFinanceiroMapping(headers: string[]): ColumnMapping<FinanceiroImportKey> {
  return suggestMapping(headers, FINANCEIRO_FIELD_KEYWORDS);
}

/**
 * Cabeçalhos da planilha de ingresso não batem com os de contas a receber: lá
 * "PAGAMENTO" é a situação (Gratuita/Pago/Em Aberto), a data está em "DATA
 * CADASTRO" e o valor em "TOTAL PAGO". A ordem cuida das armadilhas: "FORMA DE
 * PAGAMENTO" e "DATA CADASTRO" são resolvidas antes de "PAGAMENTO" sozinho.
 */
const FINANCEIRO_INGRESSO_KEYWORDS: { key: FinanceiroIngressoFieldKey; patterns: RegExp[] }[] = [
  { key: "compareceu", patterns: [/^compareceu$/, /^presen[cç]a$/] },
  // a data de impressão do crachá é o registro de quando a pessoa passou no
  // balcão — é o que dá o público por dia de evento
  { key: "dataComparecimento", patterns: [/data.?hora.*(impress|check|comparec|entrada)/, /data.*impress/, /data.*check.?in/, /data.*comparec/, /data.*entrada/] },
  { key: "horaComparecimento", patterns: [/hora.*impress/, /hora.*check.?in/, /hora.*comparec/, /hora.*entrada/] },
  { key: "valorDevido", patterns: [/total a pagar$/, /valor a pagar/, /valor devido/] },
  { key: "convite", patterns: [/^edi[cç][aã]o$/, /lote/, /convidado de/, /origem.*convite/] },
  { key: "categoria", patterns: [/^categoria$/, /tipo.*ingresso/, /nome ingresso/] },
  // "CARGOS" (lista padronizada) antes de "CARGO" (texto livre digitado pelo
  // participante): a primeira agrupa, a segunda tem um valor por pessoa.
  { key: "cargo", patterns: [/^cargos$/, /^cargo$/, /fun[cç][aã]o/] },
  { key: "segmento", patterns: [/^segmentos?$/, /[aá]rea de atua/] },
  { key: "estado", patterns: [/^estado$/, /\buf\b/, /estado comercial/] },
  { key: "pais", patterns: [/^pa[ií]s$/, /pa[ií]s comercial/] },
  { key: "forma", patterns: [/forma.*pag/, /m[eé]todo.*pag/] },
  { key: "pagamento", patterns: [/data.*pagamento/, /data.*cadastro/, /^data$/] },
  { key: "status", patterns: [/^pagamento$/, /situa[cç][aã]o/, /^status$/] },
  { key: "valor", patterns: [/total pago/, /total a pagar$/, /^valor$/, /valor pago/] },
  { key: "cnpj", patterns: [/^cpf$/, /^cnpj$/, /cpf.*cnpj/, /documento/] },
  { key: "numero", patterns: [/c[oó]digo.*(cracha|ingresso|convite)/, /ingressos? ?\/ ?convites?/, /^c[oó]digo$/] },
  { key: "cliente", patterns: [/nome completo/, /nome.*participante/, /^nome$/, /raz[aã]o social/] },
];

export function suggestFinanceiroIngressoMapping(headers: string[]): ColumnMapping<FinanceiroImportKey> {
  return suggestMapping(headers, FINANCEIRO_INGRESSO_KEYWORDS);
}

/**
 * "São Paulo", "SP" e "sao paulo" são o mesmo estado e apareciam como três
 * barras. Converte para a sigla quando reconhece o nome; o que não for estado
 * brasileiro fica como veio (capitalizado), para não inventar sigla.
 */
const UF_POR_NOME: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};
const UFS = new Set(Object.values(UF_POR_NOME));

export function normalizarEstado(valor: string | null | undefined): string {
  const v = normalize(valor ?? "");
  if (!v) return "";
  if (UF_POR_NOME[v]) return UF_POR_NOME[v];
  const sigla = v.toUpperCase();
  if (sigla.length === 2 && UFS.has(sigla)) return sigla;
  return (valor ?? "").trim();
}

/** "Sim"/"Não"/"SIM" da planilha viram booleano; qualquer outra coisa é "não informado". */
function parseSimNao(valor: string | undefined): boolean | null {
  const v = normalize(valor ?? "");
  if (!v) return null;
  if (/^(sim|s|yes|y|true|1)$/.test(v)) return true;
  if (/^(nao|n|no|false|0)$/.test(v)) return false;
  return null;
}

const FINANCEIRO_STATUS_KEYWORDS: { value: InvoiceStatus; patterns: RegExp[] }[] = [
  { value: "cancelado", patterns: [/cancelad/, /anulad/, /estornad/, /void/] },
  // cortesia antes de pago: "Gratuita" não é pagamento, e contá-la como pago
  // inflaria a quantidade de ingressos vendidos.
  { value: "cortesia", patterns: [/gratuit/, /cortesia/, /convite/, /isent/, /free/] },
  { value: "pago", patterns: [/pago/, /quitad/, /pay?d/, /liquidad/] },
  // vencido/atrasado entra como pendente: continua sendo cobrança em aberto,
  // e a data de vencimento na tabela já mostra quem passou do prazo.
  { value: "pendente", patterns: [/pendente/, /aberto/, /open/, /pending/, /atrasad/, /vencid/, /overdue/, /late/] },
];

export function suggestFinanceiroStatusMapping(values: string[]): StatusMapping<InvoiceStatus> {
  return suggestValueMapping(values, FINANCEIRO_STATUS_KEYWORDS);
}

/**
 * A coluna "Origem" vem em texto livre e varia por evento ("EXPOSITOR",
 * "EXPOSITOR/MONTADOR", "INGRESSO", "INSCRIÇÃO", "FINANCEIRO"...). Classifica
 * nas duas categorias que a tela separa; o que não for nenhuma das duas cai em
 * "outras" em vez de ser forçado para um lado e distorcer o total.
 */
/**
 * Sugere a origem da planilha no momento do import: se ela tem uma coluna
 * "Origem" mapeável, deixa que a coluna decida linha a linha; senão tenta pelo
 * nome do arquivo ("contas_a_receber_ingressos.xls"). Sem nenhum dos dois, volta
 * vazio e o admin é obrigado a escolher — é isso que evita uma planilha inteira
 * cair em "Outras" e sumir do recorte por origem.
 */
export function sugerirOrigemFinanceiro(fileName: string, table: SheetTable): string {
  if (suggestFinanceiroMapping(table.headers).origem) return "auto";

  const n = normalize(fileName);
  if (/ingresso|inscri|participante|visitante/.test(n)) return "Ingresso";
  if (/expositor|montador|estande|patrocin/.test(n)) return "Expositor";
  return "";
}

export function classificarOrigem(origem: string | null | undefined): OrigemReceita | null {
  const o = normalize(origem ?? "");
  if (!o) return null;
  if (/ingresso|inscri|participante|visitante|credencial|congressista|ticket/.test(o)) return "ingresso";
  if (/expositor|montador|estande|stand|patrocin/.test(o)) return "expositor";
  return null;
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
  mapping: ColumnMapping<FinanceiroImportKey>,
  statusMapping: StatusMapping<InvoiceStatus>,
  sourceFile: string,
  /** Origem escolhida no import: "auto" deixa a coluna da planilha decidir. */
  origemEscolhida?: string
): Invoice[] {
  const idx = (key: FinanceiroImportKey) => {
    const col = mapping[key];
    return col ? table.headers.indexOf(col) : -1;
  };
  const texto = (r: string[], i: number) => (i >= 0 ? r[i]?.trim() ?? "" : "");
  const iCliente = idx("cliente");
  const iValor = idx("valor");
  const iForma = idx("forma");
  const iStatus = idx("status");
  const iNumero = idx("numero");
  const iCnpj = idx("cnpj");
  const iPag = idx("pagamento");
  const iOrigem = idx("origem");
  const iQuantidade = idx("quantidade");
  const iCentroCusto = idx("centroCusto");

  const iCompareceu = idx("compareceu");
  const iDataComparecimento = idx("dataComparecimento");
  const iHoraComparecimento = idx("horaComparecimento");
  const iValorDevido = idx("valorDevido");
  const iConvite = idx("convite");
  const iCategoria = idx("categoria");
  const iCargo = idx("cargo");
  const iSegmento = idx("segmento");
  const iEstado = idx("estado");
  const iPais = idx("pais");
  const temDadosIngresso = [
    iCompareceu,
    iDataComparecimento,
    iHoraComparecimento,
    iValorDevido,
    iConvite,
    iCategoria,
    iCargo,
    iSegmento,
    iEstado,
    iPais,
  ].some((i) => i >= 0);

  const escolha = (origemEscolhida ?? "").trim();
  const forcarOrigem = !escolha || escolha === "auto" ? "" : escolha;
  const iConta1 = idx("conta1");
  const iConta2 = idx("conta2");
  const iConta3 = idx("conta3");

  return table.rows
    .filter((r) => {
      // Linha de aviso/observação no meio da planilha (uma célula solta
      // preenchida) entrava como duplicata fantasma de valor zero.
      const semCliente = iCliente >= 0 && !r[iCliente]?.trim();
      const semValor = iValor < 0 || !r[iValor]?.trim() || parseValor(r[iValor]) === 0;
      return !(semCliente && semValor);
    })
    .map((r, i) => {
    const rawStatus = iStatus >= 0 ? r[iStatus] : "";
    return {
      numero: iNumero >= 0 && r[iNumero] ? r[iNumero] : `${sourceFile}#${i + 1}`,
      cliente: iCliente >= 0 ? r[iCliente] : "",
      cnpj: iCnpj >= 0 ? r[iCnpj] : "",
      // vencimento saiu do painel: nada mais lê essa data, e o ERP a regera
      // quando a duplicata vence
      vencimento: "",
      pagamento: iPag >= 0 && r[iPag] ? r[iPag] : null,
      forma: iForma >= 0 ? r[iForma] : "",
      valor: iValor >= 0 ? parseValor(r[iValor]) : 0,
      status: statusMapping[rawStatus] ?? "pendente",
      // a escolha do import vale para o arquivo inteiro; "auto" devolve a
      // decisão para a coluna, que pode variar linha a linha.
      quantidade: iQuantidade >= 0 && r[iQuantidade] ? parseInt(r[iQuantidade].replace(/[^\d-]/g, ""), 10) || null : null,
      ingresso: temDadosIngresso
        ? ((comparecimento) => ({
            compareceu: parseSimNao(texto(r, iCompareceu)),
            valorDevido: iValorDevido >= 0 && r[iValorDevido] ? parseValor(r[iValorDevido]) : null,
            convite: texto(r, iConvite),
            categoria: texto(r, iCategoria),
            cargo: texto(r, iCargo),
            segmento: texto(r, iSegmento),
            estado: normalizarEstado(texto(r, iEstado)),
            pais: texto(r, iPais),
            cadastro: separarDataHora(iPag >= 0 ? r[iPag] : "").data,
            dataComparecimento: comparecimento.data,
            // hora própria manda; sem ela, usa a que veio colada na data
            horaComparecimento: texto(r, iHoraComparecimento) || comparecimento.hora,
          }))(separarDataHora(texto(r, iDataComparecimento)))
        : null,
      origem: forcarOrigem || (iOrigem >= 0 ? r[iOrigem] : ""),
      origemTipo: classificarOrigem(forcarOrigem || (iOrigem >= 0 ? r[iOrigem] : "")),
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

  // só faz sentido quando a planilha traz a coluna de origem — sem ela toda
  // linha cairia em "outras" e o painel diria uma coisa que não é verdade.
  const origemTotals = new Map<OrigemReceita, number>();
  for (const inv of invoices) {
    const tipo = inv.origemTipo ?? classificarOrigem(inv.origem);
    if (!tipo) continue;
    origemTotals.set(tipo, (origemTotals.get(tipo) ?? 0) + inv.valor);
  }

  // opcional — só populado quando a planilha traz colunas de rateio (Conta/Conta 2/Conta 3).
  // uma duplicata pode aparecer em mais de uma conta ao mesmo tempo (rateio entre centros de
  // custo), então o valor dela entra na soma de cada conta que ela referencia.
  const contaTotals = new Map<string, number>();
  for (const inv of invoices) {
    for (const conta of [inv.centroCusto, inv.conta1, inv.conta2, inv.conta3]) {
      if (conta) contaTotals.set(conta, (contaTotals.get(conta) ?? 0) + inv.valor);
    }
  }

  // Só o realizado: o vencimento saiu do painel porque, quando uma duplicata
  // vence, o ERP gera outra no lugar — a data antiga não descreve mais nada
  // que se possa comparar com o que entrou.
  const recebidoPorDia = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.pagamento) recebidoPorDia.set(inv.pagamento, (recebidoPorDia.get(inv.pagamento) ?? 0) + inv.valor);
  }

  const timeline = Array.from(recebidoPorDia, ([date, recebido]) => ({ date, recebido })).sort(
    (a, b) => parseDateLoose(a.date) - parseDateLoose(b.date)
  );

  // Leitura de ingresso: quantos ingressos saíram. Linha sem coluna de
  // quantidade conta como 1 — é um ingresso.
  const naoCanceladas = invoices.filter((i) => i.status !== "cancelado");
  const qtdIngressos = naoCanceladas.reduce((s, i) => s + (i.quantidade ?? 1), 0);

  return {
    asOf: new Date().toISOString(),
    ingressoStats: agregarIngresso(invoices),
    kpis: {
      totalRecebido,
      ticketMedio,
      qtdDuplicatas: invoices.length,
      qtdIngressos: naoCanceladas.length ? qtdIngressos : null,
    },
    timeline,
    paymentMethods: Array.from(methodTotals, ([label, value]) => ({ label, value })),
    topClients: Array.from(clientTotals, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    statusBreakdown: Array.from(statusTotals, ([label, value]) => ({ label, value })),
    // conta com total zerado não diz nada e só ocupa linha no painel — some.
    contas: Array.from(contaTotals, ([name, value]) => ({ name, value }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value),
    origens: Array.from(origemTotals, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    invoices,
  };
}

/**
 * Junta variações de escrita do mesmo valor: "Diretor", "Diretora" e "DIRETOR"
 * são um cargo só, mas chegam como três linhas do ranking.
 *
 * Caixa, acento, pontuação e espaço sobrando são sempre ignorados. O gênero é
 * unido só quando as DUAS formas aparecem nos dados — aplicar a regra às cegas
 * transformaria "Secretaria" (a área) em "Secretário" (o cargo) e "Consultoria"
 * em "Consultório". O rótulo exibido é a grafia mais frequente entre as
 * variantes, para a tela mostrar como o pessoal realmente escreve.
 */
export function agruparVariacoes(
  itens: Array<{ name: string; value: number }>,
  opcoes: { unirGenero?: boolean } = {}
): Array<{ name: string; value: number }> {
  // 1) caixa/acento/pontuação: "DIRETOR" e "Diretor" viram a mesma chave
  const porChave = new Map<string, { total: number; grafias: Map<string, number> }>();
  for (const item of itens) {
    const chave = normalize(item.name)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!chave) continue;
    const atual = porChave.get(chave) ?? { total: 0, grafias: new Map<string, number>() };
    atual.total += item.value;
    atual.grafias.set(item.name, (atual.grafias.get(item.name) ?? 0) + item.value);
    porChave.set(chave, atual);
  }

  // 2) gênero, só entre chaves que coexistem
  if (opcoes.unirGenero) {
    const masculinoDe = (chave: string) =>
      chave
        .split(" ")
        .map((w) => (w.length > 4 ? w.replace(/oras$/, "ores").replace(/ora$/, "or").replace(/as$/, "os").replace(/a$/, "o") : w))
        .join(" ");

    for (const [chave, dados] of [...porChave]) {
      const masc = masculinoDe(chave);
      if (masc === chave) continue;
      const destino = porChave.get(masc);
      if (!destino) continue; // sem a forma masculina nos dados, não mexe
      destino.total += dados.total;
      for (const [g, q] of dados.grafias) destino.grafias.set(g, (destino.grafias.get(g) ?? 0) + q);
      porChave.delete(chave);
    }
  }

  return Array.from(porChave.values())
    .map(({ total, grafias }) => ({
      // grafia mais usada vence; empate resolve pela ordem alfabética para o
      // resultado não depender da ordem de leitura do arquivo
      name: Array.from(grafias).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0][0],
      value: total,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Leituras exclusivas do recorte de ingressos. Só roda sobre as linhas que
 * têm o bloco `ingresso` preenchido — planilha de contas a receber não tem
 * nada disso e devolve nulo, o que faz a tela esconder os painéis.
 */
function agregarIngresso(invoices: Invoice[]): IngressoStats | null {
  const comDados = invoices.filter((i) => i.ingresso && i.status !== "cancelado");
  if (!comDados.length) return null;

  const compareceram = comDados.filter((i) => i.ingresso!.compareceu === true).length;
  const faltaram = comDados.filter((i) => i.ingresso!.compareceu === false).length;
  const totalComPresenca = compareceram + faltaram;

  // Em aberto = o que foi cobrado menos o que entrou. Linha sem valor devido
  // informado fica de fora: contar devido zero viraria crédito a favor.
  let devido = 0;
  let pagoDeQuemDeve = 0;
  let temDevido = false;
  for (const i of comDados) {
    const d = i.ingresso!.valorDevido;
    if (d == null) continue;
    temDevido = true;
    devido += d;
    pagoDeQuemDeve += i.valor;
  }

  const porStatus = new Map<InvoiceStatus, { compareceu: number; faltou: number }>();
  for (const i of comDados) {
    if (i.ingresso!.compareceu == null) continue;
    const atual = porStatus.get(i.status) ?? { compareceu: 0, faltou: 0 };
    if (i.ingresso!.compareceu) atual.compareceu++;
    else atual.faltou++;
    porStatus.set(i.status, atual);
  }

  // Devolve o ranking inteiro: quantos itens aparecem é decisão da tela, que
  // tem o botão "ver todos". Cortar aqui esconderia o 9º cargo para sempre.
  const contar = (get: (d: DadosIngresso) => string | undefined) => {
    const m = new Map<string, number>();
    for (const i of comDados) {
      const v = (get(i.ingresso!) ?? "").trim();
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const porDia = new Map<string, number>();
  for (const i of comDados) {
    const d = (i.ingresso!.cadastro ?? "").trim();
    if (d) porDia.set(d, (porDia.get(d) ?? 0) + 1);
  }
  const cadastrosPorDia = Array.from(porDia, ([date, cadastros]) => ({ date, cadastros })).sort(
    (a, b) => parseDateLoose(a.date) - parseDateLoose(b.date)
  );

  // Público por dia: conta pela data em que o crachá foi impresso. Quem tem
  // data mas está marcado como ausente entrou pela catraca do mesmo jeito —
  // a data é o registro mais concreto dos dois.
  const porDiaEvento = new Map<string, number>();
  for (const i of comDados) {
    const d = (i.ingresso!.dataComparecimento ?? "").trim();
    if (d) porDiaEvento.set(d, (porDiaEvento.get(d) ?? 0) + 1);
  }
  const comparecimentoPorDia = Array.from(porDiaEvento, ([name, value]) => ({ name, value })).sort(
    (a, b) => parseDateLoose(a.name) - parseDateLoose(b.name)
  );

  // Fluxo do credenciamento: quantas pessoas passaram em cada hora de cada
  // dia. A hora vem como "14:25:03" e o que importa é a faixa horária.
  const porHora = new Map<string, number>();
  for (const i of comDados) {
    const dia = (i.ingresso!.dataComparecimento ?? "").trim();
    const hora = (i.ingresso!.horaComparecimento ?? "").trim();
    if (!dia || !hora) continue;
    const h = parseInt(hora.slice(0, 2), 10);
    if (!Number.isFinite(h) || h < 0 || h > 23) continue;
    const chave = dia + "|" + h;
    porHora.set(chave, (porHora.get(chave) ?? 0) + 1);
  }
  const comparecimentoPorHora = Array.from(porHora, ([chave, pessoas]) => {
    const [dia, h] = chave.split("|");
    return { dia, hora: Number(h), pessoas };
  }).sort((a, b) => parseDateLoose(a.dia) - parseDateLoose(b.dia) || a.hora - b.hora);

  const porDoc = new Map<string, number>();
  for (const i of comDados) {
    const doc = i.cnpj?.trim();
    if (doc) porDoc.set(doc, (porDoc.get(doc) ?? 0) + 1);
  }

  return {
    compareceram,
    faltaram,
    taxaComparecimento: totalComPresenca ? (compareceram / totalComPresenca) * 100 : null,
    valorEmAberto: temDevido ? Math.max(0, devido - pagoDeQuemDeve) : null,
    comparecimentoPorStatus: Array.from(porStatus, ([status, v]) => ({ status, ...v })),
    convites: contar((d) => d.convite),
    categorias: agruparVariacoes(contar((d) => d.categoria)),
    // cargo tem masculino/feminino ("Diretor"/"Diretora"); segmento é
    // descrição de área, onde unir gênero não faria sentido
    cargos: agruparVariacoes(contar((d) => d.cargo), { unirGenero: true }),
    segmentos: agruparVariacoes(contar((d) => d.segmento)),
    estados: contar((d) => d.estado),
    paises: contar((d) => d.pais),
    cadastrosPorDia,
    comparecimentoPorDia,
    comparecimentoPorHora,
    documentosRepetidos: Array.from(porDoc.values()).filter((v) => v > 1).length,
    documentosDistintos: porDoc.size,
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
  { key: "nome", label: "Nome", required: true, grupo: "Quem" },
  { key: "documento", label: "Documento (CPF/RG)", required: true, grupo: "Quem" },
  { key: "categoria", label: "Categoria", required: false, grupo: "Quem" },

  { key: "status", label: "Status", required: true, grupo: "Credenciamento" },
  { key: "credenciadoEm", label: "Data de credenciamento", required: false, grupo: "Credenciamento" },
  { key: "checkinEm", label: "Data/hora do check-in", required: false, grupo: "Credenciamento" },
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

/**
 * Campos do import agrupados por assunto. Só expositor e status são exigidos:
 * cada serviço tem sua planilha e elas não trazem as mesmas colunas — muitas
 * não têm quantidade (uma linha = um pedido), algumas usam data/hora e outras
 * só turno.
 */
export const OPERACIONAL_FIELDS = [
  { key: "expositor", label: "Expositor (razão social)", required: true, grupo: "Quem contratou" },
  { key: "nomeFantasia", label: "Nome fantasia", required: false, grupo: "Quem contratou" },
  { key: "cnpj", label: "CNPJ / CPF", required: false, grupo: "Quem contratou" },

  { key: "estande", label: "Nº do estande", required: false, grupo: "Onde" },
  { key: "localizacao", label: "Localização (pavilhão/setor)", required: false, grupo: "Onde" },
  { key: "tipoEstande", label: "Tipo de estande / montagem", required: false, grupo: "Onde" },
  { key: "area", label: "Área (m²)", required: false, grupo: "Onde" },

  { key: "equipamento", label: "Equipamento / item", required: false, grupo: "O que foi contratado" },
  { key: "tipo", label: "Tipo / variação do item", required: false, grupo: "O que foi contratado" },
  { key: "quantidade", label: "Quantidade", required: false, grupo: "O que foi contratado" },
  { key: "kva", label: "Potência (kVA)", required: false, grupo: "O que foi contratado" },

  { key: "dataInicio", label: "Data inicial", required: false, grupo: "Quando" },
  { key: "dataFim", label: "Data final", required: false, grupo: "Quando" },
  { key: "horaInicio", label: "Hora inicial", required: false, grupo: "Quando" },
  { key: "horaFim", label: "Hora final", required: false, grupo: "Quando" },
  { key: "turno", label: "Turno", required: false, grupo: "Quando" },
  { key: "dias", label: "Nº de dias", required: false, grupo: "Quando" },

  { key: "status", label: "Status", required: true, grupo: "Cobrança" },
  { key: "valor", label: "Valor (unitário ou total)", required: false, grupo: "Cobrança" },
] as const;

export type OperacionalFieldKey = (typeof OPERACIONAL_FIELDS)[number]["key"];

// Declarado aqui (e não junto dos helpers abaixo) porque OPERACIONAL_FIELD_KEYWORDS
// referencia esta regex na avaliação do módulo — const não sofre hoisting.
const LOC_ESTANDE_HEADER = /^loc[a-z.]*\s*\/\s*estande|estande\s*\/\s*loc/;

const OPERACIONAL_FIELD_KEYWORDS: { key: OperacionalFieldKey; patterns: RegExp[] }[] = [
  { key: "cnpj", patterns: [/cnpj/, /\bcpf\b/, /documento/] },
  // "nome fantasia" antes de "expositor": senão o padrão de razão social/nome
  // roubaria a coluna fantasia e sobraria a errada pro expositor.
  { key: "nomeFantasia", patterns: [/fantasia/, /nome comercial/] },
  { key: "expositor", patterns: [/raz[aã]o social/, /expositor/, /empresa/, /cliente/, /contratante/] },
  // "Loc. / Estande" primeiro: é uma coluna só com os dois valores, e o
  // padrão de estande a roubaria antes de localizacao ter chance.
  { key: "localizacao", patterns: [LOC_ESTANDE_HEADER, /localiza/, /pavilh/, /setor/, /\brua\b/, /^loc\b/, /local/] },
  // tipo antes de estande: "Tipo de Estande" seria capturado pelo padrão de
  // estande (que procura o número do estande) se viesse depois.
  { key: "tipoEstande", patterns: [/tipo.*(estande|montagem|stand)/, /^montagem$/, /categoria.*estande/] },
  { key: "equipamento", patterns: [/equipamento/, /^item$/, /produto/, /material/] },
  // "tipo" genérico só depois dos tipos específicos, para não roubar a coluna
  // de montagem nem a de faturamento
  { key: "tipo", patterns: [/tipo de energia/, /voltagem/, /idioma/, /modalidade/, /varia[cç][aã]o/, /^tipo$/] },
  { key: "estande", patterns: [/estande/, /stand/, /\bbox\b/, /booth/] },
  { key: "dias", patterns: [/dias/, /di[aá]ria/, /days/] },
  // hora antes de data: "Hora Final" não pode ser capturada pelo padrão de
  // data final, e "Data Início" não pode ser capturada pelo de hora.
  { key: "horaInicio", patterns: [/hor(a|ário|ario).*(in[ií]cio|inicial|entrada)/, /(in[ií]cio|inicial|entrada).*hora/] },
  { key: "horaFim", patterns: [/hor(a|ário|ario).*(fim|final|t[eé]rmino|sa[ií]da)/, /(fim|final|t[eé]rmino|sa[ií]da).*hora/] },
  { key: "dataInicio", patterns: [/data.?hora/, /data .*(in[ií]cio|inicial|entrada)/, /(in[ií]cio|inicial).*data/, /^in[ií]cio$/, /^data$/] },
  { key: "dataFim", patterns: [/data .*(fim|final|t[eé]rmino|sa[ií]da)/, /(fim|final|t[eé]rmino).*data/, /^(fim|final|t[eé]rmino)$/] },
  { key: "turno", patterns: [/turno/, /per[ií]odo/] },
  { key: "quantidade", patterns: [/quantidade/, /\bqtd\b/, /\bqtde\b/, /\bqty\b/] },
  { key: "valor", patterns: [/valor/, /pre[cç]o/, /^total$/, /amount/] },
  // "Total Geral" é a soma de kva + mínimo + cortesia: é o número que
  // interessa, e vem antes das colunas parciais na ordem de preferência
  { key: "kva", patterns: [/^total geral$/, /kva total/, /^kva$/, /pot[eê]ncia/] },
  { key: "area", patterns: [/[aá]rea/, /\bm2\b/, /m²/] },
  { key: "status", patterns: [/status/, /situa[cç][aã]o/] },
];

/**
 * Nome do arquivo como ele deve APARECER na tela: sem a extensão e sem o
 * carimbo de data/versão que costuma vir grudado no fim ("Recepcionista
 * 03-09-2026.xls" → "Recepcionista"). O nome completo continua sendo a chave
 * real do import — é ele que identifica o arquivo no banco e o que permite
 * reenviar a versão atualizada substituindo só as linhas dele.
 */
export function nomeArquivoCurto(fileName: string): string {
  const semExtensao = fileName.replace(/\.[^.]+$/, "");
  let s = semExtensao;

  // "(1)" de cópia, "v2" de versão
  s = s.replace(/[\s_-]*(\(\d+\)|v\d+)\s*$/i, "");

  // Data no fim. A ISO vem primeiro de propósito: aplicada depois, a regra de
  // dd-mm-aaaa casaria o "26-09-03" de "..._2026-09-03" e deixaria um "20"
  // pendurado no nome. O separador antes da data é exigido para não morder
  // dígitos de um número maior.
  s = s.replace(/(^|[\s_-])\d{4}[-_./]\d{1,2}[-_./]\d{1,2}\s*$/, "");
  s = s.replace(/(^|[\s_-])\d{1,2}[-_./]\d{1,2}([-_./]\d{2,4})?\s*$/, "");
  s = s.replace(/(^|[\s_-])\d{8}\s*$/, "");

  // o ano sozinho FICA: é o que distingue "Recepcionista 2025" de
  // "Recepcionista 2026" na lista de arquivos importados.
  s = s.replace(/[\s_-]+$/, "").trim();
  return s || semExtensao;
}

/**
 * Palavras que aparecem no nome do arquivo sem dizer QUAL serviço ele é:
 * o tipo de documento, ligações, marcadores de versão/revisão. Tudo isso é
 * descartado — o que sobra é a palavra-chave que vira o nome do serviço.
 */
const RUIDO_NOME_ARQUIVO = new Set([
  "contratacao", "contratacoes", "contrato", "contratos", "contratada", "contratado",
  "pedido", "pedidos", "solicitacao", "solicitacoes", "requisicao",
  "planilha", "planilhas", "relatorio", "relatorios", "lista", "listagem", "listas",
  "cadastro", "controle", "mapa", "resumo", "base", "dados", "export", "exportacao",
  "geral", "final", "finalizado", "atualizado", "atualizada", "atualizacao",
  "novo", "nova", "copia", "revisao", "versao", "parcial", "consolidado",
  "de", "da", "do", "das", "dos", "para", "por", "com", "e",
]);

/**
 * O serviço não vem de coluna nenhuma — cada planilha É um serviço, então o
 * nome sai do arquivo. Em vez de tirar só o prefixo, joga fora toda palavra
 * que não identifica o serviço: tipo de documento, ano, data, versão, número
 * solto e (quando informado) o nome do evento e da edição, que se repetem em
 * todos os arquivos e por isso não distinguem nada.
 *
 *   "Contratação Recepcionista.xls"                        → "Recepcionista"
 *   "Relatorio_Contratacao_Limpeza_SetExpo_2026_v2.xlsx"   → "Limpeza"
 *   "PEDIDO DE SEGURANCA - 03-09-2026 (1).xls"             → "Seguranca"
 *
 * O resultado continua editável antes de confirmar o import — heurística
 * nenhuma acerta todo nome de arquivo que alguém inventa.
 */
export function servicoFromFileName(fileName: string, contexto: string[] = []): string {
  const semExtensao = fileName.replace(/\.[^.]+$/, "");

  // o nome do evento/edição entra como ruído: "SetExpo 2026" aparece em todos
  // os arquivos do evento, então não é o que diferencia um serviço do outro.
  const ruidoContexto = new Set(
    contexto
      .flatMap((c) => c.split(/[\s_\-]+/))
      .map((w) => normalize(w))
      .filter((w) => w.length > 1)
  );

  const palavras = semExtensao
    .split(/[\s_\-.]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => {
      const n = normalize(w);
      if (!n) return false;
      if (/^\(?\d+\)?$/.test(n)) return false;            // "2026", "(1)", "03", "20260903"
      if (/^(xls|xlsx|csv|ods)$/.test(n)) return false;     // extensão escrita no meio do nome
      if (/^v\d+$/.test(n)) return false;                  // "v2"
      if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(n)) return false; // "03/09/2026"
      if (RUIDO_NOME_ARQUIVO.has(n)) return false;
      if (ruidoContexto.has(n)) return false;
      return true;
    });

  if (!palavras.length) return semExtensao.trim() || fileName;

  // Sobrando mais de uma palavra, fica com a mais longa: em "Recepcionista
  // Bilingue" o serviço é recepcionista, e o resto costuma ser qualificador.
  // Duas palavras curtas e parecidas ("Painel LED") seguem juntas.
  const principal = palavras.length <= 2 ? palavras.join(" ") : palavras.sort((a, b) => b.length - a.length)[0];

  // Capitaliza sem destruir sigla: LED, TV, AV vieram em caixa alta de
  // propósito e viram "Led"/"Tv" se passarem por toLowerCase cego.
  return principal
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function suggestOperacionalMapping(headers: string[]): ColumnMapping<OperacionalFieldKey> {
  return suggestMapping(headers, OPERACIONAL_FIELD_KEYWORDS);
}

const OPERACIONAL_STATUS_KEYWORDS: { value: ServicoStatus; patterns: RegExp[] }[] = [
  // isento vem primeiro porque "sem débito"/"sem crédito" contém palavras que
  // as outras regras também procuram
  { value: "isento", patterns: [/isent/, /cortesia/, /gratuit/, /dispensad/, /sem ?d[eé]bito/, /sem ?cr[eé]dito/, /sem ?cobran/, /n[aã]o ?gera ?cobran/] },
  { value: "cancelado", patterns: [/cancelad/, /recusad/, /negad/, /reprovad/, /estornad/, /desistiu/] },
  { value: "pago", patterns: [/pago/, /quitad/, /liquidad/, /paid/, /confirmad/, /aprovad/] },
  { value: "pendente", patterns: [/pendente/, /em aberto/, /aberto/, /aguardando/, /an[aá]lise/, /solicitad/] },
];

export function suggestOperacionalStatusMapping(values: string[]): StatusMapping<ServicoStatus> {
  return suggestValueMapping(values, OPERACIONAL_STATUS_KEYWORDS);
}

/**
 * Algumas planilhas trazem local e estande numa coluna só ("Loc. / Estande"
 * com valor "XXX / X123") e outras em colunas separadas. Sem separar, o mesmo
 * lugar vira dois rótulos diferentes no painel por localização — "XXX" numa
 * planilha e "XXX / X123" na outra — e nada soma junto.
 */

function isLocEstandeHeader(header: string | undefined): boolean {
  return !!header && LOC_ESTANDE_HEADER.test(normalize(header));
}

/** "XXX / X123" → ["XXX", "X123"]. Sem a barra, tudo vira localização. */
function splitLocEstande(valor: string): [string, string] {
  const i = valor.indexOf("/");
  if (i === -1) return [valor.trim(), ""];
  return [valor.slice(0, i).trim(), valor.slice(i + 1).trim()];
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
  const iTipoEstande = idx("tipoEstande");
  const iQuantidade = idx("quantidade");
  const iDias = idx("dias");
  const iDataInicio = idx("dataInicio");
  const iDataFim = idx("dataFim");
  const iHoraInicio = idx("horaInicio");
  const iHoraFim = idx("horaFim");
  const iTurno = idx("turno");
  const iValor = idx("valor");
  const iEquipamento = idx("equipamento");
  const iTipo = idx("tipo");
  const iKva = idx("kva");
  const iArea = idx("area");
  const iStatus = idx("status");

  // "Valor Unitário" precisa ser multiplicado pela quantidade; "Valor Total"
  // já vem fechado. O cabeçalho é quem diz qual dos dois é.
  const valorEhUnitario = /unit/.test(normalize(mapping.valor ?? ""));

  // sem nome informado, cai pro derivado do arquivo — é sempre o arquivo que
  // diz qual serviço é, nunca uma coluna da planilha.
  const nomeServico = servico?.trim() || servicoFromFileName(sourceFile);

  // coluna única "Loc. / Estande": o estande sai dela, a não ser que a planilha
  // também tenha uma coluna de estande própria (aí a dela manda).
  const combinada = isLocEstandeHeader(mapping.localizacao);
  const localizacaoDaLinha = (r: string[]) => {
    if (iLocalizacao < 0) return "";
    return combinada ? splitLocEstande(r[iLocalizacao])[0] : r[iLocalizacao];
  };
  const estandeDaLinha = (r: string[]) => {
    if (iEstande >= 0 && r[iEstande]) return r[iEstande];
    if (combinada && iLocalizacao >= 0) return splitLocEstande(r[iLocalizacao])[1];
    return "";
  };

  return table.rows.map((r) => {
    const rawStatus = iStatus >= 0 ? r[iStatus] : "";
    // a coluna pode vir como "13/07/2026 17:13" — a hora embutida só é
    // aproveitada quando a planilha não tem coluna de hora própria
    const inicio = separarDataHora(iDataInicio >= 0 ? r[iDataInicio] : "");
    const fim = separarDataHora(iDataFim >= 0 ? r[iDataFim] : "");
    const dataInicio = inicio.data;
    const dataFim = fim.data;
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
      estande: estandeDaLinha(r),
      localizacao: localizacaoDaLinha(r),
      tipoEstande: iTipoEstande >= 0 ? r[iTipoEstande] : "",
      equipamento: iEquipamento >= 0 ? r[iEquipamento] : "",
      tipo: iTipo >= 0 ? r[iTipo] : "",
      quantidade,
      dias,
      dataInicio,
      dataFim,
      horaInicio: (iHoraInicio >= 0 ? r[iHoraInicio] : "") || inicio.hora,
      horaFim: (iHoraFim >= 0 ? r[iHoraFim] : "") || fim.hora,
      turno: iTurno >= 0 ? r[iTurno] : "",
      valor:
        iValor >= 0 && r[iValor]
          ? valorEhUnitario
            ? parseValor(r[iValor]) * quantidade
            : parseValor(r[iValor])
          : null,
      // "1.520,00" no formato BR — mesmo leitor do campo de valor
      kva: iKva >= 0 && r[iKva] ? parseValor(r[iKva]) : null,
      area: iArea >= 0 && r[iArea] ? parseValor(r[iArea]) : null,
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

/**
 * O mesmo tipo de estande chega escrito de várias formas conforme quem
 * preencheu e de qual relatório veio — "exhibit_hall", "exhibit hall",
 * "EXHIBIT HALL" e "Exhibit Hall" são o mesmo estande, e apareciam como quatro
 * barras diferentes no painel. Agrupa pelas palavras: caixa, acento e
 * separador (_ - .) deixam de contar, e o rótulo sai numa forma única.
 *
 * O que NÃO é agrupado: variações com palavras a mais
 * ("exhibit_hall_-_isencao_taxa_de_montagem") continuam separadas — ali o
 * texto extra diz algo sobre a contratação e somar apagaria essa distinção.
 */
export function tipoEstandeAgrupado(valor: string | null | undefined): string {
  const bruto = (valor ?? "").trim();
  if (!bruto) return "";

  return bruto
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function aggregateOperacional(pedidos: PedidoServico[]): OperacionalData {
  // pedido cancelado não vira operação — fica fora dos totais e dos gráficos
  // de volume, mas continua na tabela e na contagem por status.
  const ativos = pedidos.filter((p) => p.status !== "cancelado");
  const totalItens = ativos.reduce((s, p) => s + p.quantidade, 0);

  const servicoTotals = new Map<string, number>();
  for (const p of ativos) if (p.servico) servicoTotals.set(p.servico, (servicoTotals.get(p.servico) ?? 0) + p.quantidade);

  const expositorTotals = new Map<string, number>();
  for (const p of ativos) if (p.expositor) expositorTotals.set(p.expositor, (expositorTotals.get(p.expositor) ?? 0) + p.quantidade);

  const statusTotals = new Map<ServicoStatus, number>();
  for (const p of pedidos) statusTotals.set(p.status, (statusTotals.get(p.status) ?? 0) + 1);

  // quantos itens cada tipo de estande contratou — é a leitura que o
  // operacional usa para dimensionar equipe e material por perfil de estande.
  // soma da potência: linha sem kVA fica fora, e sem nenhuma linha com o dado
  // o KPI nem aparece na tela
  const comKva = ativos.filter((p) => p.kva != null);
  const kvaTotal = comKva.length ? comKva.reduce((s, p) => s + (p.kva as number), 0) : null;

  const tipoTotals = new Map<string, number>();
  for (const p of ativos) {
    const tipo = tipoEstandeAgrupado(p.tipoEstande);
    if (tipo) tipoTotals.set(tipo, (tipoTotals.get(tipo) ?? 0) + p.quantidade);
  }

  // equipamento e variação seguem o mesmo agrupamento por escrita do tipo de
  // estande: "Câmera de Monitoramento" e "CAMERA DE MONITORAMENTO" são um item só
  const somarPor = (get: (p: PedidoServico) => string) => {
    const m = new Map<string, number>();
    for (const p of ativos) {
      const chave = tipoEstandeAgrupado(get(p));
      if (chave) m.set(chave, (m.get(chave) ?? 0) + p.quantidade);
    }
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  // Isenção: itens que não geram cobrança (isento + sem débito) sobre o total
  // ativo. É a leitura de quanto do serviço saiu de graça para o expositor.
  const itensIsentos = ativos.filter((p) => p.status === "isento").reduce((s, p) => s + p.quantidade, 0);

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalItens,
      taxaIsencao: totalItens ? (itensIsentos / totalItens) * 100 : null,
      qtdExpositores: new Set(ativos.map((p) => p.expositor).filter(Boolean)).size,
      kvaTotal,
    },
    servicos: Array.from(servicoTotals, ([label, value]) => ({ label, value })),
    // ranking completo: a tela mostra os 10 primeiros e abre o resto sob
    // demanda. Cortar aqui impediria ver o expositor de número 11.
    topExpositores: Array.from(expositorTotals, ([name, value]) => ({ name, value })).sort(
      (a, b) => b.value - a.value
    ),
    statusBreakdown: Array.from(statusTotals, ([label, value]) => ({ label, value })),
    tiposEstande: Array.from(tipoTotals, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    equipamentos: somarPor((p) => p.equipamento),
    tipos: somarPor((p) => p.tipo),
    pedidos,
  };
}
