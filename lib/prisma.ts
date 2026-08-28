import { PrismaClient } from "@prisma/client";

// Evita múltiplas instâncias em dev (hot-reload do Next recriaria o client a cada save).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
