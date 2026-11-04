import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  collection,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { db, onLocalChange, remoteTx, SYNC_TABLES, type MemberRole, type SyncTable } from './db';
import { blobToBase64 } from './utils';
import { publicBase } from './native';

/*
 * Synchronisation entre appareils (téléphone, ordi…) avec Firebase (Google), forfait gratuit.
 * - Chaque appareil garde une copie complète (fonctionne hors-ligne).
 * - Chaque modification est horodatée (_u); la plus récente gagne.
 * - Les suppressions sont des « pierres tombales » (_deleted) pour se propager partout.
 * - Les photos de reçus sont stockées à part (collection « photos »).
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  emulator?: boolean; // tests locaux
}

const CONFIG_KEY = 'murco.firebase';
const PENDING_DELETES = 'murco.pendingDeletes';

export type Role = 'owner' | MemberRole;

export interface SyncState {
  status: 'off' | 'signedout' | 'connecting' | 'syncing' | 'ok' | 'error';
  email?: string;
  lastSync?: number;
  error?: string;
  configured: boolean;
  role: Role; // propriétaire, employé, vendeur, admin
  memberId?: number;
  workspace?: string; // uid du propriétaire de l'entreprise
}

let state: SyncState = { status: 'off', configured: false, role: 'owner' };
const subs = new Set<() => void>();
function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
/** Pour le code hors React: appelé à chaque changement d'état de la synchro. */
export function onSyncState(fn: (s: SyncState) => void): () => void {
  const f = () => fn(state);
  subs.add(f);
  return () => subs.delete(f);
}
/** Compte connecté (création du compte = début de l'essai gratuit). */
export function currentAccount(): { uid: string; email: string; createdAt: string; getToken: () => Promise<string> } | null {
  if (!user) return null;
  const u = user;
  return { uid: u.uid, email: u.email ?? '', createdAt: new Date(u.metadata.creationTime ?? Date.now()).toISOString(), getToken: () => u.getIdToken() };
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

/** Accepte le JSON ou le bout de code copié de la console Firebase (const firebaseConfig = {...}). */
export function parseFirebaseConfig(text: string): FirebaseConfig | null {
  const t = text.trim();
  if (!t) return null;
  // Le lien « Connecter ton téléphone » collé tel quel (l'app Android n'ouvre pas les liens web)
  const link = t.match(/[?&]sync=([^&\s]+)/);
  if (link) return configFromLink(link[1]);
  // Un lien client déjà envoyé (…#/p/xxx?c=…) contient aussi l'adresse publique de la base de données
  const client = t.match(/[?&]c=([^&\s#]+)/);
  if (client) return configFromClientParam(client[1]);
  try {
    const j = JSON.parse(t);
    if (j.apiKey && j.projectId) return j;
  } catch {
    /* format JS */
  }
  const out: Record<string, string | boolean> = {};
  for (const m of t.matchAll(/(\w+)\s*:\s*["']([^"']+)["']/g)) out[m[1]] = m[2];
  if (/emulator\s*:\s*true/.test(t)) out.emulator = true;
  if (!out.apiKey || !out.projectId) return null;
  out.authDomain ||= `${out.projectId}.firebaseapp.com`;
  return out as unknown as FirebaseConfig;
}

export function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  // Configuration intégrée au moment de la compilation (optionnel)
  const env = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  return env ? parseFirebaseConfig(env) : null;
}

export function saveFirebaseConfig(cfg: FirebaseConfig | null) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

/** Lien à ouvrir sur un autre appareil pour lui donner la même configuration. */
export function deviceLink(): string | null {
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
  return `${publicBase()}#/parametres?sync=${encodeURIComponent(b64)}`;
}

/** Paramètre « c » des liens clients: format court (projet~clé~app) ou ancien format (JSON en base64). */
export function configFromClientParam(p: string): FirebaseConfig | null {
  const short = decodeURIComponent(p).split('~');
  if (short.length === 3 && short.every(Boolean)) {
    const [projectId, apiKey, appId] = short;
    return { apiKey, appId, projectId, authDomain: `${projectId}.firebaseapp.com` };
  }
  try {
    const j = JSON.parse(atob(decodeURIComponent(p)));
    if (j.apiKey && j.projectId) return { authDomain: `${j.projectId}.firebaseapp.com`, ...j };
  } catch {
    /* ancien format */
  }
  return configFromLink(p);
}

export function configFromLink(param: string): FirebaseConfig | null {
  try {
    return parseFirebaseConfig(decodeURIComponent(escape(atob(param))));
  } catch {
    return null;
  }
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let fs: Firestore | null = null;
let user: User | null = null;
let unsubs: Unsubscribe[] = [];
let stopLocal: (() => void) | null = null;

/** Accès Firestore pour les autres modules (portail client). */
export function syncContext(): { fs: Firestore; uid: string; workspace: string; role: Role } | null {
  return fs && user ? { fs, uid: user.uid, workspace: workspace ?? user.uid, role } : null;
}

/** Après avoir rejoint une équipe: recharge l'espace de travail et resynchronise. */
export async function reattach() {
  if (!user) return;
  detach();
  await resolveWorkspace(user);
  attach();
}
const attachListeners = new Set<() => (() => void) | void>();
/** Exécuté une fois les données du nuage reçues (avant « tout est chargé »): seul moment sûr pour écrire des réglages. */
const firstSyncHooks = new Set<() => Promise<void> | void>();
export function onFirstSync(fn: () => Promise<void> | void) {
  firstSyncHooks.add(fn);
}
// Tables dont la 1re réponse du serveur est appliquée (avant, rien n'est envoyé: un appareil neuf écrasait le nuage)
let readyTables = new Set<SyncTable>();
let freshDevice = false;
const syncedKey = () => `murco.synced:${workspace ?? user?.uid ?? ''}`;
/** Exécuté à chaque connexion au compte (ex.: écoute du portail client). */
export function onSyncAttach(fn: () => (() => void) | void) {
  attachListeners.add(fn);
}
const localDocHooks = new Set<(table: SyncTable, v: Record<string, unknown>) => void>();
export function onSyncedPut(fn: (table: SyncTable, v: Record<string, unknown>) => void) {
  localDocHooks.add(fn);
}

// Espace de travail: celui du propriétaire (même pour un employé invité)
let workspace: string | null = null;
let role: Role = 'owner';

/** Tables que chaque rôle synchronise (lecture) et peut modifier (écriture). */
const READ: Record<Role, readonly SyncTable[]> = {
  owner: SYNC_TABLES,
  admin: SYNC_TABLES,
  vendeur: ['settings', 'clients', 'services', 'jobs', 'media', 'punches', 'members', 'projects', 'leads', 'docs', 'messages'],
  employe: ['settings', 'clients', 'services', 'jobs', 'media', 'punches', 'members', 'projects'],
};
const WRITE: Record<Role, readonly SyncTable[]> = {
  owner: SYNC_TABLES,
  admin: SYNC_TABLES,
  vendeur: ['clients', 'jobs', 'media', 'punches', 'leads', 'docs', 'messages'],
  employe: ['jobs', 'media', 'punches'],
};
const canWrite = (t: SyncTable) => WRITE[role].includes(t);

function base() {
  return `users/${workspace ?? user!.uid}`;
}

/** Détermine si l'utilisateur est le propriétaire ou un membre invité d'une entreprise. */
async function resolveWorkspace(u: User) {
  workspace = u.uid;
  role = 'owner';
  let memberId: number | undefined;
  try {
    const m = await getDoc(doc(fs!, 'memberships', u.uid));
    if (m.exists()) {
      const d = m.data() as { ownerUid: string; role: MemberRole; memberId: number };
      workspace = d.ownerUid;
      role = d.role;
      memberId = d.memberId;
    }
  } catch {
    /* hors ligne: on garde le dernier état connu */
    try {
      const last = JSON.parse(localStorage.getItem('murco.workspace') ?? 'null');
      if (last?.uid === u.uid) ({ workspace, role, memberId } = last);
    } catch {
      /* ignore */
    }
  }
  // Un appareil qui passe dans l'espace d'une autre entreprise repart à neuf (pas de mélange de données)
  try {
    const prev = localStorage.getItem('murco.deviceWorkspace');
    if (prev && prev !== workspace) {
      await remoteTx(SYNC_TABLES.map((t) => db.table(t)), async () => {
        for (const t of SYNC_TABLES) await db.table(t).clear();
      });
    }
    localStorage.setItem('murco.deviceWorkspace', workspace ?? '');
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem('murco.workspace', JSON.stringify({ uid: u.uid, workspace, role, memberId }));
  } catch {
    /* ignore */
  }
  setState({ role, memberId, workspace: workspace ?? undefined });
}

const APP_CHECK_SITE_KEY = '6Lc5vg4uAAAAAJDE0ddPMoxjBnL4wOMyaLqQ3W9_';

export function startSync(): void {
  const cfg = getFirebaseConfig();
  if (!cfg || app) {
    setState({ configured: !!cfg, status: cfg ? state.status : 'off' });
    return;
  }
  try {
    app = initializeApp(cfg, 'murco');
    if (!cfg.emulator) {
      try {
        // App Check (clé publique reCAPTCHA): Firebase exige ce jeton pour l'assistant IA
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
      } catch {
        /* sans App Check, seul l'assistant IA est refusé */
      }
    }
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
    fs = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    if (cfg.emulator) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(fs, '127.0.0.1', 8080);
    }
  } catch (e) {
    setState({ configured: true, status: 'error', error: msg(e) });
    return;
  }
  setState({ configured: true, status: 'connecting' }); // en attente de la session enregistrée
  onAuthStateChanged(auth, async (u) => {
    detach();
    user = u;
    if (u) {
      await resolveWorkspace(u);
      attach();
    } else setState({ status: 'signedout', email: undefined, role: 'owner', memberId: undefined });
  });
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function authError(e: unknown): Error {
  const code = (e as { code?: string }).code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Courriel ou mot de passe invalide.',
    'auth/wrong-password': 'Mot de passe invalide.',
    'auth/user-not-found': 'Aucun compte avec ce courriel. Crée-le d’abord.',
    'auth/email-already-in-use': 'Ce courriel a déjà un compte: connecte-toi.',
    'auth/weak-password': 'Mot de passe trop court (6 caractères minimum).',
    'auth/invalid-email': 'Courriel invalide.',
    'auth/operation-not-allowed': 'Active « Courriel/Mot de passe » (ou Google) dans Firebase → Authentication.',
    'auth/unauthorized-domain': `Ajoute ${location.hostname} dans Firebase → Authentication → Paramètres → Domaines autorisés.`,
    'auth/popup-blocked': 'Fenêtre bloquée: autorise les fenêtres surgissantes ou utilise courriel + mot de passe.',
    'auth/network-request-failed': 'Pas de connexion Internet.',
  };
  return new Error(map[code] ?? msg(e));
}

export async function signInEmail(email: string, password: string, create = false) {
  if (!auth) throw new Error('Synchronisation non configurée.');
  try {
    if (create) await createUserWithEmailAndPassword(auth, email.trim(), password);
    else await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (e) {
    throw authError(e);
  }
}

export async function signInGoogle() {
  if (!auth) throw new Error('Synchronisation non configurée.');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    throw authError(e);
  }
}

export async function resetPassword(email: string) {
  if (!auth) throw new Error('Synchronisation non configurée.');
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    throw authError(e);
  }
}

/**
 * Loi 25: supprime le compte et toutes les données de l'entreprise dans le nuage, puis sur cet appareil.
 * Un employé quitte simplement l'entreprise (son accès est supprimé).
 */
export async function deleteMyAccount(): Promise<void> {
  if (!fs || !user) throw new Error('Connecte-toi d’abord.');
  const u = user;
  // Firebase exige une connexion récente pour supprimer un compte: on vérifie avant d'effacer quoi que ce soit
  const auth = await u.getIdTokenResult();
  if (Date.now() - new Date(auth.authTime).getTime() > 4 * 60_000) {
    throw new Error('Par sécurité, déconnecte-toi puis reconnecte-toi, et recommence la suppression dans les 5 minutes.');
  }
  const ownerUid = u.uid;
  const wipe = async (refs: { ref: Parameters<typeof deleteDoc>[0] }[]) => {
    for (let i = 0; i < refs.length; i += 400) {
      const b = writeBatch(fs!);
      refs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  };
  detach();
  if (role === 'owner') {
    for (const t of [...SYNC_TABLES, 'files', 'invites']) await wipe((await getDocs(collection(fs, 'users', ownerUid, t))).docs);
    await wipe((await getDocs(query(collection(fs, 'portal'), where('owner', '==', ownerUid)))).docs);
    await wipe((await getDocs(collection(fs, 'inbox', ownerUid, 'leads'))).docs);
    await wipe((await getDocs(query(collection(fs, 'memberships'), where('ownerUid', '==', ownerUid)))).docs);
    await deleteDoc(doc(fs, 'public', ownerUid)).catch(() => undefined);
  } else {
    await deleteDoc(doc(fs, 'memberships', ownerUid)).catch(() => undefined);
  }
  try {
    await deleteUser(u);
  } catch (e) {
    throw authError(e);
  }
  await remoteTx(SYNC_TABLES.map((t) => db.table(t)), async () => {
    for (const t of SYNC_TABLES) await db.table(t).clear();
  });
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('murco.') && k !== 'murco.firebase' && k !== 'murco.lang' && k !== 'murco.theme') localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export async function signOutSync() {
  if (auth) await signOut(auth);
}

function detach() {
  unsubs.forEach((u) => u());
  unsubs = [];
  stopLocal?.();
  stopLocal = null;
}

type Rec = Record<string, unknown> & { id: number | string; _u?: number; _deleted?: boolean };

const keyOf = (table: SyncTable, id: string): number | string => (table === 'settings' ? id : Number(id));

/** Tables qui contiennent un fichier (photo): champ du fichier, de l'empreinte, du nom et du type. */
const BLOBS: Partial<Record<SyncTable, { field: string; sig: string; name: string; type: string }>> = {
  expenses: { field: 'photo', sig: 'photoSig', name: 'photoName', type: 'photoType' },
  media: { field: 'blob', sig: 'sig', name: 'name', type: 'type' },
};

function clean(table: SyncTable, v: Rec): Rec {
  const cfg = BLOBS[table];
  if (!cfg) return v;
  const rest = { ...v };
  delete rest[cfg.field];
  return rest;
}

const photoSig = (b: Blob) => `${b.size}-${b.type}`;
const fileDocId = (table: SyncTable, id: unknown) => `${table}-${id}`;

/** Réduit une photo pour qu'elle tienne dans un document Firestore (< 1 Mo). */
async function shrinkForCloud(b: Blob): Promise<Blob> {
  if (b.size < 650_000) return b;
  if (!b.type.startsWith('image/')) throw new Error('Fichier trop lourd (max. 650 Ko)');
  const bmp = await createImageBitmap(b);
  for (const [max, q] of [[1400, 0.72], [1100, 0.62], [850, 0.55]] as const) {
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc);
    c.height = Math.round(bmp.height * sc);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (out && out.size < 650_000) return out;
  }
  throw new Error('Photo trop lourde pour la synchronisation');
}

async function pushRecord(table: SyncTable, v: Rec) {
  if (!fs || !user || !canWrite(table)) return;
  const rec = { ...clean(table, v) };
  const cfg = BLOBS[table];
  const file = cfg ? v[cfg.field] : undefined;
  if (cfg && file instanceof Blob) {
    const sig = photoSig(file);
    if (rec[cfg.sig] !== sig) {
      rec[cfg.sig] = sig;
      // garde la même empreinte localement, sans changer l'horodatage
      const t = db.table(table);
      await remoteTx([t], () => t.update(v.id, { [cfg.sig]: sig }));
      try {
        const small = await shrinkForCloud(file);
        await setDoc(doc(fs, base(), 'files', fileDocId(table, v.id)), {
          data: await blobToBase64(small),
          type: small.type,
          name: (v[cfg.name] as string) ?? 'photo.jpg',
          sig,
        });
      } catch (e) {
        setState({ error: `Photo non synchronisée: ${msg(e)}` });
      }
    }
  }
  await setDoc(doc(fs, base(), table, String(v.id)), rec);
}

async function pushDelete(table: SyncTable, id: unknown) {
  if (fs && user && !canWrite(table)) return;
  if (!fs || !user) {
    // hors connexion au compte: on retient la suppression pour plus tard
    try {
      const list = JSON.parse(localStorage.getItem(PENDING_DELETES) ?? '[]') as [string, unknown, number][];
      list.push([table, id, Date.now()]);
      localStorage.setItem(PENDING_DELETES, JSON.stringify(list));
    } catch {
      /* ignore */
    }
    return;
  }
  await setDoc(doc(fs, base(), table, String(id)), { id, _deleted: true, _u: Date.now() });
}

async function fetchFile(table: SyncTable, id: unknown): Promise<{ blob: Blob; name: string; type: string } | null> {
  if (!fs || !user) return null;
  const snap = await getDoc(doc(fs, base(), 'files', fileDocId(table, id)));
  if (!snap.exists()) return null;
  const d = snap.data() as { data: string; type: string; name: string };
  const bin = atob(d.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: d.type }), name: d.name, type: d.type };
}

