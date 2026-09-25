"use client";

import { useState } from "react";
import { money, int } from "@/components/ui";

// 20 cores porque um evento grande sobe de 10 a 20 relatórios e cada um vira
// uma série. As 10 primeiras são matizes distintos (começando pelas cores do
// tema), as 10 últimas são as mesmas famílias em tom claro — então uma edição
// com 8 serviços usa só matizes diferentes, e uma com 18 só repete família
// quando já passou por todos. Acima de 20 o índice dá a volta.
export const PALETTE = [
  "var(--accent)",
  "var(--blue)",
  "var(--amber)",
  "var(--teal)",
  "var(--violet)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
  "var(--chart-11)",
  "var(--chart-12)",
  "var(--chart-13)",
  "var(--chart-14)",
  "var(--chart-15)",
  "var(--chart-16)",
  "var(--chart-17)",
  "var(--chart-18)",
  "var(--chart-19)",
  "var(--chart-20)",
];

/* ------------------------------- Donut ---------------------------------- */

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

export function Donut({
  data,
  valueFmt = money,
  variant = "full",
  onSelect,
  selected,
  colorFor,
  legenda,
}: {
  data: Array<{ label: string; value: number }>;
  valueFmt?: (v: number) => string;
  /** "full": anel completo (padrão). "half": semicírculo (estilo "gauge"), pra quem prefere ler de relance. */
  variant?: "full" | "half";
  /** Clique na fatia ou na legenda — usado para filtrar a tela por aquele item. */
  onSelect?: (label: string) => void;
  /** Item filtrado no momento: os demais ficam esmaecidos. */
  selected?: string;
  /**
   * Cabeçalho da legenda: diz o que é o rótulo e o que é o número ("Serviço" /
   * "Itens"). Sem isso, quem abre a tela pela primeira vez vê "137" e não sabe
   * se são pedidos, pessoas ou reais.
   */
  legenda?: { nome: string; valor: string };
  /**
   * Cor fixa por rótulo. Sem isso a cor sai da posição na lista, e filtrar por
   * um serviço fazia a fatia dele trocar de cor — o mesmo dado aparecia de
   * duas cores conforme o filtro.
   */
  colorFor?: (label: string) => string | undefined;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  // sempre do maior para o menor: é a ordem em que se lê um gráfico de
  // participação, e a legenda acompanha as fatias
  const dados = [...data].sort((a, b) => b.value - a.value);
  if (!total) return null;

  const R = 56;
  const STROKE = 18;

  if (variant === "half") {
    // semicírculo de 180° (esquerda) a 0° (direita), passando pelo topo (90°) —
    // ângulo diminui conforme o valor acumulado cresce, então o primeiro item
    // fica à esquerda e o último à direita, igual se lê um gauge.
    const cx = 72;
    const cy = 74;
    // quanto vem antes de cada fatia, calculado de uma vez: mutar um
    // acumulador dentro do map é o tipo de efeito que o compilador do React
    // não consegue garantir entre renders
    const antes = dados.map((_, i) => dados.slice(0, i).reduce((soma, d) => soma + d.value, 0));
    const arcs = dados.map((d, i) => {
      const a0 = 180 - (antes[i] / total) * 180;
      const a1 = 180 - ((antes[i] + d.value) / total) * 180;
      const p0 = polar(cx, cy, R, a0);
      const p1 = polar(cx, cy, R, a1);
      return {
        ...d,
        i,
        color: colorFor?.(d.label) ?? PALETTE[i % PALETTE.length],
        path: `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      };
    });
    const trackStart = polar(cx, cy, R, 180);
    const trackEnd = polar(cx, cy, R, 0);

    return (
      <div className="donut-wrap">
        <svg
          className="donut-svg donut-svg-half"
          viewBox="0 0 144 92"
          role="img"
          aria-label="Distribuição proporcional (meio círculo)"
        >
          <path
            d={`M ${trackStart.x} ${trackStart.y} A ${R} ${R} 0 0 1 ${trackEnd.x} ${trackEnd.y}`}
            fill="none"
            stroke="var(--line)"
            strokeWidth={STROKE}
          />
          {arcs.map((a) => (
            <path
              key={a.label}
              d={a.path}
              fill="none"
              stroke={a.color}
              strokeWidth={hover === a.i ? 20 : STROKE}
              strokeLinecap="butt"
              style={{
                transition: "stroke-width .15s, opacity .15s",
                cursor: onSelect ? "pointer" : "default",
                opacity: selected && selected !== a.label ? 0.3 : 1,
              }}
              onPointerEnter={() => setHover(a.i)}
              onPointerLeave={() => setHover(null)}
              onClick={onSelect ? () => onSelect(a.label) : undefined}
            />
          ))}
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--ink)">
            {valueFmt(total)}
          </text>
        </svg>
        <LegendaDonut
          arcs={arcs}
          total={total}
          valueFmt={valueFmt}
          hover={hover}
          setHover={setHover}
          selected={selected}
          onSelect={onSelect}
          legenda={legenda}
        />
      </div>
    );
  }

  const C = 2 * Math.PI * R;
  const antesDe = dados.map((_, i) => dados.slice(0, i).reduce((soma, d) => soma + d.value, 0));
  const arcs = dados.map((d, i) => {
    const len = (d.value / total) * C;
    return {
      ...d,
      i,
      dasharray: `${len} ${C - len}`,
      dashoffset: -(antesDe[i] / total) * C,
      color: colorFor?.(d.label) ?? PALETTE[i % PALETTE.length],
    };
  });

  return (
    <div className="donut-wrap">
      <svg className="donut-svg" viewBox="0 0 144 144" role="img" aria-label="Distribuição proporcional">
        <circle cx="72" cy="72" r={R} fill="none" stroke="var(--line)" strokeWidth={STROKE} />
        {arcs.map((a) => (
          <circle
            key={a.label}
            cx="72"
            cy="72"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.i ? STROKE + 2 : STROKE}
            strokeDasharray={a.dasharray}
            strokeDashoffset={a.dashoffset}
            transform="rotate(-90 72 72)"
            style={{
              transition: "stroke-width .15s, opacity .15s",
              cursor: onSelect ? "pointer" : "default",
              // o item filtrado fica opaco e o resto recua, para a fatia
              // clicada continuar identificável depois do clique
              opacity: selected && selected !== a.label ? 0.3 : 1,
            }}
            onPointerEnter={() => setHover(a.i)}
            onPointerLeave={() => setHover(null)}
            onClick={onSelect ? () => onSelect(a.label) : undefined}
          />
        ))}
      </svg>
      <LegendaDonut
        arcs={arcs}
        total={total}
        valueFmt={valueFmt}
        hover={hover}
        setHover={setHover}
        selected={selected}
        onSelect={onSelect}
        legenda={legenda}
      />
    </div>
  );
}

/**
 * Percentual da fatia. Abaixo de 1% entra uma casa decimal: arredondar para
 * inteiro mostrava "0%" para quem tem 2 de 600 itens, e 0% tem de significar
 * nada contratado.
 */
function percentualLegivel(valor: number, total: number): string {
  if (!valor) return "0%";
  const pct = (valor / total) * 100;
  if (pct < 1) return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return `${Math.round(pct)}%`;
}

/**
 * Legenda do donut em tabela: rótulo, valor e percentual em colunas próprias.
 * Como lista de linhas flex, cada item alinhava por conta e os números ficavam
 * em posições diferentes conforme o tamanho do nome.
 */
function LegendaDonut({
  arcs,
  total,
  valueFmt,
  hover,
  setHover,
  selected,
  onSelect,
  legenda,
}: {
  arcs: Array<{ label: string; value: number; color: string; i: number }>;
  total: number;
  valueFmt: (v: number) => string;
  hover: number | null;
  setHover: (i: number | null) => void;
  selected?: string;
  onSelect?: (label: string) => void;
  legenda?: { nome: string; valor: string };
}) {
  return (
    <table className="donut-legend">
      {legenda && (
        <thead>
          <tr>
            <th />
            <th className="donut-legend-nome">{legenda.nome}</th>
            <th className="donut-legend-valor">{legenda.valor}</th>
            <th className="donut-legend-pct">%</th>
          </tr>
        </thead>
      )}
      <tbody>
        {arcs.map((a) => (
          <tr
            key={a.label}
            className={`${onSelect ? "donut-legend-clicavel" : ""} ${selected === a.label ? "on" : ""}`}
            style={{
              opacity: hover === null || hover === a.i ? 1 : 0.45,
              cursor: onSelect ? "pointer" : "default",
            }}
            onPointerEnter={() => setHover(a.i)}
            onPointerLeave={() => setHover(null)}
            onClick={onSelect ? () => onSelect(a.label) : undefined}
          >
            <td className="donut-legend-cor">
              <span className="legend-swatch" style={{ background: a.color }} />
            </td>
            <td className="donut-legend-nome" title={a.label}>
              {a.label}
            </td>
            <td className="donut-legend-valor">{valueFmt(a.value)}</td>
            <td className="donut-legend-pct">{percentualLegivel(a.value, total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------ Bar list --------------------------------- */

export function BarList({
  data,
  valueFmt = money,
  onSelect,
  selected,
  layout = "row",
}: {
  data: Array<{ name: string; value: number }>;
  valueFmt?: (v: number) => string;
  onSelect?: (name: string) => void;
  selected?: string;
  /** "row": nome + barra + valor lado a lado (nomes curtos, ex. clientes).
   *  "stacked": nome numa linha, barra + valor embaixo (nomes longos, ex. conta/centro de custo). */
  layout?: "row" | "stacked";
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowClass = layout === "stacked" ? "barlist-row barlist-row-stacked" : "barlist-row";
  /**
   * Largura da coluna de nome, medida pelo maior rótulo da lista.
   *
   * Cada linha é um grid independente, então uma largura que se ajusta ao
   * conteúdo (fit-content) desalinharia as barras entre si — "SP" e "MG" teriam
   * colunas de tamanhos diferentes. Um valor fixo alinha, mas é ou apertado
   * demais para "Gerente ou Supervisor de Empresa" ou largo demais para uma
   * lista de siglas, que foi o que deixava a barra começando no meio do card.
   *
   * Medir aqui resolve os dois: a lista inteira usa a mesma largura, e ela é a
   * do rótulo mais longo. O teto de 30ch mantém o corte com reticências para as
   * listas de texto livre (cargo, segmento), onde um único nome quilométrico
   * levaria a coluna junto.
   */
  const maiorRotulo = data.reduce((n, d) => Math.max(n, d.name.length), 0);
  const larguraNome = `${Math.min(30, Math.max(3, maiorRotulo))}ch`;
  return (
    <div className="barlist" style={{ "--barlist-nome": larguraNome } as React.CSSProperties}>
      {data.map((d) => {
        const row = (
          <>
            <span className="barlist-name" title={d.name}>
              {d.name}
            </span>
            <div className="barlist-track">
              <div className="barlist-fill" style={{ width: `${(d.value / max) * 100}%` }} />
            </div>
            <span className="barlist-val">{valueFmt(d.value)}</span>
          </>
        );
        if (!onSelect) {
          return (
            <div className={rowClass} key={d.name}>
              {row}
            </div>
          );
        }
        return (
          <button
            type="button"
            key={d.name}
            className={`${rowClass} barlist-row-clickable${selected === d.name ? " on" : ""}`}
            onClick={() => onSelect(d.name)}
            title={`Ver apenas duplicatas de ${d.name}`}
          >
            {row}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------- Status bars -------------------------------- */

const STATUS_COLOR: Record<string, string> = {
  pago: "var(--good)",
  pendente: "var(--amber)",
  atrasado: "var(--red)",
  credenciado: "var(--good)",
  // cancelado em vermelho (a cobrança caiu) e cortesia/isento em cinza (não há
  // o que cobrar) — antes os dois usavam a mesma cor
  cancelado: "var(--red)",
  cortesia: "var(--ink-mute)",
  isento: "var(--ink-mute)",
};

export function StatusBars({
  data,
  labels,
  classMap,
  colorMap,
  layout = "list",
}: {
  data: Array<{ label: string; value: number }>;
  labels: Record<string, string>;
  /** mapeia o `label` para a classe CSS do badge — necessário quando o rótulo não tem classe própria (ex.: "credenciado" reaproveita a cor de "pago"). */
  classMap?: Record<string, string>;
  /** sobrepõe a cor padrão da barrinha proporcional — útil quando o mesmo `label` tem semântica diferente entre módulos (ex.: "cancelado" é negativo no credenciamento, mas neutro no financeiro). */
  colorMap?: Record<string, string>;
  /** "list": um status por linha (padrão). "row": os status lado a lado, para
   *  quando são poucos e a leitura é de comparação, não de lista. */
  layout?: "list" | "row";
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  if (layout === "row") {
    return (
      <div className="statusbars-row">
        {data.map((d) => {
          const cor = colorMap?.[d.label] ?? STATUS_COLOR[d.label] ?? "var(--accent)";
          return (
            <div className="statusbars-cell" key={d.label}>
              <span className={`badge ${classMap?.[d.label] ?? d.label}`}>
                <span className="dot" />
                {labels[d.label] ?? d.label}
              </span>
              <strong className="statusbars-value">{d.value.toLocaleString("pt-BR")}</strong>
              <span className="barlist-track">
                <span className="barlist-fill" style={{ width: `${(d.value / total) * 100}%`, background: cor }} />
              </span>
              <span className="statusbars-pct">{((d.value / total) * 100).toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Um sub-cartão por status: rótulo e número em evidência em cima, a barra de
  // proporção embaixo. Como linha simples, a barra de 70px espremida no canto
  // direito não se comparava com as outras e o número se perdia.
  return (
    <div className="statusbars-list">
      {data.map((d) => {
        const pct = (d.value / total) * 100;
        return (
          <div className="status-card" key={d.label}>
            <div className="status-card-topo">
              <span className={`badge ${classMap?.[d.label] ?? d.label}`}>
                <span className="dot" />
                {labels[d.label] ?? d.label}
              </span>
              <strong className="status-card-valor">{d.value.toLocaleString("pt-BR")}</strong>
            </div>
            <span className="barlist-track">
              <span
                className="barlist-fill"
                style={{
                  width: `${pct}%`,
                  background: colorMap?.[d.label] ?? STATUS_COLOR[d.label] ?? "var(--accent)",
                }}
              />
            </span>
            <span className="status-card-pct">{pct.toFixed(1)}% do total</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Line chart ------------------------------ */

// "27/08/2026" ou "2026-08-27" -> "27/08" — no eixo, o ano só ocupa espaço
// sem ajudar a leitura (o período já está no contexto da tela).
function shortDate(v: string): string {
  const br = v.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/);
  if (br) return `${br[1].padStart(2, "0")}/${br[2].padStart(2, "0")}`;
  const iso = v.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[1]}`;
  return v;
}

export function LineChart({
  data,
  series,
  valueFmt = money,
}: {
  data: Array<{ date: string; [key: string]: string | number }>;
  // desenhadas na ordem do array — a última fica por cima nos cruzamentos,
  // então a série "principal" deve vir por último. `secondary` deixa a
  // linha mais fina/discreta pra ela não competir visualmente com a principal.
  series: Array<{ key: string; color: string; dash?: string; secondary?: boolean }>;
  valueFmt?: (v: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 560;
  const h = 190;
  const pad = { top: 10, right: 10, bottom: 34, left: 10 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const max = Math.max(...data.flatMap((d) => series.map((s) => Number(d[s.key]))), 1);
  const x = (i: number) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const path = (key: string) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(Number(d[key])).toFixed(1)}`).join(" ");

  const hovered = hoverIdx != null ? data[hoverIdx] : null;

  // rótulos na diagonal ocupam menos espaço horizontal cada um, então cabem
  // mais que na horizontal — ~26px por rótulo em vez de 45px.
  const maxLabels = Math.max(2, Math.floor(innerW / 26));
  const labelStep = data.length > maxLabels ? Math.ceil((data.length - 1) / (maxLabels - 1)) : 1;
  const labelIdxs = data.length
    ? Array.from(new Set([...Array.from({ length: data.length }, (_, i) => i).filter((i) => i % labelStep === 0), data.length - 1]))
    : [];

  return (
    <div className="chart-wrap">
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Série no tempo"
        onPointerLeave={() => setHoverIdx(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = data.length > 1 ? Math.round(((px - pad.left) / innerW) * (data.length - 1)) : 0;
          setHoverIdx(Math.min(Math.max(idx, 0), data.length - 1));
        }}
      >
        <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="var(--baseline)" />
        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.secondary ? 1.75 : 2.5}
            strokeOpacity={s.secondary ? 0.75 : 1}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
          />
        ))}
        {hoverIdx != null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={pad.top} y2={h - pad.bottom} stroke="var(--line)" strokeWidth="1" />
        )}
        {data.map((d, i) => (
          <g key={String(d.date ?? i)}>
            {series.map((s) => (
              <circle
                key={s.key}
                cx={x(i)}
                cy={y(Number(d[s.key]))}
                r={hoverIdx === i ? 4 : s.secondary ? 2 : 2.5}
                fill={s.color}
                opacity={s.secondary ? 0.75 : 1}
              />
            ))}
          </g>
        ))}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={h - pad.bottom + 14}
            fontSize="8.5"
            fill="var(--ink-mute)"
            textAnchor="end"
            transform={`rotate(-40 ${x(i)} ${h - pad.bottom + 14})`}
          >
            {shortDate(String(data[i].date))}
          </text>
        ))}
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: `${(x(hoverIdx!) / w) * 100}%` }}>
          <strong>{String(hovered.date)}</strong>
          {series.map((s) => (
            <div key={s.key}>
              <span className="legend-swatch" style={{ background: s.color }} /> {valueFmt(Number(hovered[s.key]))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Grouped bar chart --------------------------- */

export function GroupedBarChart({
  data,
  series,
  valueFmt = money,
}: {
  data: Array<{ date: string; [key: string]: string | number }>;
  series: Array<{ key: string; color: string; label: string }>;
  valueFmt?: (v: number) => string;
}) {
  const [hover, setHover] = useState<{ i: number; key: string } | null>(null);
  const w = 560;
  const h = 180;
  const pad = { top: 10, right: 10, bottom: 24, left: 10 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const max = Math.max(...data.flatMap((d) => series.map((s) => Number(d[s.key]))), 1);
  const groupW = data.length ? innerW / data.length : innerW;
  // grupo ocupa ~72% da largura disponível (o resto é respiro entre grupos),
  // dividido igualmente entre as barras da série dentro do grupo.
  const barGap = 2;
  const barW = Math.max(2, (groupW * 0.72 - barGap * (series.length - 1)) / series.length);
  const groupX = (i: number) => pad.left + i * groupW + (groupW - (barW * series.length + barGap * (series.length - 1))) / 2;
  const barH = (v: number) => (v / max) * innerH;

  // muitas datas lotariam o eixo — mesma lógica de espaçamento do LineChart.
  const maxLabels = Math.max(2, Math.floor(innerW / 45));
  const labelStep = data.length > maxLabels ? Math.ceil((data.length - 1) / (maxLabels - 1)) : 1;
  const labelIdxs = data.length
    ? Array.from(new Set([...Array.from({ length: data.length }, (_, i) => i).filter((i) => i % labelStep === 0), data.length - 1]))
    : [];

  const hovered = hover ? data[hover.i] : null;

  return (
    <div className="chart-wrap">
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Comparativo por data">
        <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="var(--baseline)" />
        {data.map((d, i) =>
          series.map((s, si) => {
            const v = Number(d[s.key]);
            const bh = barH(v);
            const bx = groupX(i) + si * (barW + barGap);
            const isHover = hover?.i === i && hover.key === s.key;
            return (
              <rect
                key={s.key}
                x={bx}
                y={h - pad.bottom - bh}
                width={barW}
                height={bh}
                rx={1.5}
                fill={s.color}
                opacity={isHover ? 1 : 0.85}
                onPointerEnter={() => setHover({ i, key: s.key })}
                onPointerLeave={() => setHover(null)}
              />
            );
          })
        )}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={pad.left + i * groupW + groupW / 2}
            y={h - 6}
            fontSize="10"
            fill="var(--ink-mute)"
            textAnchor="middle"
          >
            {String(data[i].date)}
          </text>
        ))}
      </svg>
      {hovered && hover && (
        <div
          className="chart-tooltip"
          style={{ left: `${((pad.left + hover.i * groupW + groupW / 2) / w) * 100}%` }}
        >
          <strong>{String(hovered.date)}</strong>
          {series.map((s) => (
            <div key={s.key}>
              <span className="legend-swatch" style={{ background: s.color }} /> {s.label}: {valueFmt(Number(hovered[s.key]))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { int };
