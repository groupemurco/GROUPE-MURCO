import type { Doc, DocStatus, LineItem, Settings } from './db';
import { splitIncludedTaxes } from './devis';
import { saveFile } from './native';

export const money = (n: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(Number.isFinite(n) ? n : 0);

export const km = (n: number) =>
  `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 }).format(Number.isFinite(n) ? n : 0)} km`;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function todayISO(): string {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface Totals {
  lines: number; // somme des lignes
  discount: number;
  subtotal: number; // après rabais, avant taxes
  tps: number;
  tvq: number;
  total: number;
  deposit: number;
  paid: number; // dépôt + paiements
  balance: number;
}

/** Montant d'une ligne: quantité × prix, avec le minimum par ligne s'il y en a un. */
export function lineAmount(it: Pick<LineItem, 'quantity' | 'unitPrice' | 'minimum'>): number {
  const q = Number(it.quantity) || 0;
  const raw = q * (Number(it.unitPrice) || 0);
  if (q > 0 && it.minimum && raw < it.minimum) return round2(it.minimum);
  return round2(raw);
}

export function lineHitsMinimum(it: Pick<LineItem, 'quantity' | 'unitPrice' | 'minimum'>): boolean {
  const q = Number(it.quantity) || 0;
  return q > 0 && !!it.minimum && q * (Number(it.unitPrice) || 0) < it.minimum;
}

export function docTotals(
  doc: Pick<Doc, 'items' | 'applyTps' | 'applyTvq' | 'payments' | 'discount' | 'deposit' | 'taxIncluded'>,
  s: Pick<Settings, 'tpsRate' | 'tvqRate'>,
): Totals {
  const lines = round2(doc.items.reduce((sum, it) => sum + lineAmount(it), 0));
  const discount = round2(Math.min(Number(doc.discount) || 0, lines));
  // Prix « taxes incluses »: le total reste le prix, on en extrait les taxes
  const inc = doc.taxIncluded ? splitIncludedTaxes(round2(lines - discount), s.tpsRate, s.tvqRate, doc.applyTps, doc.applyTvq) : null;
  const subtotal = inc ? inc.subtotal : round2(lines - discount);
  const tps = inc ? inc.tps : doc.applyTps ? round2((subtotal * s.tpsRate) / 100) : 0;
  const tvq = inc ? inc.tvq : doc.applyTvq ? round2((subtotal * s.tvqRate) / 100) : 0;
  const total = round2(subtotal + tps + tvq);
  const deposit = round2(Number(doc.deposit) || 0);
  const paid = round2(deposit + (doc.payments ?? []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  return { lines, discount, subtotal, tps, tvq, total, deposit, paid, balance: round2(total - paid) };
}

export const STATUS_LABELS: Record<DocStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyée',
  paid: 'Payée',
  partial: 'Paiement partiel',
  accepted: 'Acceptée',
  refused: 'Refusée',
  cancelled: 'Annulée',
};

export function statusLabel(doc: Doc): string {
  if (doc.type === 'invoice' && doc.status === 'sent' && doc.dueDate && doc.dueDate < todayISO()) return 'En retard';
  return STATUS_LABELS[doc.status];
}

export function statusClass(doc: Doc): string {
  if (doc.type === 'invoice' && doc.status === 'sent' && doc.dueDate && doc.dueDate < todayISO()) return 'badge red';
  switch (doc.status) {
    case 'paid':
    case 'accepted':
      return 'badge green';
    case 'sent':
    case 'partial':
      return 'badge blue';
    case 'refused':
    case 'cancelled':
      return 'badge gray';
    default:
      return 'badge amber';
  }
}

/** Site web à afficher: jamais un courriel (erreur fréquente dans le champ « Site web ») ni le courriel en double. */
export function websiteOf(s: Pick<Settings, 'website' | 'email'>): string {
  const w = (s.website ?? '').trim();
  return !w || w.includes('@') || w.toLowerCase() === (s.email ?? '').trim().toLowerCase() ? '' : w;
}

export function companyAddressLines(s: Settings): string[] {
  const lines: string[] = [];
  if (s.address) lines.push(s.address);
  const cityLine = [s.city, s.province, s.postalCode].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  return lines;
}

export function fileToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return fileToDataURL(blob).then((d) => d.slice(d.indexOf(',') + 1));
}

/** Télécharge (navigateur) ou enregistre/partage (app mobile) un fichier. */
export function downloadBlob(blob: Blob, filename: string) {
  void saveFile(blob, filename);
}

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: unknown[][]): string {
  // BOM pour qu'Excel lise correctement les accents
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function safeFileName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_. ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

/** Taux ARC: 1er 5000 km au taux 1, le reste au taux 2. */
export function kmAllowance(totalKm: number, s: Pick<Settings, 'kmRateFirst5000' | 'kmRateAfter5000'>): number {
  const first = Math.min(totalKm, 5000);
  const rest = Math.max(0, totalKm - 5000);
  return round2(first * s.kmRateFirst5000 + rest * s.kmRateAfter5000);
}

/** Origine de la distance d'un déplacement. */
export const METHOD_LABEL: Record<string, string> = {
  google: 'Distance Google Maps',
  route: 'Distance routière (OpenStreetMap)',
  manuel: 'Km entrés manuellement',
  estimation: 'Estimation (service de routes indisponible)',
};
