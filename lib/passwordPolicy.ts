/**
 * Regra de senha do sistema — sem dependências do Node (usável em client
 * components, ao contrário de lib/password.ts, que usa `crypto`).
 */
export const PASSWORD_HINT = "mín. 8 caracteres, incluindo 1 caractere especial (ex.: ! @ # $ % *)";
const SPECIAL_CHAR = /[^A-Za-z0-9]/;

/** Retorna a mensagem de erro se a senha não atender à política, ou `null` se estiver ok. */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return "Senha precisa ter ao menos 8 caracteres";
  if (!SPECIAL_CHAR.test(password)) return "Senha precisa ter ao menos 1 caractere especial (ex.: ! @ # $ % *)";
  return null;
}
