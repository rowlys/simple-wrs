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
| `/code-review` | Before every change is handed to the user for review. Effort `medium` by default, `high` for receipt, reversal and status-transition transactions. |
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
| 4 | Agent | Implement. |
| 5 | Agent | Run the affected tests and the full backend suite, including `assertInventoryConsistent()`. |
| 6 | Agent | Run `/code-review` (and `/security-review` when §1.3 applies); fix what it finds. |
| 7 | User | Review the change. |
| 8 | Agent | Commit when asked: one logical change per commit, Conventional Commits. Add a row to the work log (§5). |

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
| | | | | | |

Result is one of: done, partial (say what is left), rejected (say why).

## 6. Decisions made during implementation

Details the PRD and technical spec leave open, resolved with the simplest option that satisfies the PRD.

| ID | Date | From instruction # | Decision | Why | Affects |
|---|---|---|---|---|---|
| | | | | | |

## 7. Where the AI was wrong

Mistakes the agent made, how they were caught, and how they were fixed.

| # | Date | What was wrong | How it was caught | Fix |
|---|---|---|---|---|
| | | | | |

## 8. Evidence

Test output and deployment checks are recorded in [testing.md §4](testing.md#4-evidence), not copied here.
