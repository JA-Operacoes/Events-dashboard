/**
 * Camada de envio de e-mail — hoje é um no-op (só loga no console/servidor).
 * Ainda não decidimos entre Resend ou o Email Routing/Workers do Cloudflare
 * (avaliando qual atende melhor o volume que vamos precisar). Quando decidir,
 * troque só o corpo de `sendEmail` abaixo — o resto do app (recuperação de
 * senha, e no futuro notificações) já chama essa função, nenhuma tela muda.
 *
 * Opção Resend (https://resend.com):
 *   npm install resend
 *   const resend = new Resend(process.env.RESEND_API_KEY);
 *   await resend.emails.send({ from: "painel@seudominio.com", to, subject, html });
 *
 * Opção Cloudflare (Email Workers / MailChannels via binding):
 *   precisa rodar dentro de um Worker com o binding de envio configurado —
 *   não dá pra chamar direto de uma API route comum do Next, então essa
 *   opção só faz sentido se o app for hospedado no Cloudflare também.
 */

export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean }> {
  // TODO: substituir por Resend ou Cloudflare — ver comentário acima.
  console.log(`[email stub] para=${to} assunto="${subject}"`);
  return { ok: true };
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  return sendEmail(
    to,
    "Redefinir sua senha",
    `<p>Clique no link abaixo para redefinir sua senha:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Se não foi você, ignore este e-mail.</p>`
  );
}
