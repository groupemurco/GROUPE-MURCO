import { Banknote, Bell, CalendarPlus, ChevronDown, ChevronRight, CircleCheck, ClipboardCheck, Eye, Inbox, PenLine, Receipt, Send, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildActivity, buildInsights, buildPipeline, whenLabel, type Activity, type EventKind, type StageKey } from '../lib/cockpit';
import { saveSettings, type Client, type Doc, type Job, type Lead, type Settings } from '../lib/db';
import { money, todayISO } from '../lib/utils';
import { CountUp } from './CountUp';
import { LeaAvatar } from './LeaChat';
import { Modal } from './Modal';

const STAGE_ICON: Record<StageKey, typeof Send> = { estimations: ClipboardCheck, envoyees: Send, planifier: CalendarPlus, facturer: Receipt, encaisser: Banknote };
const EVENT_ICON: Record<EventKind, typeof Send> = { signed: PenLine, viewed: Eye, paid: Banknote, review: Star, lead: Inbox, sent: Send, done: CircleCheck };

interface Props { docs: Doc[]; jobs: Job[]; leads: Lead[]; clients: Map<number, Client>; s: Settings; show: (k: string) => boolean }

/** Poste de pilotage de l'accueil: l'argent en route, les nouvelles des clients, et ce que Léa remarque dans les chiffres. */
export function Cockpit({ docs, jobs, leads, clients, s, show }: Props) {
  const today = todayISO();
  const stages = useMemo(() => buildPipeline(docs, jobs, clients, s, today), [docs, jobs, clients, s, today]);
  const events = useMemo(() => buildActivity(docs, jobs, leads, clients, today), [docs, jobs, leads, clients, today]);
  const insights = useMemo(() => buildInsights(docs, jobs, clients, s, today), [docs, jobs, clients, s, today]);
  const [open, setOpen] = useState<StageKey | null>(null);
  const [feed, setFeed] = useState(false);

  const inPlay = stages.reduce((a, st) => a + st.amount, 0);
  const max = Math.max(1, ...stages.map((st) => st.amount));
  const busy = stages.some((st) => st.count > 0);
  const seenAt = s.activitySeenAt ?? '';
  const fresh = events.filter((e) => e.fromClient && e.at > seenAt);
  const openFeed = () => {
    setFeed(true);
    if (events[0] && events[0].at > seenAt) void saveSettings({ activitySeenAt: new Date().toISOString() });
  };

  return (
    <>
      {show('pipeline') && busy && (
        <section className="card ck-pipe" aria-label="L’argent en route">
          <div className="ck-head">
            <div>
              <h2>L’argent en route</h2>
              <div className="small muted">De l’estimation jusqu’au paiement</div>
            </div>
            <div className="ck-total"><b><CountUp value={inPlay} format={money} /></b><span>en jeu</span></div>
          </div>
          <ol className="ck-stages">
            {stages.map((st, i) => {
              const Icon = STAGE_ICON[st.key];
              const on = open === st.key;
              return (
                <li key={st.key} className={`ck-stage ${st.count ? '' : 'empty'} ${on ? 'on' : ''}`}>
                  <button type="button" className="ck-row" disabled={!st.count} aria-expanded={on} onClick={() => setOpen(on ? null : st.key)}>
                    <span className="ck-ico"><Icon size={18} /></span>
                    <span className="ck-txt">
                      <strong>{st.label}</strong>
                      <small>{st.alert ?? st.hint}</small>
                    </span>
                    <span className="ck-num">
                      <b>{st.count}</b>
                      {st.amount > 0 && <small>{money(st.amount)}</small>}
                    </span>
                    {st.count > 0 && <ChevronDown size={16} className="ck-chev" />}
                  </button>
                  <span className="ck-bar" aria-hidden="true"><i style={{ width: `${st.amount ? Math.max(6, (st.amount / max) * 100) : 0}%`, transitionDelay: `${i * 70}ms` }} /></span>
                  {on && (
                    <div className="ck-items">
                      {st.items.slice(0, 8).map((it) => (
                        <Link key={it.id} to={it.to} className={`ck-item ${it.hot ? 'hot' : ''}`}>
                          <span><strong>{it.title}</strong><small>{it.sub}</small></span>
                          {it.amount > 0 && <b>{money(it.amount)}</b>}
                          <ChevronRight size={15} />
                        </Link>
                      ))}
                      {st.items.length > 8 && <div className="small muted">et {st.items.length - 8} de plus</div>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {show('activity') && events.length > 0 && (
        <section className="card ck-feed" aria-label="Dernières nouvelles">
          <div className="ck-head">
            <h2>Dernières nouvelles</h2>
            <button type="button" className="btn small" onClick={openFeed}><Bell size={14} /> Tout voir{fresh.length > 0 && <i className="ck-dot">{fresh.length}</i>}</button>
          </div>
          <EventList events={events.slice(0, 4)} today={today} seenAt={seenAt} />
        </section>
      )}

      {show('insights') && insights.length > 0 && (
        <section className="card ck-insights" aria-label="Léa a remarqué">
          <div className="ck-head">
            <div className="ck-lea"><LeaAvatar size={34} /><div><h2>Léa a remarqué</h2><div className="small muted">D’après tes chiffres</div></div></div>
          </div>
          {insights.map((x) => (
            <div key={x.key} className={`ck-insight ${x.tone}`}>
              <span>{x.text}</span>
              {x.action && <Link className="btn small" to={x.action.to}>{x.action.label}</Link>}
            </div>
          ))}
        </section>
      )}

      {feed && (
        <Modal title="Dernières nouvelles" onClose={() => setFeed(false)}>
          <EventList events={events} today={today} seenAt={seenAt} onPick={() => setFeed(false)} />
        </Modal>
      )}
    </>
  );
}

export function EventList({ events, today, seenAt, onPick }: { events: Activity[]; today: string; seenAt: string; onPick?: () => void }) {
  return (
    <div className="ck-events">
      {events.map((e) => {
        const Icon = EVENT_ICON[e.kind];
        return (
          <Link key={e.key} to={e.to} className={`ck-event ${e.kind} ${e.fromClient && e.at > seenAt ? 'new' : ''}`} onClick={onPick}>
            <span className="ck-ev-ico"><Icon size={15} /></span>
            <span className="ck-ev-txt">{e.text}</span>
            <small>{whenLabel(e.at, today)}</small>
          </Link>
        );
      })}
    </div>
  );
}
