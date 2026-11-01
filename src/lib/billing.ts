import { doc, onSnapshot } from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { PRODUCT } from '../brand';
import { getSettings, saveSettings } from './db';
import { billingState, type BillingInfo, type BillingRecord } from './billingState';
import { useSettings } from './hooks';
import { getLang } from './i18n';
import { currentAccount, onSyncAttach, syncContext, useSyncState } from './sync';

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

onSyncAttach(() => {
  const ctx = syncContext();
  if (!ctx) return;
  // Début de l'essai = création du compte du propriétaire (gardé dans les réglages pour les employés aussi)
  if (ctx.role === 'owner') {
    const acc = currentAccount();
    void getSettings().then((s) => {
      if (acc && !s.accountCreatedAt) void saveSettings({ accountCreatedAt: acc.createdAt });
      // Entreprise du créateur: les employés connectés à ce compte n'ont pas d'essai non plus
      if (isOwnerAccount() && !s.founderWorkspace) void saveSettings({ founderWorkspace: true });
    });
  }
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
