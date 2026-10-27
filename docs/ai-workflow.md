# AI Workflow — Warehouse Receiving System (WRS)

| Field | Value |
|---|---|
| Version | 1.0 |
| Related docs | [prd.md](prd.md), [technical-spec.md](technical-spec.md), [openapi.yaml](openapi.yaml), [testing.md](testing.md), [CLAUDE.md](../CLAUDE.md) |

> **Purpose.** The implementation is written by an AI coding agent and reviewed by a person (PRD §12). This document records how the agent is set up, how each piece of work is directed and checked, and what was decided or corrected along the way. There is no up-front task list: the user directs each piece of work.

---

## 1. Setup

### 1.1 Tools

| Tool | Use |
|---|---|
| Claude Code CLI, model Opus 5.5 (`claude-opus-5-5`) | All implementation work |
| git | Version control; Conventional Commits (technical spec §12) |
| Docker Desktop | PostgreSQL for integration tests (`docker compose up -d db`) and the full stack |

### 1.2 Project instructions

[CLAUDE.md](../CLAUDE.md) at the repository root is loaded into every agent session. It holds the source-of-truth order (§2), the working rules (§4), the skills to use and the test commands. It points to the docs instead of copying them.

### 1.3 Skills

| Skill | When |
|---|---|
| `ponytail` | Active for all coding work. Smallest change that fully solves the request, matching the technical spec's rule to choose the simplest option that satisfies the PRD. |
| `/code-review` | Before every commit (§3 step 6). Effort `medium` by default, `high` for receipt, reversal and status-transition transactions. |
| `/security-review` | After any change to authentication, guards, tokens, password handling or configuration, and once before the final review. |

## 2. Sources of truth

1. [prd.md](prd.md) — **what** to build. Not described there means not in scope.
2. [technical-spec.md](technical-spec.md) — **how**. The DDL in §3.2 is authoritative.
3. [openapi.yaml](openapi.yaml) — request and response shapes.
4. The user's current instruction — **which** piece to build now.

An instruction chooses the next piece of work; it does not override the PRD. If an instruction or two documents conflict, the agent stops and says so before writing code.

## 3. Loop for each instruction

| Step | Who | Action |
|---|---|---|
| 1 | Agent | Restate the instruction and list the requirement IDs it covers (FR, BR, AC, and test IDs from [testing.md](testing.md)). |
| 2 | Agent | Plan: files to touch and tests to write. The user confirms when the change is large or ambiguous. |
| 3 | Agent | Write the tests and show them failing. |
| 4 | Agent | Implement. Record undecided details in §6. |
| 5 | Agent | Run the affected tests and the full backend suite, including `assertInventoryConsistent()`. |
| 6 | Agent | Run `/code-review` (and `/security-review` when §1.3 applies); fix what it finds and rerun the tests. Record significant findings in §7. |
| 7 | Agent | Commit: one logical change per commit, Conventional Commits. Add a row to the work log (§5). |
| 8 | User | Review the change. Fixes the user asks for are made as new commits. |

**Commits.** The agent commits without asking the user once a change is finished: `/code-review` run, its findings fixed, and the full backend suite passing. A commit never contains tests that fail. Committed history is never amended or rewritten; later fixes are new commits. Nothing is pushed unless the user asks.

## 4. Rules for the agent

- Never mock the database or Prisma in integration tests.
- Never edit an applied migration; add a new one.
- No secrets in the repository; configuration comes from environment variables (technical spec §10).
- Never invent behaviour the PRD does not describe.
- Stock changes only through `ReceiptsService` (technical spec §5).
- Lock order is always document → item → balance (technical spec §6).
- Never start work that was not asked for.

## 5. Work log

One row per instruction, oldest first.

| # | Date | Instruction | Requirement IDs | Commits | Result |
|---|---|---|---|---|---|
| 1 | 2026-10-27 | Let the agent commit finished changes without asking | — | a1ecda2 | done |
| 2 | 2026-10-27 | Create the app foundations: database schema, backend skeleton, seed, test setup, auth and guards | NFR-01, NFR-02, NFR-05, NFR-09, FR-01–FR-03, FR-12, FR-50, A-08, AC-01.1–AC-01.4, AC-09.1–AC-09.2; T-DB-01–03, T-AUT-01–03, T-API-02, T-HLT-01 | 37002dc, 1e577f0, 0d43b78 | partial: T-AUT-04 waits for the supervisor-only endpoints (FR-03 / AC-01.4 covered through a test-only controller); no Dockerfiles, Swagger UI or frontend yet |
| 3 | 2026-10-27 | Create the product model and its endpoints | FR-10–FR-13, BR-01–BR-03, AC-02.1–AC-02.4, AC-02.5 (API part), FR-03; T-PRD-01–04, T-AUT-04 (POST /products) | 36d1c14, 265a79e, docs commit | done (frontend part of AC-02.5 comes with the frontend) |

