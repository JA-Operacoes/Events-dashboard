-- Acesso por edição em vez de por evento inteiro.
-- Preserva o acesso já concedido: cada vínculo existente em user_event_access
-- vira acesso a TODAS as edições daquele evento (o admin pode restringir
-- depois pela tela de usuários).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "user_edition_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_edition_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_edition_access_userId_editionId_key" ON "user_edition_access"("userId", "editionId");

ALTER TABLE "user_edition_access" ADD CONSTRAINT "user_edition_access_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_edition_access" ADD CONSTRAINT "user_edition_access_editionId_fkey"
    FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "user_edition_access" ("id", "userId", "editionId", "createdAt")
SELECT gen_random_uuid()::text, uea."userId", e."id", uea."createdAt"
FROM "user_event_access" uea
JOIN "editions" e ON e."eventId" = uea."eventId"
ON CONFLICT ("userId", "editionId") DO NOTHING;

DROP TABLE "user_event_access";