/** Applique un enregistrement venant du nuage s'il est plus récent que la copie locale. */
async function applyRemote(table: SyncTable, remote: Rec, freshFirst = false) {
  const t = db.table(table);
  const key = keyOf(table, String(remote.id));
  const local = (await t.get(key)) as Rec | undefined;
  const ru = remote._u ?? 0;
  const lu = local?._u ?? -1;
  // Appareil neuf (ou nouvelle adresse de l'app): ce qui est dans le nuage gagne toujours sur les valeurs par défaut
  // créées ici avant la connexion; on garde seulement ce que le nuage n'a pas.
  if (freshFirst && local && !remote._deleted && !BLOBS[table]) {
    const merged: Rec = { ...local };
    for (const [k, v] of Object.entries(remote)) if (v !== undefined) merged[k] = v;
    const extra = Object.keys(local).some((k) => !(k in remote) && local[k] !== undefined && local[k] !== '' && k !== '_u');
    if (extra) {
      const fixed: Rec = { ...merged, id: key, _u: Math.max(lu, ru) + 1 };
      await remoteTx([t], () => t.put(fixed));
      await pushRecord(table, fixed);
    } else await remoteTx([t], () => t.put({ ...remote, id: key }));
    return;
  }
  // Un appareil neuf envoie des réglages vides, jugés plus récents: ils ne doivent jamais effacer une clé déjà enregistrée
  // (clé Google Maps, ID Gmail, adresse du paiement par carte).
  if (table === 'settings' && local && !remote._deleted) {
    const PROTECTED = /(Key|ClientId|Endpoint)$/;
    const newer = lu > ru ? local : remote;
    const older = lu > ru ? remote : local;
    const merged: Rec = { ...newer };
    let changed = false;
    for (const k of Object.keys(older)) {
      const nv = merged[k];
      const ov = older[k];
      if (PROTECTED.test(k) && (nv === '' || nv === null || nv === undefined) && typeof ov === 'string' && ov !== '') {
        merged[k] = ov;
        changed = true;
      }
    }
    if (changed) {
      const fixed: Rec = { ...merged, id: key, _u: Math.max(lu, ru) + 1 };
      await remoteTx([t], () => t.put(fixed));
      await pushRecord(table, fixed);
      return;
    }
  }
  if (local && lu > ru && !remote._deleted) {
    await pushRecord(table, local); // la copie locale est plus récente (modifiée hors-ligne)
    return;
  }
  if (remote._deleted) {
    if (local && lu <= ru) await remoteTx([t], () => t.delete(key));
    return;
  }
  if (local && lu === ru) return;
  let rec: Rec = { ...remote, id: key };
  const cfg = BLOBS[table];
  if (cfg) {
    const keepLocal = () => ({ [cfg.field]: local![cfg.field], [cfg.name]: local![cfg.name], [cfg.type]: local![cfg.type] });
    if (local?.[cfg.field] && local[cfg.sig] === remote[cfg.sig]) rec = { ...rec, ...keepLocal() };
    else if (remote[cfg.sig]) {
      const f = await fetchFile(table, key).catch(() => null);
      if (f) rec = { ...rec, [cfg.field]: f.blob, [cfg.name]: f.name, [cfg.type]: f.type };
      else if (local?.[cfg.field]) rec = { ...rec, ...keepLocal() };
    }
  }
  await remoteTx([t], () => t.put(rec));
}

