import { parseUpload } from './parseFiles';
import type { DataTable } from './types';

const DEMO_FILES = ['sales_q1.csv', 'sales_q2.csv', 'employees.csv'] as const;

/** One-click demo datasets shipped with the app. */
export async function loadDemoTables(): Promise<DataTable[]> {
  const out: DataTable[] = [];
  for (const name of DEMO_FILES) {
    const res = await fetch(`/sample-data/${name}`);
    if (!res.ok) throw new Error(`Could not load sample ${name}`);
    const blob = await res.blob();
    const file = new File([blob], name, { type: 'text/csv' });
    out.push(...(await parseUpload(file)));
  }
  return out;
}
