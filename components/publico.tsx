"use client";

import { useMemo, useState } from "react";
import { BarList } from "@/components/charts";
import { Empty } from "@/components/ui";
import type { IngressoStats, InvoiceStatus } from "@/lib/dataSource";

/**
 * Leitura do público de um evento: quem compareceu, em que dia e hora, e qual
 * é o perfil de quem veio. Mora aqui (e não numa página) porque nasceu no
 * recorte de ingressos do financeiro e hoje pertence ao credenciamento — o
 * financeiro ficou só com o dinheiro.
 */

/** Quantos itens o ranking mostra antes de pedir "ver todos". */
const RANKING_VISIVEL = 8;

const STATUS_LABEL: Record<string, string> = {
  pago: "Pago",
  pendente: "Em aberto",
  cortesia: "Cortesia",
  cancelado: "Cancelado",
};
const STATUS_CLASS: Record<string, string> = {
  pago: "pago",
  pendente: "pendente",
  cortesia: "cortesia",
  // "atrasado" é a classe do badge vermelho — cancelado se separa da cortesia
  cancelado: "atrasado",
};

export type AbaRanking = {
  id: string;
  /** rótulo do botão quando o card tem mais de uma leitura */
  aba?: string;
  desc: string;
  layout?: "row" | "stacked";
  /** uma lista só… */
  dados?: Array<{ name: string; value: number }>;
  /** …ou várias, empilhadas com subtítulo (é o que a opção "Ambos" usa) */
  grupos?: Array<{ titulo: string; dados: Array<{ name: string; value: number }> }>;
};

/**
 * Ranking do público. Mostra o topo e abre a lista inteira sob demanda — cargo
 * e segmento passam de mil valores distintos no relatório, e sem isso o 9º
 * colocado nunca apareceria.
 *
 * Aceita mais de uma leitura no mesmo card (estado, país, ou os dois juntos):
 * são a mesma pergunta em recortes diferentes e não precisam de painéis
 * separados disputando espaço.
 */
