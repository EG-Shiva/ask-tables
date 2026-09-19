import type { AggOp, DataTable, QueryPlan } from './types';

function pickNumeric(table: DataTable): string | null {
  return table.columns.find((c) => c.type === 'number')?.name || null;
}

function pickCategorical(table: DataTable): string | null {
  return (
    table.columns.find((c) => c.type === 'string' && c.uniqueCount > 1 && c.uniqueCount <= Math.max(20, table.rowCount / 2))
      ?.name || table.columns.find((c) => c.type === 'string')?.name || null
  );
}

function findCommonKeys(a: DataTable, b: DataTable): { left: string; right: string } | null {
  for (const ca of a.columns) {
    for (const cb of b.columns) {
      if (ca.name.toLowerCase() === cb.name.toLowerCase()) return { left: ca.name, right: cb.name };
    }
  }
  const idLike = (n: string) => /id|code|key|name|sku|emp/i.test(n);
  for (const ca of a.columns.filter((c) => idLike(c.name))) {
    for (const cb of b.columns.filter((c) => idLike(c.name))) {
      return { left: ca.name, right: cb.name };
    }
  }
  return null;
}

function matchAgg(q: string): AggOp {
  if (/\b(avg|average|mean)\b/.test(q)) return 'avg';
  if (/\b(min|minimum|lowest)\b/.test(q)) return 'min';
  if (/\b(max|maximum|highest|top)\b/.test(q)) return 'max';
  if (/\b(count|how many|number of)\b/.test(q)) return 'count';
  return 'sum';
}

function findColumnMention(q: string, table: DataTable, prefer?: 'number' | 'string'): string | null {
  const lower = q.toLowerCase();
  const scored = table.columns
    .map((c) => {
      const name = c.name.toLowerCase();
      let score = 0;
      if (lower.includes(name)) score = name.length + 5;
      else {
        const parts = name.split(/[_\s]+/).filter(Boolean);
        if (parts.some((p) => p.length > 2 && lower.includes(p))) score = 2;
      }
      if (!score) return null;
      if (prefer === 'number' && c.type === 'number') score += 10;
      if (prefer === 'string' && c.type === 'string') score += 8;
      if (prefer === 'number' && c.type !== 'number') score -= 4;
      return { name: c.name, score, type: c.type };
    })
    .filter(Boolean) as { name: string; score: number; type: string }[];
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name || null;
}

function tablesFromQuestion(q: string, tables: DataTable[]): DataTable[] {
  const hits = tables.filter(
    (t) =>
      q.includes(t.name.toLowerCase()) ||
      q.includes(t.fileName.toLowerCase()) ||
      q.includes(t.name.toLowerCase().replace(/\s+/g, '')),
  );
  if (hits.length) return hits;
  if (
    /\b(all|both|across|compare|vs|versus|each file|these files|these|them|uploaded)\b/.test(q) &&
    tables.length > 1
  ) {
    return tables;
  }
  return tables.slice(0, 1);
}

