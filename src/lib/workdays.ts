// Une job sur plusieurs journées (ex.: estimation le 10, travaux vendredi et lundi): chaque journée est une job à l'agenda,
// toutes reliées par le même groupe. La soumission et la facture couvrent l'ensemble des journées.
import { db, type Job } from './db';

export const groupKey = (j: Pick<Job, 'id' | 'groupId'>) => j.groupId ?? j.id;

/** Toutes les journées de travail de la même job (annulées exclues), de la première à la dernière. */
export async function workDays(j: Job): Promise<Job[]> {
  const gid = groupKey(j);
  return (await db.jobs.where('clientId').equals(j.clientId).toArray())
    .filter((x) => groupKey(x) === gid && x.status !== 'annule')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

/** Ajoute une journée de travail à cette job (même client, adresse et équipe; le prix reste sur la première journée). */
export async function addWorkDay(j: Job, date: string, time: string): Promise<number> {
  if (!j.id) throw new Error('Enregistre la job avant d’ajouter une journée.');
  const gid = groupKey(j)!;
  if (!j.groupId) await db.jobs.update(j.id, { groupId: gid });
  const n = (await workDays({ ...j, groupId: gid })).length + 1;
  const base = (j.title || '').replace(/\s*\(jour \d+\)\s*$/i, '').trim();
  return (await db.jobs.add({
    date, time, durationMin: j.durationMin, clientId: j.clientId, address: j.address, geo: j.geo, title: base ? `${base} (jour ${n})` : `Suite des travaux (jour ${n})`,
    items: [], notes: j.notes, status: 'planifie', order: 0, recurrence: 'none', type: j.type, color: j.color, assignees: j.assignees, projectId: j.projectId, groupId: gid,
    createdAt: new Date().toISOString(),
  })) as number;
}

/**
 * Jobs prêtes à facturer: une seule entrée par job de plusieurs journées, et seulement quand toutes ses journées sont faites.
 * `all` = toutes les jobs connues (pour retrouver les journées d'un même groupe).
 */
export function readyToBill(done: Job[], all: Job[]): Job[] {
  const out: Job[] = [];
  const seen = new Set<number | undefined>();
  for (const j of done) {
    const gid = groupKey(j);
    if (!j.groupId) {
      out.push(j);
      continue;
    }
    if (seen.has(gid)) continue;
    seen.add(gid);
    const days = all.filter((x) => groupKey(x) === gid && x.status !== 'annule');
    if (days.every((x) => x.status === 'fait' || x.status === 'facture')) out.push(days.sort((a, b) => a.date.localeCompare(b.date))[0]);
  }
  return out;
}
