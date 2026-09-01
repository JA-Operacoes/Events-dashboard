/**
 * SweetAlert2, com a cara do sistema — usa as mesmas classes `.btn`/`.btn
 * primary` dos botões do resto do app (via `buttonsStyling: false`) e o popup
 * é temido pelas variáveis de tema em globals.css, então já respeita dark/light
 * sem precisar ler cor nenhuma aqui.
 */
import Swal from "sweetalert2";

const base = Swal.mixin({
  buttonsStyling: false,
  customClass: {
    popup: "ja-swal",
    confirmButton: "btn primary",
    cancelButton: "btn",
    title: "ja-swal-title",
    htmlContainer: "ja-swal-text",
  },
});

export function notifySuccess(title: string, text?: string) {
  return base.fire({ icon: "success", title, text, timer: 2600, timerProgressBar: true, showConfirmButton: false });
}

export function notifyWarning(title: string, text?: string) {
  return base.fire({ icon: "warning", title, text, confirmButtonText: "Entendi" });
}

export function notifyError(title: string, text?: string) {
  return base.fire({ icon: "error", title, text, confirmButtonText: "Entendi" });
}

/** Popup informativo simples (sem ação) — ex.: detalhe de uma lista longa que foi resumida na UI. */
export function showDetails(title: string, html: string) {
  return base.fire({ title, html, confirmButtonText: "Fechar" });
}

export async function confirmDanger(title: string, text: string, confirmLabel = "Remover"): Promise<boolean> {
  const result = await base.fire({
    icon: "warning",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmLabel,
    cancelButtonText: "Cancelar",
    reverseButtons: true,
    customClass: {
      popup: "ja-swal",
      confirmButton: "btn danger",
      cancelButton: "btn",
      title: "ja-swal-title",
      htmlContainer: "ja-swal-text",
    },
  });
  return result.isConfirmed;
}
