-- Substitui o booleano isAdmin por um papel de 3 níveis (admin / funcionario /
-- usuario) — quem já era admin continua admin, o resto vira "usuario" (o
-- admin promove manualmente pra "funcionario" quem precisar).

CREATE TYPE "UserRole" AS ENUM ('admin', 'funcionario', 'usuario');

ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'usuario';

UPDATE "users" SET "role" = 'admin' WHERE "isAdmin" = true;

ALTER TABLE "users" DROP COLUMN "isAdmin";
