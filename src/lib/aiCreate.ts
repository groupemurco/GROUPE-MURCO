// Léa crée elle-même (dans sa fenêtre) ce que le patron a confirmé: facture, soumission, job ou visite d'estimation.
import type { AiDoc } from './ai';
import { blankJob } from './agenda';
import { findClients } from './fuzzy';
import { db, getSettings, takeNextNumber, type Doc, type Job, type LineItem, type Service } from './db';
import { isDevisEmpty } from './devis';
import { devisPriceItems, draftPrice, jobTitle, runDevisAi, styleDevis } from './devisFlow';
import { addDays, docTotals, lineAmount, todayISO } from './utils';

/** Lignes de l'IA → lignes de document (le prix de la liste, sauf si un prix a été dit). */
export function aiItems(a: AiDoc, services: Service[], lang: 'fr' | 'en' = 'fr'): LineItem[] {
  return a.lines.map((l) => {
    const sv = l.code ? services.find((x) => x.code.toUpperCase() === l.code) : undefined;
    if (sv) {
      const it: LineItem = { code: sv.code, description: lang === 'en' && sv.nameEn ? sv.nameEn : sv.name, unit: sv.unit, quantity: l.quantity, unitPrice: sv.price, minimum: sv.minimum };
      return l.unitPrice != null ? { ...it, unitPrice: l.unitPrice } : it;
    }
    return { code: '', description: l.description || l.code || 'Travaux', unit: l.unit || undefined, quantity: l.quantity, unitPrice: l.unitPrice ?? 0 };
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
  ask?: string; // la demande du patron (sert à rédiger le devis détaillé)
  detailed?: boolean; // devis détaillé (texte complet des travaux, conditions) au lieu de lignes de prix
  tax?: { applyTps: boolean; applyTvq: boolean; taxIncluded: boolean };
  newJob?: boolean; // planifier une nouvelle job même si le client en a déjà une de planifiée
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

/** La job déjà planifiée de ce client (la prochaine à venir, sans compter les estimations): on s'en sert au lieu d'en créer une autre. */
export async function plannedJobOf(clientId: number): Promise<Job | undefined> {
  const today = todayISO();
  return (await db.jobs.where('clientId').equals(clientId).toArray())
    .filter((j) => j.status === 'planifie' && j.type !== 'estimation' && j.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** « 75 pi lin à 6 $ du pied linéaire » → 75 pieds linéaires à 6 $ (lu directement dans ce que le patron a dit, sans dépendre de l'IA). */
export function parseTarif(text: string): { qty: number; rate: number } | null {
  const n = (x: string) => Number(x.replace(',', '.'));
  const rate = /(\d+(?:[.,]\d+)?)\s*\$?\s*(?:du|le|par|\/|au)\s*(?:pied|pi)\b/i.exec(text);
  const qty = /(\d+(?:[.,]\d+)?)\s*(?:pieds?|pi)\.?\s*(?:lin\w*|lineaires?|linéaires?)/i.exec(text) ?? /(\d+(?:[.,]\d+)?)\s*pieds?\b/i.exec(text);
  if (!rate || !qty) return null;
  const r = n(rate[1]);
  const q = n(qty[1]);
  return r > 0 && q > 0 ? { qty: q, rate: r } : null;
}

const money2 = (x: number) => new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);

export async function createFromAi(i: AiCreateInput): Promise<AiCreated> {
  const st = await getSettings();
  const now = new Date().toISOString();
  let clientId = i.clientId;
  if (!clientId && i.name.trim()) {
    const hit = findClients(i.name, await db.clients.toArray());
    if (hit.length === 1) clientId = hit[0].id;
  }
  if (!clientId) {
    if (!i.name.trim()) throw new Error('Quel est le nom du client?');
    clientId = await db.clients.add({ name: i.name.trim(), contact: '', email: '', phone: i.phone.trim(), address: i.address.trim(), notes: '', createdAt: now });
  }
  let items = i.items.filter((it) => it.description.trim() || it.unitPrice || it.code);
  // Tarif dit par le patron (« 75 pi lin à 6 $ du pied linéaire »): une ligne avec ses chiffres exacts
  const tarif = i.type === 'soumission' || i.type === 'job' ? parseTarif([i.ask, ...i.items.map((it) => it.description)].filter(Boolean).join('. ')) : null;
  if (tarif && items.length <= 1) items = [{ code: '', description: items[0]?.description || 'Calfeutrage', unit: 'pi lin', quantity: tarif.qty, unitPrice: tarif.rate }];
  const work = items.map((it) => it.description).filter(Boolean).join(' + ');
  const title = work || 'Job';
  const tx = i.tax ?? { applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, taxIncluded: false };
  const taxes = { applyTps: tx.applyTps, applyTvq: tx.applyTvq, taxIncluded: tx.taxIncluded, payments: [] as Doc['payments'] };
  let total = docTotals({ items, ...taxes }, st).total;
  const address = i.address.trim();

  // Soumission: en lignes de prix, ou en devis détaillé rédigé par l'assistant (comme dans l'éditeur)
  const makeQuote = async (jobDate: string, jobId?: number, jobTime?: string): Promise<{ id: number; number: string }> => {
    const date = todayISO();
    const number = await takeNextNumber('quote');
    let base: Partial<Doc> = { title, items };
    if (i.detailed) {
      const given = items.reduce((a, it) => a + lineAmount(it), 0);
      const priced = items.filter((it) => it.unitPrice);
      const calc = priced.map((it) => `${it.description}: ${it.quantity}${it.unit ? ' ' + it.unit : ''} à ${it.unitPrice} $${it.unit && it.quantity > 1 ? ' par ' + it.unit : ''}`).join('; ');
      const text = [i.ask, address && `Lieu des travaux: ${address}`, work && `Travaux: ${work}`, calc && `Calcul du prix: ${calc}`, given > 0 && `Prix: ${given} $ ${tx.taxIncluded ? 'taxes incluses' : 'avant taxes'}`].filter(Boolean).join('. ');
      const { draft } = await runDevisAi(text, st, { clientId });
      const devis = isDevisEmpty(draft.devis) ? styleDevis(st) : draft.devis;
      const { price } = draftPrice({ ...draft, price: given > 0 ? given : draft.price }, tx, st);
      // Le tarif dit par le patron (ex.: 75 pi lin à 6 $) s'écrit sous le prix, si l'assistant ne l'a pas fait
      const one = priced.length === 1 && priced[0].quantity > 1 ? priced[0] : undefined;
      const lin = !!one && /^pi\.?\s*lin|pied.*lin/i.test(one.unit ?? '');
      const noteOf = (it: LineItem) => lin ? `Tarif : ${money2(it.unitPrice)} $ par pied linéaire. Base de calcul : ${it.quantity} pieds linéaires.` : `Tarif : ${money2(it.unitPrice)} $${it.unit ? ' par ' + it.unit : ''}. Base de calcul : ${it.quantity}${it.unit ? ' ' + it.unit : ''}.`;
      const note = tarif && one ? noteOf(one) : devis.priceNote.trim() || (one ? noteOf(one) : '');
      const final = { ...devis, priceNote: note };
      base = { title: jobTitle(final) || title, items: devisPriceItems(final, price), devis: final, ...(draft.estimate ? { estimate: draft.estimate } : {}) };
    }
    const doc = { type: 'quote', number, clientId, date, dueDate: addDays(date, st.quoteValidityDays), jobDate, ...(jobTime ? { jobTime } : {}), jobAddress: address, ...base, ...taxes, notes: st.quoteNotes, status: 'draft', ...(jobId ? { jobId } : {}), createdAt: now, updatedAt: now } as Doc;
    const id = await db.docs.add(doc);
    total = docTotals(doc, st).total;
    return { id, number };
  };

  if (i.type === 'facture') {
    const date = todayISO();
    const number = await takeNextNumber('invoice');
    const invoiceId = await db.docs.add({ type: 'invoice', number, clientId, date, dueDate: addDays(date, st.paymentTermsDays), jobDate: date, jobAddress: address, title, items, ...taxes, notes: st.invoiceNotes, status: 'draft', createdAt: now, updatedAt: now });
    return { invoiceId, number, total, summary: `Facture ${number} créée.` };
  }
  if (i.type === 'soumission' && !i.hasDate) {
    const q = await makeQuote('', undefined, i.time); // pas de date de travaux connue: on n'en invente pas
    return { quoteId: q.id, number: q.number, total, summary: `${i.detailed ? 'Devis détaillé' : 'Soumission'} ${q.number} créé${i.detailed ? '' : 'e'}.` };
  }
  const visit = i.type === 'visite';
  const ej = visit || i.newJob ? undefined : await plannedJobOf(clientId);
  if (ej) {
    const patch: Partial<Job> = {};
    if (!ej.items.length && items.length) patch.items = items;
    if (!ej.title && title) patch.title = title;
    if (!ej.address && address) patch.address = address;
    if (i.type === 'job' && i.hasDate) {
      patch.date = i.date;
      if (i.time) patch.time = i.time;
    }
    if (Object.keys(patch).length) await db.jobs.update(ej.id!, patch);
    const date = patch.date ?? ej.date;
    const hasQuote = (await db.docs.where('clientId').equals(clientId).toArray()).some((d) => d.type === 'quote' && d.jobId === ej.id);
    let q: { id: number; number: string } | undefined;
    if (i.type === 'soumission' || (!hasQuote && items.length)) q = await makeQuote(date, ej.id, patch.time ?? ej.time);
    return { jobId: ej.id, quoteId: q?.id, number: q?.number, total, summary: `Job déjà planifiée le ${fmtDate(date, patch.time ?? ej.time)}: ${q ? `${i.detailed ? 'devis détaillé' : 'soumission'} ${q.number} créé${i.detailed ? '' : 'e'} et lié${i.detailed ? '' : 'e'} à cette job` : 'rien de nouveau à créer'}.` };
  }
  const jobId = await db.jobs.add({
    ...blankJob(i.date, clientId), time: i.time, durationMin: visit ? 60 : 120, address,
    title: visit ? `Visite d’estimation${work ? ` — ${work}` : ''}` : title, items: visit ? [] : items, type: visit ? 'estimation' : undefined,
  });
  let quoteId: number | undefined;
  let number: string | undefined;
  if (i.type === 'soumission' || (!visit && items.length)) {
    // une job planifiée garde sa soumission (à envoyer) liée
    const q = await makeQuote(i.date, jobId, i.time);
    quoteId = q.id;
    number = q.number;
  }
  const what = visit ? 'Visite d’estimation planifiée' : 'Job planifiée';
  return { jobId, quoteId, number, total, summary: `${what} ${fmtDate(i.date, i.time)}${number ? `, ${i.detailed ? 'devis détaillé' : 'soumission'} ${number} créé${i.detailed ? '' : 'e'}` : ''}.` };
}
