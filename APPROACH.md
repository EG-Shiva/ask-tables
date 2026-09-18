# Approach (1 page)

## Problem framing
Darwinbox asked for a small web app where users upload CSV/Excel files and ask analytical questions in plain English. The risk with a naïve LLM demo is wrong numbers: models invent aggregates. I scoped a thin product that is correct first, then smart.

## Architecture (the delta)
1. **Ingest** — Papa Parse / SheetJS load one or more files; Excel sheets become separate tables.
2. **Profile** — Infer column types, nulls, uniques, numeric min/max/mean. This grounds later planning.
3. **Plan** — Natural language → structured `QueryPlan` (metrics, group-by, filters, join keys, chart type). Default planner is **heuristic** (no API key). Optional OpenAI-compatible open model (e.g. Groq Llama) may refine the plan only.
4. **Execute locally** — `queryEngine` runs sum/avg/count/min/max, filters, group-by, cross-file compare, and simple key joins in the browser.
5. **Present** — Answer text + expandable plan JSON + table preview + Recharts when useful.

That split is the “delta solutioning”: AI proposes structure; deterministic code owns truth.

## Key decisions
- **Browser-first prototype** — Zero backend for the happy path; easy to demo in ~minutes.
- **Show the plan** — Interviewers can see what was understood vs executed.
- **Multi-file by default** — “across all files” and “compare” use every uploaded table; join-compare uses shared/id-like columns.
- **Charts only when they help** — Grouped or comparative answers get bar/line/pie; schema dumps stay text.

## Trade-offs / what I’d build next
- Richer NL (explicit filters like `region = North`, date ranges) and SQL preview.
- DuckDB-WASM for larger files and real SQL.
- Server-side job queue + auth if this became an internal Darwinbox tool.
- Eval set of questions with golden answers to regression-test the planner.

## Time box
Built as a focused prototype aligned with the 4–6 hour expectation: complete upload → ask → chart loop, not a sprawling unfinished platform.
