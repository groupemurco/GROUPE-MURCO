import { X } from 'lucide-react';
import type { Doc } from '../lib/db';
import { formatDate } from '../lib/utils';

/** Date(s) des travaux: une ou plusieurs journées. Touche la case pour ajouter une date, la croix pour en retirer une. */
export function WorkDatesField({ doc, onChange }: { doc: Pick<Doc, 'jobDate' | 'extraDates'>; onChange: (p: Partial<Doc>) => void }) {
  const all = [...new Set([doc.jobDate, ...(doc.extraDates ?? [])].filter(Boolean))].sort();
  const setAll = (list: string[]) => {
    const l = [...new Set(list)].sort();
    onChange({ jobDate: l[0] ?? '', extraDates: l.slice(1) });
  };
  return (
    <div className="field full work-dates">
      <span>Date(s) des travaux <small className="muted">— une date par journée de travail</small></span>
      <div className="chips">
        {all.map((d) => (
          <span key={d} className="chip-btn on wd-chip">{formatDate(d)}<button type="button" className="icon-btn" aria-label={`Retirer le ${d}`} onClick={() => setAll(all.filter((x) => x !== d))}><X size={13} /></button></span>
        ))}
        <input type="date" className="wd-input" aria-label={all.length ? 'Ajouter une autre date' : 'Choisir la date des travaux'} value="" onChange={(e) => { if (e.target.value) setAll([...all, e.target.value]); }} />
        <span className="small muted">{all.length ? '← ajoute une autre date' : '← choisis une date'}</span>
      </div>
    </div>
  );
}
