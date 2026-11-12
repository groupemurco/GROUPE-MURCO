import { db, getSettings, saveSettings, type Client, type Doc, type Job, type Lead, type Punch } from './db';
import { addDays, docTotals, money, todayISO } from './utils';

// Liste « À confirmer »: l'app prépare le travail de bureau, tu confirmes d'un toucher.

export type TodoKind = 'rappel' | 'facturer' | 'retard' | 'soumission' | 'demande' | 'punch';

export interface Todo {
  key: string; // identifiant stable (pour « Plus tard »)
  kind: TodoKind;
  title: string;
  sub: string;
  amount?: number;
  job?: Job;
  doc?: Doc;
  lead?: Lead;
  punch?: Punch;
  client?: Client;
}

const days = (from: string, to: string) => Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from.slice(0, 10) + 'T12:00:00').getTime()) / 86400000);
const hhmm = (t: string) => (t ? `${Number(t.slice(0, 2))} h${t.slice(3) !== '00' ? ` ${t.slice(3)}` : ''}` : '');

export async function buildTodos(today = todayISO()): Promise<Todo[]> {
  const s = await getSettings();
  const snooze = s.todoSnooze ?? {};
  const tomorrow = addDays(today, 1);
  const [jobs, docs, clients, leads, punches] = await Promise.all([
    db.jobs.where('date').between(addDays(today, -60), tomorrow, true, true).toArray(),
    db.docs.toArray(),
    db.clients.toArray(),
    db.leads.toArray(),
    db.punches.toArray(),
  ]);
  const cl = new Map(clients.map((c) => [c.id!, c]));
  const name = (id: number) => cl.get(id)?.name ?? 'Client';
  const out: Todo[] = [];

  // 1. Rappels aux clients de demain (ou d'aujourd'hui)
  for (const j of jobs) {
    if (j.status !== 'planifie' || j.remindedAt || (j.date !== tomorrow && j.date !== today)) continue;
    const c = cl.get(j.clientId);
    if (!c?.phone && !c?.email) continue;
    out.push({ key: `rappel:${j.id}`, kind: 'rappel', job: j, client: c, title: `Rappeler à ${c.name} sa job ${j.date === today ? 'd’aujourd’hui' : 'de demain'}${j.time ? ` à ${hhmm(j.time)}` : ''}`, sub: j.title || 'Job' });
  }
  // 2. Jobs faites pas encore facturées
  for (const j of jobs) {
    if (j.status !== 'fait' || j.type === 'estimation' || (j.docId && docs.some((d) => d.id === j.docId))) continue;
    const amt = j.items.reduce((a, it) => a + (it.quantity || 0) * (it.unitPrice || 0), 0);
    out.push({ key: `facturer:${j.id}`, kind: 'facturer', job: j, client: cl.get(j.clientId), amount: amt, title: `Facturer la job de ${name(j.clientId)}`, sub: `${j.title || 'Job'} · faite le ${j.date}${amt ? ` · ${money(amt)}` : ''}` });
  }
  // 3. Factures en retard
  for (const d of docs) {
    if (d.type !== 'invoice' || (d.status !== 'sent' && d.status !== 'partial') || !d.dueDate || d.dueDate >= today) continue;
    const bal = docTotals(d, s).balance;
    if (bal <= 0.004) continue;
    out.push({ key: `retard:${d.id}`, kind: 'retard', doc: d, client: cl.get(d.clientId), amount: bal, title: `Relancer ${name(d.clientId)} — ${money(bal)}`, sub: `Facture ${d.number} · ${days(d.dueDate, today)} jour${days(d.dueDate, today) > 1 ? 's' : ''} de retard` });
  }
  // 4. Soumissions sans réponse depuis 7 jours
  for (const d of docs) {
    if (d.type !== 'quote' || d.status !== 'sent' || d.signature || d.convertedInvoiceId) continue;
    const since = (d.sentAt ?? d.date).slice(0, 10);
    if (d.viewedAt && days(d.viewedAt, today) >= 1 && days(since, today) < 7) {
      out.push({ key: `vue:${d.id}`, kind: 'soumission', doc: d, client: cl.get(d.clientId), amount: docTotals(d, s).total, title: `${name(d.clientId)} a ouvert ta soumission: relance-le`, sub: `${d.number} · ${money(docTotals(d, s).total)} · ouverte ${days(d.viewedAt, today) === 1 ? 'hier' : `il y a ${days(d.viewedAt, today)} jours`}, pas encore signée` });
      continue;
    }
    if (days(since, today) < 7) continue;
    out.push({ key: `soumission:${d.id}`, kind: 'soumission', doc: d, client: cl.get(d.clientId), amount: docTotals(d, s).total, title: `Relancer la soumission de ${name(d.clientId)}`, sub: `${d.number} · ${money(docTotals(d, s).total)} · envoyée il y a ${days(since, today)} jours${d.viewedAt ? ' · vue par le client' : ''}` });
  }
  // 5. Nouvelles demandes à rappeler
  for (const l of leads) {
    if (l.stage !== 'nouveau') continue;
    out.push({ key: `demande:${l.id}`, kind: 'demande', lead: l, title: `Rappeler ${l.name}`, sub: `${l.service || 'Nouvelle demande'}${l.phone ? ` · ${l.phone}` : ''}` });
  }
  // 6. Punch resté ouvert
  const now = Date.now();
  for (const p of punches) {
    if (p.end || now - new Date(p.start).getTime() < 12 * 3600000) continue;
    out.push({ key: `punch:${p.id}`, kind: 'punch', punch: p, title: `Vérifier le punch de ${p.name.split(' ')[0]}`, sub: `Encore pointé depuis le ${new Date(p.start).toLocaleString('fr-CA', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });
  }

  const order: TodoKind[] = ['retard', 'facturer', 'rappel', 'demande', 'soumission', 'punch'];
  return out.filter((t) => !(snooze[t.key] && snooze[t.key] > today)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** « Plus tard »: l'élément revient dans N jours (synchronisé sur tous les appareils). */
export async function snoozeTodo(key: string, nDays = 1): Promise<void> {
  const s = await getSettings();
  const today = todayISO();
  const next = Object.fromEntries(Object.entries(s.todoSnooze ?? {}).filter(([, until]) => until > today));
  next[key] = addDays(today, nDays);
  await saveSettings({ todoSnooze: next });
}
