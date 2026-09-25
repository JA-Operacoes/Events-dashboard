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
  EnergiaPorEstande,
  EstandeEnergia,
  ExpositorBase,
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

/**
 * Contas a receber de ingresso ("contas_a_receber_sem_rateio"): a mesma venda
 * vista pelo ERP financeiro, uma linha por duplicata.
 *
 * Não tem coluna de status: o relatório é exportado já filtrado (um arquivo de
 * pagas, um de em aberto, um de canceladas), então quem diz o status é a
 * escolha feita no import, não a planilha. Também não tem rateio — nenhuma
 * coluna de conta — nem os campos de perfil e presença, que só existem do lado
 * do credenciamento.
 */
export const FINANCEIRO_INGRESSO_VALORES_FIELDS = [
  { key: "cliente", label: "Comprador (razão social)", required: true, grupo: "Quem" },
  { key: "cnpj", label: "CPF / CNPJ", required: false, grupo: "Quem" },
  { key: "numero", label: "Número da duplicata", required: false, grupo: "Quem" },

  { key: "valor", label: "Valor da duplicata", required: true, grupo: "Cobrança" },
  { key: "forma", label: "Forma de pagamento", required: false, grupo: "Cobrança" },
  { key: "pagamento", label: "Data de pagamento", required: false, grupo: "Cobrança" },
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
 * Cabeçalhos do contas a receber de ingresso. As armadilhas aqui são colunas
 * que existem no cabeçalho mas vêm vazias no export: "NOME COMPLETO" e
 * "DOCUMENTO" não têm uma linha preenchida sequer, e quem identifica o
 * comprador é "RAZÃO SOCIAL". Por isso razão social vem antes de nome completo,
 * e CNPJ antes de documento.
 */
const FINANCEIRO_INGRESSO_VALORES_KEYWORDS: { key: FinanceiroImportKey; patterns: RegExp[] }[] = [
  // data antes de forma: "FORMA PAGAMENTO" e "DATA PAGAMENTO" disputam o mesmo
  // padrão solto de "pagamento"
  { key: "pagamento", patterns: [/^data pagamento$/, /data.*pagamento/] },
  { key: "forma", patterns: [/forma.*pag/, /m[eé]todo.*pag/] },
  // "TOTAL DA DUPLICATA" é o valor da linha; "VALOR TOTAL DOCUMENTO" pode somar
  // várias duplicatas do mesmo documento
  { key: "valor", patterns: [/total da duplicata/, /valor total documento/, /^valor$/] },
  // "DUPLICATA" ("V39139") identifica a cobrança; "ID DUPLICATA" é a chave
  // interna do ERP e não aparece em lugar nenhum fora dele
  { key: "numero", patterns: [/^duplicata$/, /n[uú]mero.*documento/, /^n[º°o].*duplicata$/] },
  { key: "cnpj", patterns: [/^cnpj$/, /^cpf$/, /^documento$/] },
  { key: "cliente", patterns: [/raz[aã]o social/, /nome fantasia/, /nome completo/] },
];

export function suggestFinanceiroIngressoValoresMapping(headers: string[]): ColumnMapping<FinanceiroImportKey> {
  return suggestMapping(headers, FINANCEIRO_INGRESSO_VALORES_KEYWORDS);
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
export function sugerirTipoFinanceiro(fileName: string, table: SheetTable): string {
  // o cabeçalho decide antes do nome do arquivo: os três relatórios saem do ERP
  // com nomes intercambiáveis ("contas_a_receber_sem_rateio (3).xls") e às vezes
  // fatiados em arquivo_1/2/3, mas as colunas são inconfundíveis.
  const cols = table.headers.map(normalize);
  const tem = (re: RegExp) => cols.some((c) => re.test(c));

  // só o credenciamento tem crachá e comparecimento
  if (tem(/c[oó]digo crach[aá]/) || tem(/^compareceu$/)) return "ingresso-quantidade";
  // rateio: as colunas de conta só existem no relatório analítico
  if (tem(/^conta ?2$/) || tem(/^conta$/) || tem(/centro.*custo/)) return "expositor";
  // contas a receber sem rateio
  if (tem(/total da duplicata/) || tem(/^duplicata$/)) return "ingresso-valores";

  const n = normalize(fileName);
  if (/ingresso|inscri|participante|visitante|crach/.test(n)) return "ingresso-quantidade";
  if (/rateio/.test(n)) return "expositor";
  if (/expositor|montador|estande|patrocin/.test(n)) return "expositor";
  return "";
}

/**
 * O que a planilha que está sendo importada é. São três porque são três fontes
 * de verdade diferentes, com cabeçalhos que não se parecem:
 *
 * - `expositor`: contas a receber COM rateio — o relatório analítico, com as
 *   colunas de conta que alimentam o painel de centro de custo.
 * - `ingresso-valores`: contas a receber SEM rateio — uma linha por duplicata.
 *   É daqui que sai quanto foi vendido e quanto entrou.
 * - `ingresso-quantidade`: o relatório do credenciamento — uma linha por
 *   inscrição, com perfil e comparecimento. É daqui que sai quantas pessoas.
 *
 * Valor vem sempre do financeiro; do credenciamento vem só contagem, perfil e
 * presença. As duas fontes descrevem a mesma venda, e somá-las cobraria o
 * mesmo ingresso duas vezes.
 */
export const FINANCEIRO_TIPOS = ["expositor", "ingresso-valores", "ingresso-quantidade"] as const;
export type FinanceiroTipoPlanilha = (typeof FINANCEIRO_TIPOS)[number];

/** A origem da receita que cada tipo representa — os dois de ingresso caem no mesmo recorte. */
export function origemDoTipo(tipo: string): string {
  return tipo === "expositor" ? "Expositor" : tipo.startsWith("ingresso") ? "Ingresso" : "";
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
  /** Tipo de planilha escolhido no import (ver FINANCEIRO_TIPOS). */
  tipoEscolhido?: string,
  /**
   * Status que vale para o arquivo inteiro. O contas a receber de ingresso é
   * exportado já filtrado por situação e não traz coluna de status — quem
   * informa é o import. Só é usado quando não há coluna de status mapeada: com
   * a coluna presente, é ela que manda, linha a linha.
   */
  statusFixo?: InvoiceStatus
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

  const escolha = (tipoEscolhido ?? "").trim();
  const forcarOrigem = origemDoTipo(escolha);
  // sem coluna de status, o arquivo inteiro recebe o que foi escolhido no
  // import; sem escolha também, sobra "pendente" — o padrão de sempre.
  const statusSemColuna: InvoiceStatus = statusFixo ?? "pendente";
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
      status: iStatus >= 0 ? statusMapping[rawStatus] ?? "pendente" : statusSemColuna,
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
      fonte: escolha || undefined,
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

/**
 * A conta que representa a duplicata no painel de rateio.
 *
 * O relatório analítico de rateio traz as colunas Conta / Conta 2 / Conta 3 como níveis de
 * uma hierarquia contábil — "Conta" é a analítica (ENERGIA ELÉTRICA - 1.0) e as seguintes são
 * as agregadoras acima dela (EVENTO - FORM EXPOSITOR/MONTADOR - 2.5). Elas não são um rateio
 * entre contas: o valor da linha pertence inteiro à analítica, e a agregadora só o reagrupa.
 *
 * Por isso ficamos com a mais específica disponível. Centro de custo é outra dimensão e entra
 * apenas como último recurso, quando a planilha não mapeou nenhuma coluna de conta.
 */
export function contaEfetiva(inv: Invoice): string | null {
  return inv.conta1 || inv.conta2 || inv.conta3 || inv.centroCusto || null;
}

export function aggregateFinanceiro(invoices: Invoice[]): FinanceiroData {
  /**
   * O credenciamento e o contas a receber descrevem a mesma venda: o relatório
   * de credenciamento traz "Total pago" por inscrição e o financeiro traz a
   * duplicata correspondente. Com os dois importados, somar tudo cobraria cada
   * ingresso duas vezes — então o dinheiro sai do financeiro e o credenciamento
   * entra só com contagem, perfil e presença.
   *
   * Quando o financeiro ainda não foi importado, o credenciamento vale pelos
   * dois: é melhor mostrar o valor que ele conhece do que uma tela zerada.
   */
  const temFinanceiro = invoices.some((i) => i.fonte === "ingresso-valores" || i.fonte === "expositor");
  const comValor = temFinanceiro ? invoices.filter((i) => i.fonte !== "ingresso-quantidade") : invoices;

  const pagos = comValor.filter((i) => i.status === "pago");
  const totalRecebido = pagos.reduce((s, i) => s + i.valor, 0);
  const ticketMedio = pagos.length ? totalRecebido / pagos.length : 0;

  const methodTotals = new Map<string, number>();
  for (const inv of comValor) methodTotals.set(inv.forma, (methodTotals.get(inv.forma) ?? 0) + inv.valor);

  const clientTotals = new Map<string, number>();
  for (const inv of comValor) clientTotals.set(inv.cliente, (clientTotals.get(inv.cliente) ?? 0) + inv.valor);

  const statusTotals = new Map<InvoiceStatus, number>();
  for (const inv of invoices) statusTotals.set(inv.status, (statusTotals.get(inv.status) ?? 0) + 1);

  // só faz sentido quando a planilha traz a coluna de origem — sem ela toda
  // linha cairia em "outras" e o painel diria uma coisa que não é verdade.
  const origemTotals = new Map<OrigemReceita, number>();
  for (const inv of comValor) {
    const tipo = inv.origemTipo ?? classificarOrigem(inv.origem);
    if (!tipo) continue;
    origemTotals.set(tipo, (origemTotals.get(tipo) ?? 0) + inv.valor);
  }

  // opcional — só populado quando a planilha traz colunas de rateio (Conta/Conta 2/Conta 3).
  // Cada duplicata soma numa conta só: a mais específica que ela tem (ver contaEfetiva).
  // Somar em todas dobrava o total, porque as colunas são níveis de uma hierarquia e não
  // centros de custo paralelos — a agregadora repetia, sozinha, o valor de todas as filhas.
  const contaTotals = new Map<string, number>();
  for (const inv of comValor) {
    const conta = contaEfetiva(inv);
    if (conta) contaTotals.set(conta, (contaTotals.get(conta) ?? 0) + inv.valor);
  }

  // Só o realizado: o vencimento saiu do painel porque, quando uma duplicata
  // vence, o ERP gera outra no lugar — a data antiga não descreve mais nada
  // que se possa comparar com o que entrou.
  const recebidoPorDia = new Map<string, number>();
  for (const inv of comValor) {
    if (inv.pagamento) recebidoPorDia.set(inv.pagamento, (recebidoPorDia.get(inv.pagamento) ?? 0) + inv.valor);
  }

  const timeline = Array.from(recebidoPorDia, ([date, recebido]) => ({ date, recebido })).sort(
    (a, b) => parseDateLoose(a.date) - parseDateLoose(b.date)
  );

  /**
   * Leitura de ingresso: quantas PESSOAS entraram, não quantas linhas existem.
   *
   * O relatório de credenciamento sai fatiado a cada 4.000 linhas e a mesma
   * pessoa aparece em mais de uma lista — quem comprou ingresso e ainda foi
   * convidado por dois expositores tem três linhas, todas com o mesmo código de
   * crachá. Contar linha a linha inflaria o público; o código de crachá é o que
   * identifica a pessoa, e é ele que entra no campo "número".
   *
   * A planilha que traz coluna de quantidade (uma linha para vários ingressos)
   * continua somando essa coluna: ali a linha não é uma pessoa.
   */
  const naoCanceladas = invoices.filter((i) => i.status !== "cancelado");
  // a fonte identifica direto; o bloco `ingresso` é a rede para as linhas
  // gravadas antes de a fonte existir, que não têm o campo preenchido
  const porCredenciamento = naoCanceladas.filter(
    (i) => i.fonte === "ingresso-quantidade" || (!i.fonte && i.ingresso)
  );
  const qtdIngressos = porCredenciamento.length
    ? new Set(porCredenciamento.map((i) => i.numero)).size
    : naoCanceladas.reduce((s, i) => s + (i.quantidade ?? 1), 0);

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalRecebido,
      ticketMedio,
      qtdDuplicatas: comValor.length,
      qtdIngressos: naoCanceladas.length ? qtdIngressos : null,
      // com o financeiro carregado, em aberto é o que as duplicatas dizem: a
      // soma das que não foram pagas. Sem ele, sobra a conta do credenciamento
      // (devido menos pago), que é o que aquele relatório sabe informar.
      valorEmAberto: temFinanceiro
        ? comValor.filter((i) => i.status === "pendente").reduce((s, i) => s + i.valor, 0)
        : calcularValorEmAberto(naoCanceladas),
    },
    timeline,
    paymentMethods: Array.from(methodTotals, ([label, value]) => ({ label, value })),
    topClients: Array.from(clientTotals, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    statusBreakdown: Array.from(statusTotals, ([label, value]) => ({ label, value })),
    // Conta zerada continua na lista, com a barra vazia: ela existe no rateio e sumir dali
    // faria parecer que não foi importada. A ordenação joga essas linhas para o fim.
    contas: Array.from(contaTotals, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
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
/**
 * Leitura do público a partir dos participantes do credenciamento. Reaproveita
 * a mesma agregação do relatório de ingressos: são a mesma planilha, lida por
 * módulos diferentes — aqui interessa quem veio, lá quanto entrou.
 */
export function agregarPublico(participantes: Participante[]): IngressoStats | null {
  const comoInvoices: Invoice[] = participantes
    .filter((p) => p.ingresso)
    .map((p) => ({
      id: "",
      numero: "",
      cliente: p.nome,
      cnpj: p.documento,
      valor: p.valor ?? 0,
      status: p.statusPagamento ?? "pago",
      forma: "",
      vencimento: "",
      pagamento: null,
      ingresso: p.ingresso,
    }));
  return agregarIngresso(comoInvoices);
}

/**
 * Em aberto = o que foi cobrado menos o que entrou. Linha sem valor devido
 * informado fica de fora: contar devido zero viraria crédito a favor.
 *
 * Roda no lugar da agregação completa de público, que custava ~35ms sobre 11
 * mil duplicatas para alimentar um cartão só.
 */
function calcularValorEmAberto(invoices: Invoice[]): number | null {
  let devido = 0;
  let pago = 0;
  let temDevido = false;
  for (const i of invoices) {
    const d = i.ingresso?.valorDevido;
    if (d == null) continue;
    temDevido = true;
    devido += d;
    pago += i.valor;
  }
  return temDevido ? Math.max(0, devido - pago) : null;
}

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

  // O status do credenciamento em si raramente vem na planilha: o que o
  // relatório traz é a situação de pagamento do ingresso. Ela é o campo que
  // passa pelo de-para (Pago / Em aberto / Isento / Cancelado); a situação da
  // credencial sai do "Compareceu" quando não houver coluna própria.
  { key: "statusCredenciamento", label: "Status do credenciamento (se houver)", required: false, grupo: "Credenciamento" },
  { key: "credenciadoEm", label: "Data de credenciamento", required: false, grupo: "Credenciamento" },
  { key: "checkinEm", label: "Data/hora do check-in", required: false, grupo: "Credenciamento" },

  // Colunas do relatório de credenciamento que descrevem a presença e o
  // perfil de quem veio. Todas opcionais: nem todo evento exporta tudo.
  { key: "compareceu", label: "Compareceu", required: false, grupo: "Presença" },
  { key: "dataComparecimento", label: "Data do comparecimento", required: false, grupo: "Presença" },
  { key: "horaComparecimento", label: "Hora do comparecimento", required: false, grupo: "Presença" },

  { key: "convite", label: "Origem do convite / lote", required: false, grupo: "Perfil do público" },
  { key: "cargo", label: "Cargo", required: false, grupo: "Perfil do público" },
  { key: "segmento", label: "Segmento", required: false, grupo: "Perfil do público" },
  { key: "estado", label: "Estado", required: false, grupo: "Perfil do público" },
  { key: "pais", label: "País", required: false, grupo: "Perfil do público" },

  { key: "status", label: "Situação do pagamento", required: true, grupo: "Pagamento do ingresso" },
  { key: "valor", label: "Valor pago", required: false, grupo: "Pagamento do ingresso" },
  { key: "valorDevido", label: "Valor a pagar (devido)", required: false, grupo: "Pagamento do ingresso" },
] as const;

export type CredenciamentoFieldKey = (typeof CREDENCIAMENTO_FIELDS)[number]["key"];

const CREDENCIAMENTO_FIELD_KEYWORDS: { key: CredenciamentoFieldKey; patterns: RegExp[] }[] = [
  { key: "documento", patterns: [/documento/, /\bcpf\b/, /\brg\b/, /identidade/] },
  // presença antes de check-in: no relatório de credenciamento é a coluna
  // "Compareceu" que diz quem passou, e ela seria capturada pelo padrão de
  // check-in se viesse depois
  { key: "compareceu", patterns: [/^compareceu$/, /^presen[cç]a$/] },
  { key: "dataComparecimento", patterns: [/data.?hora.*(impress|check|comparec|entrada)/, /data.*impress/, /data.*check.?in/, /data.*comparec/, /data.*entrada/] },
  { key: "horaComparecimento", patterns: [/hora.*impress/, /hora.*check.?in/, /hora.*comparec/, /hora.*entrada/] },
  { key: "checkinEm", patterns: [/check.?in/, /entrada/] },
  { key: "credenciadoEm", patterns: [/credenciad/, /inscri[cç][aã]o/, /cadastro/, /registro/] },
  { key: "convite", patterns: [/^edi[cç][aã]o$/, /lote/, /convidado de/, /origem.*convite/] },
  { key: "categoria", patterns: [/^categoria$/, /categoria/, /tipo.*ingresso/, /nome ingresso/, /perfil/] },
  // "CARGOS" (lista padronizada) antes de "CARGO" (texto livre digitado pelo
  // participante): a primeira agrupa, a segunda tem um valor por pessoa.
  { key: "cargo", patterns: [/^cargos$/, /^cargo$/, /fun[cç][aã]o/] },
  { key: "segmento", patterns: [/^segmentos?$/, /[aá]rea de atua/] },
  { key: "estado", patterns: [/^estado$/, /\buf\b/, /estado comercial/] },
  { key: "pais", patterns: [/^pa[ií]s$/, /pa[ií]s comercial/] },
  { key: "valorDevido", patterns: [/total a pagar$/, /valor a pagar/, /valor devido/] },
  { key: "valor", patterns: [/total pago/, /^valor$/, /valor pago/] },
  { key: "statusCredenciamento", patterns: [/status.*credenc/, /situa[cç][aã]o.*credenc/] },
  { key: "status", patterns: [/^pagamento$/, /situa[cç][aã]o.*pagamento/, /status.*pagamento/, /situa[cç][aã]o/, /status/] },
  { key: "nome", patterns: [/nome completo/, /nome.*participante/, /^nome$/, /participante/, /visitante/, /convidado/] },
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
  statusMapping: StatusMapping<InvoiceStatus>,
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
  const iStatusCred = idx("statusCredenciamento");
  const iCompareceu = idx("compareceu");
  const iDataComp = idx("dataComparecimento");
  const iHoraComp = idx("horaComparecimento");
  const iConvite = idx("convite");
  const iCargo = idx("cargo");
  const iSegmento = idx("segmento");
  const iEstado = idx("estado");
  const iPais = idx("pais");
  const iValor = idx("valor");
  const iValorDevido = idx("valorDevido");

  // A situação da credencial (quando a planilha tem uma coluna própria) não
  // passa pelo de-para — esse agora é da situação de pagamento. Classificamos
  // pelos mesmos termos de sempre.
  const mapaCredenciamento =
    iStatusCred >= 0 ? suggestCredenciamentoStatusMapping(distinctValues(table, table.headers[iStatusCred])) : {};

  // Data e hora podem vir num campo só ("21/07/2026 14:25") — nesse caso a
  // coluna de hora fica vazia e a de data carrega as duas informações.
  const temColunaHora = iHoraComp >= 0;

  const temPerfil =
    iCompareceu >= 0 || iDataComp >= 0 || iConvite >= 0 || iCargo >= 0 || iSegmento >= 0 || iEstado >= 0 || iPais >= 0;

  return table.rows.map((r, i) => {
    const rawStatus = iStatus >= 0 ? r[iStatus] : "";
    const separado = iDataComp >= 0 ? separarDataHora(r[iDataComp] ?? "") : { data: "", hora: "" };
    const dataComp = separado.data;
    const horaDaData = separado.hora;
    const horaComp = temColunaHora && r[iHoraComp] ? r[iHoraComp] : horaDaData;
    return {
      nome: iNome >= 0 ? r[iNome] : "",
      documento: iDoc >= 0 && r[iDoc] ? r[iDoc] : `${sourceFile}#${i + 1}`,
      categoria: iCategoria >= 0 ? r[iCategoria] : "",
      credenciadoEm: iCredenciadoEm >= 0 && r[iCredenciadoEm] ? r[iCredenciadoEm] : null,
      checkinEm: iCheckinEm >= 0 && r[iCheckinEm] ? r[iCheckinEm] : null,
      // sem coluna própria de credenciamento, quem passou pela catraca está
      // credenciado e o resto fica pendente — é a leitura que o relatório permite
      status:
        iStatusCred >= 0
          ? mapaCredenciamento[r[iStatusCred] ?? ""] ?? "pendente"
          : iCompareceu >= 0
          ? parseSimNao(r[iCompareceu])
            ? "credenciado"
            : "pendente"
          : "credenciado",
      valor: iValor >= 0 && r[iValor] ? parseValor(r[iValor]) : null,
      statusPagamento: iStatus >= 0 ? statusMapping[rawStatus] ?? null : null,
      ingresso: temPerfil
        ? {
            compareceu: iCompareceu >= 0 ? parseSimNao(r[iCompareceu]) : null,
            valorDevido: iValorDevido >= 0 && r[iValorDevido] ? parseValor(r[iValorDevido]) : null,
            convite: iConvite >= 0 ? r[iConvite] : "",
            categoria: iCategoria >= 0 ? r[iCategoria] : "",
            cargo: iCargo >= 0 ? r[iCargo] : "",
            segmento: iSegmento >= 0 ? r[iSegmento] : "",
            estado: iEstado >= 0 ? normalizarEstado(r[iEstado]) : "",
            pais: iPais >= 0 ? r[iPais] : "",
            dataComparecimento: dataComp,
            horaComparecimento: horaComp,
          }
        : null,
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

  // Com a coluna "Compareceu" na planilha, quem responde presença é ela —
  // é o registro real da catraca, não o check-in deduzido.
  const publico = agregarPublico(participantes);

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalCredenciados,
      presencaConfirmada: publico ? publico.compareceram : presencaConfirmada,
      checkinsRealizados,
      taxaComparecimento: publico
        ? publico.taxaComparecimento
        : totalCredenciados
        ? (checkinsRealizados / totalCredenciados) * 100
        : null,
    },
    publico,
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

/**
 * Listagem geral de expositores da edição — uma planilha só, sem status e sem
 * serviço. Serve de denominador: "137 de 210 expositores contrataram".
 */
export const EXPOSITOR_FIELDS = [
  { key: "expositor", label: "Expositor (razão social)", required: true, grupo: "Quem é" },
  { key: "nomeFantasia", label: "Nome fantasia", required: false, grupo: "Quem é" },
  { key: "cnpj", label: "CNPJ / CPF", required: false, grupo: "Quem é" },

  { key: "estande", label: "Nº do estande", required: false, grupo: "Onde fica" },
  { key: "localizacao", label: "Localização (pavilhão/setor)", required: false, grupo: "Onde fica" },
  { key: "tipoEstande", label: "Tipo de estande / montagem", required: false, grupo: "Onde fica" },
  { key: "area", label: "Área (m²)", required: false, grupo: "Onde fica" },
] as const;

export type ExpositorFieldKey = (typeof EXPOSITOR_FIELDS)[number]["key"];

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

// mesmas palavras-chave do operacional, restritas aos campos da listagem: a
// planilha de expositores vem do mesmo sistema e usa os mesmos cabeçalhos.
const EXPOSITOR_KEYS = new Set<string>(EXPOSITOR_FIELDS.map((f) => f.key));

export function suggestExpositorMapping(headers: string[]): ColumnMapping<ExpositorFieldKey> {
  const keywords = OPERACIONAL_FIELD_KEYWORDS.filter((k) => EXPOSITOR_KEYS.has(k.key)) as {
    key: ExpositorFieldKey;
    patterns: RegExp[];
  }[];
  return suggestMapping(headers, keywords);
}

export function mapRowsToExpositores(
  table: SheetTable,
  mapping: ColumnMapping<ExpositorFieldKey>,
  _statusMapping: unknown,
  sourceFile: string
): ExpositorBase[] {
  const idx = (key: ExpositorFieldKey) => {
    const col = mapping[key];
    return col ? table.headers.indexOf(col) : -1;
  };
  const iExpositor = idx("expositor");
  const iFantasia = idx("nomeFantasia");
  const iCnpj = idx("cnpj");
  const iEstande = idx("estande");
  const iLocalizacao = idx("localizacao");
  const iTipoEstande = idx("tipoEstande");
  const iArea = idx("area");

  const vistos = new Set<string>();
  const lista: ExpositorBase[] = [];
  for (const r of table.rows) {
    const expositor = limpar(iExpositor >= 0 ? r[iExpositor] : "");
    const cnpj = limpar(iCnpj >= 0 ? r[iCnpj] : "");
    if (!expositor && !cnpj) continue;
    // a mesma empresa pode repetir (um estande por linha): a base conta
    // empresas, não estandes
    const chave = chaveExpositor(expositor, cnpj);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push({
      expositor,
      nomeFantasia: limpar(iFantasia >= 0 ? r[iFantasia] : ""),
      cnpj,
      estande: limpar(iEstande >= 0 ? r[iEstande] : ""),
      localizacao: limpar(iLocalizacao >= 0 ? r[iLocalizacao] : ""),
      tipoEstande: limpar(iTipoEstande >= 0 ? r[iTipoEstande] : ""),
      area: iArea >= 0 && r[iArea] ? parseValor(r[iArea]) : null,
      sourceFile,
    });
  }
  return lista;
}

// a listagem vem de um relatório em HTML: sobram quebras de linha e espaços
function limpar(valor: string | undefined): string {
  return (valor ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Chave de identidade do expositor: CNPJ (só dígitos) quando existe, senão o
 * nome normalizado. As planilhas de serviço e a listagem geral nem sempre
 * escrevem a razão social igual, mas o documento bate.
 */
export function chaveExpositor(nome: string | null | undefined, cnpj: string | null | undefined): string {
  const digitos = (cnpj ?? "").replace(/\D/g, "");
  if (digitos.length >= 11) return "doc:" + digitos;
  return (
    "nome:" +
    (nome ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
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

  /**
   * Linha de totalização do relatório — não é um pedido.
   *
   * Os relatórios de elétrica terminam com uma linha "Total de Kva:" em que a
   * célula do rótulo tem colspan cobrindo as colunas de identificação. O número
   * cai exatamente na coluna de kVA, e a linha passava por um pedido válido: o
   * total do evento entrava duas vezes, uma somada estande a estande e outra
   * pelo rodapé, e o cartão de potência mostrava o dobro.
   *
   * O corte não olha o texto — "Total de Kva:" e "Total de Kva's solicitados:"
   * já são diferentes entre os dois relatórios de elétrica, e o próximo formato
   * seria outro. Olha o que todo pedido de verdade tem e nenhum rodapé tem: a
   * linha diz de quem é, por expositor, nome fantasia, CNPJ ou estande.
   */
  const temColunaDeIdentificacao = iExpositor >= 0 || iNomeFantasia >= 0 || iCnpj >= 0 || iEstande >= 0 || combinada;
  const identificada = (r: string[]) =>
    !!(
      (r[iExpositor] ?? "").trim() ||
      (r[iNomeFantasia] ?? "").trim() ||
      estandeDaLinha(r).trim() ||
      // o documento conta só quando tem dígito: a coluna dele é a primeira da
      // planilha, e é justamente ali que o rótulo do rodapé ("Total de Kva:")
      // cai quando o colspan cobre o resto — texto puro não identifica ninguém
      /\d/.test(r[iCnpj] ?? "")
    );

  // a planilha que não mapeou nenhuma coluna de identificação passa inteira: ali
  // o critério não tem como distinguir rodapé de pedido, e descartar tudo seria
  // pior do que deixar passar.
  const linhas = temColunaDeIdentificacao ? table.rows.filter(identificada) : table.rows;

  return linhas.map((r) => {
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

/**
 * Energia inclusa no contrato de participação: 0,11 kVA por m² de estande.
 * Está no regulamento do evento, não na planilha — por isso vive aqui, num
 * lugar só, e aparece escrito na tela para conferência.
 */
export const KVA_INCLUSO_POR_M2 = 0.11;

/** Preço do kVA excedente. Muda por edição; hoje é o valor da tabela vigente. */
export const VALOR_KVA_EXTRA = 692.12;

/**
 * Energia de cada estande.
 *
 * Contrato de participação: o expositor já tem 0,11 kVA/m² e a energia é
 * fornecida em unidade de kVA não fracionada — qualquer fração sobe para a
 * unidade seguinte (9,9 vira 10). Em cima disso, ele contrata quanto quiser de
 * potência adicional direto no relatório de elétrica, sem pedir autorização a
 * ninguém: é esse número que a coluna de kVA traz.
 *
 * Então: disponível no estande = franquia (arredondada) + adicional
 * contratado; e o adicional é o que tem preço (R$ por kVA).
 *
 * A área vem repetida em todas as linhas do mesmo estande (é a área dele, não
 * de cada item), então entra uma vez só — somá-la multiplicaria a franquia
 * pelo número de pedidos.
 */
function calcularEnergia(pedidos: PedidoServico[]): EnergiaPorEstande | null {
  const comKva = pedidos.filter((p) => p.kva != null && p.status !== "cancelado");
  if (!comKva.length) return null;

  const porEstande = new Map<
    string,
    { estande: string; expositor: string; area: number | null; areas: Set<number>; kva: number }
  >();
  for (const p of comKva) {
    // Uma linha por estande, exatamente como ele está escrito no relatório:
    // "SD 109" e "SD109" são estandes diferentes até que a operação diga o
    // contrário — unir grafias parecidas juntaria dois estandes de verdade do
    // mesmo expositor. Sem número de estande, o expositor identifica a linha.
    const chave = p.estande.trim() || `EXPOSITOR:${p.expositor.trim()}`;
    const atual = porEstande.get(chave);
    if (atual) {
      atual.kva += p.kva as number;
      if (p.area != null) {
        atual.areas.add(p.area);
        // a franquia segue a maior área informada: na dúvida entre dois
        // números para o mesmo estande, o maior é o que favorece o expositor
        atual.area = atual.area == null ? p.area : Math.max(atual.area, p.area);
      }
      if (!atual.expositor) atual.expositor = p.expositor;
    } else {
      porEstande.set(chave, {
        estande: p.estande || "—",
        expositor: p.expositor,
        area: p.area ?? null,
        areas: new Set(p.area != null ? [p.area] : []),
        kva: p.kva as number,
      });
    }
  }

  const linhas: EstandeEnergia[] = Array.from(porEstande.values()).map((e) => {
    const kvaIncluso = e.area != null ? Math.ceil(e.area * KVA_INCLUSO_POR_M2) : null;
    return {
      estande: e.estande,
      expositor: e.expositor,
      area: e.area,
      // mais de uma área para o mesmo estande é erro de cadastro na origem:
      // a tela avisa em vez de escolher em silêncio
      areasDivergentes: e.areas.size > 1 ? Array.from(e.areas).sort((a, b) => a - b) : null,
      kvaIncluso,
      kvaAdicional: e.kva,
      kvaTotal: kvaIncluso != null ? kvaIncluso + e.kva : null,
      valorAdicional: e.kva * VALOR_KVA_EXTRA,
    };
  });

  linhas.sort((a, b) => b.kvaAdicional - a.kvaAdicional || (b.kvaTotal ?? 0) - (a.kvaTotal ?? 0));

  return {
    linhas,
    kvaPorM2: KVA_INCLUSO_POR_M2,
    valorPorKva: VALOR_KVA_EXTRA,
    semArea: linhas.filter((l) => l.area == null).length,
  };
}

export function aggregateOperacional(
  pedidos: PedidoServico[],
  expositoresBase: ExpositorBase[] = []
): OperacionalData {
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
  // Potência total do evento: a franquia de todos os estandes (0,11 kVA/m²,
  // arredondada) mais o adicional que cada um contratou. Antes somava só o
  // adicional e ficava igual ao segundo número do cartão de energia.
  const energia = calcularEnergia(pedidos);
  const kvaTotal = energia
    ? energia.linhas.reduce((s, l) => s + (l.kvaIncluso ?? 0) + l.kvaAdicional, 0)
    : null;

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

  // Quantos serviços diferentes cada expositor contrata. Conta pares
  // expositor+serviço (não linhas): o mesmo expositor pedindo recepcionista
  // em três variações contratou um serviço, não três.
  const paresExpositorServico = new Set<string>();
  for (const p of ativos) if (p.expositor && p.servico) paresExpositorServico.add(`${p.expositor}||${p.servico}`);

  // Quem contratou x quem só está na listagem. O cruzamento é por CNPJ e, na
  // falta dele, pelo nome normalizado — as duas planilhas vêm do mesmo sistema
  // mas escrevem a razão social de jeitos diferentes.
  const contratantes = new Set(ativos.map((p) => chaveExpositor(p.expositor, p.cnpj)));
  const expositoresSemContratacao = expositoresBase.filter(
    (e) => !contratantes.has(chaveExpositor(e.expositor, e.cnpj))
  );

  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalItens,
      servicosPorExpositor: paresExpositorServico.size
        ? paresExpositorServico.size / new Set(Array.from(paresExpositorServico, (k) => k.split("||")[0])).size
        : null,
      qtdExpositores: new Set(ativos.map((p) => p.expositor).filter(Boolean)).size,
      qtdExpositoresBase: expositoresBase.length || null,
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
    energia,
    expositoresSemContratacao,
    pedidos,
  };
}