export function PainelRanking({ titulo, abas }: { titulo: string; abas: AbaRanking[] }) {
  const [verTodos, setVerTodos] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState(0);

  const tamanho = (a: AbaRanking) =>
    a.grupos ? a.grupos.reduce((acc, g) => acc + g.dados.length, 0) : a.dados?.length ?? 0;

  const disponiveis = abas.filter((a) => tamanho(a) > 0);
  if (!disponiveis.length) return null;

  const atual = disponiveis[Math.min(abaAtiva, disponiveis.length - 1)];
  const grupos = atual.grupos ?? [{ titulo: "", dados: atual.dados ?? [] }];
  const maiorGrupo = Math.max(...grupos.map((g) => g.dados.length));

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>{titulo}</h3>
          <p>{atual.desc}</p>
        </div>
        <div className="panel-head-tools">
          {disponiveis.length > 1 && (
            <div className="seg">
              {disponiveis.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className={atual.id === a.id ? "on" : ""}
                  onClick={() => {
                    setAbaAtiva(i);
                    setVerTodos(false); // a outra leitura tem outro tamanho de lista
                  }}
                >
                  {a.aba ?? a.id}
                </button>
              ))}
            </div>
          )}
          {maiorGrupo > RANKING_VISIVEL && (
            <button className="field field-btn" type="button" onClick={() => setVerTodos((v) => !v)}>
              {verTodos ? "Ver menos" : "Ver todos (" + tamanho(atual).toLocaleString("pt-BR") + ")"}
            </button>
          )}
        </div>
      </div>
      {/* fechado, a lista se distribui pela altura do card; aberto, ela rola
          dentro do mesmo card em vez de esticá-lo */}
      {/* dois grupos (Estado + País) ficam lado a lado: empilhados, cada um
          sobrava com metade dos itens e o card esticava sem necessidade */}
      <div
        className={`ranking-lista ${grupos.length > 1 ? "ranking-lista-pares" : ""} ${
          verTodos ? "barlist-scroll scroll-slim" : ""
        }`}
      >
        {grupos.map((g) => {
          const total = g.dados.reduce((soma, d) => soma + d.value, 0);
          return (
            <div className="ranking-grupo" key={g.titulo || atual.id}>
              {g.titulo && <span className="section-label">{g.titulo}</span>}
              <BarList
                data={verTodos ? g.dados : g.dados.slice(0, RANKING_VISIVEL)}
                // o percentual carrega a leitura quando um valor domina: com São
                // Paulo em 63% do público, a barra do segundo colocado vira um
                // traço de 6% e só o número diz o tamanho dele
                valueFmt={(v) =>
                  total > 0
                    ? `${v.toLocaleString("pt-BR")} · ${((v / total) * 100).toFixed(v / total < 0.1 ? 1 : 0)}%`
                    : v.toLocaleString("pt-BR")
                }
                layout={atual.layout ?? "row"}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Barra de dias do evento — recorta cartões, painéis e tabela da tela. */
export function BarraDiasEvento({
  dias,
  selecionado,
  onSelecionar,
}: {
  dias: string[];
  selecionado: string;
  onSelecionar: (dia: string) => void;
}) {
  if (!dias.length) return null;
  return (
    <div className="segbar" style={{ marginBottom: 12 }}>
      <div className="seg">
        <button className={selecionado === "todos" ? "on" : ""} type="button" onClick={() => onSelecionar("todos")}>
          Todos
        </button>
        {dias.map((d) => (
          <button key={d} className={selecionado === d ? "on" : ""} type="button" onClick={() => onSelecionar(d)}>
            {d.slice(0, 5)}
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: "var(--ink-mute)", alignSelf: "center" }}>
        {selecionado === "todos"
          ? "dia do evento — recorta cartões, painéis e tabela"
          : `mostrando só quem passou no credenciamento em ${selecionado}`}
      </span>
    </div>
  );
}

export function PaineisPublico({
  publico,
  publicoPorDia,
  diaSelecionado,
  onSelecionarDia,
}: {
  publico: IngressoStats;
  /**
   * Público por dia ignorando o filtro de dia — senão o gráfico viraria uma
   * barra só e não haveria com o que comparar o dia escolhido.
   */
  publicoPorDia: Array<{ name: string; value: number }>;
  diaSelecionado: string;
  onSelecionarDia: (dia: string) => void;
}) {
  /**
   * Em "Todos", a curva única soma os dias e esconde justamente o que
   * interessa: em qual dia e em qual hora deu fila. Esta matriz mostra cada
   * dia numa linha, com uma barra por hora — dá para comparar os dias na
   * vertical e as horas na horizontal de uma vez.
   */
  const matrizFluxo = useMemo(() => {
    const linhas = publico.comparecimentoPorHora ?? [];
    if (!linhas.length) return null;

    const horas = Array.from(new Set(linhas.map((l) => l.hora))).sort((a, b) => a - b);
    const dias = Array.from(new Set(linhas.map((l) => l.dia)));
    const porDia = dias.map((dia) => {
      const doDia = linhas.filter((l) => l.dia === dia);
      const valores = horas.map((h) => doDia.find((l) => l.hora === h)?.pessoas ?? 0);
      const total = valores.reduce((acc, v) => acc + v, 0);
      const picoValor = Math.max(...valores);
      return { dia, valores, total, picoHora: horas[valores.indexOf(picoValor)], picoValor };
    });
    // a escala é comum a todos os dias: uma barra só é maior que a outra se o
    // movimento foi maior mesmo, e não porque o dia teve menos gente no total
    const maximo = Math.max(...porDia.flatMap((d) => d.valores), 1);
    return { horas, porDia, maximo };
  }, [publico]);

  return (
    <>
      <div className="panels panels-ingresso">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Comparecimento por situação de pagamento</h3>
              <p>quem pagou aparece mais do que quem ganhou cortesia?</p>
            </div>
          </div>
          {!publico.comparecimentoPorStatus.length ? (
            <Empty
              glyph="⌸"
              title="sem dado de comparecimento"
              desc="mapeie a coluna 'Compareceu' no import para ver esta leitura"
            />
          ) : (
            <div className="statusbars-row">
              {publico.comparecimentoPorStatus.map((c) => {
                const total = c.compareceu + c.faltou;
                const taxa = total ? (c.compareceu / total) * 100 : 0;
                return (
                  <div className="statusbars-cell" key={c.status}>
                    <span className={`badge ${STATUS_CLASS[c.status as InvoiceStatus] ?? c.status}`}>
                      <span className="dot" />
                      {STATUS_LABEL[c.status as InvoiceStatus] ?? c.status}
                    </span>
                    <strong className="statusbars-value">{taxa.toFixed(1)}%</strong>
                    <span className="barlist-track">
                      <span className="barlist-fill" style={{ width: `${taxa}%`, background: "var(--good)" }} />
                    </span>
                    <span className="statusbars-pct">
                      {c.compareceu.toLocaleString("pt-BR")} vieram · {c.faltou.toLocaleString("pt-BR")} faltaram
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {publicoPorDia.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>Público por dia do evento</h3>
                <p>
                  {diaSelecionado === "todos"
                    ? "quantos passaram pelo credenciamento em cada dia"
                    : "todos os dias, para comparar com o selecionado"}
                </p>
              </div>
            </div>
            {/* em ordem de data, não de volume: a leitura aqui é a sequência
                dos dias do evento. Clicar no dia recorta a seção. */}
            <BarList
              data={publicoPorDia}
              valueFmt={(v) => v.toLocaleString("pt-BR")}
              selected={diaSelecionado === "todos" ? "" : diaSelecionado}
              onSelect={(nome) => onSelecionarDia(nome === diaSelecionado ? "todos" : nome)}
            />
          </div>
        )}

        {publico.comparecimentoPorHora.length > 0 && (
          <div className="panel panel-largo">
            <div className="panel-head">
              <div>
                <h3>Fluxo de credenciamento</h3>
                <p>
                  {diaSelecionado === "todos"
                    ? "cada dia numa linha, uma barra por hora — clique no dia para recortar a seção"
                    : `pessoas por hora em ${diaSelecionado}`}
                </p>
              </div>
            </div>
            {matrizFluxo ? (
              <div
                className={`fluxo-matriz scroll-slim ${matrizFluxo.porDia.length === 1 ? "fluxo-matriz-dia" : ""}`}
                style={{ ["--horas" as string]: matrizFluxo.horas.length }}
              >
                <div className="fluxo-linha fluxo-cabecalho">
                  <span className="fluxo-dia" />
                  {matrizFluxo.horas.map((h) => (
                    <span className="fluxo-hora-rotulo" key={h}>
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                  <span className="fluxo-total">total</span>
                </div>
                {matrizFluxo.porDia.map((d) => (
                  <div className="fluxo-linha" key={d.dia}>
                    <button className="fluxo-dia" type="button" onClick={() => onSelecionarDia(d.dia)} title={`Ver só ${d.dia}`}>
                      {d.dia.slice(0, 5)}
                    </button>
                    {d.valores.map((v, i) => (
                      <span
                        className="fluxo-celula"
                        key={matrizFluxo.horas[i]}
                        title={`${d.dia} às ${String(matrizFluxo.horas[i]).padStart(2, "0")}h — ${v.toLocaleString(
                          "pt-BR"
                        )} pessoa(s)`}
                      >
                        {/* com um dia só há espaço para o número; com vários,
                            ele viraria poluição sobre barras baixas */}
                        <em className="fluxo-valor">{v > 0 ? v.toLocaleString("pt-BR") : ""}</em>
                        <span
                          className={`fluxo-barra ${v === d.picoValor && v > 0 ? "fluxo-pico" : ""}`}
                          style={{ height: `${Math.max(v > 0 ? 6 : 0, (v / matrizFluxo.maximo) * 100)}%` }}
                        />
                      </span>
                    ))}
                    <span className="fluxo-total">
                      {d.total.toLocaleString("pt-BR")}
                      <em>
                        pico {String(d.picoHora).padStart(2, "0")}h · {d.picoValor.toLocaleString("pt-BR")}
                      </em>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty glyph="⌁" title="sem horário registrado" desc="a planilha não trouxe a hora do comparecimento" />
            )}
          </div>
        )}
      </div>

      <div className="panels-rankings">
        {/* "stacked" só na origem do convite, onde o nome passa de 40 caracteres */}
        <PainelRanking
          titulo="Origem do convite"
          abas={[
            {
              id: "convite",
              desc: "de qual lote/patrocinador veio cada ingresso",
              dados: publico.convites,
              layout: "stacked",
            },
          ]}
        />
        <PainelRanking titulo="Categoria" abas={[{ id: "categoria", desc: "tipo de ingresso emitido", dados: publico.categorias }]} />
        <PainelRanking titulo="Cargo" abas={[{ id: "cargo", desc: "quem é o público que se inscreveu", dados: publico.cargos }]} />
        <PainelRanking titulo="Segmento" abas={[{ id: "segmento", desc: "área de atuação declarada", dados: publico.segmentos }]} />
        <PainelRanking
          titulo="Origem geográfica"
          abas={[
            { id: "estado", aba: "Estado", desc: "de qual estado veio o público (siglas agrupadas)", dados: publico.estados },
            { id: "pais", aba: "País", desc: "de qual país veio o público", dados: publico.paises },
            {
              id: "ambos",
              aba: "Ambos",
              desc: "estado e país no mesmo painel",
              grupos: [
                { titulo: "Estado", dados: publico.estados },
                { titulo: "País", dados: publico.paises },
              ],
            },
          ]}
        />
      </div>

      {publico.documentosRepetidos > 0 && (
        <div className="import-files-bar" style={{ marginBottom: 12 }}>
          <span>
            {publico.documentosDistintos.toLocaleString("pt-BR")} documentos distintos ·{" "}
            <strong>{publico.documentosRepetidos.toLocaleString("pt-BR")}</strong> aparecem em mais de um ingresso — pode
            ser a mesma pessoa com vários ingressos ou cadastro duplicado.
          </span>
        </div>
      )}
    </>
  );
}
