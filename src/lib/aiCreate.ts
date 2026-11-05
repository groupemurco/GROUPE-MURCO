// Léa crée elle-même (dans sa fenêtre) ce que le patron a confirmé: facture, soumission, job ou visite d'estimation.
import type { AiDoc } from './ai';
import { blankJob } from './agenda';
import { db, getSettings, takeNextNumber, type Doc, type LineItem, type Service } from './db';
import { addDays, docTotals, todayISO } from './utils';

/** Lignes de l'IA → lignes de document (le prix de la liste, sauf si un prix a été dit). */
export function aiItems(a: AiDoc, services: Service[], lang: 'fr' | 'en' = 'fr'): LineItem[] {
  return a.lines.map((l) => {
    const sv = l.code ? services.find((x) => x.code.toUpperCase() === l.code) : undefined;
    if (sv) {
      const it: LineItem = { code: sv.code, description: lang === 'en' && sv.nameEn ? sv.nameEn : sv.name, unit: sv.unit, quantity: l.quantity, unitPrice: sv.price, minimum: sv.minimum };
      return l.unitPrice != null ? { ...it, unitPrice: l.unitPrice } : it;
    }
    return { code: '', description: l.description || l.code || 'Travaux', quantity: l.quantity, unitPrice: l.unitPrice ?? 0 };
  });
}

export interface AiCreateInput {
  type: AiDoc['type'];
  clientId?: number;
  name: string;
  phone: string;
  address: string;
  date: string;
  time: string;
  hasDate: boolean;
  items: LineItem[];
}
export interface AiCreated {
  jobId?: number;
  quoteId?: number;
  invoiceId?: number;
  number?: string;
  total: number;
  summary: string;
}

const fmtDate = (d: string, t: string) => `${new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}${t ? ` à ${Number(t.slice(0, 2))} h${t.slice(3) !== '00' ? ` ${t.slice(3)}` : ''}` : ''}`;

export async function createFromAi(i: AiCreateInput): Promise<AiCreated> {
  const st = await getSettings();
  const now = new Date().toISOString();
  let clientId = i.clientId;
  if (!clientId) {
    if (!i.name.trim()) throw new Error('Quel est le nom du client?');
    clientId = await db.clients.add({ name: i.name.trim(), contact: '', email: '', phone: i.phone.trim(), address: i.address.trim(), notes: '', createdAt: now });
  }
  const items = i.items.filter((it) => it.description.trim() || it.unitPrice || it.code);
  const work = items.map((it) => it.description).filter(Boolean).join(' + ');
  const title = work || 'Job';
  const taxes = { applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, payments: [] as Doc['payments'] };
  const total = docTotals({ items, ...taxes }, st).total;
  const address = i.address.trim();

  if (i.type === 'facture') {
    const date = todayISO();
    const number = await takeNextNumber('invoice');
    const invoiceId = await db.docs.add({ type: 'invoice', number, clientId, date, dueDate: addDays(date, st.paymentTermsDays), jobDate: date, jobAddress: address, title, items, ...taxes, notes: st.invoiceNotes, status: 'draft', createdAt: now, updatedAt: now });
    return { invoiceId, number, total, summary: `Facture ${number} créée.` };
  }
  if (i.type === 'soumission' && !i.hasDate) {
    const date = todayISO();
    const number = await takeNextNumber('quote');
    const quoteId = await db.docs.add({ type: 'quote', number, clientId, date, dueDate: addDays(date, st.quoteValidityDays), jobDate: date, jobAddress: address, title, items, ...taxes, notes: st.quoteNotes, status: 'draft', createdAt: now, updatedAt: now });
    return { quoteId, number, total, summary: `Soumission ${number} créée.` };
  }
  const visit = i.type === 'visite';
  const jobId = await db.jobs.add({
    ...blankJob(i.date, clientId), time: i.time, durationMin: visit ? 60 : 120, address,
    title: visit ? `Visite d’estimation${work ? ` — ${work}` : ''}` : title, items: visit ? [] : items, type: visit ? 'estimation' : undefined,
  });
  let quoteId: number | undefined;
  let number: string | undefined;
  if (i.type === 'soumission') {
    const date = todayISO();
    number = await takeNextNumber('quote');
    quoteId = await db.docs.add({ type: 'quote', number, clientId, date, dueDate: addDays(date, st.quoteValidityDays), jobDate: i.date, jobAddress: address, title, items, ...taxes, notes: st.quoteNotes, status: 'draft', jobId, createdAt: now, updatedAt: now });
  } else if (!visit && items.length) {
    // job planifiée seule: la soumission qui va avec reste à envoyer
    number = await takeNextNumber('quote');
    quoteId = await db.docs.add({ type: 'quote', number, clientId, date: todayISO(), dueDate: addDays(todayISO(), st.quoteValidityDays), jobDate: i.date, jobAddress: address, title, items, ...taxes, notes: st.quoteNotes, status: 'draft', jobId, createdAt: now, updatedAt: now });
  }
  const what = visit ? 'Visite d’estimation planifiée' : 'Job planifiée';
  return { jobId, quoteId, number, total, summary: `${what} ${fmtDate(i.date, i.time)}${number ? `, soumission ${number} créée` : ''}.` };
}
