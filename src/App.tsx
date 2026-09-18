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

function pickNumeric(table: DataTable) {
  return table.columns.find((c) => c.type === 'number')?.name;
}

function pickCategory(table: DataTable) {
  return table.columns.find(
    (c) => c.type === 'string' && c.uniqueCount > 1 && c.uniqueCount <= Math.max(25, Math.floor(table.rowCount / 2) || 25),
  )?.name;
}

/** Suggestion chips that match whatever files are currently loaded. */
function buildExamples(tables: DataTable[]): string[] {
  if (!tables.length) return [];

  const out: string[] = [];
  const first = tables[0];
  out.push(`Describe ${first.name}`);

  const num = pickNumeric(first);
  const cat = pickCategory(first);
  if (num && cat) out.push(`Total ${num} by ${cat}`);
  else if (num) out.push(`Sum of ${num}`);
  else out.push(`Count rows in ${first.name}`);

  if (tables.length > 1) {
    const nums = tables.map((t) => pickNumeric(t)).filter(Boolean);
    if (nums.length >= 2 && new Set(nums).size === 1) {
      out.push(`Average ${nums[0]} across all files`);
    } else {
      out.push('Compare aggregates across all files');
    }
    out.push(`Compare ${tables[0].name} and ${tables[1].name}`);
  }

  if (tables.length === 1 && cat) {
    out.push(`Count rows by ${cat}`);
  }

  // Second file–specific tip when useful
  if (tables.length >= 2) {
    const second = tables[1];
    const n2 = pickNumeric(second);
    const c2 = pickCategory(second);
    if (n2 && c2) out.push(`Total ${n2} by ${c2} in ${second.name}`);
  }

  return [...new Set(out)].slice(0, 5);
}

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
  const examples = useMemo(() => buildExamples(tables), [tables]);

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
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            A
          </div>
          <div className="brand-text">
            <strong>AskTables</strong>
            <span>Plain-English spreadsheet Q&amp;A</span>
          </div>
        </div>
      </div>

      <header className="hero">
        <p className="eyebrow">Upload · Ask · Chart</p>
        <h1>Ask your spreadsheets</h1>
        <p className="lede">
          Drop CSV or Excel files, ask in plain English, get clear answers and charts.
          Optional AI only drafts the plan — totals are computed in your browser.
        </p>
      </header>

      <section className="panel upload-panel">
        <div className="panel-head">
          <h2>
            <span className="step">1</span>
            Upload files
          </h2>
          <span className="meta">
            {tables.length} file{tables.length === 1 ? '' : 's'} · {totalRows.toLocaleString()} rows
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
                  <h3 title={t.name}>{t.name}</h3>
                  <button type="button" onClick={() => setTables((prev) => prev.filter((x) => x.id !== t.id))}>
                    Remove
                  </button>
                </header>
                <p>
                  {t.rowCount.toLocaleString()} rows · {t.columns.length} columns
                  {t.fileName !== t.name ? ` · ${t.fileName}` : ''}
                </p>
                <ul>
                  {t.columns.slice(0, 8).map((c) => (
                    <li key={c.name}>
                      <code>{c.name}</code>
                      <em className={`type-pill ${c.type}`}>{c.type}</em>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
        <p className="hint">
          Upload one or more CSV/Excel files, then ask questions below. Sample files are in <code>sample-data/</code>.
        </p>
      </section>

      <section className="panel ask-panel">
        <div className="panel-head">
          <h2>
            <span className="step">2</span>
            Ask in plain English
          </h2>
        </div>
        <div className="examples">
          {examples.map((ex) => (
            <button key={ex} type="button" disabled={!tables.length || asking} onClick={() => void ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <form className="ask-form" onSubmit={onSubmit}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              tables.length
                ? examples[1]
                  ? `e.g. ${examples[1].toLowerCase()}`
                  : 'Ask a question about your files'
                : 'Upload files first'
            }
            disabled={!tables.length || asking}
          />
          <button type="submit" disabled={!tables.length || asking || !question.trim()}>
            {asking ? 'Running…' : 'Ask'}
          </button>
        </form>

        <div className="chat">
          {messages.length === 0 && (
            <p className="empty">Answers show here with the query plan and a chart when it helps.</p>
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
          Plan locally (or with an optional open LLM) → execute in-browser. Numbers are never invented by the model.
        </p>
      </footer>
    </div>
  );
}
