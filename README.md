# empireNigeria API

NestJS backend for the empireNigeria property care platform.

## Local setup

The API is designed to use a hosted PostgreSQL database. Docker is optional and is only kept as a local database fallback.

1. Copy the environment template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Update `.env` with your hosted PostgreSQL connection string and application secrets. Use the connection string supplied by your database provider. Many hosted providers require `?sslmode=require`.

3. Create a Resend API key and verify the sending domain or email address in Resend. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Keep both values private.

4. Install dependencies and prepare Prisma:

   ```powershell
   npm install
   npm run prisma:generate
   npm run prisma:migrate
   npm run prisma:seed
   ```

5. Start the API:

   ```powershell
   npm run start:dev
   ```

The API listens on `http://localhost:4000` and exposes versioned endpoints under `/api/v1`.

## Authentication foundation

- Public registration is limited to owners and guests.
- Registration creates a pending account and sends a verification code through Resend when configured.
- In development, the verification code is also returned in the response for local testing.
- Administrator accounts are seeded or created internally.
- Property managers, inspectors, and contractors are intended to be approved through administrator workflows.

## Email delivery

The initial notification service sends account verification email through Resend. Password recovery, approval notices, work-order updates, and other notifications should use the same service as those workflows are added.

For production, `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are required at startup. Do not commit `.env` or place database credentials and API keys in source control.

## Optional local PostgreSQL

If a local database is needed, `docker compose up -d` starts the PostgreSQL service defined in `docker-compose.yml`. This is optional and is not needed when using hosted PostgreSQL.
