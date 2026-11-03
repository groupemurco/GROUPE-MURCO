import { doc, onSnapshot } from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { PRODUCT } from '../brand';
import { db, DEFAULT_SETTINGS, getSettings, MURCO_SETTINGS, saveSettings, type Settings } from './db';
import { billingState, type BillingInfo, type BillingRecord } from './billingState';
import { useSettings } from './hooks';
import { getLang } from './i18n';
import { currentAccount, onFirstSync, onSyncAttach, syncContext, useSyncState } from './sync';

// Le proprietaire de l'app n'a jamais d'essai: toujours "fondateur" (acces complet gratuit).
const OWNER_EMAILS = ['info@groupemurco.com', 'myriam.austin07@gmail.com'];
const isOwnerAccount = () => OWNER_EMAILS.includes((currentAccount()?.email ?? '').toLowerCase());

// Abonnement de l'entreprise: document « billing/{propriétaire} » tenu à jour par Stripe (fonctions Firebase).
let record: BillingRecord | null = null;
const subs = new Set<() => void>();
const set = (r: BillingRecord | null) => {
  record = r;
  subs.forEach((f) => f());
};

// Réglages écrits seulement APRÈS avoir reçu ceux du nuage (sinon un appareil neuf écrasait l'entreprise)
onFirstSync(async () => {
  const ctx = syncContext();
  if (!ctx || ctx.role !== 'owner') return;
  const acc = currentAccount();
  const s = await getSettings();
  const patch: Partial<Settings> = {};
  // Début de l'essai = création du compte du propriétaire (gardé dans les réglages pour les employés aussi)
  if (acc && !s.accountCreatedAt) patch.accountCreatedAt = acc.createdAt;
  // Entreprise du créateur: les employés connectés à ce compte n'ont pas d'essai non plus
  if (isOwnerAccount() && !s.founderWorkspace) patch.founderWorkspace = true;
  // Réglages de Groupe Murco effacés par l'ancien bogue (connexion sur un appareil neuf): on les remet
  if (isOwnerAccount() && !s.companyName.trim()) Object.assign(patch, await murcoRepair(s));
  if (Object.keys(patch).length) await saveSettings(patch);
});

/** Remet les infos de Groupe Murco qui sont vides; les numéros suivent les documents existants. */
async function murcoRepair(s: Settings): Promise<Partial<Settings>> {
  const patch: Record<string, unknown> = { setupComplete: true };
  const cur = s as unknown as Record<string, unknown>;
  const def = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(MURCO_SETTINGS)) {
    if (k === 'id' || v === '' || v === undefined) continue;
    if (cur[k] === undefined || cur[k] === '' || cur[k] === def[k]) patch[k] = v;
  }
  if (!s.trade) patch.trade = 'calfeutrage';
  if (!s.trades?.length) patch.trades = [s.trade || 'calfeutrage'];
  const docs = await db.docs.toArray();
  const next = (type: 'invoice' | 'quote', prefix: string) =>
    docs.filter((d) => d.type === type && d.number.startsWith(prefix)).reduce((m, d) => Math.max(m, Number(d.number.slice(prefix.length)) || 0), 1000) + 1;
  patch.nextInvoiceNumber = Math.max(s.nextInvoiceNumber, next('invoice', s.invoicePrefix || 'F-'));
  patch.nextQuoteNumber = Math.max(s.nextQuoteNumber, next('quote', s.quotePrefix || 'S-'));
  return patch as Partial<Settings>;
}

onSyncAttach(() => {
  const ctx = syncContext();
  if (!ctx) return;
  return onSnapshot(
    doc(ctx.fs, 'billing', ctx.workspace),
    (snap) => set(snap.exists() ? (snap.data() as BillingRecord) : null),
    () => set(null),
  );
});

function foundersBefore(): string {
  try {
    return localStorage.getItem('murco.foundersBefore') || PRODUCT.foundersBefore; // test: simuler un nouveau client
  } catch {
    return PRODUCT.foundersBefore;
  }
}

export function useBilling(): BillingInfo {
  const st = useSyncState();
  const s = useSettings();
  const r = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => record);
  const signedIn = st.status === 'ok' || st.status === 'syncing' || st.status === 'error';
  const created = s.accountCreatedAt ?? (st.role === 'owner' ? currentAccount()?.createdAt : undefined);
  let trialDays = PRODUCT.trialDays;
  try {
    const t = localStorage.getItem('murco.trialDays'); // test: essai terminé
    if (t !== null) trialDays = Number(t);
  } catch {
    /* ignore */
  }
  const founder = isOwnerAccount() || !!s.founderWorkspace;
  return billingState({ signedIn, accountCreatedAt: created, record: r, foundersBefore: founder ? '2999-01-01T00:00:00Z' : foundersBefore(), trialDays });
}

/** Adresse des fonctions (intégrée à la compilation pour la version vendue, sinon celle des paramètres). */
export function apiBase(endpoint?: string): string {
  return ((import.meta.env.VITE_API_URL as string | undefined) || endpoint || '').replace(/\/+$/, '');
}

async function call(path: string, body: Record<string, unknown>, endpoint?: string): Promise<string> {
  const base = apiBase(endpoint);
  if (!base) throw new Error('Les abonnements ne sont pas encore activés sur cette installation (adresse des fonctions manquante).');
  const acc = currentAccount();
  if (!acc) throw new Error('Connecte-toi d’abord.');
  const res = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await acc.getToken()}` },
    body: JSON.stringify({ ...body, lang: getLang() }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Service d’abonnement indisponible pour le moment.');
  return data.url;
}

const here = () => `${location.origin}${location.pathname}#/abonnement`;
export const startSubscription = (plan: string, endpoint?: string) => call('createSubscription', { plan, returnUrl: here() }, endpoint);
export const openBillingPortal = (endpoint?: string) => call('billingPortal', { returnUrl: here() }, endpoint);
