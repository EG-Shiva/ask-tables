export type ColumnType = 'number' | 'string' | 'date' | 'boolean';

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  nullCount: number;
  uniqueCount: number;
  sampleValues: string[];
  min?: number;
  max?: number;
  mean?: number;
}

export interface DataTable {
  id: string;
  name: string;
  fileName: string;
  rows: Record<string, unknown>[];
  columns: ColumnProfile[];
  rowCount: number;
}

export type AggOp = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface FilterClause {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string | number | boolean;
}

export interface QueryPlan {
  intent: 'aggregate' | 'filter' | 'compare' | 'trend' | 'describe' | 'join_compare';
  tables: string[];
  metrics?: { column: string; op: AggOp }[];
  groupBy?: string[];
  filters?: FilterClause[];
  join?: { leftTable: string; rightTable: string; leftKey: string; rightKey: string };
  chart?: 'bar' | 'line' | 'pie' | 'none';
  explanation: string;
  source: 'heuristic' | 'llm';
}

export interface QueryResult {
  plan: QueryPlan;
  answerText: string;
  tablePreview: Record<string, unknown>[];
  chartData?: { label: string; value: number }[];
  chartType?: 'bar' | 'line' | 'pie';
  warnings: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  result?: QueryResult;
}
