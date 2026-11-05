// Importe une liste de dépenses (ex.: l'essence d'un relevé de carte) dans « Reçus et dépenses », avec l'endroit où elles ont été faites.
import { db, getSettings, EXPENSE_CATEGORIES } from './db';
import { geocode } from './geo';
import { splitTaxes } from './receipt';

export interface ImportRow {
  date: string; // YYYY-MM-DD
  vendor: string;
  category?: string;
  total: number;
  place?: string; // ville / lieu tel qu'inscrit au relevé
  note?: string;
}

export interface ImportReport { added: number; skipped: number; located: number; total: number }

export function parseImportFile(text: string): ImportRow[] {
  const j = JSON.parse(text) as { expenses?: ImportRow[] } | ImportRow[];
  const list = Array.isArray(j) ? j : j.expenses ?? [];
  return list.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(Number(r.total)) && Number(r.total) > 0 && String(r.vendor ?? '').trim());
}

/** Ajoute les dépenses qui n'y sont pas déjà (même date, même montant, même commerce), puis cherche l'adresse de chaque commerce. */
export async function importExpenses(rows: ImportRow[], progress?: (done: number, of: number) => void): Promise<ImportReport> {
  const st = await getSettings();
  const existing = await db.expenses.toArray();
  const seen = new Set(existing.map((e) => `${e.date}|${e.total.toFixed(2)}|${e.vendor.trim().toLowerCase()}`));
  const rep: ImportReport = { added: 0, skipped: 0, located: 0, total: rows.length };
  let n = 0;
  for (const r of rows) {
    n++;
    progress?.(n, rows.length);
    const vendor = r.vendor.trim();
    const total = Math.round(Number(r.total) * 100) / 100;
    const key = `${r.date}|${total.toFixed(2)}|${vendor.toLowerCase()}`;
    if (seen.has(key)) {
      rep.skipped++;
      continue;
    }
    seen.add(key);
    const category = r.category && (EXPENSE_CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'Autre';
    let geo: { lat: number; lon: number } | undefined;
    let label = [vendor, r.place].filter(Boolean).join(', ');
    if (r.place) {
      const g = await geocode(`${vendor} ${r.place}`).catch(() => null);
      if (g) {
        geo = g.geo;
        label = g.label;
        rep.located++;
      }
    }
    await db.expenses.add({
      date: r.date, vendor, category, ...splitTaxes(total, st.tpsRate, st.tvqRate), total, paymentMethod: 'Carte',
      notes: r.note ?? 'Importé du relevé de carte — reçu à ajouter', locationLabel: label, geo, geoSource: geo ? 'adresse' : undefined,
      createdAt: new Date().toISOString(),
    });
    rep.added++;
  }
  return rep;
}
