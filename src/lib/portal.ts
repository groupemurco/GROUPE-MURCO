import { companyTexts, docLangOf } from './docLang';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection, connectFirestoreEmulator, doc, getDoc, initializeFirestore, onSnapshot, query, setDoc, updateDoc, where, type Firestore,
} from 'firebase/firestore';
import { db, getSettings, type Doc, type LineItem, type Review, type Signature } from './db';
import type { Devis } from './devis';
import { configFromLink, getFirebaseConfig, onSyncAttach, onSyncedPut, syncContext, type FirebaseConfig } from './sync';
import { companyAddressLines, docTotals, type Totals } from './utils';
import { publicBase } from './native';

/*
 * Portail client: le client ouvre un lien (sans compte) pour voir sa soumission ou sa facture,
 * accepter la soumission avec sa signature, et voir comment payer.
 * Les données publiées sont une copie (users/… reste privé). Voir firestore.rules.
 */

export interface PortalData {
  owner: string;
  token: string;
  company: {
    name: string;
    legalName: string;
    owner: string;
    lines: string[];
    phone: string;
    email: string;
    logo?: string;
    color?: string; // couleur de l'entreprise
    paymentInstructions: string;
    conditions: string;
    tpsRate: number;
    tvqRate: number;
    tpsNumber: string;
    tvqNumber: string;
    chargeTaxes: boolean;
    cardPayments?: boolean;
    payEndpoint?: string;
    reviewUrl?: string;
    website?: string; // signature du devis
    tagline?: string;
  };
  client: { name: string; address: string };
  lang?: 'fr' | 'en'; // langue de la page client
  doc: {
    kind: 'invoice' | 'quote';
    number: string;
    date: string;
    dueDate: string;
    jobDate: string;
    title: string;
    jobAddress: string;
    items: LineItem[];
    devis?: Devis | null; // soumission rédigée (devis détaillé)
    applyTps: boolean;
    applyTvq: boolean;
    taxIncluded?: boolean;
    discount: number;
    deposit: number;
    notes: string;
    status: Doc['status'];
    totals: Totals;
  };
  signature?: Signature | null;
  viewedAt?: string | null;
  cardPayments?: { id: string; amount: number; at: string; method: string }[];
  review?: Review | null;
  updatedAt: string;
}