function isAboutQuestion(q: string): boolean {
  return /\b(describe|schema|columns|profile|overview|summary|summarize)\b/.test(q) ||
    /\bwhat\b.*\b(about|in|is|are)\b/.test(q) ||
    /\b(tell me about|what(?:'s| is| are) (?:this|these|the) (?:file|files|data|dataset|sheet|sheets))\b/.test(q) ||
    /\bwhat (?:are|is) (?:these|this|the) files?\b/.test(q);
}

/** Deterministic NL → plan. This is the "delta" layer: AI (optional) only proposes structure; numbers come from the engine. */
export function planFromHeuristics(question: string, tables: DataTable[]): QueryPlan {
  const q = question.toLowerCase().trim();
  const selected = tablesFromQuestion(q, tables);
  const primary = selected[0];

  if (!primary) {
    return {
      intent: 'describe',
      tables: [],
      explanation: 'No tables loaded.',
      source: 'heuristic',
      chart: 'none',
    };
  }

  if (isAboutQuestion(q)) {
    const aboutAll =
      tables.length > 1 &&
      (/\b(these|all|both|uploaded|files)\b/.test(q) || selected.length > 1);
    const targets = aboutAll ? tables : selected;
    return {
      intent: 'describe',
      tables: targets.map((t) => t.name),
      explanation: 'Human-readable overview from file names, sheets, and columns (local).',
      source: 'heuristic',
      chart: 'none',
    };
  }

  if (selected.length >= 2 && /\b(compare|vs|versus|difference|delta|against)\b/.test(q)) {
    const keys = findCommonKeys(selected[0], selected[1]);
    const metric = findColumnMention(q, selected[0], 'number') || pickNumeric(selected[0]);
    if (keys) {
      return {
        intent: 'join_compare',
        tables: selected.map((t) => t.name),
        metrics: metric ? [{ column: metric, op: matchAgg(q) }] : undefined,
        join: {
          leftTable: selected[0].name,
          rightTable: selected[1].name,
          leftKey: keys.left,
          rightKey: keys.right,
        },
        chart: 'bar',
        explanation: `Join-compare on shared key ${keys.left}.`,
        source: 'heuristic',
      };
    }
    return {
      intent: 'compare',
      tables: selected.map((t) => t.name),
      metrics: [{ column: metric || pickNumeric(selected[0]) || '*', op: matchAgg(q) }],
      chart: 'bar',
      explanation: 'Side-by-side aggregates across files (no shared key).',
      source: 'heuristic',
    };
  }

  const byMatch = q.match(/\bby\s+([a-z0-9_ ]+?)(?:\s|$|,|\?)/i);
  const groupHint = byMatch?.[1]?.trim();
  const groupCol =
    (groupHint && (findColumnMention(groupHint, primary, 'string') || findColumnMention(groupHint, primary))) ||
    (/\b(per|by|each|breakdown|group)\b/.test(q) ? pickCategorical(primary) : null);

  // Prefer numeric metrics; aliases like "sales"/"revenue" fall back to first numeric column.
  const mentionedMetric = findColumnMention(q, primary, 'number');
  const metricCol =
    (mentionedMetric && mentionedMetric !== groupCol ? mentionedMetric : null) ||
    (/\b(sales|revenue|amount|salary|units|price|total)\b/.test(q) ? pickNumeric(primary) : null) ||
    pickNumeric(primary) ||
    '*';
  const op = matchAgg(q);

  if (/\b(trend|over time|monthly|daily|timeline)\b/.test(q)) {
    const dateCol = primary.columns.find((c) => c.type === 'date')?.name || pickCategorical(primary);
    return {
      intent: 'trend',
      tables: [primary.name],
      metrics: [{ column: metricCol, op }],
      groupBy: dateCol ? [dateCol] : undefined,
      chart: 'line',
      explanation: 'Trend via group-by on time/category column.',
      source: 'heuristic',
    };
  }

  if (/\b(filter|where|only|show rows|list)\b/.test(q) && !/\b(sum|total|avg|average|count)\b/.test(q)) {
    const cat = pickCategorical(primary);
    const sample = cat ? primary.columns.find((c) => c.name === cat)?.sampleValues[0] : undefined;
    return {
      intent: 'filter',
      tables: [primary.name],
      filters:
        cat && sample
          ? [{ column: cat, op: 'contains', value: String(sample) }]
          : undefined,
      chart: 'none',
      explanation: 'Row filter preview (heuristic sample filter if no explicit value).',
      source: 'heuristic',
    };
  }

  return {
    intent: groupCol ? 'aggregate' : 'aggregate',
    tables: selected.length > 1 ? selected.map((t) => t.name) : [primary.name],
    metrics: [{ column: metricCol, op }],
    groupBy: groupCol ? [groupCol] : undefined,
    chart: groupCol ? 'bar' : selected.length > 1 ? 'bar' : 'bar',
    explanation: groupCol
      ? `Aggregate ${op}(${metricCol}) grouped by ${groupCol}.`
      : `Aggregate ${op}(${metricCol}).`,
    source: 'heuristic',
  };
}

export async function planFromOptionalLlm(
  question: string,
  tables: DataTable[],
  fallback: QueryPlan,
): Promise<QueryPlan> {
  const endpoint = (import.meta.env.VITE_LLM_URL as string | undefined)?.trim();
  const apiKey = (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim();
  const model = (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim() || 'llama-3.1-8b-instant';

  if (!endpoint || !apiKey) return fallback;

  const schema = tables.map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
    rowCount: t.rowCount,
  }));

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You convert analytics questions into a JSON query plan. Reply with JSON only, no markdown. Schema: {intent, tables, metrics:[{column,op}], groupBy, filters:[{column,op,value}], join:{leftTable,rightTable,leftKey,rightKey}, chart, explanation}. ops: sum|avg|count|min|max. Use only columns that exist. Never invent numeric answers.',
          },
          {
            role: 'user',
            content: `Tables: ${JSON.stringify(schema)}\nQuestion: ${question}`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as QueryPlan;
    return {
      ...fallback,
      ...parsed,
      source: 'llm',
      explanation: parsed.explanation || fallback.explanation,
    };
  } catch {
    return fallback;
  }
}

export async function buildPlan(question: string, tables: DataTable[]): Promise<QueryPlan> {
  const heuristic = planFromHeuristics(question, tables);
  return planFromOptionalLlm(question, tables, heuristic);
}
