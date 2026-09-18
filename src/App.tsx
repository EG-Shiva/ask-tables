import { useMemo, useState, type FormEvent } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { parseUpload } from './lib/parseFiles';
import { buildPlan } from './lib/nlPlanner';
import { executePlan } from './lib/queryEngine';
import type { ChatMessage, DataTable, QueryResult } from './lib/types';
import './App.css';

const COLORS = ['#0f766e', '#c2410c', '#1d4ed8', '#a16207', '#be123c', '#7c3aed'];

const EXAMPLES = [
  'Describe the first file',
  'Total sales by region',
  'Average amount across all files',
  'Compare the two sales files',
  'Count rows by department',
];

function ChartBlock({ result }: { result: QueryResult }) {
  if (!result.chartData?.length || !result.chartType) return null;
  const data = result.chartData;

  if (result.chartType === 'pie') {
    return (
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" outerRadius={90} label>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (result.chartType === 'line') {
    return (
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#0f766e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{String(row[c] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [tables, setTables] = useState<DataTable[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);

  const totalRows = useMemo(() => tables.reduce((n, t) => n + t.rowCount, 0), [tables]);

  async function onFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setBusy(true);
    setError(null);
    try {
      const next: DataTable[] = [];
      for (const file of Array.from(fileList)) {
        const parsed = await parseUpload(file);
        next.push(...parsed);
      }
      setTables((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function ask(q: string) {
    const text = q.trim();
    if (!text || !tables.length) return;
    setAsking(true);
    setError(null);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setQuestion('');
    try {
      const plan = await buildPlan(text, tables);
      const result = executePlan(tables, plan);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: result.answerText,
          result,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Question failed');
    } finally {
      setAsking(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">AskTables</p>
        <h1>Ask your spreadsheets</h1>
        <p className="lede">
          Upload CSV/Excel files, ask questions in plain English, get clear answers and charts.
          Optional AI only drafts the query plan — numbers are computed in your browser.
        </p>
      </header>

      <section className="panel upload-panel">
        <div className="panel-head">
          <h2>1. Upload files</h2>
          <span className="meta">
            {tables.length} file{tables.length === 1 ? '' : 's'} · {totalRows} rows
          </span>
        </div>
        <label className={`drop ${busy ? 'busy' : ''}`}>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            multiple
            disabled={busy}
            onChange={(e) => void onFiles(e.target.files)}
          />
          <strong>Drop CSV / Excel</strong>
          <span>or click to browse · multiple files OK</span>
        </label>
        {error && <p className="error">{error}</p>}
        {tables.length > 0 && (
          <div className="file-list">
            {tables.map((t) => (
              <article key={t.id} className="file-card">
                <header>
                  <h3>{t.name}</h3>
                  <button type="button" onClick={() => setTables((prev) => prev.filter((x) => x.id !== t.id))}>
                    Remove
                  </button>
                </header>
                <p>
                  {t.rowCount} rows · {t.columns.length} columns
                </p>
                <ul>
                  {t.columns.slice(0, 8).map((c) => (
                    <li key={c.name}>
                      <code>{c.name}</code> <em>{c.type}</em>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
        <p className="hint">
          Sample files are in <code>sample-data/</code> — upload both sales CSVs to try cross-file compare.
        </p>
      </section>

      <section className="panel ask-panel">
        <div className="panel-head">
          <h2>2. Ask in plain English</h2>
        </div>
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" disabled={!tables.length || asking} onClick={() => void ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <form className="ask-form" onSubmit={onSubmit}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={tables.length ? 'e.g. total revenue by region across both files' : 'Upload files first'}
            disabled={!tables.length || asking}
          />
          <button type="submit" disabled={!tables.length || asking || !question.trim()}>
            {asking ? 'Running…' : 'Ask'}
          </button>
        </form>

        <div className="chat">
          {messages.length === 0 && (
            <p className="empty">Answers appear here with a visible plan (heuristic or LLM) and chart when useful.</p>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`bubble ${msg.role}`}>
              <p className="bubble-text">{msg.text}</p>
              {msg.result && (
                <div className="result">
                  <details open>
                    <summary>
                      Query plan · {msg.result.plan.source}
                      {msg.result.warnings.length ? ` · ${msg.result.warnings.length} warning(s)` : ''}
                    </summary>
                    <pre>{JSON.stringify(msg.result.plan, null, 2)}</pre>
                  </details>
                  <ChartBlock result={msg.result} />
                  <PreviewTable rows={msg.result.tablePreview} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <p>
          Delta design: natural language → structured plan → deterministic local execution. Optional open LLM via{' '}
          <code>VITE_LLM_*</code> only helps plan, never invents totals.
        </p>
      </footer>
    </div>
  );
}
