// Le poste de pilotage de l'accueil: où est l'argent (pipeline), ce que les clients ont fait (fil d'activité)
// et ce que les chiffres disent (constats). Tout est calculé à partir des données déjà dans l'app.
import type { Client, Doc, Job, Lead, Settings } from './db';
import { addDays, docTotals, lineAmount, money } from './utils';

type Tax = Pick<Settings, 'tpsRate' | 'tvqRate'>;
const daysBetween = (from: string, to: string) => Math.round((new Date(to.slice(0, 10) + 'T12:00:00').getTime() - new Date(from.slice(0, 10) + 'T12:00:00').getTime()) / 86400000);
const ago = (n: number) => (n <= 0 ? 'aujourd’hui' : n === 1 ? 'hier' : `il y a ${n} jours`);

// ---------- 1. L'argent en route ----------
export type StageKey = 'estimations' | 'envoyees' | 'planifier' | 'facturer' | 'encaisser';
export interface StageItem { id: string; to: string; title: string; sub: string; amount: number; hot?: boolean }
export interface Stage { key: StageKey; label: string; hint: string; count: number; amount: number; items: StageItem[]; alert?: string }

export function buildPipeline(docs: Doc[], jobs: Job[], clients: Map<number, Client>, s: Tax, today: string): Stage[] {
  const name = (id: number) => clients.get(id)?.name ?? 'Client';
  const total = (d: Doc) => docTotals(d, s);
  const jobAmt = (j: Job) => j.items.reduce((a, it) => a + lineAmount(it), 0);
  const liveJobs = jobs.filter((j) => j.status !== 'annule');
  const jobById = new Map(liveJobs.map((j) => [j.id!, j]));

  const estimations = liveJobs.filter((j) => j.type === 'estimation' && j.status === 'planifie').sort((a, b) => a.date.localeCompare(b.date));
  const sent = docs.filter((d) => d.type === 'quote' && d.status === 'sent' && !d.signature).sort((a, b) => (b.viewedAt ?? '').localeCompare(a.viewedAt ?? '') || b.date.localeCompare(a.date));
  // Acceptée, pas encore facturée, et aucune job planifiée ou faite pour la réaliser
  const toPlan = docs.filter((d) => d.type === 'quote' && (d.status === 'accepted' || !!d.signature) && d.status !== 'refused' && d.status !== 'cancelled' && !d.convertedInvoiceId && !(d.jobId && jobById.has(d.jobId)));
  const invoicedJobs = new Set(docs.filter((d) => d.type === 'invoice' && d.jobId).map((d) => d.jobId!));
  const toBill = liveJobs.filter((j) => j.status === 'fait' && j.type !== 'estimation' && !invoicedJobs.has(j.id!) && !(j.docId && docs.some((d) => d.id === j.docId && d.type === 'invoice'))).sort((a, b) => a.date.localeCompare(b.date));
  const unpaid = docs.filter((d) => d.type === 'invoice' && (d.status === 'sent' || d.status === 'partial') && total(d).balance > 0.004).sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date));
  const late = unpaid.filter((d) => d.dueDate && d.dueDate < today);
  const seen = sent.filter((d) => d.viewedAt).length;

  return [
    {
      key: 'estimations', label: 'Estimations à faire', hint: 'Visites prévues chez le client', count: estimations.length, amount: 0,
      items: estimations.map((j) => ({ id: `j${j.id}`, to: `/job/${j.id}`, title: name(j.clientId), sub: `${j.date}${j.time ? ` à ${j.time}` : ''}${j.address ? ` · ${j.address}` : ''}`, amount: 0 })),
    },
    {
      key: 'envoyees', label: 'Soumissions envoyées', hint: 'En attente de la réponse du client', count: sent.length, amount: sent.reduce((a, d) => a + total(d).total, 0),
      alert: seen ? `${seen} ouverte${seen > 1 ? 's' : ''} par le client` : undefined,
      items: sent.map((d) => ({ id: `d${d.id}`, to: `/doc/${d.id}`, title: `${name(d.clientId)} — ${d.number}`, sub: d.viewedAt ? `Ouverte par le client ${ago(daysBetween(d.viewedAt, today))} · pas encore signée` : `Envoyée ${ago(daysBetween(d.sentAt ?? d.date, today))} · pas encore ouverte`, amount: total(d).total, hot: !!d.viewedAt })),
    },
    {
      key: 'planifier', label: 'Acceptées à planifier', hint: 'Le client a dit oui: il reste à mettre la job à l’agenda', count: toPlan.length, amount: toPlan.reduce((a, d) => a + total(d).total, 0),
      items: toPlan.map((d) => ({ id: `d${d.id}`, to: `/doc/${d.id}`, title: `${name(d.clientId)} — ${d.number}`, sub: d.signature ? `Signée par ${d.signature.name}` : 'Acceptée', amount: total(d).total, hot: true })),
    },
    {
      key: 'facturer', label: 'Jobs à facturer', hint: 'Travaux faits, facture pas encore créée', count: toBill.length, amount: toBill.reduce((a, j) => a + jobAmt(j), 0),
      items: toBill.map((j) => ({ id: `j${j.id}`, to: `/job/${j.id}`, title: name(j.clientId), sub: `${j.title || 'Job'} · faite le ${j.date}`, amount: jobAmt(j), hot: true })),
    },
    {
      key: 'encaisser', label: 'À encaisser', hint: 'Factures envoyées, pas encore payées', count: unpaid.length, amount: unpaid.reduce((a, d) => a + total(d).balance, 0),
      alert: late.length ? `${late.length} en retard` : undefined,
      items: unpaid.map((d) => ({ id: `d${d.id}`, to: `/doc/${d.id}`, title: `${name(d.clientId)} — ${d.number}`, sub: d.dueDate && d.dueDate < today ? `En retard de ${daysBetween(d.dueDate, today)} jour${daysBetween(d.dueDate, today) > 1 ? 's' : ''}` : d.dueDate ? `Échéance le ${d.dueDate}` : 'Payable sur réception', amount: total(d).balance, hot: !!d.dueDate && d.dueDate < today })),
    },
  ];
}

