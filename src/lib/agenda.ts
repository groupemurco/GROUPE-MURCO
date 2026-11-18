import { db, getSettings, takeNextNumber, type Client, type Doc, type GeoPoint, type Job, type Trip } from './db';
import { drivingDistance, geocode, haversineKm } from './geo';
import { ensureHomeGeo } from './trips';
import { addDays, formatDate, todayISO } from './utils';

export const JOB_STATUS_LABEL: Record<Job['status'], string> = {
  planifie: 'Planifié',
  fait: 'Fait',
  facture: 'Facturé',
  annule: 'Annulé',
};

export const RECURRENCE_LABEL: Record<Job['recurrence'], string> = {
  none: 'Une seule fois',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  months: 'Aux X mois',
  yearly: 'Chaque année',
};

export function blankJob(date = todayISO(), clientId = 0): Job {
  return {
    date,
    time: '',
    durationMin: 120,
    clientId,
    address: '',
    title: '',
    items: [],
    notes: '',
    status: 'planifie',
    order: Date.now(),
    recurrence: 'none',
    createdAt: new Date().toISOString(),
  };
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function nextOccurrence(j: Job): string | null {
  switch (j.recurrence) {
    case 'weekly':
      return addDays(j.date, 7);
    case 'monthly':
      return addMonths(j.date, 1);
    case 'months':
      return addMonths(j.date, Math.max(1, j.recurEveryMonths ?? 6));
    case 'yearly':
      return addMonths(j.date, 12);
    default:
      return null;
  }
}

/** Coordonnées du lieu du job (adresse du job, sinon celle du client). */
export async function jobGeo(j: Job, client?: Client): Promise<{ geo: GeoPoint; label: string } | null> {
  const label = j.address?.trim() || client?.address?.trim() || '';
  if (!label) return null;
  if (j.address?.trim() && j.geo) return { geo: j.geo, label };
  if (!j.address?.trim() && client?.geo) return { geo: client.geo, label };
  const g = await geocode(label);
  if (!g) return null;
  if (j.address?.trim() && j.id) await db.jobs.update(j.id, { geo: g.geo });
  else if (client?.id) await db.clients.update(client.id, { geo: g.geo });
  return { geo: g.geo, label };
}

export async function jobsOfDay(date: string): Promise<Job[]> {
  const list = await db.jobs.where('date').equals(date).toArray();
  return list.filter((j) => j.status !== 'annule').sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.order - b.order);
}

export function sortRoute(list: Job[]): Job[] {
  return [...list].sort((a, b) => a.order - b.order);
}

/**
 * Journal de bord de la journée: domicile → job 1 → job 2 → … → domicile.
 * Un seul trajet enchaîné (plus exact que des allers-retours séparés pour chaque facture).
 */
export async function syncDayRoute(date: string): Promise<Trip[]> {
  const jobs = sortRoute((await jobsOfDay(date)).filter((j) => j.status === 'fait' || j.status === 'facture'));
  const old = await db.trips.where('routeDate').equals(date).toArray();
  await db.trips.bulkDelete(old.filter((t) => t.source === 'auto-agenda').map((t) => t.id!));
  if (!jobs.length) return [];
  const home = await ensureHomeGeo();
  const clients = new Map((await db.clients.toArray()).map((c) => [c.id!, c]));
  const stops: { geo: GeoPoint; label: string; job?: Job; reason: string }[] = [];
  for (const j of jobs) {
    const c = clients.get(j.clientId);
    const g = await jobGeo(j, c);
    if (g) stops.push({ ...g, job: j, reason: `${j.title || 'Travaux'} — ${c?.name ?? 'client'}` });
  }
  if (!stops.length) return [];
  const path = [{ geo: home.geo, label: home.label, reason: '' }, ...stops, { geo: home.geo, label: home.label, reason: 'Retour au domicile (fin de journée)' }];
  const created: Trip[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const r = await drivingDistance(a.geo, b.geo);
    const t: Trip = {
      date,
      fromLabel: a.label,
      fromGeo: a.geo,
      toLabel: b.label,
      toGeo: b.geo,
      oneWayKm: r.km,
      roundTrip: false,
      totalKm: r.km,
      reason: b.reason,
      clientId: 'job' in b && b.job ? b.job.clientId : undefined,
      jobId: 'job' in b && b.job ? b.job.id : undefined,
      source: 'auto-agenda',
      routeDate: date,
      distanceMethod: r.method,
      durationMin: r.durationMin,
      createdAt: new Date().toISOString(),
    };
    t.id = await db.trips.add(t);
    created.push(t);
  }
  // Les factures liées à ces jobs n'ont plus besoin de leur aller-retour séparé
  for (const j of jobs) {
    if (!j.docId) continue;
    const d = await db.docs.get(j.docId);
    if (d?.tripId) {
      const t = await db.trips.get(d.tripId);
      if (t?.source === 'auto-facture') await db.trips.delete(d.tripId);
      await db.docs.update(d.id!, { tripId: undefined });
    }
  }
  return created;
}

