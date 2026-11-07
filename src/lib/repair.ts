// Répare les documents dont le numéro de client est « presque » celui d'un vrai client (l'IA avait recopié le numéro avec une erreur d'arrondi).
import { db } from './db';

let done = false;

export async function repairClientIds(): Promise<number> {
  if (done) return 0;
  const clients = await db.clients.toArray();
  const ids = clients.map((c) => c.id!).filter((n) => Number.isFinite(n));
  if (!ids.length) return 0; // les clients ne sont pas encore chargés: on réessaiera
  done = true;
  const known = new Set(ids);
  const nearest = (n: number) => {
    let best: number | undefined;
    let gap = Infinity;
    for (const id of ids) {
      const d = Math.abs(id - n);
      if (d < gap) { gap = d; best = id; }
    }
    return best !== undefined && gap <= 1000 ? best : undefined;
  };
  let fixed = 0;
  const fix = async <T extends { id?: number; clientId?: number }>(rows: T[], update: (id: number, cid: number) => Promise<unknown>) => {
    for (const r of rows) {
      if (r.id === undefined || !r.clientId || known.has(r.clientId)) continue;
      const to = nearest(r.clientId);
      if (to !== undefined) {
        await update(r.id, to);
        fixed++;
      }
    }
  };
  await fix(await db.docs.toArray(), (id, cid) => db.docs.update(id, { clientId: cid }));
  await fix(await db.jobs.toArray(), (id, cid) => db.jobs.update(id, { clientId: cid }));
  await fix(await db.trips.toArray(), (id, cid) => db.trips.update(id, { clientId: cid }));
  await fix(await db.expenses.toArray(), (id, cid) => db.expenses.update(id, { clientId: cid }));
  return fixed;
}
