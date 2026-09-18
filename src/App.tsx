import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { loadDemoTables } from './lib/sampleData';
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

  if (tables.length >= 2) {
    const second = tables[1];
    const n2 = pickNumeric(second);
    const c2 = pickCategory(second);
    if (n2 && c2) out.push(`Total ${n2} by ${c2} in ${second.name}`);
  }

  return [...new Set(out)].slice(0, 5);
}

function groupFiles(tables: DataTable[]) {
  const map = new Map<string, DataTable[]>();
  for (const t of tables) {
    const list = map.get(t.fileName) || [];
    list.push(t);
    map.set(t.fileName, list);
  }
  return [...map.entries()];
}

function formatNum(n: number) {
  if (!Number.isFinite(n)) return String(n);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function extractCallouts(result: QueryResult): { label: string; value: string }[] {
  if (result.plan.intent === 'describe' || result.plan.intent === 'filter') return [];

  if (result.chartData?.length === 1) {
    return [{ label: cleanLabel(result.chartData[0].label), value: formatNum(result.chartData[0].value) }];
  }

  if (result.chartData && result.chartData.length > 1 && result.chartData.length <= 4 && result.plan.intent === 'compare') {
    return result.chartData.map((d) => ({ label: cleanLabel(d.label), value: formatNum(d.value) }));
  }

  if (result.tablePreview.length === 1) {
    const row = result.tablePreview[0];
    const metricKeys = Object.keys(row).filter((k) => /^(sum|avg|count|min|max)_/i.test(k) || k === 'delta');
    if (metricKeys.length) {
      return metricKeys.slice(0, 4).map((k) => ({
        label: cleanLabel(k),
        value: formatNum(Number(row[k])),
      }));
    }
  }

  return [];
}

function cleanLabel(label: string) {
  return label.replace(/^(sum|avg|count|min|max)_/i, '').replace(/_/g, ' ');
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

function PreviewTable({ rows, title }: { rows: Record<string, unknown>[]; title?: string }) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-block">
      {title && <p className="table-title">{title}</p>}
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
                  <td key={c} title={String(row[c] ?? '')}>
                    {String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnswerCard({ message, isLatest }: { message: ChatMessage; isLatest: boolean }) {
  const result = message.result;
  if (!result) {
    return <p className="bubble-text">{message.text}</p>;
  }

  const intentLabel =
    result.plan.intent === 'describe'
      ? 'File profile'
      : result.plan.intent === 'compare' || result.plan.intent === 'join_compare'
        ? 'Comparison'
        : result.plan.intent === 'trend'
          ? 'Trend'
          : result.plan.intent === 'filter'
            ? 'Filtered rows'
            : 'Answer';

  const callouts = extractCallouts(result);
  const planSource =
    result.plan.source === 'llm' ? 'Open model helped draft the plan' : 'Local planner built the plan';

  return (
    <div className={`answer-card ${isLatest ? 'latest' : ''}`}>
      <div className="answer-head">
        <span className="answer-badge">{intentLabel}</span>
        {isLatest && <span className="answer-live">New</span>}
      </div>
      <p className="answer-summary">{result.answerText}</p>
      {callouts.length > 0 && (
        <div className={`callouts callouts-${Math.min(callouts.length, 4)}`}>
          {callouts.map((c) => (
            <div key={`${c.label}-${c.value}`} className="callout">
              <span className="callout-label">{c.label}</span>
              <strong className="callout-value">{c.value}</strong>
            </div>
          ))}
        </div>
      )}
      <ChartBlock result={result} />
      <PreviewTable
        rows={result.tablePreview}
        title={result.plan.intent === 'describe' ? 'Columns' : 'Results'}
      />
      <details className="plan-details">
        <summary>
          How this was computed
          {result.warnings.length ? ` · ${result.warnings.length} warning(s)` : ''}
        </summary>
        <ol className="plan-steps">
          <li>Read your question in plain English.</li>
          <li>{planSource} (no invented numbers).</li>
          <li>Ran the math locally in your browser.</li>
          {result.plan.explanation ? <li>{result.plan.explanation}</li> : null}
        </ol>
        <details className="plan-tech">
          <summary>Technical plan</summary>
          <pre>{JSON.stringify(result.plan, null, 2)}</pre>
        </details>
      </details>
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
  const answersRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<HTMLDivElement | null>(null);

  const fileGroups = useMemo(() => groupFiles(tables), [tables]);
  const totalRows = useMemo(() => tables.reduce((n, t) => n + t.rowCount, 0), [tables]);
  const examples = useMemo(() => buildExamples(tables), [tables]);
  const sheetCount = tables.length;
  const fileCount = fileGroups.length;

  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    latestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [messages]);

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

  async function loadDemo() {
    setBusy(true);
    setError(null);
    try {
      const demo = await loadDemoTables();
      setTables(demo);
      setMessages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load demo data');
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
    answersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  function removeFile(fileName: string) {
    setTables((prev) => prev.filter((t) => t.fileName !== fileName));
  }

  const latestId = messages.length ? messages[messages.length - 1].id : null;

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
        <button type="button" className="demo-btn" disabled={busy} onClick={() => void loadDemo()}>
          Try demo data
        </button>
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
            {fileCount} file{fileCount === 1 ? '' : 's'}
            {sheetCount > fileCount ? ` · ${sheetCount} sheets` : ''}
            {' · '}
            {totalRows.toLocaleString()} rows
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
        <div className="upload-actions">
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void loadDemo()}>
            Load sample sales + employees
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {fileGroups.length > 0 && (
          <div className="file-list">
            {fileGroups.map(([fileName, sheets]) => {
              const rows = sheets.reduce((n, s) => n + s.rowCount, 0);
              const cols = sheets[0]?.columns.length ?? 0;
              const multi = sheets.length > 1;
              return (
                <article key={fileName} className="file-card">
                  <header>
                    <h3 title={fileName}>{fileName}</h3>
                    <button type="button" onClick={() => removeFile(fileName)}>
                      Remove
                    </button>
                  </header>
                  <p>
                    {multi
                      ? `${sheets.length} sheets · ${rows.toLocaleString()} rows`
                      : `${rows.toLocaleString()} rows · ${cols} columns`}
                  </p>
                  {multi ? (
                    <ul className="sheet-list">
                      {sheets.map((s) => (
                        <li key={s.id}>
                          <span className="sheet-name">{s.sheetName}</span>
                          <span className="sheet-meta">
                            {s.rowCount.toLocaleString()} rows · {s.columns.length} cols
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul>
                      {sheets[0].columns.slice(0, 8).map((c) => (
                        <li key={c.name}>
                          <code>{c.name}</code>
                          <em className={`type-pill ${c.type}`}>{c.type}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="hint">Excel workbooks with multiple sheets stay under one file card. Each sheet can still be queried.</p>
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
                : 'Upload files or try demo data first'
            }
            disabled={!tables.length || asking}
          />
          <button type="submit" disabled={!tables.length || asking || !question.trim()}>
            {asking ? 'Running…' : 'Ask'}
          </button>
        </form>

        <div className="chat" ref={answersRef}>
          {asking && <p className="status-line">Working on your question…</p>}
          {messages.length === 0 && !asking && (
            <p className="empty">
              Answers show here right after you ask — big numbers first, then table and chart when useful.
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`bubble ${msg.role}`}
              ref={msg.id === latestId && msg.role === 'assistant' ? latestRef : undefined}
            >
              {msg.role === 'user' ? (
                <p className="bubble-text">
                  <span className="you-label">You</span>
                  {msg.text}
                </p>
              ) : (
                <AnswerCard message={msg} isLatest={msg.id === latestId} />
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <p>Plan first, then calculate locally. Numbers are never invented by the model.</p>
      </footer>
    </div>
  );
}
