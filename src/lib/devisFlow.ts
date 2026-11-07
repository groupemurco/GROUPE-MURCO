// Assistant des soumissions: une phrase (ou le courriel du client) → client, devis et prix.
// Partagé par l'éditeur de devis et la page « Soumission IA » (tout créé en un clic).
import { db, takeNextNumber, type Doc, type LineItem, type Settings } from './db';
import {
  blankDevis, contactFromText, parseTarif, tarifNote, devisFromTemplate, devisFromText, devisLineDescription, estimateTotal, isDevisEmpty, priceFromEstimate, templateKeyFor,
  templateKeyForText, withoutContact, type Devis, type DevisContact, type DevisDraft,
} from './devis';
import { syncLeadFromDoc } from './crm';
import { activeTrades } from './orders';
import { tradeOf } from './templates';
import { addDays, money, round2, todayISO } from './utils';

/** La ligne de prix unique d'un devis (le montant sert aux totaux, à la facture et aux rapports). */
export function devisPriceItems(d: Devis, price: number): LineItem[] {
  return [{ code: '', description: devisLineDescription(d), unit: 'forfait', quantity: 1, unitPrice: round2(price) }];
}

/** Modèle dont l'assistant imite le style: le dernier enregistré par l'entrepreneur, sinon celui de son métier. */
export function styleDevis(s: Settings): Devis {
  const own = s.devisTemplates ?? [];
  return own.length ? own[own.length - 1].devis : devisFromTemplate(templateKeyFor(activeTrades(s)));
}

/** « 75 pi lin à 6 $ du pied »: prix = quantité × tarif et la phrase du tarif sous le prix, sans dépendre de l'IA. */
function withTarif(draft: DevisDraft, text: string): DevisDraft {
  const tf = parseTarif(text);
  if (!tf) return draft;
  return { ...draft, price: round2(tf.qty * tf.rate), devis: { ...draft.devis, priceNote: tarifNote(tf) } };
}

/** L'assistant écrit le devis; s'il ne répond pas, on fait le mieux possible sans lui (failed explique pourquoi). */
export async function runDevisAi(text: string, s: Settings, o: { current?: Devis; clientId?: number } = {}): Promise<{ draft: DevisDraft; failed?: string; isMail: boolean }> {
  const t = text.trim();
  const isMail = /@|\n.*\n/.test(t) && t.length > 120;
  try {
    const { aiDevis } = await import('./ai');
    const trades = activeTrades(s).map((k) => tradeOf(k)?.label).filter(Boolean).join(', ');
    const known = o.clientId ? (await db.clients.get(o.clientId))?.name : undefined;
    const prices = (await db.services.orderBy('order').toArray()).map((x) => ({ code: x.code, name: x.name, unit: x.unit, price: x.price, minimum: x.minimum }));
    const draft = await aiDevis({ company: s.companyName, owner: s.ownerName, trades, text: t, style: styleDevis(s), current: o.current, clientKnown: known, prices, model: s.aiModel || undefined });
    return { draft: withTarif(draft, t), isMail };
  } catch (e) {
    // Sans l'assistant: un courriel → au moins les coordonnées; une phrase → chaque morceau devient un point
    const why = `L’assistant n’a pas répondu (${(e instanceof Error ? e.message : String(e)).slice(0, 70)}).`;
    const contact = contactFromText(t, { email: s.email, phone: s.phone });
    const key = templateKeyForText(t);
    const draft: DevisDraft = isMail
      ? { devis: o.current ?? (key ? devisFromTemplate(key) : blankDevis()), client: contact, address: contact.address, fromClient: true }
      : { ...devisFromText(withoutContact(t, contact), o.current ?? (key ? devisFromTemplate(key) : styleDevis(s))), client: contact, address: contact.address };
    return { draft: withTarif(draft, t), failed: why, isMail };
  }
}

const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (x?: string) => (x ?? '').replace(/\D/g, '').slice(-10);

/** Client du texte: retrouvé (courriel, cell, nom) et complété, sinon créé. */
export async function resolveClient(c: DevisContact | undefined, jobAddress?: string): Promise<{ id?: number; who: string }> {
  if (!c || !(c.name || c.email || c.phone)) return { who: '' };
  const all = await db.clients.toArray();
  const found = all.find((x) => c.email && x.email.toLowerCase() === c.email.toLowerCase())
    ?? all.find((x) => c.phone && digits(x.phone).length === 10 && digits(x.phone) === digits(c.phone))
    ?? all.find((x) => c.name && norm(x.name) === norm(c.name));
  if (found) {
    const fill = { email: found.email || c.email || '', phone: found.phone || c.phone || '', address: found.address || c.address || '' };
    if (fill.email !== found.email || fill.phone !== found.phone || fill.address !== found.address) await db.clients.update(found.id!, fill);
    return { id: found.id, who: `Client: ${found.name}.` };
  }
  const name = c.name || c.contact || c.email || `Client ${c.phone}`;
  const id = await db.clients.add({ name, contact: c.contact ?? '', email: c.email ?? '', phone: c.phone ?? '', address: c.address || jobAddress || '', notes: '', createdAt: new Date().toISOString() });
  return { id, who: `Nouveau client ajouté: ${name}.` };
}

