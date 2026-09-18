import type { AggOp, DataTable, FilterClause, QueryPlan, QueryResult } from './types';

function findTable(tables: DataTable[], nameOrId: string): DataTable | undefined {
  const q = nameOrId.toLowerCase();
  return (
    tables.find((t) => t.id === nameOrId) ||
    tables.find((t) => t.name.toLowerCase() === q) ||
    tables.find((t) => t.fileName.toLowerCase() === q) ||
    tables.find((t) => t.name.toLowerCase().includes(q) || t.fileName.toLowerCase().includes(q))
  );
}

function resolveColumn(table: DataTable, hint: string): string | null {
  const q = hint.toLowerCase().replace(/[_\s]+/g, '');
  const exact = table.columns.find((c) => c.name.toLowerCase() === hint.toLowerCase());
  if (exact) return exact.name;
  const loose = table.columns.find((c) => c.name.toLowerCase().replace(/[_\s]+/g, '') === q);
  if (loose) return loose.name;
  const partial = table.columns.find((c) => c.name.toLowerCase().includes(hint.toLowerCase()));
  return partial?.name || null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function applyFilters(rows: Record<string, unknown>[], filters: FilterClause[] | undefined): Record<string, unknown>[] {
  if (!filters?.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const raw = row[f.column];
      const leftNum = asNumber(raw);
      const rightNum = typeof f.value === 'number' ? f.value : asNumber(f.value);
      const leftStr = String(raw ?? '').toLowerCase();
      const rightStr = String(f.value).toLowerCase();

      switch (f.op) {
        case 'eq':
          return leftNum !== null && rightNum !== null ? leftNum === rightNum : leftStr === rightStr;
        case 'neq':
          return leftNum !== null && rightNum !== null ? leftNum !== rightNum : leftStr !== rightStr;
        case 'gt':
          return leftNum !== null && rightNum !== null && leftNum > rightNum;
        case 'gte':
          return leftNum !== null && rightNum !== null && leftNum >= rightNum;
        case 'lt':
          return leftNum !== null && rightNum !== null && leftNum < rightNum;
        case 'lte':
          return leftNum !== null && rightNum !== null && leftNum <= rightNum;
        case 'contains':
          return leftStr.includes(rightStr);
        default:
          return true;
      }
    }),
  );
}

