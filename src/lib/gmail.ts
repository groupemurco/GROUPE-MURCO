import { isNative, publicBase } from './native';
import { blobToBase64 } from './utils';

// Intégration Gmail via Google Identity Services (OAuth dans le navigateur).
// Nécessite un « ID client OAuth » Google (voir README) entré dans Paramètres.

const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_KEY = 'murco.gmail.token';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }) => TokenClient;
          revoke: (token: string, cb?: () => void) => void;
        };
      };
    };
  }
}

let token: { value: string; exp: number } | null = null;
try {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { value: string; exp: number };
    if (parsed.exp > Date.now()) token = parsed;
  }
} catch {
  /* stockage indisponible */
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.async = true;
      sc.onload = () => resolve();
      sc.onerror = () => {
        gisPromise = null;
        reject(new Error('Impossible de charger Google (vérifie ta connexion Internet).'));
      };
      document.head.appendChild(sc);
    });
  }
  return gisPromise;
}

export function isGmailConnected(): boolean {
  return !!token && token.exp > Date.now();
}

function saveToken(access: string, expiresIn: number) {
  token = { value: access, exp: Date.now() + (expiresIn - 60) * 1000 };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* ignore */
  }
}

/**
 * App installée: Google refuse la connexion dans une app (WebView). On ouvre la connexion dans Chrome,
 * Google revient sur oauth.html, qui renvoie le jeton à l'app (com.groupemurco.gestion://oauth#access_token=…).
 */
async function connectGmailNative(clientId: string): Promise<void> {
  const { App } = await import('@capacitor/app');
  const state = Math.random().toString(36).slice(2);
  const redirect = `${publicBase()}oauth.html`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'token', scope: SCOPES, include_granted_scopes: 'true', prompt: 'select_account', state,
  })}`;
  await new Promise<void>((resolve, reject) => {
    let handle: { remove: () => Promise<void> } | undefined;
    const timer = setTimeout(() => { void handle?.remove(); reject(new Error('Connexion Gmail non terminée. Réessaie.')); }, 10 * 60 * 1000);
    void App.addListener('appUrlOpen', ({ url: back }) => {
      if (!back.startsWith('com.groupemurco.gestion://oauth')) return;
      const p = new URLSearchParams(back.split('#')[1] ?? '');
      clearTimeout(timer);
      void handle?.remove();
      if (p.get('state') !== state) return reject(new Error('Connexion Gmail refusée (réponse inattendue). Réessaie.'));
      const access = p.get('access_token');
      if (!access) return reject(new Error(p.get('error') === 'access_denied' ? 'Connexion Gmail annulée.' : `Connexion Gmail refusée: ${p.get('error') ?? 'inconnue'}`));
      saveToken(access, Number(p.get('expires_in')) || 3600);
      resolve();
    }).then((h) => { handle = h; });
    // Une adresse hors de l'app s'ouvre dans le navigateur du téléphone (Chrome)
    window.location.href = url;
  });
}

export async function connectGmail(clientId: string, interactive = true): Promise<void> {
  if (!clientId) throw new Error('Ajoute ton ID client Google OAuth dans Paramètres → Gmail.');
  if (isNative()) {
    if (!interactive) throw new Error('Reconnecte Gmail.');
    return connectGmailNative(clientId);
  }
  await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = { value: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        } catch {
          /* ignore */
        }
        resolve();
      },
      error_callback: (e) => reject(new Error(e.message || e.type)),
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function disconnectGmail() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value);
  token = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function api<T>(path: string, init: RequestInit = {}, base = 'https://gmail.googleapis.com/gmail/v1/users/me'): Promise<T> {
  if (!isGmailConnected()) throw new Error('Gmail non connecté. Clique sur « Connecter Gmail ».');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` },
  });
  if (res.status === 401) {
    disconnectGmail();
    throw new Error('Session Gmail expirée. Reconnecte-toi.');
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erreur Gmail (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${utf8ToBase64(s)}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

export interface Attachment {
  filename: string;
  mimeType: string;
  blob: Blob;
}

export async function sendEmail(o: { to: string; cc?: string; subject: string; body: string; attachments?: Attachment[] }): Promise<string> {
  const boundary = `murco_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `To: ${o.to}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Subject: ${encodeHeader(o.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToBase64(o.body)),
  ];
  for (const a of o.attachments ?? []) {
    const name = encodeHeader(a.filename);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(await blobToBase64(a.blob)),
    );
  }
  lines.push(`--${boundary}--`, '');
  // Point d'envoi « upload » : accepte les pièces jointes jusqu'à ~35 Mo.
  const r = await api<{ id: string }>(
    '/messages/send?uploadType=media',
    { method: 'POST', headers: { 'Content-Type': 'message/rfc822' }, body: lines.join('\r\n') },
    'https://gmail.googleapis.com/upload/gmail/v1/users/me',
  );
  return r.id;
}

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  attachments: { attachmentId: string; filename: string; mimeType: string; size: number }[];
}

interface GmailPart {
  filename?: string;
  mimeType: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

function collectAttachments(p: GmailPart | undefined, out: MailSummary['attachments']) {
  if (!p) return;
  if (p.filename && p.body?.attachmentId) {
    out.push({ attachmentId: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType, size: p.body.size ?? 0 });
  }
  p.parts?.forEach((c) => collectAttachments(c, out));
}

export async function searchMail(q: string, max = 15): Promise<MailSummary[]> {
  const list = await api<{ messages?: { id: string; threadId: string }[] }>(
    `/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
  );
  const ids = list.messages ?? [];
  const out = await Promise.all(
    ids.map(async ({ id }) => {
      const msg = await api<{ id: string; threadId: string; snippet: string; payload: GmailPart; internalDate: string }>(
        `/messages/${id}?format=full`,
      );
      const h = (n: string) => msg.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
      const attachments: MailSummary['attachments'] = [];
      collectAttachments(msg.payload, attachments);
      return {
        id: msg.id,
        threadId: msg.threadId,
        from: h('from'),
        to: h('to'),
        subject: h('subject'),
        date: new Date(Number(msg.internalDate)).toISOString(),
        snippet: decodeEntities(msg.snippet),
        attachments,
      } satisfies MailSummary;
    }),
  );
  return out;
}

function decodeEntities(s: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

/** Texte d'un courriel (pour que l'assistant en fasse un devis): en-têtes utiles + corps en texte. */
export async function getMailText(id: string): Promise<string> {
  const msg = await api<{ payload: GmailPart }>(`/messages/${id}?format=full`);
  const h = (n: string) => msg.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
  const decode = (data: string) => {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };
  const find = (p: GmailPart | undefined, type: string): string => {
    if (!p) return '';
    if (p.mimeType === type && p.body?.data && !p.filename) return decode(p.body.data);
    for (const c of p.parts ?? []) {
      const t = find(c, type);
      if (t) return t;
    }
    return '';
  };
  let body = find(msg.payload, 'text/plain');
  if (!body) {
    const html = find(msg.payload, 'text/html');
    body = html ? new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'), 'text/html').body.textContent ?? '' : '';
  }
  return [`De : ${h('from')}`, `Objet : ${h('subject')}`, `Date : ${h('date')}`, '', body.replace(/\n{3,}/g, '\n\n').trim()].join('\n');
}

export async function getAttachment(messageId: string, attachmentId: string, mimeType: string): Promise<Blob> {
  const r = await api<{ data: string }>(`/messages/${messageId}/attachments/${attachmentId}`);
  const b64 = r.data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function gmailThreadLink(threadId: string) {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

/** Repli sans Gmail API: ouvre le client courriel avec le message pré-rempli. */
export function mailtoLink(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