function newToken(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function buildPortalData(d: Doc, token: string, owner: string): Promise<Omit<PortalData, 'signature' | 'viewedAt'>> {
  const s = await getSettings();
  const c = await db.clients.get(d.clientId);
  return {
    owner,
    token,
    company: {
      name: s.companyName,
      legalName: s.legalName,
      owner: s.ownerName,
      lines: companyAddressLines(s),
      phone: s.phone,
      email: s.email,
      logo: s.logo && s.logo.length < 300_000 ? s.logo : undefined,
      color: s.brandColor,
      paymentInstructions: companyTexts(s, docLangOf(d, c)).paymentInstructions,
      conditions: companyTexts(s, docLangOf(d, c)).invoiceConditions,
      tpsRate: s.tpsRate,
      tvqRate: s.tvqRate,
      tpsNumber: s.tpsNumber,
      tvqNumber: s.tvqNumber,
      chargeTaxes: s.chargeTaxes,
      cardPayments: s.cardPayments && !!s.paymentsEndpoint,
      payEndpoint: s.cardPayments ? s.paymentsEndpoint.replace(/\/+$/, '') : '',
      reviewUrl: s.googleReviewUrl || '',
      website: s.website || '',
      tagline: s.tagline ?? '',
    },
    client: { name: c?.name ?? '', address: c?.address ?? '' },
    lang: docLangOf(d, c),
    doc: {
      kind: d.type,
      number: d.number,
      date: d.date,
      dueDate: d.dueDate,
      jobDate: d.jobDate,
      title: d.title,
      jobAddress: d.jobAddress,
      items: d.items.map(({ calc: _calc, ...it }) => it),
      devis: d.devis ?? null,
      applyTps: d.applyTps,
      applyTvq: d.applyTvq,
      taxIncluded: !!d.taxIncluded,
      discount: d.discount ?? 0,
      deposit: d.deposit ?? 0,
      notes: d.notes,
      status: d.status,
      totals: docTotals(d, s),
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Publie (ou met à jour) la page client et retourne le lien à envoyer. */
export async function publishPortal(docId: number): Promise<string> {
  const ctx = syncContext();
  if (!ctx) throw new Error('Le lien client utilise la synchronisation: connecte-toi dans Paramètres → Synchronisation.');
  const d = await db.docs.get(docId);
  if (!d) throw new Error('Document introuvable');
  const token = d.portalToken || newToken();
  await setDoc(doc(ctx.fs, 'portal', token), await buildPortalData(d, token, ctx.uid), { merge: true });
  if (!d.portalToken) await db.docs.update(docId, { portalToken: token });
  return portalLink(token);
}

export function portalLink(token: string): string {
  const base = `${publicBase()}#/p/${token}`;
  const built = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  if (built) return base;
  const cfg = getFirebaseConfig();
  if (!cfg) return base;
  const { apiKey, authDomain, projectId, appId, emulator } = cfg;
  const b64 = btoa(JSON.stringify({ apiKey, authDomain, projectId, appId, emulator })).replace(/=+$/, '');
  return `${base}?c=${encodeURIComponent(b64)}`;
}

// Côté propriétaire: republie quand le document change, et reçoit les signatures.
onSyncedPut((table, v) => {
  if (table !== 'docs' || !v.portalToken) return;
  const ctx = syncContext();
  if (!ctx) return;
  void buildPortalData(v as unknown as Doc, v.portalToken as string, ctx.uid).then((data) => setDoc(doc(ctx.fs, 'portal', v.portalToken as string), data, { merge: true })).catch(() => undefined);
});

onSyncAttach(() => {
  const ctx = syncContext();
  if (!ctx) return;
  return onSnapshot(query(collection(ctx.fs, 'portal'), where('owner', '==', ctx.uid)), async (snap) => {
    for (const ch of snap.docChanges()) {
      const p = ch.doc.data() as PortalData;
      const local = (await db.docs.filter((d) => d.portalToken === p.token).toArray())[0];
      if (!local?.id) continue;
      const patch: Partial<Doc> = {};
      if (p.viewedAt && p.viewedAt !== local.viewedAt) patch.viewedAt = p.viewedAt;
      if (p.review && !local.review) patch.review = p.review;
      if (p.signature && !local.signature) {
        patch.signature = p.signature;
        if (local.type === 'quote' && (local.status === 'draft' || local.status === 'sent')) patch.status = 'accepted';
      }
      // Paiements par carte reçus par Stripe → ajoutés à la facture (une seule fois)
      const fresh = (p.cardPayments ?? []).filter((cp) => !local.payments.some((x) => x.ref === cp.id));
      if (fresh.length) {
        const s = await getSettings();
        const payments = [...local.payments, ...fresh.map((cp) => ({ date: cp.at.slice(0, 10), amount: cp.amount, method: 'Carte de crédit (en ligne)', ref: cp.id, note: 'Payé en ligne par le client (Stripe)' }))];
        const t = docTotals({ ...local, payments }, s);
        patch.payments = payments;
        patch.status = t.balance <= 0.004 ? 'paid' : 'partial';
      }
      if (Object.keys(patch).length) {
        await db.docs.update(local.id, patch);
        if (patch.signature) void import('./crm').then((m) => m.syncLeadFromDoc({ ...local, ...patch } as Doc));
      }
    }
  });
});

// ---------- Côté client (page publique, sans compte) ----------
let viewApp: FirebaseApp | null = null;
let viewFs: Firestore | null = null;

export function portalFs(cfgParam: string | null): Firestore {
  if (viewFs) return viewFs;
  const cfg: FirebaseConfig | null = (cfgParam ? configFromLinkLoose(cfgParam) : null) ?? getFirebaseConfig();
  if (!cfg) throw new Error('Lien incomplet. Demande un nouveau lien à l’entreprise.');
  viewApp = initializeApp(cfg, 'murco-portal');
  viewFs = initializeFirestore(viewApp, { ignoreUndefinedProperties: true });
  if (cfg.emulator) connectFirestoreEmulator(viewFs, '127.0.0.1', 8080);
  return viewFs;
}

function configFromLinkLoose(p: string): FirebaseConfig | null {
  try {
    const j = JSON.parse(atob(decodeURIComponent(p)));
    if (j.apiKey && j.projectId) return { authDomain: `${j.projectId}.firebaseapp.com`, ...j };
  } catch {
    /* ancien format */
  }
  return configFromLink(p);
}

export async function loadPortal(token: string, cfgParam: string | null): Promise<PortalData | null> {
  const fs = portalFs(cfgParam);
  const snap = await getDoc(doc(fs, 'portal', token));
  if (!snap.exists()) return null;
  const data = snap.data() as PortalData;
  if (!data.viewedAt) {
    try {
      await updateDoc(doc(fs, 'portal', token), { viewedAt: new Date().toISOString() });
    } catch {
      /* lecture seule */
    }
  }
  return data;
}

export async function signPortal(token: string, cfgParam: string | null, sig: Signature): Promise<void> {
  const fs = portalFs(cfgParam);
  await updateDoc(doc(fs, 'portal', token), { signature: sig });
}

/** Démarre le paiement par carte: retourne l'adresse de la page Stripe. */
export async function startCardPayment(p: PortalData): Promise<string> {
  const ep = p.company.payEndpoint;
  if (!ep) throw new Error('Paiement par carte non disponible.');
  const res = await fetch(`${ep}/createCheckout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: p.token, returnUrl: location.href.replace(/([?&])paid=1&?/, '$1').replace(/[?&]$/, '') }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Paiement impossible pour le moment.');
  return data.url;
}

export async function reviewPortal(token: string, cfgParam: string | null, review: Review): Promise<void> {
  const fs = portalFs(cfgParam);
  await updateDoc(doc(fs, 'portal', token), { review });
}

/** Lien « donne-nous ton avis » (page du portail avec les étoiles). */
export function reviewLink(portalUrl: string): string {
  return portalUrl + (portalUrl.includes('?') ? '&' : '?') + 'avis=1';
}
