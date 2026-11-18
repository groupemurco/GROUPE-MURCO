// Une estimation faite chez le client → sa soumission → (job des travaux) → sa facture, tout est relié.
import { db, type Doc, type Job } from './db';
import { addDays, todayISO } from './utils';

/** La dernière estimation faite chez ce client (45 derniers jours) qui n'a pas encore de soumission. */
export async function pendingEstimate(clientId: number): Promise<Job | undefined> {
  const since = addDays(todayISO(), -45);
  const taken = new Set((await db.docs.where('clientId').equals(clientId).toArray()).map((d) => d.estimateJobId).filter((x): x is number => !!x));
  return (await db.jobs.where('clientId').equals(clientId).toArray())
    .filter((j) => j.type === 'estimation' && j.status === 'fait' && j.date >= since && j.id !== undefined && !taken.has(j.id))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** La soumission faite à partir de cette estimation. */
export async function quoteOfEstimate(job: Job): Promise<Doc | undefined> {
  return (await db.docs.where('clientId').equals(job.clientId).toArray()).find((d) => d.type === 'quote' && d.estimateJobId === job.id);
}