/**
 * Ordre de visite le plus court: les jobs avec une heure gardent leur heure,
 * ceux sans heure sont placés ensuite au plus proche (plus proche voisin).
 */
export async function optimizeDay(date: string): Promise<void> {
  const jobs = await jobsOfDay(date);
  if (jobs.length < 2) return;
  const home = await ensureHomeGeo();
  const clients = new Map((await db.clients.toArray()).map((c) => [c.id!, c]));
  const timed = jobs.filter((j) => j.time).sort((a, b) => a.time.localeCompare(b.time));
  const pts: { j: Job; g: GeoPoint }[] = [];
  const noGeo: Job[] = [];
  for (const j of jobs.filter((x) => !x.time)) {
    const g = await jobGeo(j, clients.get(j.clientId));
    if (g) pts.push({ j, g: g.geo });
    else noGeo.push(j);
  }
  let cur = home.geo;
  if (timed.length) {
    const last = await jobGeo(timed[timed.length - 1], clients.get(timed[timed.length - 1].clientId));
    if (last) cur = last.geo;
  }
  const ordered: Job[] = [];
  while (pts.length) {
    let best = 0;
    pts.forEach((p, i) => {
      if (haversineKm(cur, p.g) < haversineKm(cur, pts[best].g)) best = i;
    });
    const [p] = pts.splice(best, 1);
    ordered.push(p.j);
    cur = p.g;
  }
  const all = [...timed, ...ordered, ...noGeo];
  await Promise.all(all.map((j, i) => db.jobs.update(j.id!, { order: i })));
}

