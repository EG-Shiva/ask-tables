# AskTables

Upload CSV/Excel files and ask analytical questions in plain English. Get answers, previews, and charts.

**Live demo:** https://ask-tables.vercel.app  
**Source:** https://github.com/EG-Shiva/ask-tables  

**How it stays accurate:** optional AI only helps draft a **query plan**. Aggregations and joins run **locally in the browser**, so totals are not hallucinated.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`).

Upload files from `sample-data/`, then try:

- `Describe the first file`
- `Total amount by region`
- `Compare the two sales files`
- `Average salary by department` (employees.csv)

## Features

| Capability | How |
|---|---|
| Multi-file upload | Multiple CSV/Excel in one session |
| Cross-file analysis | Side-by-side aggregates + join-compare on shared keys |
| Visual insights | Bar / line / pie via Recharts when useful |
| Plan → execute | Heuristic (default) or optional LLM → JSON plan → deterministic engine |

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
