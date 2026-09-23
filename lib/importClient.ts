/**
 * Envio das linhas importadas para a API, em lotes.
 *
 * Um relatório de credenciamento passa de 10 mil linhas e vira um JSON de ~6MB
 * num POST só. A gravação em si aguenta (medido: 6,7s numa transação única),
 * mas a requisição inteira fica sem resposta esse tempo todo e qualquer falha
 * no meio derruba o import completo — com a tela já mostrando os dados, porque
 * o import é otimista. Era isso que deixava a página em estado inconsistente
 * até o refresh.
 *
 * Em lotes, cada requisição é pequena e falha isoladamente. O tamanho é um
 * meio-termo medido: 500 linhas por chamada levavam 16s para as 10 mil (21
 * idas ao banco), 3000 levam 5s (4 idas).
 *
 * O primeiro lote substitui o que existia daquele arquivo; os seguintes
 * acrescentam. Se um lote falhar no meio, a tela recarrega do banco e mostra o
 * que de fato entrou, em vez de seguir exibindo a planilha inteira.
 */
export const TAMANHO_LOTE = 3000;

export type ResultadoImport = { ok: true; lotes: number } | { ok: false; erro: string };

export async function enviarImportEmLotes(
  url: string,
  editionId: string,
  sourceFile: string,
  /** nome do campo que a rota espera no corpo ("invoices", "pedidos", "participantes") */
  campo: string,
  linhas: unknown[]
): Promise<ResultadoImport> {
  // lista vazia ainda precisa de uma chamada: é assim que um arquivo
  // reimportado sem linhas limpa o que havia antes.
  const total = Math.max(1, Math.ceil(linhas.length / TAMANHO_LOTE));

  for (let i = 0; i < total; i++) {
    const lote = linhas.slice(i * TAMANHO_LOTE, (i + 1) * TAMANHO_LOTE);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editionId,
        sourceFile,
        // só o primeiro lote apaga as linhas anteriores do arquivo
        modo: i === 0 ? "replace" : "append",
        [campo]: lote,
      }),
    });

    if (!res.ok) {
      const corpo = await res.json().catch(() => null);
      const detalhe = corpo && typeof corpo.error === "string" ? corpo.error : `HTTP ${res.status}`;
      return {
        ok: false,
        erro: total > 1 ? `${detalhe} (no lote ${i + 1} de ${total})` : detalhe,
      };
    }
  }

  return { ok: true, lotes: total };
}