Result is one of: done, partial (say what is left), rejected (say why).

## 6. Decisions made during implementation

Details the PRD and technical spec leave open, resolved with the simplest option that satisfies the PRD.

| ID | Date | From instruction # | Decision | Why | Affects |
|---|---|---|---|---|---|
| D-01 | 2026-10-27 | 2 | JWT is verified by a plain global guard using `JwtService` from `@nestjs/jwt`, without `passport-jwt` / `@nestjs/passport` (spec §0 lists passport-jwt). Signing and verification are pinned to HS256. | Same behaviour as spec §8 with three fewer dependencies and no strategy boilerplate (user approved, spec §0 amended). | `src/common/auth/`, `src/modules/auth/` |
| D-02 | 2026-10-27 | 2 | Seed runner: `npm run seed` runs `prisma/seed.ts` directly with Node 22's built-in type stripping (`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prisma/seed.ts`). No build step and no `package.json#prisma.seed` (deprecated in Prisma 6). The seed must stay erasable TypeScript only. | Works unchanged in the `node:22-alpine` runtime image, which must be Node ≥ 22.18 (type stripping on by default). | `prisma/seed.ts`, `package.json`, future `backend/Dockerfile` |
| D-03 | 2026-10-27 | 2 | The test setup loads `backend/.env.test` and throws unless the database name in `DATABASE_URL` ends with `_test`. | The tests truncate every table of that database; this protects the dev database. | `test/env.ts`, `test/global-setup.ts` |
| D-04 | 2026-10-27 | 2 | Prisma 6.19 reports P2002 as `meta = { modelName, target: [db column names] }`, not the constraint name, so the filter maps `Product:sku`, `ReceivingItem:receiving_document_id,product_id` and `ReceiptReversal:receipt_id` (observed against the real schema). A unique violation from `$executeRaw` arrives as P2010 / `23505` with no constraint name and becomes a 500. | Mapping on what Prisma actually returns. Consequence: inserts that rely on these mappings (e.g. the reversal insert, spec §6.2 step 10) must use the Prisma client, not raw SQL. | `src/common/errors/all-exceptions.filter.ts` |
| D-05 | 2026-10-27 | 2 | Init migration hand-edited beyond §3.3 step 3 so the database equals the §3.2 DDL exactly: unique indexes turned into `UNIQUE` constraints, `CURRENT_TIMESTAMP` defaults into `now()`, `BIGSERIAL` into `GENERATED ALWAYS AS IDENTITY`. Checked: `pg_dump --schema-only` of the migrated DB and of the DDL run directly are identical; `prisma migrate diff` reports no difference, so a later `migrate dev` does not try to drop the CHECKs, expression indexes or sequence. | §3.2 is authoritative ("must produce exactly this"). | `prisma/migrations/*_init/migration.sql` |
| D-06 | 2026-10-27 | 2 | `VALIDATION_ERROR` `details.fields` holds one `{field, message}` entry per failed constraint; nested fields use a dotted path (`items.1.quantity`). Other 400s (malformed JSON, a Nest pipe, a body-parser client error such as 413 body too large) are also `VALIDATION_ERROR` with `details.fields: []`. | Spec §4.2 fixes the shape but not these cases; §4.3 puts every malformed request at 400 and has no 413. | `src/common/errors/` |
| D-07 | 2026-10-27 | 2 | Seed upserts: an existing user gets `fullName`, `role` and a fresh hash of the current env password; an existing product is left untouched (its balance is created only with the product, in the same nested write). | The env vars stay the source of truth for demo passwords (A-08); stock never changes outside `ReceiptsService`. | `prisma/seed.ts` |
| D-08 | 2026-10-27 | 2 | `PrismaService` does not connect on module init; Prisma connects on the first query. | The API can start and `/health` can answer 503 while the database is down. | `src/prisma/prisma.service.ts` |
| D-09 | 2026-10-27 | 2 | `GET /auth/me` reads the user from the database; a valid token for a user that no longer exists gets 401 `UNAUTHENTICATED`. | `User.fullName` is not in the token. | `src/modules/auth/` |
| D-10 | 2026-10-27 | 2 | `main.ts` exports `configureApp()` (global prefix + request logger), used by bootstrap and by the integration tests; guards, the validation pipe and the filter are `APP_*` providers in `AppModule`. `nest build` compiles `src/` only, so the entry point is `dist/main.js` (spec §11). | Tests run exactly the app that ships, with no copy of the setup. | `src/main.ts`, `src/app.module.ts`, `tsconfig.build.json` |
| D-11 | 2026-10-27 | 2 | The Jest global setup runs `prisma migrate deploy` (after the `_test` guard) instead of `prisma migrate reset --force --skip-seed`; each test file still truncates the tables in `beforeEach`. User decision. | Prisma 6.19 refuses `migrate reset` when run by an AI agent without the user's consent, so the agent could not run the suite. | spec §3.3 step 7, `test/global-setup.ts` |
| D-12 | 2026-10-27 | 3 | Product `description` is trimmed; an empty or whitespace-only value (or `null`) is stored as `null`. The 1000-character limit applies after trimming, like name and unit (BR-03). | BR-03 makes description optional and the column nullable; a blank string carries no information, and one empty state is simpler for the UI. | `src/modules/products/dto/product.dto.ts` |
| D-13 | 2026-10-27 | 3 | Product list order is `created_at DESC, id DESC`. | FR-10 says newest first; rows created in one transaction share `now()`, and without a unique tie-break they could repeat or vanish across pages. | `src/modules/products/products.service.ts` |
| D-14 | 2026-10-27 | 3 | Product search escapes `\`, `%` and `_` before Prisma's `contains` (`mode: 'insensitive'`, i.e. `ILIKE`), so they match literally. An empty or whitespace-only `search` means no filter. | Observed: Prisma 6.19 passes `contains` to `ILIKE` unescaped, so search `%` or `_` listed every product and `\` listed none (test T-PRD-04). | `src/modules/products/products.service.ts`; later list searches (documents) need the same escape |
| D-15 | 2026-10-27 | 3 | `page` has an upper bound of 1,000,000 on every list (spec §4.4 only says ≥ 1); a larger page is 400 `VALIDATION_ERROR` naming `page`. | Without a bound, e.g. `page=1e18` passes `@IsInt` and Prisma 6.19 rejects the 64-bit `skip` with a 500. 1,000,000 × 100 rows is far beyond NFR-04. | `src/common/pagination/pagination.ts` |

## 7. Where the AI was wrong

Mistakes the agent made, how they were caught, and how they were fixed.

| # | Date | What was wrong | How it was caught | Fix |
|---|---|---|---|---|
| 1 | 2026-10-27 | `.env.example` shipped a 42-character `JWT_SECRET` placeholder, which passes the ≥ 32 check: an unedited copy would start the API with a public secret, so anyone could sign a SUPERVISOR token. | `/code-review` (instruction #2) | Placeholder shortened below 32 characters; test `NFR-02 the JWT_SECRET placeholder in .env.example is rejected…` fails if it is lengthened again |
| 2 | 2026-10-27 | `engines` allowed Node 22.0–22.17, where `npm run seed` (`node prisma/seed.ts`) fails because type stripping is on by default only from 22.18. | `/code-review` (instruction #2) | `engines.node` set to `>=22.18 <23` |
| 3 | 2026-10-27 | `page` had no upper bound: `?page=1e18` passed validation and Prisma rejected the 64-bit `skip`, so a client mistake returned 500 `INTERNAL_ERROR`. | `/code-review` (instruction #3); confirmed against `wrs_test` | `@Max(1_000_000)` on `page` (D-15), with tests |
| 4 | 2026-10-27 | SKU normalization used full Unicode `toUpperCase()`, so `ßku-1` was stored as `SSKU-1`, `ſku-1` as `SKU-1` and `ıabc` as `IABC`: SKUs the user never typed. | `/code-review` (instruction #3) | Only ASCII `a–z` are upper-cased; non-ASCII input now fails BR-01 with 400, with tests |
| 5 | 2026-10-27 | Eight test names started with "spec §…" instead of a requirement ID (CLAUDE.md rule); four of them slipped through the review of instruction #2. | `/code-review` (instruction #3) | Renamed; test names are now checked for a leading ID in every review |

## 8. Evidence

Test output and deployment checks are recorded in [testing.md §4](testing.md#4-evidence), not copied here.
