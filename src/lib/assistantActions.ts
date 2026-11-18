import type { Intent } from './assistant';
import { completeJob, jobToInvoice, syncDayRoute } from './agenda';
import { db, getSettings, takeNextNumber, type Client, type Doc } from './db';
import { splitTaxes } from './receipt';
import { buildTodos } from './todo';
import { createOrder } from './orders';
import { plural } from './tradeCalc';
import { addDays, docTotals, money, todayISO } from './utils';

// L'assistant prépare l'action, tu confirmes. Rien n'est modifié avant « Confirmer ».

export interface Step {
  label: string;
  run: () => Promise<Outcome>;
}
export interface Outcome {
  title: string;
  say: string;
  links?: { label: string; to: string }[];
  next?: Step[]; // actions qu'on peut enchaîner (ex.: facturer après « job finie »)
  relance?: Doc; // ouvrir la relance (texto / courriel) de ce document
  todo?: boolean; // afficher la liste « À confirmer »
  done?: boolean; // action faite (vs simple réponse)
}
export interface Proposal extends Outcome {
  confirm?: Step;
}

const dayLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
const hh = (t?: string) => (t ? ` à ${Number(t.slice(0, 2))} h${t.slice(3) !== '00' ? ` ${t.slice(3)}` : ''}` : '');
const round = (n: number) => `${Math.round(n).toLocaleString('fr-CA')} $`;

/** Facture à partir d'une soumission (après une visite). */
export async function quoteToInvoice(q: Doc): Promise<number> {
  if (q.convertedInvoiceId && (await db.docs.get(q.convertedInvoiceId))) return q.convertedInvoiceId;
  const st = await getSettings();
  const now = new Date().toISOString();
  const date = todayISO();
  const invId = await db.docs.add({
    ...q, id: undefined, type: 'invoice', number: await takeNextNumber('invoice'), date, dueDate: addDays(date, st.paymentTermsDays), notes: st.invoiceNotes,
    status: 'draft', payments: [], sourceQuoteId: q.id, signature: undefined, portalToken: undefined, viewedAt: undefined, sentAt: undefined, review: undefined, createdAt: now, updatedAt: now,
  });
  await db.docs.update(q.id!, { convertedInvoiceId: invId, status: q.status === 'draft' || q.status === 'sent' ? 'accepted' : q.status });
  if (q.jobId) await db.jobs.update(q.jobId, { docId: invId });
  return invId;
}

const needClient = (what: string): Proposal => ({ title: 'Pour quel client?', say: `${what} pour quel client? Redis-le avec le nom, par exemple « ${what.toLowerCase()} de Girard ».` });

