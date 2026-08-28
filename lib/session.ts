import { SignJWT, jwtVerify } from "jose";

/**
 * JWT de sessão em cookie httpOnly — roda tanto em rotas de API (Node) quanto
 * no middleware (Edge), por isso usa `jose` (Web Crypto) em vez do `crypto`
 * nativo do Node, que não existe no runtime Edge.
 */

export const SESSION_COOKIE = "session";

export type SessionPayload = {
  email: string;
  isAdmin: boolean;
  /** "all" pra admins; lista de ids de Event pra usuários comuns. */
  allowedEventIds: "all" | string[];
};

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET não configurado (.env)");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      email: String(payload.email),
      isAdmin: !!payload.isAdmin,
      allowedEventIds: payload.allowedEventIds as "all" | string[],
    };
  } catch {
    return null;
  }
}
