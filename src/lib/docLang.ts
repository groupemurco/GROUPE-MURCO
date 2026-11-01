import type { Client, Doc, Settings } from './db';

// Langue des documents envoyés au client (facture, soumission, lien client, courriels, textos).
export type DocLang = 'fr' | 'en';

export const docLangOf = (doc: Pick<Doc, 'lang'> | undefined, client?: Pick<Client, 'lang'>): DocLang => doc?.lang ?? client?.lang ?? 'fr';

export const D = {
  fr: {
    invoice: 'FACTURE', quote: 'SOUMISSION', invoiceWord: 'Facture', quoteWord: 'Soumission',
    invoiceNo: 'No de facture', quoteNo: 'No de soumission', date: 'Date', due: 'Échéance', validUntil: 'Valide jusqu’au', onReceipt: 'Sur réception',
    jobDate: 'Date des travaux', billTo: 'FACTURÉ À', preparedFor: 'PRÉPARÉ POUR', jobSite: 'LIEU DES TRAVAUX',
    cols: ['Code', 'Description', 'Qté', 'Unité', 'Prix / unité', 'Montant'], minimum: 'minimum',
    subtotal: 'Sous-total', discount: 'Rabais', afterDiscount: 'Après rabais', total: 'TOTAL', deposit: 'Dépôt reçu', payments: 'Paiements reçus',
    balanceDue: 'SOLDE À PAYER', balance: 'SOLDE', gst: 'TPS', qst: 'TVQ', paymentMethods: 'Modes de paiement',
    acceptedBy: 'Acceptée en ligne par', clientSignature: 'Signature du client (acceptation)', photos: 'Photos des travaux',
    rbq: 'Licence RBQ', page: 'Page',
    taxesIncluded: 'taxes incluses', plusTaxes: 'plus taxes', totalTaxIncl: 'TOTAL (taxes incluses)', gstIncl: 'TPS incluse', qstIncl: 'TVQ incluse',
    kinds: { avant: 'Avant', apres: 'Après', job: 'Travaux', paiement: 'Paiement', autre: 'Autre' } as Record<string, string>,
  },
  en: {
    invoice: 'INVOICE', quote: 'QUOTE', invoiceWord: 'Invoice', quoteWord: 'Quote',
    invoiceNo: 'Invoice no.', quoteNo: 'Quote no.', date: 'Date', due: 'Due date', validUntil: 'Valid until', onReceipt: 'Upon receipt',
    jobDate: 'Work date', billTo: 'BILL TO', preparedFor: 'PREPARED FOR', jobSite: 'JOB SITE',
    cols: ['Code', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount'], minimum: 'minimum',
    subtotal: 'Subtotal', discount: 'Discount', afterDiscount: 'After discount', total: 'TOTAL', deposit: 'Deposit received', payments: 'Payments received',
    balanceDue: 'BALANCE DUE', balance: 'BALANCE', gst: 'GST', qst: 'QST', paymentMethods: 'Payment methods',
    acceptedBy: 'Accepted online by', clientSignature: 'Client signature (acceptance)', photos: 'Job photos',
    rbq: 'RBQ licence', page: 'Page',
    taxesIncluded: 'taxes included', plusTaxes: 'plus taxes', totalTaxIncl: 'TOTAL (taxes included)', gstIncl: 'GST included', qstIncl: 'QST included',
    kinds: { avant: 'Before', apres: 'After', job: 'Work', paiement: 'Payment', autre: 'Other' } as Record<string, string>,
  },
};

const UNITS_EN: Record<string, string> = {
  'pi lin': 'lin. ft', 'pi²': 'sq. ft', 'pi2': 'sq. ft', fenêtre: 'window', heure: 'hour', forfait: 'flat rate', sac: 'bag', porte: 'door',
  passage: 'visit', 'verge³': 'cu. yd', gallon: 'gallon', unité: 'unit', jour: 'day', 'm²': 'sq. m', mètre: 'metre',
};
export const unitFor = (u: string | undefined, l: DocLang) => (l === 'en' ? UNITS_EN[(u ?? '').trim()] ?? u ?? '' : u ?? '');

export const moneyFor = (n: number, l: DocLang) =>
  new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD' }).format(Number.isFinite(n) ? n : 0);

export function dateFor(iso: string, l: DocLang): string {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString(l === 'en' ? 'en-CA' : 'fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Textes de l'entreprise dans la langue du document (versions anglaises facultatives dans les paramètres). */
export function companyTexts(s: Settings, l: DocLang) {
  if (l === 'fr') return { invoiceNotes: s.invoiceNotes, quoteNotes: s.quoteNotes, paymentInstructions: s.paymentInstructions, invoiceConditions: s.invoiceConditions };
  return {
    invoiceNotes: s.invoiceNotesEn || 'Thank you for your business!',
    quoteNotes: s.quoteNotesEn || `This quote is valid ${s.quoteValidityDays} days. Work will begin upon your acceptance.`,
    paymentInstructions: s.paymentInstructionsEn || (s.email ? `Interac e-Transfer to ${s.email}, cash or cheque.` : 'Interac e-Transfer, cash or cheque.'),
    invoiceConditions: s.invoiceConditionsEn || 'Payment due by the date shown.',
  };
}