function attach() {
  if (!fs || !user) return;
  setState({ status: 'syncing', email: user.email ?? undefined, error: undefined });

  // Suppressions faites avant la connexion
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_DELETES) ?? '[]') as [SyncTable, unknown, number][];
    localStorage.removeItem(PENDING_DELETES);
    list.forEach(([table, id, at]) => setDoc(doc(fs!, base(), table, String(id)), { id, _deleted: true, _u: at }));
  } catch {
    /* ignore */
  }

  readyTables = new Set();
  try {
    freshDevice = !localStorage.getItem(syncedKey());
  } catch {
    freshDevice = true;
  }

  // Local → nuage (seulement une fois la table reçue du serveur; avant, la 1re réponse règle les écarts)
  stopLocal = onLocalChange((c) => {
    if (c.type === 'put' && !readyTables.has(c.table)) return;
    const job =
      c.type === 'put'
        ? Promise.all((c.values ?? []).map(async (v) => {
            await pushRecord(c.table, v as Rec);
            localDocHooks.forEach((fn) => fn(c.table, v as Rec));
          }))
        : Promise.all(c.keys.map((k) => pushDelete(c.table, k)));
    job.then(() => setState({ lastSync: Date.now() })).catch((e) => setState({ status: 'error', error: msg(e) }));
  });

  attachListeners.forEach((fn) => {
    const stop = fn();
    if (stop) unsubs.push(stop);
  });

  // Nuage → local (temps réel)
  const tables = READ[role];
  let pendingFirst = tables.length;
  for (const table of tables) {
    let first = true;
    let queue = Promise.resolve();
    // includeMetadataChanges: on attend la vraie réponse du serveur (pas le cache vide d'un nouvel appareil ou
    // d'une nouvelle adresse) avant de dire « tout est chargé » — sinon l'app croyait l'entreprise vide.
    const u = onSnapshot(
      collection(fs, base(), table),
      { includeMetadataChanges: true },
      (snap) => {
        const changes = snap.docChanges().filter((ch) => ch.type !== 'removed');
        const isFirst = first && !snap.metadata.fromCache;
        if (isFirst) first = false;
        if (!changes.length && !isFirst) return;
        queue = queue.then(async () => {
          for (const ch of changes) await applyRemote(table, { ...(ch.doc.data() as Rec), id: ch.doc.id }, isFirst && freshDevice);
          if (isFirst) {
            // Envoie ce qui n'existe que sur cet appareil
            const remoteIds = new Set(snap.docs.map((d) => d.id));
            const locals = (await db.table(table).toArray()) as Rec[];
            for (const l of locals) if (!remoteIds.has(String(l.id))) await pushRecord(table, l);
            readyTables.add(table);
            if (--pendingFirst === 0) {
              for (const fn of firstSyncHooks) await Promise.resolve(fn()).catch(() => undefined);
              try {
                localStorage.setItem(syncedKey(), '1');
              } catch {
                /* ignore */
              }
              setState({ status: 'ok', lastSync: Date.now() });
            }
          } else setState({ lastSync: Date.now() });
        }).catch((e) => setState({ status: 'error', error: msg(e) }));
      },
      (e) => setState({ status: 'error', error: msg(e).includes('permission') ? 'Accès refusé: vérifie les règles Firestore (voir README).' : msg(e) }),
    );
    unsubs.push(u);
  }
}

/** L'app Firebase (pour l'assistant IA). null si la synchro n'est pas configurée. */
export function firebaseApp(): FirebaseApp | null {
  if (!app) startSync();
  return app;
}
