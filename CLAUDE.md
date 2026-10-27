# Warehouse Receiving System (WRS)

## Sources of truth (in this order)
1. docs/prd.md — what to build. Not described there = not in scope.
2. docs/technical-spec.md — how. DDL in §3.2 is authoritative.
3. docs/openapi.yaml — request/response shapes.
4. The user's current instruction — which piece to build now.
If two disagree, stop and say so. Never invent behaviour.

## Working rules
- Work only on what the user asked in this session. Restate it with the
  requirement IDs it covers (FR/BR/AC/T-xx) before coding.
- Tests first: write them, show them failing, then implement.
- Test names start with the requirement ID: `it('BR-07 rejects …')`.
- Integration tests use real PostgreSQL (wrs_test). Never mock the DB or Prisma.
- Stock (inventory_balances, inventory_transactions) changes only in
  ReceiptsService (+ the 0 balance on product create).
- Lock order is always document → item → balance.
- Never edit an applied migration; add a new one.
- No secrets in code; config comes from env (spec §10).
- Undecided detail → simplest option that satisfies the PRD, logged in
  docs/ai-workflow.md "Decisions made during implementation".
- Conventional Commits, one logical change per commit. Commit only when asked.

## Skills
- ponytail: active for all coding work.
- /code-review before handing a change to the user: `medium` by default,
  `high` for receipt, reversal and status-transition transactions.
- /security-review after any change to auth, guards, tokens, passwords or config.

## Commands
- DB for tests: `docker compose up -d db`
- Backend tests: `cd backend && npm test` (one rule: `npm test -- -t "BR-07"`)
- Frontend tests: `cd frontend && npm test`
- E2E: `npm run test:e2e` (stack running)
- Full stack: `docker compose up --build -d` → http://localhost:8080

## After each change
Run the affected tests plus the full backend suite, then add a row to the
work log in docs/ai-workflow.md.