function aggregate(
  rows: Record<string, unknown>[],
  metrics: { column: string; op: AggOp }[],
  groupBy: string[] | undefined,
): { preview: Record<string, unknown>[]; chartData: { label: string; value: number }[] } {
  if (!groupBy?.length) {
    const preview: Record<string, unknown> = {};
    const chartData: { label: string; value: number }[] = [];
    for (const m of metrics) {
      const vals = rows.map((r) => asNumber(r[m.column])).filter((n): n is number => n !== null);
      let value = 0;
      if (m.op === 'count') value = m.column === '*' ? rows.length : vals.length;
      else if (!vals.length) value = 0;
      else if (m.op === 'sum') value = vals.reduce((a, b) => a + b, 0);
      else if (m.op === 'avg') value = vals.reduce((a, b) => a + b, 0) / vals.length;
      else if (m.op === 'min') value = Math.min(...vals);
      else if (m.op === 'max') value = Math.max(...vals);
      const key = `${m.op}_${m.column}`;
      preview[key] = Number(value.toFixed(4));
      chartData.push({ label: key, value: Number(value.toFixed(4)) });
    }
    return { preview: [preview], chartData };
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = groupBy.map((g) => String(row[g] ?? '')).join(' | ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const preview: Record<string, unknown>[] = [];
  const chartData: { label: string; value: number }[] = [];
  const primary = metrics[0];

  for (const [label, groupRows] of groups) {
    const out: Record<string, unknown> = {};
    groupBy.forEach((g, i) => {
      out[g] = label.split(' | ')[i];
    });
    for (const m of metrics) {
      const vals = groupRows.map((r) => asNumber(r[m.column])).filter((n): n is number => n !== null);
      let value = 0;
      if (m.op === 'count') value = m.column === '*' ? groupRows.length : vals.length;
      else if (!vals.length) value = 0;
      else if (m.op === 'sum') value = vals.reduce((a, b) => a + b, 0);
      else if (m.op === 'avg') value = vals.reduce((a, b) => a + b, 0) / vals.length;
      else if (m.op === 'min') value = Math.min(...vals);
      else if (m.op === 'max') value = Math.max(...vals);
      out[`${m.op}_${m.column}`] = Number(value.toFixed(4));
      if (m === primary) chartData.push({ label, value: Number(value.toFixed(4)) });
    }
    preview.push(out);
  }

  preview.sort((a, b) => {
    const ka = String(a[groupBy[0]] ?? '');
    const kb = String(b[groupBy[0]] ?? '');
    return ka.localeCompare(kb);
  });
  chartData.sort((a, b) => a.label.localeCompare(b.label));
  return { preview, chartData };
}

function describeTable(table: DataTable): QueryResult {
  const lines = [
    `**${table.name}** — ${table.rowCount} rows, ${table.columns.length} columns.`,
    '',
    ...table.columns.map((c) => {
      const stats =
        c.type === 'number' && c.mean !== undefined
          ? ` min=${c.min}, max=${c.max}, mean=${Number(c.mean.toFixed(2))}`
          : ` samples: ${c.sampleValues.join(', ') || '—'}`;
      return `- \`${c.name}\` (${c.type}, ${c.uniqueCount} unique, ${c.nullCount} empty)${stats}`;
    }),
  ];
  return {
    plan: {
      intent: 'describe',
      tables: [table.name],
      explanation: 'Schema + basic stats from local profiler (no LLM numbers).',
      source: 'heuristic',
      chart: 'none',
    },
    answerText: lines.join('\n'),
    tablePreview: table.rows.slice(0, 8),
    warnings: [],
  };
}

function joinCompare(
  left: DataTable,
  right: DataTable,
  leftKey: string,
  rightKey: string,
  metricCol: string | null,
): QueryResult {
  const rightIndex = new Map<string, Record<string, unknown>[]>();
  for (const r of right.rows) {
    const k = String(r[rightKey] ?? '');
    if (!rightIndex.has(k)) rightIndex.set(k, []);
    rightIndex.get(k)!.push(r);
  }

  const preview: Record<string, unknown>[] = [];
  let matched = 0;
  for (const l of left.rows) {
    const k = String(l[leftKey] ?? '');
    const rights = rightIndex.get(k) || [];
    if (rights.length) matched += 1;
    for (const r of rights.length ? rights : [{}]) {
      const row: Record<string, unknown> = {
        [leftKey]: l[leftKey],
        [`${left.name}.${metricCol || 'rows'}`]: metricCol ? l[metricCol] : 1,
        [`${right.name}.${metricCol || 'rows'}`]: metricCol && r[metricCol] !== undefined ? r[metricCol] : rights.length ? 1 : 0,
      };
      if (metricCol) {
        const a = asNumber(l[metricCol]) ?? 0;
        const b = asNumber(r[metricCol]) ?? 0;
        row.delta = Number((a - b).toFixed(4));
      }
      preview.push(row);
    }
  }

  const chartData = preview.slice(0, 30).map((p) => ({
    label: String(p[leftKey] ?? ''),
    value: asNumber(p.delta) ?? 0,
  }));

  return {
    plan: {
      intent: 'join_compare',
      tables: [left.name, right.name],
      join: { leftTable: left.name, rightTable: right.name, leftKey, rightKey },
      explanation: `Inner/outer style compare on ${leftKey} ↔ ${rightKey}. Numbers computed locally.`,
      source: 'heuristic',
      chart: 'bar',
    },
    answerText: `Compared **${left.name}** vs **${right.name}** on \`${leftKey}\`/\`${rightKey}\`.\nMatched keys: **${matched}** of ${left.rowCount} left rows.`,
    tablePreview: preview.slice(0, 50),
    chartData,
    chartType: 'bar',
    warnings: [],
  };
}

export function executePlan(tables: DataTable[], plan: QueryPlan): QueryResult {
  const warnings: string[] = [];
  const selected = plan.tables
    .map((name) => findTable(tables, name))
    .filter((t): t is DataTable => Boolean(t));

  if (!selected.length) {
    return {
      plan,
      answerText: 'Could not resolve which uploaded file(s) to use. Try naming the file in your question.',
      tablePreview: [],
      warnings: ['No matching tables'],
    };
  }

  if (plan.intent === 'describe') {
    return describeTable(selected[0]);
  }

  if (plan.intent === 'join_compare' && plan.join && selected.length >= 2) {
    const left = findTable(tables, plan.join.leftTable) || selected[0];
    const right = findTable(tables, plan.join.rightTable) || selected[1];
    const leftKey = resolveColumn(left, plan.join.leftKey) || plan.join.leftKey;
    const rightKey = resolveColumn(right, plan.join.rightKey) || plan.join.rightKey;
    const metric =
      plan.metrics?.[0]?.column && resolveColumn(left, plan.metrics[0].column)
        ? resolveColumn(left, plan.metrics[0].column)
        : left.columns.find((c) => c.type === 'number')?.name || null;
    return joinCompare(left, right, leftKey, rightKey, metric);
  }

  // Cross-file: run same aggregate on each selected table and compare
  if (plan.intent === 'compare' || (selected.length > 1 && plan.intent === 'aggregate')) {
    const metrics = plan.metrics?.length
      ? plan.metrics
      : [{ column: selected[0].columns.find((c) => c.type === 'number')?.name || '*', op: 'sum' as AggOp }];

    const chartData: { label: string; value: number }[] = [];
    const preview: Record<string, unknown>[] = [];

    for (const table of selected) {
      const resolvedMetrics = metrics.map((m) => ({
        ...m,
        column: m.column === '*' ? '*' : resolveColumn(table, m.column) || m.column,
      }));
      const groupBy = plan.groupBy
        ?.map((g) => resolveColumn(table, g))
        .filter((g): g is string => Boolean(g));
      const filtered = applyFilters(
        table.rows,
        plan.filters?.map((f) => ({ ...f, column: resolveColumn(table, f.column) || f.column })),
      );
      const { preview: p, chartData: c } = aggregate(filtered, resolvedMetrics, groupBy);
      for (const row of p) {
        preview.push({ file: table.name, ...row });
      }
      if (!groupBy?.length && c[0]) {
        chartData.push({ label: table.name, value: c[0].value });
      } else {
        for (const point of c) {
          chartData.push({ label: `${table.name}: ${point.label}`, value: point.value });
        }
      }
    }

    const lines = preview.slice(0, 20).map((r) =>
      Object.entries(r)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    );

    return {
      plan,
      answerText: `Compared across **${selected.map((t) => t.name).join(', ')}** (local execution):\n\n${lines.map((l) => `- ${l}`).join('\n')}`,
      tablePreview: preview.slice(0, 50),
      chartData,
      chartType: plan.chart && plan.chart !== 'none' ? plan.chart : 'bar',
      warnings,
    };
  }

  const table = selected[0];
  const metrics = (plan.metrics?.length
    ? plan.metrics
    : [{ column: table.columns.find((c) => c.type === 'number')?.name || '*', op: 'count' as AggOp }]
  ).map((m) => ({
    ...m,
    column: m.column === '*' ? '*' : resolveColumn(table, m.column) || m.column,
  }));

  for (const m of metrics) {
    if (m.column !== '*' && !table.columns.some((c) => c.name === m.column)) {
      warnings.push(`Column "${m.column}" not found in ${table.name}`);
    }
  }

  const groupBy = plan.groupBy
    ?.map((g) => resolveColumn(table, g))
    .filter((g): g is string => Boolean(g));

  const filters = plan.filters?.map((f) => ({
    ...f,
    column: resolveColumn(table, f.column) || f.column,
  }));

  const filtered = applyFilters(table.rows, filters);
  if (plan.intent === 'filter' && !plan.metrics?.length) {
    return {
      plan,
      answerText: `Found **${filtered.length}** rows in **${table.name}** after filters.`,
      tablePreview: filtered.slice(0, 50),
      warnings,
    };
  }

  const { preview, chartData } = aggregate(filtered, metrics, groupBy);
  const summary = preview
    .slice(0, 15)
    .map((r) =>
      Object.entries(r)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    )
    .join('\n');

  return {
    plan,
    answerText: `Result on **${table.name}** (${filtered.length} rows after filters):\n\n\`\`\`\n${summary}\n\`\`\`\n\n_${plan.explanation}_`,
    tablePreview: preview.slice(0, 50),
    chartData: plan.chart === 'none' ? undefined : chartData.slice(0, 40),
    chartType: plan.chart && plan.chart !== 'none' ? plan.chart : groupBy?.length ? 'bar' : 'bar',
    warnings,
  };
}
