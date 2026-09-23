/**
 * Exportação do que está na tela para planilha.
 *
 * O arquivo sai com exatamente as linhas e colunas visíveis no momento — se o
 * usuário filtrou por um serviço e um status, é isso que o Excel recebe.
 * Exportar a base inteira ignorando os filtros seria mais simples, mas
 * devolveria um arquivo que não corresponde ao que está sendo lido na tela.
 *
 * Roda no navegador: o dado já está todo em memória, e mandar de volta para o
 * servidor só para gerar o arquivo custaria uma viagem inteira à toa.
 */
import * as XLSX from "xlsx";

export type ColunaExport<T> = {
  /** cabeçalho na planilha */
  titulo: string;
  /** valor da célula; devolva número quando for número, para o Excel somar */
  valor: (linha: T) => string | number | null;
};

/** "Contratação de Brigadista" + edição + data → nome de arquivo previsível. */
function nomeArquivo(prefixo: string, contexto: string[]): string {
  const partes = [prefixo, ...contexto]
    .filter(Boolean)
    .map((p) =>
      p
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
    )
    .filter(Boolean);
  const agora = new Date();
  const data = [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, "0"),
    String(agora.getDate()).padStart(2, "0"),
  ].join("-");
  return `${partes.join("_")}_${data}.xlsx`;
}

export function exportarPlanilha<T>({
  prefixo,
  contexto = [],
  colunas,
  linhas,
  aba = "Dados",
}: {
  prefixo: string;
  /** evento, edição, filtros aplicados — entram no nome do arquivo */
  contexto?: string[];
  colunas: Array<ColunaExport<T>>;
  linhas: T[];
  aba?: string;
}): number {
  const matriz = linhas.map((linha) => {
    const obj: Record<string, string | number | null> = {};
    for (const c of colunas) obj[c.titulo] = c.valor(linha);
    return obj;
  });

  const sheet = XLSX.utils.json_to_sheet(matriz, { header: colunas.map((c) => c.titulo) });

  // largura aproximada por coluna: sem isso tudo sai com 8 caracteres e o
  // usuário precisa arrastar coluna por coluna antes de conseguir ler
  sheet["!cols"] = colunas.map((c) => {
    const maior = matriz.reduce((max, linha) => {
      const v = linha[c.titulo];
      return Math.max(max, v == null ? 0 : String(v).length);
    }, c.titulo.length);
    return { wch: Math.min(48, Math.max(10, maior + 2)) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, aba.slice(0, 31));
  XLSX.writeFile(wb, nomeArquivo(prefixo, contexto));
  return matriz.length;
}
