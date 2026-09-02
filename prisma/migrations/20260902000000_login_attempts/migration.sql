-- Rate limit de login: registra tentativas mal-sucedidas por e-mail.
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");