export async function propose(intent: Intent): Promise<Proposal> {
  const today = todayISO();
  const s = await getSettings();
  const client: Client | undefined = intent.clientId ? await db.clients.get(intent.clientId) : undefined;
  const who = client?.name ?? '';

  switch (intent.kind) {
    case 'facturer': {
      if (!client) {
        const todos = (await buildTodos(today)).filter((t) => t.kind === 'facturer');
        if (todos.length === 1) return propose({ kind: 'facturer', clientId: todos[0].job!.clientId });
        return { ...needClient('Facturer'), todo: todos.length > 0, say: todos.length ? `Tu as ${todos.length} jobs faites pas encore facturées. Laquelle?` : 'Facturer pour quel client?' };
      }
      const jobs = (await db.jobs.where('clientId').equals(client.id!).toArray()).filter((j) => j.status !== 'annule' && j.date <= today && !(j.docId && j.status === 'facture')).sort((a, b) => b.date.localeCompare(a.date));
      const job = jobs.find((j) => j.status === 'fait') ?? jobs.find((j) => j.status === 'planifie');
      const quote = (await db.docs.where('clientId').equals(client.id!).toArray()).filter((d) => d.type === 'quote' && !d.convertedInvoiceId && d.status !== 'refused' && d.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date))[0];
      if (job && job.items.length) {
        const amt = job.items.reduce((a, it) => a + it.quantity * it.unitPrice, 0);
        return {
          title: `Facturer ${who}`, say: `Je fais la facture de ${who} pour « ${job.title} »${amt ? `, ${round(amt)} avant taxes` : ''}?`,
          confirm: { label: 'Créer la facture', run: async () => { const id = await jobToInvoice(job.id!); return { done: true, title: 'Facture prête', say: 'La facture est prête. Tu peux l’envoyer.', links: [{ label: 'Voir et envoyer la facture', to: `/doc/${id}` }] }; } },
        };
      }
      if (quote) {
        return {
          title: `Facturer ${who}`, say: `Je fais la facture de ${who} à partir de la soumission ${quote.number}, ${money(docTotals(quote, s).total)}?`,
          confirm: { label: 'Créer la facture', run: async () => { const id = await quoteToInvoice(quote); return { done: true, title: 'Facture prête', say: 'La facture est prête. Tu peux l’envoyer.', links: [{ label: 'Voir et envoyer la facture', to: `/doc/${id}` }] }; } },
        };
      }
      return { title: 'Rien à facturer', say: `Je n’ai pas trouvé de job ni de soumission à facturer pour ${who}.`, links: [{ label: `Nouvelle facture pour ${who}`, to: `/doc/new?type=invoice&client=${client.id}` }] };
    }

    case 'payee': {
      if (!client) return needClient('Marquer payée');
      const inv = (await db.docs.where('clientId').equals(client.id!).toArray()).filter((d) => d.type === 'invoice' && ['sent', 'partial', 'draft'].includes(d.status)).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!inv) return { title: 'Aucune facture ouverte', say: `${who} n’a aucune facture à payer.` };
      const bal = docTotals(inv, s).balance;
      const method = intent.method ?? 'Non précisé';
      return {
        title: `Paiement de ${who}`, say: `Je marque la facture ${inv.number} de ${who} payée, ${money(bal)}${intent.method ? ` en ${intent.method.toLowerCase()}` : ''}?`,
        confirm: {
          label: 'Marquer payée',
          run: async () => {
            await db.docs.update(inv.id!, { payments: [...inv.payments, { date: today, amount: bal, method }], status: 'paid', updatedAt: new Date().toISOString() });
            return { done: true, title: 'Payée', say: `C’est noté: ${money(bal)} reçus de ${who}.`, links: [{ label: `Voir la facture ${inv.number}`, to: `/doc/${inv.id}` }] };
          },
        },
      };
    }

    case 'relancer': {
      if (client) {
        const doc = (await db.docs.where('clientId').equals(client.id!).toArray()).filter((d) => (d.type === 'invoice' && (d.status === 'sent' || d.status === 'partial')) || (d.type === 'quote' && d.status === 'sent')).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
        if (!doc) return { title: 'Rien à relancer', say: `${who} n’a pas de facture ni de soumission en attente.` };
        return { title: `Relancer ${who}`, say: `Voici la relance pour ${doc.type === 'invoice' ? 'la facture' : 'la soumission'} ${doc.number} de ${who}. Tu choisis texto ou courriel.`, relance: doc };
      }
      const late = (await buildTodos(today)).filter((t) => t.kind === 'retard' || t.kind === 'soumission');
      return { title: 'Relances', say: late.length ? `Tu as ${late.length} relance${late.length > 1 ? 's' : ''} à faire. Touche « Relancer » sur chacune.` : 'Personne à relancer, tout est à jour.', todo: late.length > 0 };
    }

    case 'depense': {
      const total = intent.amount ?? 0;
      const vendor = intent.vendor ?? '';
      return {
        title: 'Nouvelle dépense', say: `J’ajoute une dépense de ${money(total)}${intent.category && intent.category !== 'Autre' ? `, ${intent.category.toLowerCase()}` : ''}${vendor ? `, chez ${vendor}` : ''}?`,
        confirm: {
          label: 'Ajouter la dépense',
          run: async () => {
            const t = splitTaxes(total, s.tpsRate, s.tvqRate);
            const id = await db.expenses.add({ date: today, vendor, category: intent.category ?? 'Autre', ...t, total, paymentMethod: 'Carte', notes: 'Ajoutée par l’assistant', locationLabel: vendor, createdAt: new Date().toISOString() });
            return { done: true, title: 'Dépense ajoutée', say: `C’est ajouté. Prends le reçu en photo quand tu peux.`, links: [{ label: 'Ajouter la photo du reçu', to: `/depenses/${id}` }] };
          },
        },
      };
    }

    case 'deplacer': {
      if (!client) return needClient('Déplacer la job');
      const job = (await db.jobs.where('clientId').equals(client.id!).toArray()).filter((j) => j.status === 'planifie').sort((a, b) => Math.abs(new Date(a.date).getTime() - Date.now()) - Math.abs(new Date(b.date).getTime() - Date.now()))[0];
      if (!job) return { title: 'Aucune job planifiée', say: `${who} n’a pas de job planifiée.` };
      if (!intent.date) return { title: 'À quelle date?', say: `La job de ${who} est le ${dayLabel(job.date)}. Redis-moi la nouvelle date, par exemple « déplace ${who} à vendredi 9 h ».` };
      const date = intent.date;
      const time = intent.time ?? job.time;
      return {
        title: `Déplacer ${who}`, say: `Je déplace la job de ${who} du ${dayLabel(job.date)} au ${dayLabel(date)}${hh(time)}?`,
        confirm: {
          label: 'Déplacer',
          run: async () => {
            await db.jobs.update(job.id!, { date, time, remindedAt: undefined });
            await syncDayRoute(job.date).catch(() => undefined);
            return { done: true, title: 'Déplacée', say: `C’est fait. Pense à prévenir ${who}.`, links: [{ label: 'Voir l’agenda', to: `/agenda?d=${date}&v=jour` }] };
          },
        },
      };
    }

    case 'fini': {
      if (!client) {
        const todays = (await db.jobs.where('date').equals(today).toArray()).filter((j) => j.status === 'planifie');
        if (todays.length === 1) return propose({ kind: 'fini', clientId: todays[0].clientId });
        return needClient('Job finie');
      }
      const job = (await db.jobs.where('clientId').equals(client.id!).toArray()).filter((j) => j.status === 'planifie' && j.date <= addDays(today, 1)).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!job) return { title: 'Aucune job en cours', say: `Je ne trouve pas de job planifiée pour ${who}.` };
      return {
        title: `Job finie chez ${who}`, say: `Je marque la job de ${who} comme faite?`,
        confirm: {
          label: 'Marquer faite',
          run: async () => {
            const r = await completeJob(job.id!);
            const km = r.trips.reduce((a, t) => a + t.totalKm, 0);
            return {
              done: true, title: 'Job faite', say: `Bravo! Je fais la facture tout de suite?${km ? ` La route du jour, ${Math.round(km)} kilomètres, est au journal de bord.` : ''}`,
              next: [{ label: 'Faire la facture', run: async () => { const id = await jobToInvoice(job.id!); return { done: true, title: 'Facture prête', say: 'La facture est prête.', links: [{ label: 'Voir et envoyer la facture', to: `/doc/${id}` }] }; } }],
            };
          },
        },
      };
    }

    case 'combien': {
      const from = intent.period === 'jour' ? today : intent.period === 'semaine' ? addDays(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7)) : intent.period === 'annee' ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
      const docs = (await db.docs.toArray()).filter((d) => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'cancelled');
      const billed = docs.filter((d) => d.date >= from && d.date <= today).reduce((a, d) => a + docTotals(d, s).subtotal, 0);
      const cashed = docs.reduce((a, d) => a + d.payments.filter((p) => p.date >= from && p.date <= today).reduce((x, p) => x + p.amount, 0), 0);
      const owed = docs.filter((d) => d.status === 'sent' || d.status === 'partial').reduce((a, d) => a + docTotals(d, s).balance, 0);
      const spent = (await db.expenses.toArray()).filter((e) => e.date >= from && e.date <= today).reduce((a, e) => a + e.subtotal, 0);
      const when = intent.period === 'jour' ? 'Aujourd’hui' : intent.period === 'semaine' ? 'Cette semaine' : intent.period === 'annee' ? 'Cette année' : 'Ce mois-ci';
      return {
        title: `${when}`,
        say: `${when}, tu as facturé ${round(billed)} avant taxes et encaissé ${round(cashed)}. Tes dépenses: ${round(spent)}. Il te reste ${round(owed)} à recevoir.`,
        links: [{ label: 'Voir les factures', to: '/factures' }, { label: 'Rapports', to: '/rapports' }],
      };
    }

    case 'horaire': {
      const date = intent.date ?? today;
      const to = intent.period === 'semaine' ? addDays(date, 6) : date;
      const jobs = (await db.jobs.where('date').between(date, to, true, true).toArray()).filter((j) => j.status === 'planifie').sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
      const names = new Map((await db.clients.toArray()).map((c) => [c.id!, c.name]));
      const when = date === today ? 'Aujourd’hui' : date === addDays(today, 1) ? 'Demain' : `Le ${dayLabel(date)}`;
      if (!jobs.length) return { title: when, say: `${when}, tu n’as rien de planifié.`, links: [{ label: 'Voir l’agenda', to: `/agenda?d=${date}&v=${intent.period === 'semaine' ? 'semaine' : 'jour'}` }] };
      const list = jobs.map((j) => `${intent.period === 'semaine' ? `${dayLabel(j.date).split(' ')[0]} ` : ''}${j.time ? `${hh(j.time).replace(' à ', '')} ` : ''}${names.get(j.clientId) ?? 'Client'}`);
      return { title: when, say: `${when}, tu as ${jobs.length} job${jobs.length > 1 ? 's' : ''}: ${list.join(', ')}.`, links: [{ label: 'Voir l’agenda', to: `/agenda?d=${date}&v=${intent.period === 'semaine' ? 'semaine' : 'jour'}` }] };
    }

    case 'afaire': {
      const n = (await buildTodos(today)).length;
      return { title: 'À confirmer', say: n ? `Tu as ${n} chose${n > 1 ? 's' : ''} à confirmer.` : 'Tout est à jour, rien à confirmer.', todo: n > 0 };
    }

    case 'commander': {
      const items = intent.items?.length ? intent.items : [{ description: '', qty: 1, unit: 'unité' }];
      const what = intent.items?.length ? intent.items.map((i) => `${String(i.qty).replace('.', ',')} ${plural(i.unit, i.qty)} de ${i.description.toLowerCase()}`).join(', ') : 'ta liste';
      return {
        title: 'Commande au fournisseur',
        say: `Je prépare la commande${intent.vendor ? ` chez ${intent.vendor}` : ''}: ${what}?`,
        confirm: {
          label: 'Préparer la commande',
          run: async () => {
            const id = await createOrder(items, { ...(intent.vendor ? { supplier: intent.vendor } : {}), clientId: intent.clientId, neededBy: intent.date });
            return { done: true, title: 'Commande prête', say: 'La commande est prête. Ajoute le téléphone ou le courriel du fournisseur et envoie-la.', links: [{ label: 'Ouvrir et envoyer', to: `/achats/${id}` }] };
          },
        },
      };
    }

    default:
      return { title: '', say: '' };
  }
}
