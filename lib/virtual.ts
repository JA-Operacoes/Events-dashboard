"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Janela de linhas visíveis de uma tabela longa.
 *
 * Com a lista inteira aberta (10 mil duplicatas, ~10 colunas), o navegador
 * monta e mantém ~100 mil células: abrir demora e a rolagem fica travada
 * mesmo depois de pronta. Aqui só as linhas que cabem na área visível existem
 * no DOM; o espaço das outras é ocupado por duas linhas vazias com a altura
 * exata do que ficou de fora, então a barra de rolagem continua fiel ao total.
 *
 * Exige altura de linha fixa — é o que permite saber onde cada índice começa
 * sem medir linha por linha (ver `.table-scroll tbody tr` no globals.css).
 */
/**
 * Altura fixa de uma linha da tabela, em pixels. Precisa bater exatamente com
 * `.table-scroll tbody tr` no globals.css — o cálculo da janela assume que
 * toda linha ocupa isto.
 */
export const ALTURA_LINHA_TABELA = 46;

export function useJanelaVirtual(
  ref: RefObject<HTMLElement | null>,
  total: number,
  alturaLinha: number,
  /** linhas extras acima e abaixo, para a rolagem rápida não mostrar vazio */
  folga = 8
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [altura, setAltura] = useState(0);
  const quadro = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const medir = () => setAltura(el.clientHeight);
    medir();

    const aoRolar = () => {
      // um quadro por rolagem: o evento dispara dezenas de vezes por segundo e
      // atualizar o estado em todas elas devolveria o travamento
      if (quadro.current) return;
      quadro.current = requestAnimationFrame(() => {
        quadro.current = 0;
        setScrollTop(el.scrollTop);
      });
    };

    el.addEventListener("scroll", aoRolar, { passive: true });
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => {
      el.removeEventListener("scroll", aoRolar);
      observador.disconnect();
      if (quadro.current) cancelAnimationFrame(quadro.current);
    };
  }, [ref]);

  // sem altura medida ainda (primeiro render), mostra um bloco inicial em vez
  // de nada — senão a tabela apareceria vazia por um quadro
  const visiveis = altura > 0 ? Math.ceil(altura / alturaLinha) : 20;
  const inicio = Math.max(0, Math.floor(scrollTop / alturaLinha) - folga);
  const fim = Math.min(total, inicio + visiveis + folga * 2);

  return {
    inicio,
    fim,
    /** altura das linhas que ficaram antes da janela */
    espacoAntes: inicio * alturaLinha,
    /** altura das linhas que ficaram depois */
    espacoDepois: Math.max(0, (total - fim) * alturaLinha),
  };
}