// ---------- 2. Le fil d'activité ----------
export type EventKind = 'signed' | 'viewed' | 'paid' | 'review' | 'lead' | 'sent' | 'done';
export interface Activity { key: string; kind: EventKind; at: string; text: string; to: string; fromClient: boolean }

export function buildActivity(docs: Doc[], jobs: Job[], leads: Lead[], clients: Map<number, Client>, today: string, max = 40): Activity[] {
  const name = (id: number) => clients.get(id)?.name ?? 'Le client';
  const what = (d: Doc) => (d.type === 'quote' ? `la soumission ${d.number}` : `la facture ${d.number}`);
  const since = addDays(today, -60);
  const out: Activity[] = [];
  for (const d of docs) {
    const to = `/doc/${d.id}`;
    if (d.signature?.at) out.push({ key: `s${d.id}`, kind: 'signed', at: d.signature.at, text: `${d.signature.name || name(d.clientId)} a signé ${what(d)}`, to, fromClient: true });
    if (d.viewedAt) out.push({ key: `v${d.id}`, kind: 'viewed', at: d.viewedAt, text: `${name(d.clientId)} a ouvert ${what(d)}`, to, fromClient: true });
    if (d.review?.at) out.push({ key: `r${d.id}`, kind: 'review', at: d.review.at, text: `${name(d.clientId)} a laissé un avis ${'★'.repeat(d.review.stars)}`, to, fromClient: true });
    if (d.sentAt) out.push({ key: `e${d.id}`, kind: 'sent', at: d.sentAt, text: `Tu as envoyé ${what(d)} à ${name(d.clientId)}`, to, fromClient: false });
    (d.payments ?? []).forEach((p, i) => {
      if (!p.date) return;
      out.push({ key: `p${d.id}.${i}`, kind: 'paid', at: `${p.date}T12:00:00`, text: `Paiement de ${money(p.amount)} — ${name(d.clientId)} (${d.number})`, to, fromClient: !!p.ref });
    });
  }
  for (const j of jobs) if (j.doneAt) out.push({ key: `j${j.id}`, kind: 'done', at: j.doneAt, text: `${j.type === 'estimation' ? 'Estimation faite' : 'Job terminée'} chez ${name(j.clientId)}`, to: `/job/${j.id}`, fromClient: false });
  for (const l of leads) if (l.createdAt) out.push({ key: `l${l.id}`, kind: 'lead', at: l.createdAt, text: `Nouvelle demande de ${l.name}${l.service ? ` — ${l.service}` : ''}`, to: '/demandes', fromClient: l.source === 'formulaire' || l.source === 'site' });
  return out.filter((e) => e.at.slice(0, 10) >= since).sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** Jour et heure lisibles: « aujourd'hui 14 h 05 », « hier », « lundi », « 3 nov. ». */
export function whenLabel(at: string, today: string): string {
  const d = at.slice(0, 10);
  const n = daysBetween(d, today);
  const date = new Date(at);
  const hm = at.length > 10 && !at.endsWith('T12:00:00') ? ` ${date.toLocaleTimeString('fr-CA', { hour: 'numeric', minute: '2-digit' })}` : '';
  if (n <= 0) return `aujourd’hui${hm}`;
  if (n === 1) return `hier${hm}`;
  if (n < 7) return date.toLocaleDateString('fr-CA', { weekday: 'long' });
  return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

// ---------- 3. Ce que les chiffres disent ----------
export interface Insight { key: string; tone: 'good' | 'warn' | 'info'; text: string; action?: { label: string; to: string } }

export function buildInsights(docs: Doc[], jobs: Job[], clients: Map<number, Client>, s: Tax, today: string): Insight[] {
  const total = (d: Doc) => docTotals(d, s);
  const out: Insight[] = [];
  const quotes = docs.filter((d) => d.type === 'quote');
  const invoices = docs.filter((d) => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'cancelled');

  // Soumissions ouvertes par le client mais pas signées: l'argent le plus proche
  const warm = quotes.filter((d) => d.status === 'sent' && d.viewedAt && !d.signature);
  if (warm.length) {
    const amt = warm.reduce((a, d) => a + total(d).total, 0);
    const first = warm.sort((a, b) => (b.viewedAt ?? '').localeCompare(a.viewedAt ?? ''))[0];
    out.push({ key: 'warm', tone: 'warn', text: `${warm.length === 1 ? `${clients.get(first.clientId)?.name ?? 'Un client'} a ouvert ta soumission` : `${warm.length} clients ont ouvert leur soumission`} sans la signer: ${money(amt)} à aller chercher. Un appel aujourd’hui fait souvent la différence.`, action: { label: 'Voir', to: `/doc/${first.id}` } });
  }

  // Taux d'acceptation (90 jours)
  const since = addDays(today, -90);
  const decided = quotes.filter((d) => d.date >= since && (d.status === 'accepted' || d.status === 'refused' || !!d.signature || !!d.convertedInvoiceId));
  const won = decided.filter((d) => d.status !== 'refused');
  const sentRecently = quotes.filter((d) => d.date >= since && d.status !== 'draft' && d.status !== 'cancelled');
  if (sentRecently.length >= 3) {
    const rate = Math.round((won.length / sentRecently.length) * 100);
    out.push({ key: 'rate', tone: rate >= 50 ? 'good' : 'info', text: `Depuis 3 mois, ${won.length} soumission${won.length > 1 ? 's' : ''} sur ${sentRecently.length} ${won.length > 1 ? 'ont été acceptées' : 'a été acceptée'} (${rate} %).${rate < 40 ? ' Relancer dans les 2 jours aide beaucoup.' : ''}` });
  }

  // Délai moyen de paiement
  const paid = invoices.filter((d) => d.status === 'paid' && d.payments?.length);
  if (paid.length >= 2) {
    const delays = paid.map((d) => Math.max(0, daysBetween(d.date, d.payments[d.payments.length - 1].date || d.date)));
    const avg = Math.round(delays.reduce((a, n) => a + n, 0) / delays.length);
    out.push({ key: 'delay', tone: avg <= 7 ? 'good' : 'info', text: avg <= 1 ? 'Tes clients te paient le jour même ou le lendemain, en moyenne.' : `Tes clients te paient en ${avg} jours en moyenne.` });
  }

  // Meilleur client de l'année
  const year = today.slice(0, 4);
  const byClient = new Map<number, number>();
  invoices.filter((d) => d.date.startsWith(year)).forEach((d) => byClient.set(d.clientId, (byClient.get(d.clientId) ?? 0) + total(d).subtotal));
  const best = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && byClient.size >= 2 && best[1] > 0) out.push({ key: 'best', tone: 'good', text: `Ton meilleur client de ${year}: ${clients.get(best[0])?.name ?? 'Client'}, avec ${money(best[1])} de travaux.`, action: { label: 'Sa fiche', to: `/clients/${best[0]}` } });

  // Facture moyenne
  const yInv = invoices.filter((d) => d.date.startsWith(year));
  if (yInv.length >= 3) out.push({ key: 'avg', tone: 'info', text: `Ta facture moyenne cette année: ${money(yInv.reduce((a, d) => a + total(d).subtotal, 0) / yInv.length)} avant taxes, sur ${yInv.length} factures.` });

  // Jobs faites qui dorment
  const invoiced = new Set(docs.filter((d) => d.type === 'invoice' && d.jobId).map((d) => d.jobId!));
  const sleeping = jobs.filter((j) => j.status === 'fait' && j.type !== 'estimation' && !invoiced.has(j.id!) && daysBetween(j.date, today) >= 3);
  if (sleeping.length) out.push({ key: 'sleep', tone: 'warn', text: `${sleeping.length} job${sleeping.length > 1 ? 's sont faites' : ' est faite'} depuis plus de 3 jours sans facture. Plus tu factures vite, plus tu es payé vite.`, action: { label: 'Facturer', to: `/job/${sleeping[0].id}` } });

  return out.slice(0, 4);
}
