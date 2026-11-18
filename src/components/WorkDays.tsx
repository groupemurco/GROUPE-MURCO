import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Job } from '../lib/db';
import { JOB_STATUS_LABEL } from '../lib/agenda';
import { addDays, formatDate } from '../lib/utils';
import { addWorkDay, workDays } from '../lib/workdays';
import { errMsg, useConfirm, useToast } from './Toast';

/** Une job sur plusieurs journées: chaque journée est à l'agenda, la soumission et la facture les couvrent toutes. */
export function WorkDays({ job }: { job: Job }) {
  const notify = useToast();
  const ask = useConfirm();
  const days = useLiveQuery(() => workDays(job), [job.id, job.groupId, job.clientId]) ?? [];
  const last = days.length ? days[days.length - 1].date : job.date;
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const next = date || addDays(last, 1);

  const add = async () => {
    setBusy(true);
    try {
      await addWorkDay(job, next, time || job.time);
      notify(`Journée du ${formatDate(next)} ajoutée à l'agenda`);
      setDate('');
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (d: Job) => {
    if (!(await ask({ title: `Retirer la journée du ${formatDate(d.date)}?`, message: 'Seulement cette journée est retirée de l\'agenda.', confirm: 'Retirer', danger: true }))) return;
    await db.jobs.delete(d.id!);
  };

  return (
    <div className="card workdays">
      <div className="card-head"><CalendarPlus size={18} /><h2>Journées de travail</h2></div>
      <div className="small muted" style={{ marginBottom: 8 }}>Les travaux prennent plus d’une journée? Ajoute chaque journée ici: elles sont toutes à l’agenda et une seule facture les couvre.</div>
      {days.length > 0 && (
        <div className="wd-list">
          {days.map((d, i) => (
            <div key={d.id} className={`wd-row ${d.id === job.id ? 'me' : ''}`}>
              <b>Jour {i + 1}</b>
              <Link to={`/job/${d.id}`}>{formatDate(d.date)}{d.time ? ` à ${d.time}` : ''}</Link>
              <span className={`badge ${d.status === 'planifie' ? 'blue' : d.status === 'fait' ? 'green' : 'gray'}`}>{JOB_STATUS_LABEL[d.status]}</span>
              {d.id !== job.id && d.status === 'planifie' && <button type="button" className="icon-btn" aria-label="Retirer cette journée" onClick={() => void remove(d)}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
      )}
      <div className="wd-add">
        <label className="field">Nouvelle journée<input type="date" value={next} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Heure<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <button type="button" className="btn accent" disabled={busy} onClick={() => void add()}>+ Ajouter la journée</button>
      </div>
    </div>
  );
}