/** Le courriel du client est gardé dans sa conversation (une seule fois). */
export async function keepClientMail(clientId: number, text: string) {
  const body = text.trim().slice(0, 8000);
  if (await db.messages.where('clientId').equals(clientId).filter((m) => m.text === body).count()) return;
  await db.messages.add({ clientId, dir: 'in', channel: 'courriel', text: body, at: new Date().toISOString() });
}

/** Prix: celui qui est dit, sinon le calcul de l'assistant avec mes prix (guessed), sinon le prix actuel. */
export function draftPrice(r: DevisDraft, d: { taxIncluded?: boolean; applyTps: boolean; applyTvq: boolean }, s: Pick<Settings, 'tpsRate' | 'tvqRate'>, current = 0): { price: number; guessed: number } {
  const est = r.estimate ? estimateTotal(r.estimate.lines) : 0;
  const guessed = !r.price && est > 0 ? priceFromEstimate(est, { taxIncluded: r.taxIncluded ?? d.taxIncluded, taxed: d.applyTps || d.applyTvq, tpsRate: s.tpsRate, tvqRate: s.tvqRate }) : 0;
  return { price: r.price ?? (guessed || current), guessed };
}

/** « Calfeutrage » à partir de « Soumission de calfeutrage » (description de la job). */
export function jobTitle(d: Devis): string {
  const what = d.heading.replace(/^soumission\s+(de\s+|d[’']|pour\s+)?/i, '').trim();
  return what ? what.charAt(0).toUpperCase() + what.slice(1) : '';
}

/**
 * Tout en un clic: le texte (phrase, dictée ou courriel) → client créé ou retrouvé, soumission rédigée avec son prix,
 * enregistrée et prête à envoyer.
 */
export async function createQuoteFromText(text: string, s: Settings): Promise<{ id: number; message: string; questions: string[]; failed?: string }> {
  const { draft: r, failed, isMail } = await runDevisAi(text, s);
  const client = await resolveClient(r.client, r.address);
  if (!client.id) throw new Error(failed ? `${failed} Je n’ai pas trouvé le nom ni le téléphone du client: ajoute-les dans ta phrase.` : 'Je n’ai pas trouvé le client: ajoute son nom (et son téléphone) dans ta phrase.');
  if (r.fromClient || (failed && isMail)) await keepClientMail(client.id, text);
  const devis = isDevisEmpty(r.devis) && !failed ? styleDevis(s) : r.devis;
  const date = todayISO();
  const now = new Date().toISOString();
  const taxIncluded = r.taxIncluded ?? true;
  const { price, guessed } = draftPrice({ ...r, taxIncluded }, { taxIncluded, applyTps: s.chargeTaxes, applyTvq: s.chargeTaxes }, s);
  const doc: Doc = {
    type: 'quote',
    number: await takeNextNumber('quote'),
    clientId: client.id,
    date,
    dueDate: addDays(date, s.quoteValidityDays),
    jobDate: '',
    jobAddress: r.address || r.client?.address || (await db.clients.get(client.id))?.address || '',
    title: jobTitle(devis),
    items: devisPriceItems(devis, price),
    devis,
    taxIncluded,
    ...(r.estimate ? { estimate: r.estimate } : {}),
    applyTps: s.chargeTaxes,
    applyTvq: s.chargeTaxes,
    notes: s.quoteNotes,
    status: 'draft',
    payments: [],
    createdAt: now,
    updatedAt: now,
  };
  const id = await db.docs.add(doc);
  void syncLeadFromDoc({ ...doc, id });
  const parts = [`Soumission ${doc.number} créée.`, client.who];
  if (guessed) parts.push(`Prix approximatif: ${money(guessed)} (calculé avec tes prix) — change-le si y’a de quoi.`);
  else if (!price) parts.push('Ajoute ton prix avant d’envoyer.');
  return { id, message: parts.filter(Boolean).join(' '), questions: r.questions ?? [], failed };
}
