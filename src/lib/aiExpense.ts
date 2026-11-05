// Léa enregistre un reçu pris en photo (avec la photo), puis note le trajet: d'où tu partais → commerce → où tu t'en vas.
import { jobGeo } from './agenda';
import { db, getSettings, type ExpenseOrigin, type GeoPoint } from './db';
import { currentPosition, drivingDistance, geocode, reverseGeocode } from './geo';
import { splitTaxes } from './receipt';
import { ensureHomeGeo, syncTripForExpense } from './trips';
import { km, todayISO } from './utils';

export type Place = { kind: 'maison' } | { kind: 'job'; jobId: number } | { kind: 'autre'; address: string } | { kind: 'aucun' };

export interface ReceiptInput {
  vendor: string;
  date: string;
  total: number;
  category: string;
  shopAddress: string;
  from: Place;
  to: Place;
  photo?: { data: string; mimeType: string };
}

interface Resolved { kind: 'maison' | 'job' | 'autre'; geo: GeoPoint; label: string; jobId?: number; clientId?: number }

async function resolve(p: Place): Promise<Resolved | null> {
  if (p.kind === 'maison') {
    const h = await ensureHomeGeo();
    return { kind: 'maison', geo: h.geo, label: h.label };
  }
  if (p.kind === 'job') {
    const j = await db.jobs.get(p.jobId);
    if (!j) return null;
    const c = await db.clients.get(j.clientId);
    const g = await jobGeo(j, c);
    return g ? { kind: 'job', geo: g.geo, label: `${c?.name ?? 'Job'} — ${g.label}`, jobId: j.id, clientId: j.clientId } : null;
  }
  if (p.kind === 'autre' && p.address.trim()) {
    const g = await geocode(p.address.trim());
    return g ? { kind: 'autre', geo: g.geo, label: p.address.trim() } : null;
  }
  return null;
}

/** Enregistre la dépense (photo comprise) et les trajets. Renvoie un résumé à afficher. */
export async function saveReceipt(i: ReceiptInput): Promise<{ summary: string; expenseId: number }> {
  const st = await getSettings();
  const now = new Date().toISOString();
  const vendor = i.vendor.trim();

  // Où est le commerce: l'adresse donnée, sinon ta position (si le reçu est d'aujourd'hui)
  let geo: GeoPoint | undefined;
  let label = vendor;
  let source: 'adresse' | 'gps' | undefined;
  if (i.shopAddress.trim()) {
    const g = await geocode(i.shopAddress.trim()).catch(() => null);
    if (g) {
      geo = g.geo;
      label = i.shopAddress.trim();
      source = 'adresse';
    }
  }
  if (!geo && i.date === todayISO()) {
    try {
      geo = await currentPosition();
      label = (await reverseGeocode(geo).catch(() => '')) || vendor;
      source = 'gps';
    } catch { /* pas de GPS: on enregistre sans trajet */ }
  }

  const from = i.from.kind === 'aucun' ? null : await resolve(i.from).catch(() => null);
  let origin: ExpenseOrigin | undefined;
  if (from && from.kind !== 'maison') origin = { kind: from.kind, label: from.label, geo: from.geo, jobId: from.jobId, clientId: from.clientId };
  const legOne = geo && from ? await drivingDistance(from.geo, geo).catch(() => null) : null;

  const photo = i.photo ? await (await fetch(`data:${i.photo.mimeType};base64,${i.photo.data}`)).blob() : undefined;
  const total = Math.round(i.total * 100) / 100;
  const id = await db.expenses.add({
    date: i.date, vendor, category: i.category, ...splitTaxes(total, st.tpsRate, st.tvqRate), total, paymentMethod: 'Carte', notes: 'Reçu enregistré avec Léa',
    photo, photoName: photo ? 'recu.jpg' : undefined, photoType: photo?.type, locationLabel: label, geo, geoSource: source,
    kmFromHome: from?.kind === 'maison' ? legOne?.km : undefined, origin, originKm: legOne?.km, clientId: origin?.clientId, createdAt: now,
  });

  let summary = `Reçu de ${vendor || 'dépense'} enregistré${photo ? ' avec la photo' : ''}`;
  if (geo && from) {
    const t = await syncTripForExpense(id, false).catch(() => null);
    if (t) summary += ` · ${km(t.totalKm)} de ${from.kind === 'maison' ? 'ton domicile' : from.label} jusqu’au commerce`;
  }
  const to = i.to.kind === 'aucun' ? null : await resolve(i.to).catch(() => null);
  if (geo && to) {
    const r = await drivingDistance(geo, to.geo).catch(() => null);
    if (r) {
      await db.trips.add({
        date: i.date, fromLabel: label, fromGeo: geo, toLabel: to.label, toGeo: to.geo, oneWayKm: r.km, roundTrip: false, totalKm: Math.round(r.km * 10) / 10,
        reason: `${vendor || 'Commerce'} → ${to.label}`, clientId: to.clientId, jobId: to.jobId, expenseId: id, source: 'auto-recu', distanceMethod: r.method, durationMin: r.durationMin, createdAt: now,
      });
      summary += ` · puis ${km(r.km)} vers ${to.kind === 'maison' ? 'ton domicile' : to.label}`;
    }
  }
  if (!geo && (i.from.kind !== 'aucun' || i.to.kind !== 'aucun')) summary += ` · pas de trajet: je n’ai pas trouvé où est le commerce (donne-moi son adresse)`;
  return { summary: summary + '.', expenseId: id };
}