/** Itinéraire de la journée dans Google Maps (domicile → arrêts → domicile). */
export async function dayRouteLink(date: string): Promise<string | null> {
  const s = await getSettings();
  const jobs = sortRoute(await jobsOfDay(date));
  const clients = new Map((await db.clients.toArray()).map((c) => [c.id!, c]));
  const stops = jobs.map((j) => j.address?.trim() || clients.get(j.clientId)?.address?.trim()).filter(Boolean) as string[];
  if (!stops.length) return null;
  const home = s.homeAddress;
  const p = new URLSearchParams({ api: '1', origin: home, destination: home, travelmode: 'driving', waypoints: stops.slice(0, 9).join('|') });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/** Marque le job comme fait, crée le prochain s'il est récurrent et met à jour le journal de bord. */
export async function completeJob(id: number, routes = true): Promise<{ next?: Job; trips: Trip[] }> {
  const j = await db.jobs.get(id);
  if (!j) return { trips: [] };
  await db.jobs.update(id, { status: j.status === 'facture' ? 'facture' : 'fait', doneAt: new Date().toISOString() });
  let next: Job | undefined;
  const nd = nextOccurrence(j);
  if (nd && !j.nextJobId) {
    next = { ...blankJob(nd, j.clientId), time: j.time, durationMin: j.durationMin, address: j.address, geo: j.geo, title: j.title, items: j.items, notes: j.notes, recurrence: j.recurrence, recurEveryMonths: j.recurEveryMonths };
    next.id = await db.jobs.add(next);
    await db.jobs.update(id, { nextJobId: next.id });
  }
  let trips: Trip[] = [];
  try {
    if (routes) trips = await syncDayRoute(j.date);
  } catch {
    /* adresse du domicile manquante: le journal se fera plus tard */
  }
  return { next, trips };
}

/** Crée la facture à partir du job (codes, adresse, photos liées). */
export async function jobToInvoice(id: number): Promise<number> {
  const j = await db.jobs.get(id);
  if (!j) throw new Error('Job introuvable');
  if (j.docId && (await db.docs.get(j.docId))) return j.docId;
  const quote = (await db.docs.where('clientId').equals(j.clientId).toArray()).find((d) => d.type === 'quote' && d.jobId === id && !d.convertedInvoiceId && d.status !== 'refused' && d.status !== 'cancelled');
  if (quote) {
    // La soumission liée à cette job devient la facture (même prix, même texte); la soumission est marquée « facturée »
    const { quoteToInvoice } = await import('./assistantActions');
    const invId = await quoteToInvoice(quote);
    await db.docs.update(invId, { jobId: id, jobDate: j.date, jobAddress: j.address || quote.jobAddress });
    await db.jobs.update(id, { docId: invId, status: 'facture', doneAt: j.doneAt ?? new Date().toISOString() });
    const photos = await db.media.where('jobId').equals(id).toArray();
    await Promise.all(photos.map((m) => db.media.update(m.id!, { docId: invId })));
    try {
      await syncDayRoute(j.date);
    } catch {
      /* ignore */
    }
    return invId;
  }
  const s = await getSettings();
  const now = new Date().toISOString();
  const date = todayISO();
  const doc: Doc = {
    type: 'invoice',
    number: await takeNextNumber('invoice'),
    clientId: j.clientId,
    date,
    dueDate: addDays(date, s.paymentTermsDays),
    jobDate: j.date,
    jobAddress: j.address,
    jobGeo: j.geo,
    title: j.title,
    items: j.items.length ? j.items.map((i) => ({ ...i })) : [{ code: '', description: j.title, unit: '', quantity: 1, unitPrice: 0 }],
    applyTps: s.chargeTaxes,
    applyTvq: s.chargeTaxes,
    notes: s.invoiceNotes,
    status: 'draft',
    payments: [],
    jobId: id,
    createdAt: now,
    updatedAt: now,
  };
  const docId = await db.docs.add(doc);
  await db.jobs.update(id, { docId, status: 'facture', doneAt: j.doneAt ?? now });
  // Les photos du job suivent la facture
  const media = await db.media.where('jobId').equals(id).toArray();
  await Promise.all(media.map((m) => db.media.update(m.id!, { docId })));
  try {
    await syncDayRoute(j.date);
  } catch {
    /* ignore */
  }
  return docId;
}

export function reminderText(j: Job, c: Client | undefined, companyName: string, phone: string, owner: string): string {
  if (c?.lang === 'en') {
    const whenEn = j.date === addDays(todayISO(), 1) ? 'tomorrow' : j.date === todayISO() ? 'today' : `on ${new Date(j.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })}`;
    const hourEn = j.time ? ` around ${j.time}` : '';
    return `Hello ${c.contact || c.name}, friendly reminder: ${companyName} will be there ${whenEn}${hourEn} for ${j.title || 'the scheduled work'}. See you soon! ${owner}${phone ? ` — ${phone}` : ''}`.replace(/\s+/g, ' ').trim();
  }
  const when = j.date === addDays(todayISO(), 1) ? 'demain' : j.date === todayISO() ? 'aujourd’hui' : `le ${formatDate(j.date)}`;
  const hour = j.time ? ` vers ${j.time.replace(':', ' h ')}` : '';
  return `Bonjour ${c?.contact || c?.name || ''}, petit rappel: ${companyName} passera ${when}${hour} pour ${j.title || 'les travaux prévus'}. Au plaisir! ${owner}${phone ? ` — ${phone}` : ''}`.replace(/\s+/g, ' ').trim();
}

export function smsLink(phone: string, body: string): string {
  const num = phone.replace(/[^\d+]/g, '');
  return `sms:${num}?&body=${encodeURIComponent(body)}`;
}

/** Route du jour manquante (ex.: jobs terminés par un employé): la calculer côté propriétaire. */
export async function ensureDayRoute(date: string): Promise<void> {
  const done = (await jobsOfDay(date)).filter((j) => j.status === 'fait' || j.status === 'facture');
  if (!done.length) return;
  const legs = await db.trips.where('routeDate').equals(date).toArray();
  const covered = new Set(legs.map((t) => t.jobId));
  if (done.some((j) => !covered.has(j.id))) await syncDayRoute(date).catch(() => undefined);
}

/** La « date des travaux » d'une facture ou soumission apparaît dans l'agenda: on crée (ou met à jour) la job liée. */
export async function syncJobFromDoc(docId: number): Promise<void> {
  const d = await db.docs.get(docId);
  if (!d || !d.jobDate || d.status === 'cancelled' || d.status === 'refused' || !d.clientId) return;
  const existing = d.jobId ? await db.jobs.get(d.jobId) : undefined;
  const isInvoice = d.type === 'invoice';
  if (existing) {
    if (existing.status === 'annule') return;
    const patch: Partial<Job> = {};
    if (existing.date !== d.jobDate) patch.date = d.jobDate;
    if (d.jobAddress && existing.address !== d.jobAddress) {
      patch.address = d.jobAddress;
      patch.geo = d.jobGeo;
    }
    if (isInvoice && existing.status === 'planifie' && d.status === 'paid') patch.status = 'facture';
    if (Object.keys(patch).length) {
      await db.jobs.update(existing.id!, patch);
      try {
        await syncDayRoute(d.jobDate);
        if (patch.date && existing.date !== patch.date) await syncDayRoute(existing.date);
      } catch {
        /* adresse du domicile manquante */
      }
    }
    return;
  }
  const j = blankJob(d.jobDate, d.clientId);
  j.address = d.jobAddress;
  j.geo = d.jobGeo;
  j.title = d.title || d.items.map((i) => i.description).filter(Boolean).join(', ').slice(0, 80);
  j.items = d.items.map((i) => ({ ...i }));
  j.status = isInvoice ? 'facture' : 'planifie';
  if (isInvoice) {
    j.docId = docId;
    j.doneAt = new Date().toISOString();
  }
  const id = await db.jobs.add(j);
  // Le trajet est maintenant compté dans la route du jour (agenda): on retire celui de la facture pour ne pas le doubler
  if (d.tripId) await db.trips.delete(d.tripId);
  await db.docs.update(docId, { jobId: id, tripId: undefined });
  try {
    await syncDayRoute(d.jobDate);
  } catch {
    /* adresse du domicile manquante */
  }
}
