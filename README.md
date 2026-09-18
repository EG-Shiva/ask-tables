# Data Q&A — Darwinbox FDE take-home

Plain-English analytics over multiple CSV/Excel files, with charts.

**Delta vs raw AI chat:** the model (optional) only helps draft a **query plan**. Aggregations and joins run **locally in the browser**, so totals are not hallucinated.

## Quick start

```bash
cd data-qa
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`).

Upload files from `sample-data/`, then try:

- `Describe the first file`
- `Total amount by region`
- `Compare the two sales files`
- `Average salary by department` (employees.csv)

## Acceptance criteria map

| Requirement | How |
|---|---|
| Multi-file upload | Multiple CSV/Excel in one session |
| Cross-file analysis | Side-by-side aggregates + join-compare on shared keys |
| Visual insights | Bar / line / pie via Recharts when the plan asks for a chart |
| Delta on AI | Heuristic (default) or optional LLM → JSON plan → deterministic `queryEngine` |

## Optional open LLM (not required)

Works offline with heuristics. To use an OpenAI-compatible open model (e.g. Groq Llama):

```env
VITE_LLM_URL=https://api.groq.com/openai/v1/chat/completions
VITE_LLM_API_KEY=your_key
VITE_LLM_MODEL=llama-3.1-8b-instant
```

Copy `.env.example` → `.env.local`.

## Stack

- Vite + React + TypeScript
- Papa Parse (CSV), SheetJS (Excel)
- Recharts
- Local query engine + heuristic NL planner

## Scripts

- `npm run dev` — local demo
- `npm run build` — production build
- `npm run preview` — preview build

## Write-up

See [APPROACH.md](./APPROACH.md).
