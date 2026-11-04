import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Bell, ClipboardList, Clock, FileText, Inbox, Phone } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobToInvoice } from '../lib/agenda';
import { setStage } from '../lib/crm';
import { db } from '../lib/db';
import { buildTodos, snoozeTodo, type Todo, type TodoKind } from '../lib/todo';
import { Ico } from './Icons';
import { RelanceModal } from './RelanceModal';
import { ReminderModal } from './ReminderModal';
import { errMsg, useToast } from './Toast';

const ICON: Record<TodoKind, typeof Bell> = { rappel: Bell, facturer: FileText, retard: AlertTriangle, soumission: ClipboardList, demande: Inbox, punch: Clock };
const ACTION: Record<TodoKind, string> = { rappel: 'Texter le rappel', facturer: 'Facturer', retard: 'Relancer', soumission: 'Relancer', demande: 'Appeler', punch: 'Vérifier' };

/** « À confirmer »: le travail de bureau préparé par l'app — un toucher pour le faire, ou « Plus tard ». */
export function ConfirmList({ limit = 5, title = 'À confirmer' }: { limit?: number; title?: string }) {
  const nav = useNavigate();
  const notify = useToast();
  const [all, setAll] = useState(false);
  const [remind, setRemind] = useState<Todo | null>(null);
  const [relance, setRelance] = useState<Todo | null>(null);
  // Recalcule quand jobs, factures, demandes, punchs ou réglages changent
  const todos = useLiveQuery(async () => {
    await Promise.all([db.jobs.count(), db.docs.count(), db.leads.count(), db.punches.count(), db.settings.get('main')]);
    return buildTodos();
  }, []);
  if (!todos) return null;

  const run = async (t: Todo) => {
    try {
      if (t.kind === 'rappel') return setRemind(t);
      if (t.kind === 'retard' || t.kind === 'soumission') return setRelance(t);
      if (t.kind === 'facturer') return nav(`/doc/${await jobToInvoice(t.job!.id!)}`);
      if (t.kind === 'punch') return nav('/temps');
      if (t.kind === 'demande') {
        await setStage(t.lead!.id!, 'contacte');
        if (t.lead!.phone) window.location.href = `tel:${t.lead!.phone}`;
        else nav('/demandes');
      }
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };
  const later = async (t: Todo) => {
    await snoozeTodo(t.key, t.kind === 'soumission' || t.kind === 'retard' ? 3 : 1);
    notify('Remis à plus tard');
  };

  const shown = all ? todos : todos.slice(0, limit);
  return (
    <div className="card todo">
      <div className="card-head">
        <Ico n="checklist" size={20} /><h2>{title}</h2>
        {todos.length > 0 && <span className="todo-count">{todos.length}</span>}
      </div>
      {todos.length === 0 ? (
        <div className="empty-ok"><span className="ok-check">✓</span> Tout est à jour. Beau travail!</div>
      ) : (
        <div className="todo-list">
          {shown.map((t) => {
            const I = ICON[t.kind];
            return (
              <div key={t.key} className={`todo-item k-${t.kind}`}>
                <span className="todo-ico"><I size={16} /></span>
                <div className="todo-txt"><strong>{t.title}</strong><small>{t.sub}</small></div>
                <div className="todo-act">
                  <button className="btn small accent" onClick={() => void run(t)}>{t.kind === 'demande' && t.lead?.phone ? <Phone size={14} /> : null}{ACTION[t.kind]}</button>
                  <button className="btn small" onClick={() => void later(t)}>Plus tard</button>
                </div>
              </div>
            );
          })}
          {todos.length > limit && <button className="btn small block" onClick={() => setAll(!all)}>{all ? 'Voir moins' : `Tout voir (${todos.length})`}</button>}
        </div>
      )}
      {remind && <ReminderModal job={remind.job!} client={remind.client} onClose={() => setRemind(null)} />}
      {relance && <RelanceModal doc={relance.doc!} client={relance.client} onClose={() => { void snoozeTodo(relance.key, 7); setRelance(null); }} />}
    </div>
  );
}
