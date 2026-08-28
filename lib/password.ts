import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Hash de senha com scrypt (nativo do Node — sem dependência extra, sem
 * binário nativo pra compilar no Windows). Formato salvo: "salt:hash", ambos
 * em hex.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
