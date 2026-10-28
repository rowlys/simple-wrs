# Warehouse Receiving System (WRS)

A web app for receiving goods at one warehouse. A supervisor creates a receiving document with the expected lines and opens it; an operator records what arrives, line by line, in one or more counts; each receipt raises stock and writes an inventory ledger row in the same transaction. The supervisor completes the document, closes it short, or cancels it, and can reverse a wrong receipt.

- **Backend:** NestJS 11, Prisma 6, PostgreSQL 16 (`backend/`)
- **Frontend:** React 19, Mantine 8, TanStack Query (`frontend/`), served by nginx, which also proxies the API
- **Docs:** [PRD](docs/prd.md) (what), [technical spec](docs/technical-spec.md) (how), [OpenAPI contract](docs/openapi.yaml), [testing and evidence](docs/testing.md), [AI workflow and decisions](docs/ai-workflow.md)

## Requirements

- Docker with Compose v2 (Docker Desktop on Windows and macOS)
- Node.js 22.18 or later 22.x, only to run the tests or work on the code outside Docker
- Free ports: `8080` (the app) and `127.0.0.1:5432` (PostgreSQL, published for the tests and local development)

## Setup

```sh
git clone <repository-url> simple-wrs
cd simple-wrs
cp .env.example .env
```

Edit `.env` and replace every `change-me` value (the API refuses to start with the placeholder `JWT_SECRET`, which is too short):

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | Any URL-safe password (no `@`, `/` or `:`); put the same password in `DATABASE_URL` |
| `JWT_SECRET` | At least 32 random characters, e.g. the output of `openssl rand -hex 32` |
| `SEED_ON_START` | `true` for the first start, so the users and products below are created |
| `SEED_SUPERVISOR_PASSWORD`, `SEED_OPERATOR_PASSWORD` | Passwords of the two seeded users, `supervisor` and `operator` |

`.env` is git-ignored; never commit it.

## Run the app

```sh
docker compose up --build -d
docker compose ps          # db, api and web all "healthy" (the first build takes a few minutes)
```

| What | Where |
|---|---|
| The app | http://localhost:8080 (log in as `supervisor` or `operator`) |
| API | http://localhost:8080/api/v1 |
| Swagger UI | http://localhost:8080/api/docs |
| Health check | http://localhost:8080/health |

Optional demo data, receiving documents in every status with receipts and one reversal:

```sh
docker compose exec api npm run seed:demo
```

Stop with `docker compose down`; the data stays in the `db-data` volume. `docker compose down -v` deletes it.

## Deployment

The same Compose file is the deployment:

- **Services.** `db` (PostgreSQL 16), `api` (NestJS, runs as the non-root `node` user) and `web` (nginx). Only `web` is published (`WEB_PORT`, default 8080); nginx serves the frontend and forwards `/api/` and `/health` to the api, so the browser sees one origin. PostgreSQL is published on `127.0.0.1` only.
- **Migrations.** Every start of the api runs `prisma migrate deploy`, which applies pending migrations and does nothing when there are none, then the seed when `SEED_ON_START=true`, then the API.
- **Seed.** Creates the two users and five products if they are missing; on every start with `SEED_ON_START=true` it resets the two users' passwords to the values in `.env`. Set it to `false` once you manage the passwords yourself.
- **Configuration.** Only environment variables, from `.env` (technical spec §10). `JWT_EXPIRES_IN` (default `8h`) and `WEB_PORT` are optional.
- **Update.** `git pull && docker compose up --build -d`. The data volume is kept and new migrations run on start.
- **Health.** Each container has a health check; `/health` answers 503 while the database is unreachable.

## Tests

### Backend: unit and integration

Integration tests run the real API against a real PostgreSQL database, `wrs_test`, which the `db` container creates on its first start. The tests empty that database; they refuse to run against any database whose name does not end in `_test`.

```sh
docker compose up -d db
cp backend/.env.test.example backend/.env.test    # put POSTGRES_PASSWORD from .env in DATABASE_URL
cd backend
npm ci
npm test                       # the whole suite
npm test -- -t "BR-07"         # the tests of one rule
npm test -- --coverage
```

### Frontend: unit

```sh
cd frontend
npm ci
npm test
```

### End-to-end

Playwright drives Chromium through the running stack as the seeded users, with the passwords from `.env`. Each run creates its own product and document, so it can be repeated on the same stack.

```sh
docker compose up --build -d          # the stack must be running and seeded
npm ci                                # in the repository root
npx playwright install chromium
npm run test:e2e
```

The HTML report goes to `playwright-report/`. Test IDs and what each test proves are in [docs/testing.md](docs/testing.md).

## Local development

Backend in watch mode, against the Compose database:

```sh
docker compose up -d db
cp backend/.env.example backend/.env     # put POSTGRES_PASSWORD from .env in DATABASE_URL, set the other change-me values
cd backend
npm ci
npm run dev                              # applies pending migrations, then http://localhost:3000 (Swagger UI at /api/docs)
npm run seed                             # users and products, with the passwords from backend/.env
```

Frontend dev server with hot reload. It forwards API calls to the full stack's nginx on `WEB_PORT`, so start the stack first:

```sh
cd frontend
npm ci
npm run dev                              # http://localhost:5173
```

## Repository layout

```
backend/     NestJS API, Prisma schema, migrations and seeds, Jest tests (test/)
frontend/    React app, Vitest tests, nginx config, Dockerfile
e2e/         Playwright specs (run from the repository root)
docker/      PostgreSQL init script (creates wrs_test)
docs/        PRD, technical spec, OpenAPI contract, diagrams, testing, AI workflow
```
