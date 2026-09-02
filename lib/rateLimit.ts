import { prisma } from "@/lib/prisma";

/**
 * Rate limit de login por e-mail, persistido no banco — a app roda serverless
 * (Vercel), então um contador em memória perderia estado entre invocações em
 * instâncias diferentes. Janela deslizante simples: conta tentativas
 * mal-sucedidas nos últimos WINDOW_MINUTES; passou do limite, bloqueia até a
 * mais antiga da janela expirar.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export async function checkLoginRateLimit(email: string): Promise<{ blocked: boolean; retryAfterSeconds?: number }> {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const attempts = await prisma.loginAttempt.findMany({
    where: { email, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  if (attempts.length < MAX_ATTEMPTS) return { blocked: false };

  const oldest = attempts[0].createdAt;
  const unlocksAt = oldest.getTime() + WINDOW_MINUTES * 60 * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((unlocksAt - Date.now()) / 1000));
  return { blocked: true, retryAfterSeconds };
}

export async function recordFailedLogin(email: string): Promise<void> {
  await prisma.loginAttempt.create({ data: { email } });
}

export async function clearLoginAttempts(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email } });
}
