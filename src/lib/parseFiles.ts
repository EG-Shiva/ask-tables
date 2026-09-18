import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ColumnProfile, ColumnType, DataTable } from './types';

function inferType(values: unknown[]): ColumnType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (nonNull.length === 0) return 'string';

  let num = 0;
  let bool = 0;
  let date = 0;

  for (const v of nonNull.slice(0, 50)) {
    const s = String(v).trim();
    if (/^(true|false|yes|no)$/i.test(s)) bool += 1;
    else if (!Number.isNaN(Number(s.replace(/,/g, ''))) && s !== '') num += 1;
    else if (!Number.isNaN(Date.parse(s)) && /\d{4}|\d{1,2}[/-]\d{1,2}/.test(s)) date += 1;
  }

  const n = nonNull.slice(0, 50).length;
  if (num / n > 0.8) return 'number';
  if (bool / n > 0.8) return 'boolean';
  if (date / n > 0.7) return 'date';
  return 'string';
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function profileColumns(rows: Record<string, unknown>[]): ColumnProfile[] {
  if (rows.length === 0) return [];
  const names = Object.keys(rows[0]);

  return names.map((name) => {
    const values = rows.map((r) => r[name]);
    const type = inferType(values);
    const nullCount = values.filter((v) => v === null || v === undefined || String(v).trim() === '').length;
    const unique = new Set(values.map((v) => String(v ?? ''))).size;
    const sampleValues = [...new Set(values.map((v) => String(v ?? '')).filter(Boolean))].slice(0, 5);

    const profile: ColumnProfile = {
      name,
      type,
      nullCount,
      uniqueCount: unique,
      sampleValues,
    };

    if (type === 'number') {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      if (nums.length) {
        profile.min = Math.min(...nums);
        profile.max = Math.max(...nums);
        profile.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    }

    return profile;
  });
}

function normalizeRows(raw: Record<string, unknown>[]): Record<string, unknown>[] {
  return raw.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const key = String(k).trim();
      if (!key) continue;
      if (typeof v === 'string') {
        const t = v.trim();
        out[key] = t === '' ? null : t;
      } else {
        out[key] = v;
      }
    }
    return out;
  });
}

function tableFromRows(fileName: string, sheetName: string, rows: Record<string, unknown>[]): DataTable {
  const cleaned = normalizeRows(rows).filter((r) => Object.values(r).some((v) => v !== null && v !== ''));
  const base = fileName.replace(/\.[^.]+$/, '');
  const isDefaultSheet = !sheetName || sheetName === 'Sheet1' || sheetName === 'main';
  const name = isDefaultSheet ? base : `${base} · ${sheetName}`;
  return {
    id: `${fileName}::${sheetName || 'main'}::${Math.random().toString(36).slice(2, 8)}`,
    name,
    fileName,
    sheetName: sheetName || 'main',
    rows: cleaned,
    columns: profileColumns(cleaned),
    rowCount: cleaned.length,
  };
}

export async function parseUpload(file: File): Promise<DataTable[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'csv' || ext === 'txt') {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    if (parsed.errors.length && !parsed.data.length) {
      throw new Error(parsed.errors[0]?.message || 'Failed to parse CSV');
    }
    return [tableFromRows(file.name, 'main', parsed.data)];
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    return wb.SheetNames.map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      return tableFromRows(file.name, sheetName, rows);
    }).filter((t) => t.rowCount > 0);
  }

  throw new Error(`Unsupported file type: .${ext}. Use CSV or Excel.`);
}
