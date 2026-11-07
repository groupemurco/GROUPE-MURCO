import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowDown, ArrowUp, Bell, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Cloud, CloudDrizzle, CloudFog, CloudLightning,
  CloudRain, CloudSnow, CloudSun, FileText, Inbox, MapPin, Mic, Navigation, Palette, Phone, Plus, Repeat, Route, Search, Shuffle, Sun, Timer, Users, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type TouchEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { JobDoneSheet } from '../components/JobDoneSheet';
import { Ring } from '../components/PageHero';
import { Modal } from '../components/Modal';
import { ReminderModal } from '../components/ReminderModal';
import { errMsg, useToast } from '../components/Toast';
import { AgendaCustomize } from '../components/AgendaCustomize';
import { clientColor, DENSITY_PX, guessType, STATUS_COLOR, useAgendaPrefs, type AgendaPrefs, type JobType } from '../lib/agendaPrefs';
import { jobIcon } from '../lib/jobIcons';
import { completeJob, dayRouteLink, ensureDayRoute, JOB_STATUS_LABEL, jobToInvoice, optimizeDay, syncDayRoute } from '../lib/agenda';
import { OPEN_STAGES } from '../lib/crm';
import { db, saveSettings, type Client, type Job, type Lead, type Member } from '../lib/db';
import { geocode } from '../lib/geo';
import { useSettings } from '../lib/hooks';
import { weekStart } from '../lib/punch';
import { useSyncState } from '../lib/sync';
import { MEMBER_COLORS } from '../lib/team';
import { addDays, formatDate, km, lineAmount, money, todayISO, toISODate } from '../lib/utils';
import { badWeather, useWeather, WEATHER_LABEL, weatherKind, type DayWeather, type WeatherKind } from '../lib/weather';

type View = 'jour' | 'semaine' | 'mois' | 'liste';
const VIEWS: { key: View; label: string }[] = [
  { key: 'jour', label: 'Jour' },
  { key: 'semaine', label: 'Semaine' },
  { key: 'mois', label: 'Mois' },
  { key: 'liste', label: 'Liste' },
];
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const OWNER_COLOR = '#e0922f';
const VIEW_KEY = 'murco.agendaView';

const WEATHER_ICON: Record<WeatherKind, LucideIcon> = {
  soleil: Sun, nuageux: CloudSun, couvert: Cloud, brouillard: CloudFog, bruine: CloudDrizzle, pluie: CloudRain, neige: CloudSnow, orage: CloudLightning,
};

function monthGrid(month: string): string[] {
  const first = new Date(month + '-01T12:00:00');
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const start = addDays(toISODate(first), -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const jobTotal = (j: Job) => j.items.reduce((a, it) => a + lineAmount(it), 0);
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', opts);
const hoursTxt = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

/** Jobs avec une heure qui se chevauchent pour une même personne (ou toi, si non assigné). */
function conflicts(list: Job[]): Set<number> {
  const out = new Set<number>();
  const timed = list.filter((j) => j.time && j.status !== 'annule');
  for (let i = 0; i < timed.length; i++) {
    for (let k = i + 1; k < timed.length; k++) {
      const a = timed[i];
      const b = timed[k];
      const pa = a.assignees?.length ? a.assignees : [0];
      const pb = b.assignees?.length ? b.assignees : [0];
      if (!pa.some((p) => pb.includes(p))) continue;
      const a0 = toMin(a.time);
      const b0 = toMin(b.time);
      if (a0 < b0 + (b.durationMin || 60) && b0 < a0 + (a.durationMin || 60)) {
        out.add(a.id!);
        out.add(b.id!);
      }
    }
  }
  return out;
}

export default function Agenda() {
  const nav = useNavigate();
  const notify = useToast();
  const s = useSettings();
  const st = useSyncState();
  const isEmp = st.role === 'employe';
  const canEdit = !isEmp;
  const showMoney = !isEmp;
  const [params, setParams] = useSearchParams();
  const prefs = useAgendaPrefs();
  const today = todayISO();
  const sel = params.get('d') || today;
  const view: View = (params.get('v') as View) || (() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || prefs.defaultView || (matchMedia('(max-width: 860px)').matches ? 'jour' : 'semaine');
    } catch {
      return 'jour';
    }
  })();
  const [who, setWho] = useState<string>('tous'); // tous | moi | <memberId>
  const [showDone, setShowDone] = useState(true);
  const [showLeads, setShowLeads] = useState(true);
  const [q, setQ] = useState('');
  const [remind, setRemind] = useState<Job | null>(null);
  const [postpone, setPostpone] = useState<{ jobs: Job[]; label: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [custom, setCustom] = useState(false);
  const mobile = useMobile();
  const [remindOpen, setRemindOpen] = useState(false);
  const wx = useWeather(s.homeGeo);
  const weather = prefs.showWeather ? wx : {};

  // Position du domicile pour la météo (une seule fois)
  useEffect(() => {
    if (!s.homeGeo && s.homeAddress) geocode(s.homeAddress).then((r) => r && saveSettings({ homeGeo: r.geo })).catch(() => undefined);
  }, [s.homeGeo, s.homeAddress]);

  const range = useMemo((): [string, string] => {
    if (view === 'jour') return [sel, sel];
    if (view === 'semaine') {
      const w = weekStart(sel);
      return [w, addDays(w, 6)];
    }
    if (view === 'mois') {
      const g = monthGrid(sel.slice(0, 7));
      return [g[0], g[41]];
    }
    return [sel, addDays(sel, 59)];
  }, [view, sel]);

  const data = useLiveQuery(async () => {
    const [jobs, clients, members, trips, leads] = await Promise.all([
      db.jobs.where('date').between(range[0], range[1], true, true).toArray(),
      db.clients.toArray(),
      db.members.toArray(),
      db.trips.where('routeDate').equals(sel).toArray(),
      isEmp || (range[0] < today ? today : range[0]) > range[1]
        ? Promise.resolve([] as Lead[])
        : db.leads.where('nextAction').between(range[0] < today ? today : range[0], range[1], true, true).toArray().catch(() => [] as Lead[]),
    ]);
    const tomorrow = addDays(today, 1);
    const toRemind = canEdit ? (await db.jobs.where('date').between(today, tomorrow, true, true).toArray()).filter((j) => j.status === 'planifie' && !j.remindedAt) : [];
    return {
      jobs,
      clients: new Map(clients.map((c) => [c.id!, c])),
      members: new Map(members.map((m) => [m.id!, m])),
      memberList: members.filter((m) => m.active),
      trips,
      leads: leads.filter((l) => OPEN_STAGES.includes(l.stage)),
      toRemind,
    };
  }, [range[0], range[1], sel, isEmp]);

  useEffect(() => {
    if (st.role === 'owner' || st.role === 'admin') void ensureDayRoute(sel);
  }, [sel, st.role]);

  const go = (d: string, v: View = view) => {
    setParams({ d, v }, { replace: true });
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const shift = (n: number) => {
    if (view === 'jour') go(addDays(sel, n));
    else if (view === 'semaine') go(addDays(sel, 7 * n));
    else if (view === 'liste') go(addDays(sel, 30 * n));
    else {
      const d = new Date(sel.slice(0, 7) + '-01T12:00:00');
      d.setMonth(d.getMonth() + n);
      go(toISODate(d));
    }
  };

  if (!data) return null;

  // Sans employés, colorer « par employé » ne sert à rien: on colore par type de travail (avec légende)
  const eff = prefs.colorBy === 'employe' && data.memberList.length === 0 ? { ...prefs, colorBy: 'type' as const } : prefs;
  const memberColor = (m?: Member) => (!m ? OWNER_COLOR : m.color === '#e0901f' ? MEMBER_COLORS[m.id! % MEMBER_COLORS.length] : m.color); // ancien orange = couleur du patron
  const typeOf = (j: Job) => guessType(j, prefs.types);
  const colorOf = (j: Job) => {
    if (j.color) return j.color;
    if (eff.colorBy === 'type') return typeOf(j)?.color ?? '#8b8f98';
    if (eff.colorBy === 'statut') return STATUS_COLOR[j.status] ?? '#8b8f98';
    if (eff.colorBy === 'client') return clientColor(j.clientId);
    return j.assignees?.length ? memberColor(data.members.get(j.assignees[0])) : OWNER_COLOR;
  };
  const ql = q.trim().toLowerCase();
  const visible = data.jobs.filter((j) => {
    if (j.status === 'annule') return false;
    if (isEmp && !j.assignees?.includes(st.memberId!)) return false;
    if (!showDone && j.status !== 'planifie') return false;
    if (who === 'moi' && j.assignees?.length) return false; // « Moi » = jobs sans employé assigné
    if (/^\d+$/.test(who) && !j.assignees?.includes(Number(who))) return false;
    if (ql) {
      const c = data.clients.get(j.clientId);
      if (![c?.name, j.title, j.address, c?.address, c?.phone].some((x) => x?.toLowerCase().includes(ql))) return false;
    }
    return true;
  });
  const byDay = new Map<string, Job[]>();
  visible.forEach((j) => byDay.set(j.date, [...(byDay.get(j.date) ?? []), j]));
  const sortDay = (list: Job[]) => [...list].sort((a, b) => (a.time && b.time ? toMin(a.time) - toMin(b.time) : a.time ? -1 : b.time ? 1 : a.order - b.order));
  const leadsOn = (d: string) => (showLeads ? data.leads.filter((l) => l.nextAction === d) : []);
  const conflictIds = new Set<number>();
  byDay.forEach((list) => conflicts(list).forEach((id) => conflictIds.add(id)));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy('');
    }
  };

  /** Glisser-déposer (ordi): déplacer un job à une autre journée / heure. */
  const onDrop = (e: DragEvent, date: string, time?: string) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/job'));
    if (!id || !canEdit) return;
    void run('Déplacer', async () => {
      const j = await db.jobs.get(id);
      if (!j || j.status !== 'planifie') return;
      const from = j.date;
      await db.jobs.update(id, { date, ...(time !== undefined ? { time } : {}), remindedAt: date === from ? j.remindedAt : undefined });
      if (from !== date) await syncDayRoute(from);
      notify(`Job déplacé au ${formatDate(date)}${time ? ` à ${time}` : ''}`);
    });
  };
  const dropProps = (date: string, time?: string) =>
    canEdit ? { onDragOver: (e: DragEvent) => e.preventDefault(), onDrop: (e: DragEvent) => onDrop(e, date, time) } : {};
  const dragProps = (j: Job) =>
    canEdit && j.status === 'planifie' ? { draggable: true, onDragStart: (e: DragEvent) => e.dataTransfer.setData('text/job', String(j.id)) } : {};

  // ---------- Résumé de la période ----------
  const inRange = visible.filter((j) => j.date >= range[0] && j.date <= range[1]);
  const planned = inRange.filter((j) => j.status === 'planifie');
  const periodMin = inRange.reduce((a, j) => a + (j.durationMin || 0), 0);
  const periodTotal = inRange.reduce((a, j) => a + jobTotal(j), 0);
  const unassigned = data.memberList.length ? planned.filter((j) => !j.assignees?.length).length : 0;

  const title =
    view === 'jour' ? dayLabel(sel) :
    view === 'semaine' ? `Semaine du ${dayLabel(range[0], { day: 'numeric', month: 'long' })}` :
    view === 'mois' ? new Date(sel.slice(0, 7) + '-01T12:00:00').toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }) :
    `À partir du ${dayLabel(sel, { day: 'numeric', month: 'long' })}`;

  const money$ = showMoney && prefs.showMoney;
  const ctx: Ctx = { data, colorOf, typeOf, memberColor, conflictIds, weather, showMoney: money$, canEdit, dragProps, dropProps, leadsOn, nav, prefs: eff, hourPx: DENSITY_PX[prefs.density] };
  const doneN = inRange.filter((j) => j.status !== 'planifie').length;
  const firstName = (isEmp ? data.members.get(st.memberId!)?.name : s.ownerName)?.split(' ')[0] ?? '';
  const hr = new Date().getHours();
  const greet = `${hr < 12 ? 'Bon matin' : hr < 18 ? 'Bon après-midi' : 'Bonsoir'}${firstName ? `, ${firstName}` : ''}`;
  const todayJobs = sortDay(byDay.get(today) ?? []).filter((j) => j.status === 'planifie' && j.time);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const current = todayJobs.find((j) => toMin(j.time) <= nowMin && nowMin < toMin(j.time) + (j.durationMin || 60));
  const next = todayJobs.find((j) => toMin(j.time) > nowMin);
  const heroW = weather[view === 'jour' ? sel : today];
  const HeroIcon = heroW ? WEATHER_ICON[weatherKind(heroW.code)] : null;

  return (
    <>
      <section className="ag-hero">
        <div className="agh-top">
          <div className="agh-title">
            <div className="agh-eyebrow"><CalendarDays size={14} /> {view === 'jour' && sel === today ? greet : 'Agenda'}</div>
            <h1>{mobile && view === 'mois' ? 'Vue du mois' : mobile && view === 'liste' ? 'Mes prochaines jobs' : title}</h1>
          </div>
          <div className="agh-nav">
            {!mobile && (
              <>
                <button className="agh-btn icon" onClick={() => shift(-1)} aria-label="Précédent"><ChevronLeft size={18} /></button>
                <button className="agh-btn" onClick={() => go(today)}>Aujourd’hui</button>
                <button className="agh-btn icon" onClick={() => shift(1)} aria-label="Suivant"><ChevronRight size={18} /></button>
              </>
            )}
            {canEdit && <button className="agh-btn icon" onClick={() => nav('/dicter')} aria-label="Assistant" title="Assistant"><Mic size={17} /></button>}
            {canEdit && <button className="agh-btn icon" onClick={() => setCustom(true)} aria-label="Personnaliser l’agenda" title="Personnaliser"><Palette size={17} /></button>}
            {canEdit && <button className="agh-btn solid" onClick={() => nav(`/job/new?d=${sel}`)}><Plus size={17} /> Job</button>}
          </div>
        </div>
        {view !== 'liste' && mobile && (
          <div className="agh-mini">
            <span><b>{inRange.length}</b> job{inRange.length > 1 ? 's' : ''}</span>
            <span><b>{hoursTxt(periodMin)}</b></span>
            {ctx.showMoney && periodTotal > 0 && <span><b>{money(periodTotal).replace(/,00\s/, ' ')}</b></span>}
            {inRange.length > 0 && <span className="ok"><Check size={13} /> {doneN}/{inRange.length}</span>}
            {conflictIds.size > 0 && <span className="warn"><AlertTriangle size={13} /> {conflictIds.size}</span>}
            {heroW && HeroIcon && <span><HeroIcon size={14} /> {heroW.tmax}°</span>}
          </div>
        )}
        {view !== 'liste' && mobile && (current || next) && (
          <Link to={`/job/${(current ?? next)!.id}`} className="agh-next">
            <Timer size={15} style={{ flex: 'none' }} />
            <span>
              {current
                ? <>En cours : <b>{data.clients.get(current.clientId)?.name ?? 'Client'}</b> jusqu’à {fmtMin(toMin(current.time) + (current.durationMin || 60))}</>
                : <>Prochain : <b>{data.clients.get(next!.clientId)?.name ?? 'Client'}</b> à {next!.time}</>}
            </span>
          </Link>
        )}
        {view !== 'liste' && !mobile && (
          <div className="agh-row">
            <Ring value={inRange.length ? doneN / inRange.length : 0} label={`${doneN} sur ${inRange.length} jobs terminés`}><b>{doneN}/{inRange.length}</b>faits</Ring>
            <div className="agh-stats">
              <div><b>{inRange.length}</b><span>job{inRange.length > 1 ? 's' : ''}</span></div>
              <div><b>{hoursTxt(periodMin)}</b><span>prévues</span></div>
              {ctx.showMoney && <div className="m"><b>{money(periodTotal)}</b><span>de travaux</span></div>}
              {conflictIds.size > 0 && <div className="warn"><b><AlertTriangle size={15} /> {conflictIds.size}</b><span>en conflit</span></div>}
              {unassigned > 0 && <div className="warn"><b>{unassigned}</b><span>sans employé</span></div>}
            </div>
            {(current || next) && (
              <Link to={`/job/${(current ?? next)!.id}`} className="agh-next">
                <Timer size={15} style={{ flex: 'none' }} />
                <span>
                  {current
                    ? <>En cours : <b>{data.clients.get(current.clientId)?.name ?? 'Client'}</b> jusqu’à {fmtMin(toMin(current.time) + (current.durationMin || 60))}</>
                    : <>Prochain : <b>{data.clients.get(next!.clientId)?.name ?? 'Client'}</b> à {next!.time} · dans {hoursTxt(toMin(next!.time) - nowMin)}</>}
                </span>
              </Link>
            )}
            {heroW && HeroIcon && (
              <div className="agh-wx">
                <HeroIcon size={22} />
                <div><b>{heroW.tmax}°</b><span>{WEATHER_LABEL[weatherKind(heroW.code)]}{heroW.pop ? ` · ${heroW.pop} %` : ''}</span></div>
              </div>
            )}
          </div>
        )}
      </section>

      {mobile && (view === 'mois' || view === 'liste') && (
        <div className="ag-strip ag-period">
          <div className="ags-head">
            <button className="ags-arrow" onClick={() => shift(-1)} aria-label="Précédent"><ChevronLeft size={18} /></button>
            <span className="ags-month">{view === 'mois' ? new Date(sel.slice(0, 7) + '-01T12:00:00').toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }) : `${dayLabel(sel, { day: 'numeric', month: 'short' })} → ${dayLabel(addDays(sel, 59), { day: 'numeric', month: 'short' })}`}</span>
            {(view === 'mois' ? sel.slice(0, 7) !== today.slice(0, 7) : sel !== today) && <button className="ags-today" onClick={() => go(today)}>Aujourd’hui</button>}
            <button className="ags-arrow" onClick={() => shift(1)} aria-label="Suivant"><ChevronRight size={18} /></button>
          </div>
        </div>
      )}
      {mobile && (view === 'jour' || view === 'semaine') && <DayStrip sel={sel} today={today} view={view} onPick={(d) => go(d, 'jour')} onShift={(n) => go(addDays(sel, 7 * n))} onToday={() => go(today)} />}

      <div className="ag-toolbar">
        <div className="seg ag-views" role="tablist">
          {VIEWS.map((v) => <button key={v.key} role="tab" aria-selected={view === v.key} className={view === v.key ? 'on' : ''} onClick={() => go(sel, v.key)}>{v.label}</button>)}
        </div>
        {!mobile && <label className="ag-date"><CalendarClock size={16} /><input type="date" value={sel} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Aller à la date" /></label>}
      </div>

      <div className="chips ag-filters">
        {!isEmp && data.memberList.length > 0 && (
          <>
            <button className={`chip-btn ${who === 'tous' ? 'on' : ''}`} onClick={() => setWho('tous')}><Users size={14} /> Tous</button>
            <button className={`chip-btn ${who === 'moi' ? 'on' : ''}`} onClick={() => setWho('moi')}><span className="dot" style={{ background: OWNER_COLOR }} /> Moi</button>
            {data.memberList.filter((m) => m.role !== 'vendeur').map((m) => (
              <button key={m.id} className={`chip-btn ${who === String(m.id) ? 'on' : ''}`} onClick={() => setWho(String(m.id))}><span className="dot" style={{ background: memberColor(m) }} /> {m.name.split(' ')[0]}</button>
            ))}
          </>
        )}
        <button className={`chip-btn ${!showDone ? 'on' : ''}`} onClick={() => setShowDone((x) => !x)}>{showDone ? 'Cacher les jobs faits' : 'Jobs faits cachés'}</button>
        {!isEmp && <button className={`chip-btn ${showLeads ? 'on' : ''}`} onClick={() => setShowLeads((x) => !x)}><Inbox size={14} /> Demandes à rappeler</button>}
      </div>

      {eff.colorBy === 'type' && prefs.types.length > 0 && (
        <div className="ag-legend" aria-label="Légende des couleurs">
          {prefs.types.map((t) => <span key={t.key}><span className="dot" style={{ background: t.color }} /> {t.label}</span>)}
        </div>
      )}

      {data.toRemind.length > 0 && mobile && !remindOpen && (
        <button className="ag-remind-mini" onClick={() => setRemindOpen(true)}>
          <Bell size={15} /> <span><b>{data.toRemind.length}</b> client{data.toRemind.length > 1 ? 's' : ''} à rappeler</span> <ChevronRight size={16} />
        </button>
      )}
      {data.toRemind.length > 0 && (!mobile || remindOpen) && (
        <div className="notice row">
          <Bell size={16} />
          <span><strong>{data.toRemind.length}</strong> client{data.toRemind.length > 1 ? 's' : ''} à rappeler pour aujourd’hui ou demain:</span>
          {data.toRemind.slice(0, 4).map((j) => (
            <button key={j.id} className="btn small" onClick={() => setRemind(j)}>{data.clients.get(j.clientId)?.name ?? 'Client'}</button>
          ))}
        </div>
      )}

      {view === 'jour' && (
        <DayView mobile={mobile} onSwipe={shift} ctx={ctx} date={sel} jobs={sortDay(byDay.get(sel) ?? [])} trips={data.trips} busy={busy} run={run} s={s}
          onRemind={setRemind} onPostpone={(jobs, label) => setPostpone({ jobs, label })} isEmp={isEmp} />
      )}
      {view === 'semaine' && <WeekView ctx={ctx} start={range[0]} byDay={byDay} sortDay={sortDay} today={today} onPick={(d) => go(d, 'jour')} />}
      {view === 'mois' && <MonthView ctx={ctx} month={sel.slice(0, 7)} sel={sel} today={today} byDay={byDay} sortDay={sortDay} onPick={(d) => (mobile ? go(d, 'mois') : go(d, 'jour'))} mobile={mobile} onOpenDay={(d) => go(d, 'jour')} />}
      {view === 'liste' && (
        <ListView ctx={ctx} from={sel} byDay={byDay} sortDay={sortDay} today={today} q={q} setQ={setQ} onPick={(d) => go(d, 'jour')} />
      )}

      {remind && <ReminderModal job={remind} client={data.clients.get(remind.clientId)} onClose={() => setRemind(null)} />}
      {custom && <AgendaCustomize onClose={() => setCustom(false)} />}
      {postpone && <PostponeModal jobs={postpone.jobs} label={postpone.label} from={sel} weather={weather} onClose={() => setPostpone(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------

interface Ctx {
  data: { clients: Map<number, Client>; members: Map<number, Member>; memberList: Member[] };
  colorOf: (j: Job) => string;
  typeOf: (j: Job) => JobType | undefined;
  prefs: AgendaPrefs;
  hourPx: number;
  memberColor: (m?: Member) => string;
  conflictIds: Set<number>;
  weather: Record<string, DayWeather>;
  showMoney: boolean;
  canEdit: boolean;
  dragProps: (j: Job) => object;
  dropProps: (date: string, time?: string) => object;
  leadsOn: (d: string) => Lead[];
  nav: (to: string) => void;
}

/** Téléphone (écran étroit): mise en page simplifiée. */
function useMobile(): boolean {
  const q = '(max-width: 640px)';
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}

/** Glisser à gauche / à droite (journée suivante / précédente). */
function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      // Pas depuis le bord de l'écran (geste « retour » du téléphone) ni sur un champ
      if (t.clientX < 24 || t.clientX > window.innerWidth - 24 || (e.target as HTMLElement).closest('input, textarea, select, .chips')) return void (start.current = null);
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s0 = start.current;
      start.current = null;
      if (!s0) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s0.x;
      const dy = t.clientY - s0.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - s0.t < 700) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

const WD = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
/** Bande de la semaine (téléphone): touche un jour, glisse pour changer de semaine. */
function DayStrip({ sel, today, view, onPick, onShift, onToday }: { sel: string; today: string; view: View; onPick: (d: string) => void; onShift: (n: number) => void; onToday: () => void }) {
  const start = weekStart(sel);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const jobs = useLiveQuery(() => db.jobs.where('date').between(days[0], days[6], true, true).toArray(), [days[0]]) ?? [];
  const count = (d: string) => jobs.filter((j) => j.date === d && j.status !== 'annule').length;
  const swipe = useSwipe((dir) => onShift(dir));
  const month = new Date(sel + 'T12:00:00').toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
  return (
    <div className="ag-strip" {...swipe}>
      <div className="ags-head">
        <button className="ags-arrow" onClick={() => onShift(-1)} aria-label="Semaine précédente"><ChevronLeft size={18} /></button>
        <span className="ags-month">{month}</span>
        {!days.includes(today) || sel !== today ? <button className="ags-today" onClick={onToday}>Aujourd’hui</button> : <span className="ags-today ghost" />}
        <button className="ags-arrow" onClick={() => onShift(1)} aria-label="Semaine suivante"><ChevronRight size={18} /></button>
      </div>
      <div className="ags-days">
        {days.map((d) => {
          const n = count(d);
          const date = new Date(d + 'T12:00:00');
          return (
            <button key={d} className={`ags-day ${view === 'jour' && d === sel ? 'on' : ''} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`} onClick={() => onPick(d)} aria-label={date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }) + ` — ${n} job${n > 1 ? 's' : ''}`}>
              <span className="wd">{WD[date.getDay()]}</span>
              <span className="dn">{date.getDate()}</span>
              <span className="dots">{Array.from({ length: Math.min(n, 3) }, (_, i) => <i key={i} />)}{n > 3 && <em>+</em>}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeatherChip({ w, full = false }: { w?: DayWeather; full?: boolean }) {
  if (!w) return null;
  const k = weatherKind(w.code);
  const Icon = WEATHER_ICON[k];
  return (
    <span className={`wx ${badWeather(w) ? 'bad' : ''}`} title={`${WEATHER_LABEL[k]} · ${w.tmin}° / ${w.tmax}° · ${w.pop} % de précipitations`}>
      <Icon size={full ? 18 : 14} /> {w.tmax}°{full && <> / {w.tmin}° · {WEATHER_LABEL[k]}{w.pop ? ` · ${w.pop} %` : ''}</>}
    </span>
  );
}

function JobBlock({ ctx, j, style, compact = false, short = false, i = 0 }: { ctx: Ctx; j: Job; style?: CSSProperties; compact?: boolean; short?: boolean; i?: number }) {
  const c = ctx.data.clients.get(j.clientId);
  const people = (j.assignees ?? []).map((id) => ctx.data.members.get(id)).filter(Boolean) as Member[];
  const t = ctx.typeOf(j);
  const end = j.time ? fmtMin(toMin(j.time) + (j.durationMin || 60)) : '';
  const total = jobTotal(j);
  return (
    <Link to={`/job/${j.id}`} className={`jb ${j.status} ${ctx.conflictIds.has(j.id!) ? 'conflict' : ''} ${compact ? 'compact' : ''} ${short ? 'short' : ''}`}
      style={{ ...style, ['--c' as string]: ctx.colorOf(j), ['--i' as string]: i }} {...ctx.dragProps(j)}>
      {compact ? (
        <span className="jb-t">
          {t && <TypeIcon t={t} />}
          {j.time && <span className="jb-time">{j.time}</span>}
          <strong>{c?.name ?? 'Client'}</strong>
        </span>
      ) : (
        <>
          {(t || j.time) && <span className="jb-t">{t && <TypeIcon t={t} />}{j.time && <span className="jb-time">{j.time}{end ? `–${end}` : ''}</span>}</span>}
          <strong className="jb-name">{c?.name ?? 'Client'}</strong>
        </>
      )}
      {!compact && <span className="jb-s">{j.title}</span>}
      {!compact && (people.length > 0 || (ctx.showMoney && total > 0)) && (
        <span className="jb-foot">
          {people.length > 0 && <span className="jb-av">{people.map((m) => <i key={m.id} title={m.name} style={{ background: ctx.memberColor(m) }}>{m.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</i>)}</span>}
          {ctx.showMoney && total > 0 && <span className="jb-money">{money(total)}</span>}
        </span>
      )}
      {j.status !== 'planifie' && <Check size={13} className="jb-done" aria-label="Terminé" />}
      {ctx.conflictIds.has(j.id!) && <AlertTriangle size={12} className="jb-warn" aria-label="Conflit d’horaire" />}
    </Link>
  );
}

function TypeIcon({ t }: { t: JobType }) {
  const I = jobIcon(t.icon);
  return <I size={12} className="type-ico" aria-label={t.label} style={{ ['--tc' as string]: t.color }} />;
}

function LeadItem({ l }: { l: Lead }) {
  return (
    <Link to="/demandes" className="jb lead compact">
      <span className="jb-t"><Phone size={11} /> Relance <strong>{l.name}</strong></span>
    </Link>
  );
}

/** Grille horaire d'une ou plusieurs journées. */
function TimeGrid({ ctx, days, byDay, onPick, today }: { ctx: Ctx; days: string[]; byDay: Map<string, Job[]>; onPick?: (d: string) => void; today: string }) {
  const H_START = ctx.prefs.startHour;
  const H_END = ctx.prefs.endHour;
  const HOUR_PX = ctx.hourPx;
  const hours = Array.from({ length: H_END - H_START }, (_, i) => H_START + i);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const isWeekend = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00').getDay());
  return (
    <div className={`tg d-${ctx.prefs.density}`} style={{ ['--cols' as string]: days.length }}>
      <div className="tg-head">
        <div />
        {days.map((d) => (
          <button key={d} className={`tg-day ${d === today ? 'today' : ''} ${isWeekend(d) ? 'we' : ''}`} onClick={() => onPick?.(d)} disabled={!onPick}>
            <span>{dayLabel(d, { weekday: 'short' })}</span> <b>{Number(d.slice(8))}</b>
            <WeatherChip w={ctx.weather[d]} />
          </button>
        ))}
      </div>
      <div className="tg-allday">
        <div className="tg-lbl">Journée</div>
        {days.map((d) => (
          <div key={d} className="tg-cell" {...ctx.dropProps(d, '')}>
            {(byDay.get(d) ?? []).filter((j) => !j.time).map((j) => <JobBlock key={j.id} ctx={ctx} j={j} compact />)}
            {ctx.leadsOn(d).map((l) => <LeadItem key={l.id} l={l} />)}
          </div>
        ))}
      </div>
      <div className="tg-body" style={{ height: (H_END - H_START) * HOUR_PX }}>
        <div className="tg-hours">
          {hours.map((h) => <div key={h} style={{ height: HOUR_PX }}>{h} h</div>)}
        </div>
        {days.map((d) => {
          const timed = (byDay.get(d) ?? []).filter((j) => j.time);
          // colonnes côte à côte quand des jobs se chevauchent
          const lanes: number[] = [];
          const placed = timed
            .sort((a, b) => toMin(a.time) - toMin(b.time))
            .map((j) => {
              const start = toMin(j.time);
              const end = start + Math.max(30, j.durationMin || 60);
              let lane = lanes.findIndex((e) => e <= start);
              if (lane < 0) lane = lanes.push(end) - 1;
              else lanes[lane] = end;
              return { j, start, end, lane };
            });
          const n = Math.max(1, lanes.length);
          return (
            <div key={d} className={`tg-col ${d === today ? 'today' : ''} ${isWeekend(d) ? 'we' : ''}`}>
              {hours.map((h) => (
                <button key={h} className={`tg-slot ${h % 2 ? 'odd' : ''}`} style={{ height: HOUR_PX }} aria-label={`Nouveau job ${formatDate(d)} ${h} h`}
                  onClick={() => ctx.canEdit && ctx.nav(`/job/new?d=${d}&t=${fmtMin(h * 60)}`)} {...ctx.dropProps(d, fmtMin(h * 60))} />
              ))}
              {d === today && nowMin >= H_START * 60 && nowMin <= H_END * 60 && <div className="tg-now" style={{ top: ((nowMin - H_START * 60) / 60) * HOUR_PX }}><span>{fmtMin(nowMin)}</span></div>}
              {placed.map(({ j, start, end, lane }, i) => (
                <JobBlock key={j.id} ctx={ctx} j={j} i={i} compact={((Math.min(end, H_END * 60) - Math.max(start, H_START * 60)) / 60) * HOUR_PX < 44}
                  short={((Math.min(end, H_END * 60) - Math.max(start, H_START * 60)) / 60) * HOUR_PX < 86} style={{
                  position: 'absolute',
                  top: (Math.max(start - H_START * 60, 0) / 60) * HOUR_PX,
                  height: Math.max(26, ((Math.min(end, H_END * 60) - Math.max(start, H_START * 60)) / 60) * HOUR_PX - 2),
                  left: `calc(${(lane / n) * 100}% + 2px)`,
                  width: `calc(${100 / n}% - 4px)`,
                }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ ctx, date, jobs, trips, busy, run, s, onRemind, onPostpone, isEmp, mobile = false, onSwipe }: {
  mobile?: boolean; onSwipe?: (n: number) => void;
  ctx: Ctx; date: string; jobs: Job[]; trips: { id?: number; jobId?: number; totalKm: number; durationMin?: number; reason: string }[];
  busy: string; run: (l: string, fn: () => Promise<void>) => Promise<void>; s: { homeAddress: string };
  onRemind: (j: Job) => void; onPostpone: (jobs: Job[], label: string) => void; isEmp: boolean;
}) {
  const notify = useToast();
  const routeJobs = [...jobs].sort((a, b) => a.order - b.order);
  const legs = [...trips].sort((a, b) => a.id! - b.id!);
  const dayKm = legs.reduce((a, t) => a + t.totalKm, 0);
  const w = ctx.weather[date];
  const planned = jobs.filter((j) => j.status === 'planifie');
  const leads = ctx.leadsOn(date);

  const move = (i: number, d: -1 | 1) =>
    run('Ordre', async () => {
      const list = [...routeJobs];
      const k = i + d;
      if (k < 0 || k >= list.length) return;
      [list[i], list[k]] = [list[k], list[i]];
      await Promise.all(list.map((x, n) => db.jobs.update(x.id!, { order: n })));
      if (list.some((x) => x.status !== 'planifie')) await syncDayRoute(date);
    });
  const [doneJob, setDoneJob] = useState<{ job: Job; km: number } | null>(null);
  const done = (j: Job) =>
    run('Fait', async () => {
      const r = await completeJob(j.id!, ctx.canEdit);
      const routeKm = r.trips.reduce((a, t) => a + t.totalKm, 0);
      if (r.next) notify(`Job terminé · prochain planifié le ${formatDate(r.next.date)}`);
      setDoneJob({ job: { ...j, status: 'fait' }, km: routeKm });
    });
  const invoice = (j: Job) =>
    run('Facture', async () => {
      ctx.nav(`/doc/${await jobToInvoice(j.id!)}`);
    });
  const [more, setMore] = useState<number | null>(null); // téléphone: actions secondaires ouvertes
  const swipe = useSwipe((dir) => onSwipe?.(dir));

  return (
    <div className={`grid two ag-day ${mobile ? 'mobile' : ''}`} style={{ alignItems: 'start' }} {...(mobile ? swipe : {})}>
      {doneJob && <JobDoneSheet job={doneJob.job} client={ctx.data.clients.get(doneJob.job.clientId)} canBill={ctx.showMoney} routeKm={doneJob.km} onClose={() => setDoneJob(null)} />}
      <div className="card ag-grid-card" style={{ padding: 10, order: mobile ? 2 : undefined }}>
        {mobile && <button className="ag-grid-toggle" onClick={() => setMore((m) => (m === -1 ? null : -1))}><CalendarDays size={15} /> {more === -1 ? 'Cacher la vue horaire' : 'Voir la vue horaire'}</button>}
        {(!mobile || more === -1) && w && (
          <div className={`wx-banner ${badWeather(w) ? 'bad' : ''}`}>
            <WeatherChip w={w} full />
            {badWeather(w) && planned.length > 0 && ctx.canEdit && (
              <button className="btn small" onClick={() => onPostpone(planned, `les ${planned.length} job${planned.length > 1 ? 's' : ''} du ${formatDate(date)}`)}><CalendarClock size={14} /> Déplacer la journée</button>
            )}
          </div>
        )}
        {(!mobile || more === -1) && <TimeGrid ctx={ctx} days={[date]} byDay={new Map([[date, jobs]])} today={todayISO()} />}
      </div>

      <div className="card ag-route-card" style={{ order: mobile ? 1 : undefined }}>
        {mobile && w && (
          <div className={`wx-banner ${badWeather(w) ? 'bad' : ''}`}>
            <WeatherChip w={w} full />
            {badWeather(w) && planned.length > 0 && ctx.canEdit && (
              <button className="btn small" onClick={() => onPostpone(planned, `les ${planned.length} job${planned.length > 1 ? 's' : ''} du ${formatDate(date)}`)}><CalendarClock size={14} /> Déplacer la journée</button>
            )}
          </div>
        )}
        <div className="card-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>{mobile ? 'Ma journée' : 'Ordre de la journée'}</h2>
            <div className="small muted">{jobs.length} job{jobs.length > 1 ? 's' : ''}{dayKm ? ` · ${km(dayKm)} de route` : ''}{leads.length ? ` · ${leads.length} relance${leads.length > 1 ? 's' : ''}` : ''}</div>
          </div>
          {!mobile && ctx.canEdit && planned.length > 0 && (
            <button className="btn small" onClick={() => onPostpone(planned, `les ${planned.length} job${planned.length > 1 ? 's' : ''} du ${formatDate(date)}`)}><CalendarClock size={14} /> Déplacer</button>
          )}
        </div>
        {mobile && jobs.length > 0 && (
          <div className="ag-day-tools">
            {jobs.length > 1 && <button className="btn small" onClick={() => run('Route', async () => { const l = await dayRouteLink(date); if (l) window.open(l, '_blank'); else notify('Ajoute des adresses aux jobs.', 'err'); })}><Navigation size={15} /> Route</button>}
            {ctx.canEdit && jobs.length > 1 && <button className="btn small" disabled={!!busy} onClick={() => run('Optimiser', async () => { await optimizeDay(date); notify('Ordre optimisé'); })}><Shuffle size={15} /> Optimiser</button>}
            {ctx.canEdit && planned.length > 0 && <button className="btn small" onClick={() => onPostpone(planned, `les ${planned.length} job${planned.length > 1 ? 's' : ''} du ${formatDate(date)}`)}><CalendarClock size={15} /> Déplacer</button>}
          </div>
        )}
        {!mobile && jobs.length > 1 && (
          <div className="row" style={{ marginBottom: 12 }}>
            {ctx.canEdit && <button className="btn small" disabled={!!busy} onClick={() => run('Optimiser', async () => { await optimizeDay(date); notify(jobs.some((x) => x.time) ? 'Ordre optimisé (les jobs avec une heure gardent leur heure)' : 'Ordre optimisé (trajet le plus court)'); })}><Shuffle size={15} /> Mettre dans le meilleur ordre</button>}
            <button className="btn small" onClick={() => run('Route', async () => { const l = await dayRouteLink(date); if (l) window.open(l, '_blank'); else notify('Ajoute des adresses aux jobs.', 'err'); })}><Navigation size={15} /> Ouvrir le trajet dans Maps</button>
          </div>
        )}
        {!mobile && leads.map((l) => (
          <div key={l.id} className="job-card lead">
            <div className="stop"><Phone size={15} /></div>
            <div className="body">
              <div className="title">Relancer {l.name}</div>
              <div className="small muted">{l.service || 'Demande'}{l.phone ? ` · ${l.phone}` : ''}</div>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                {l.phone && <a className="btn small" href={`tel:${l.phone}`}><Phone size={14} /> Appeler</a>}
                <Link className="btn small" to="/demandes">Ouvrir la demande</Link>
              </div>
            </div>
          </div>
        ))}
        {jobs.length === 0 ? (
          <div className="empty">
            <CalendarDays size={34} />
            <div>Rien de prévu ce jour-là.</div>
            {ctx.canEdit && <button className="btn accent" onClick={() => ctx.nav(`/job/new?d=${date}`)}><Plus size={16} /> Planifier un job</button>}
          </div>
        ) : (
          <div>
            {routeJobs.map((j, i) => {
              const c = ctx.data.clients.get(j.clientId);
              const leg = legs.find((t) => t.jobId === j.id);
              const who = (j.assignees ?? []).map((id) => ctx.data.members.get(id)).filter(Boolean) as Member[];
              return (
                <div key={j.id}>
                  {leg && <div className="leg"><Route size={13} /> {km(leg.totalKm)}{leg.durationMin ? ` · ${leg.durationMin} min` : ''}</div>}
                  <div className={`job-card ${j.status}`} style={{ ['--c' as string]: ctx.colorOf(j) }}>
                    <div className="stop">{j.status === 'planifie' ? i + 1 : <Check size={16} />}</div>
                    <div className="body">
                      <div className="row" style={{ gap: 6 }}>
                        <Link to={`/job/${j.id}`} className="title" style={{ color: 'var(--ink)' }}>{c?.name ?? 'Client'}</Link>
                        {ctx.typeOf(j) && <span className="type-tag" style={{ ['--c' as string]: ctx.typeOf(j)!.color }}><TypeIcon t={ctx.typeOf(j)!} />{ctx.typeOf(j)!.label}</span>}
                        {j.time && <span className="badge gray">{j.time}{j.durationMin ? ` · ${hoursTxt(j.durationMin)}` : ''}</span>}
                        <span className={`badge ${j.status === 'planifie' ? 'blue' : j.status === 'fait' ? 'green' : 'gray'}`}>{JOB_STATUS_LABEL[j.status]}</span>
                        {ctx.conflictIds.has(j.id!) && <span className="badge red"><AlertTriangle size={11} /> Conflit</span>}
                        {j.recurrence !== 'none' && <Repeat size={14} className="muted" aria-label="Récurrent" />}
                        {j.remindedAt && <Bell size={14} className="muted" aria-label="Rappel envoyé" />}
                      </div>
                      <div className="small">{j.title}{ctx.showMoney && jobTotal(j) ? ` · ${money(jobTotal(j))}` : ''}</div>
                      {(j.address || c?.address) && <div className="small muted row" style={{ gap: 4 }}><MapPin size={13} /> {j.address || c?.address}</div>}
                      {who.length > 0 && <div className="small row" style={{ gap: 6, marginTop: 2 }}>{who.map((m) => <span key={m.id} className="who"><span className="dot" style={{ background: ctx.memberColor(m) }} /> {m.name.split(' ')[0]}</span>)}</div>}
                      {(
                        <div className="jc-main">
                          {j.status === 'planifie' && <button className="btn accent" disabled={!!busy} onClick={() => done(j)}><Check size={17} /> Fait</button>}
                          {!isEmp && j.status === 'fait' && !j.docId && <button className="btn accent" disabled={!!busy} onClick={() => invoice(j)}><FileText size={17} /> Facturer</button>}
                          {(j.address || c?.address) && <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.address || c?.address || '')}`} target="_blank" rel="noreferrer"><Navigation size={17} /> Y aller</a>}
                          {c?.phone && <a className="btn icon-btn" href={`tel:${c.phone}`} aria-label={`Appeler ${c.name}`}><Phone size={17} /></a>}
                          <button className={`btn icon-btn ${more === j.id ? 'on' : ''}`} onClick={() => setMore((m) => (m === j.id ? null : j.id!))} aria-label="Plus d’actions" aria-expanded={more === j.id}>⋯</button>
                        </div>
                      )}
                      {more === j.id && <div className="row" style={{ marginTop: 8, gap: 6 }}>
                        {!isEmp && (j.docId ? (
                          <Link className="btn small" to={`/doc/${j.docId}`}><FileText size={15} /> Facture</Link>
                        ) : (
                          <button className="btn small" disabled={!!busy} onClick={() => invoice(j)}><FileText size={15} /> Facturer</button>
                        ))}
                        {ctx.canEdit && <div className="row full" style={{ gap: 6, width: '100%', flexWrap: 'wrap' }}><span className="small muted">Type:</span>{ctx.prefs.types.map((t) => <button key={t.key} type="button" className={`chip-btn ${j.type === t.key ? 'on' : ''}`} onClick={() => void db.jobs.update(j.id!, { type: j.type === t.key ? undefined : t.key })}>{t.label}</button>)}</div>}
                        {ctx.canEdit && j.status === 'planifie' && <button className="btn small" onClick={() => onRemind(j)}><Bell size={15} /> Rappel</button>}
                        {ctx.canEdit && j.status === 'planifie' && <button className="btn small" onClick={() => onPostpone([j], c?.name ?? 'ce job')}><CalendarClock size={15} /> Déplacer</button>}
                        {ctx.canEdit && (
                          <>
                            <span className="spacer" />
                            <button className="btn small icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter"><ArrowUp size={15} /></button>
                            <button className="btn small icon-btn" onClick={() => move(i, 1)} disabled={i === routeJobs.length - 1} aria-label="Descendre"><ArrowDown size={15} /></button>
                          </>
                        )}
                      </div>}
                    </div>
                  </div>
                </div>
              );
            })}
            {mobile && leads.length > 0 && <div style={{ height: 8 }} />}
            {mobile && leads.map((l) => (
          <div key={l.id} className="job-card lead">
            <div className="stop"><Phone size={15} /></div>
            <div className="body">
              <div className="title">Relancer {l.name}</div>
              <div className="small muted">{l.service || 'Demande'}{l.phone ? ` · ${l.phone}` : ''}</div>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                {l.phone && <a className="btn small" href={`tel:${l.phone}`}><Phone size={14} /> Appeler</a>}
                <Link className="btn small" to="/demandes">Ouvrir la demande</Link>
              </div>
            </div>
          </div>
        ))}
            {legs.length > 0 && legs[legs.length - 1].reason.startsWith('Retour') && (
              <div className="leg"><Route size={13} /> Retour au domicile: {km(legs[legs.length - 1].totalKm)}</div>
            )}
            <p className="small muted" style={{ marginTop: 12 }}>
              Quand tu marques un job « Fait », la route de la journée (domicile → jobs → domicile) s’inscrit toute seule au <Link to="/km">journal de bord</Link>.
              {!s.homeAddress && ' Ajoute ton adresse de domicile dans Paramètres.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function WeekView({ ctx, start, byDay, sortDay, today, onPick }: { ctx: Ctx; start: string; byDay: Map<string, Job[]>; sortDay: (l: Job[]) => Job[]; today: string; onPick: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((_, i) => ctx.prefs.weekends || i < 5);
  return (
    <>
      {/* Ordi: grille horaire de la semaine (glisser un job pour le déplacer) */}
      <div className="card hide-mobile" style={{ padding: 10 }}>
        <TimeGrid ctx={ctx} days={days} byDay={byDay} onPick={onPick} today={today} />
        {ctx.canEdit && <div className="small muted" style={{ marginTop: 8 }}>Glisse un job pour le changer de journée ou d’heure. Clique une case vide pour planifier un job à cette heure.</div>}
      </div>
      {/* Cellulaire: une ligne par journée */}
      <div className="week-list hide-desktop">
        {days.map((d) => {
          const list = sortDay(byDay.get(d) ?? []);
          const leads = ctx.leadsOn(d);
          const min = list.reduce((a, j) => a + (j.durationMin || 0), 0);
          return (
            <div key={d} className={`wl-day ${d === today ? 'today' : ''}`}>
              <button className="wl-head" onClick={() => onPick(d)}>
                <span className="wl-date"><b>{Number(d.slice(8))}</b><span>{dayLabel(d, { weekday: 'short' })}</span></span>
                <span className="wl-sum">{list.length ? `${list.length} job${list.length > 1 ? 's' : ''} · ${hoursTxt(min)}` : 'Libre'}</span>
                <WeatherChip w={ctx.weather[d]} />
                <ChevronRight size={16} className="muted" />
              </button>
              {(list.length > 0 || leads.length > 0) && (
                <div className="wl-items">
                  {list.map((j) => <JobBlock key={j.id} ctx={ctx} j={j} />)}
                  {leads.map((l) => <LeadItem key={l.id} l={l} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MonthView({ ctx, month, sel, today, byDay, sortDay, onPick, mobile = false, onOpenDay }: { ctx: Ctx; month: string; sel: string; today: string; byDay: Map<string, Job[]>; sortDay: (l: Job[]) => Job[]; onPick: (d: string) => void; mobile?: boolean; onOpenDay?: (d: string) => void }) {
  const days = monthGrid(month);
  const selJobs = sortDay(byDay.get(sel) ?? []);
  const swipe = useSwipe((dir) => {
    const d = new Date(month + '-01T12:00:00');
    d.setMonth(d.getMonth() + dir);
    onPick(toISODate(d));
  });
  return (
    <>
    <div className={`card ag-month ${mobile ? 'mobile' : ''}`} style={{ padding: 10 }} {...(mobile ? swipe : {})}>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((d) => {
          const list = sortDay(byDay.get(d) ?? []);
          const leads = ctx.leadsOn(d);
          const w = ctx.weather[d];
          const load = Math.min(1, list.reduce((a, j) => a + (j.durationMin || 60), 0) / 480);
          return (
            <div key={d} role="button" tabIndex={0} style={{ ['--load' as string]: `${Math.round(load * 100)}%` }}
              className={`day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${list.length ? 'busy' : ''}`}
              onClick={() => onPick(d)} onKeyDown={(e) => e.key === 'Enter' && onPick(d)}
              aria-label={`${formatDate(d)}: ${list.length} job(s)`} {...ctx.dropProps(d)}>
              <span className="day-top"><span className="dnum">{Number(d.slice(8))}</span>{w && !mobile && <span className={`wx-mini ${badWeather(w) ? 'bad' : ''}`}>{(() => { const I = WEATHER_ICON[weatherKind(w.code)]; return <I size={12} />; })()}</span>}</span>
              <span className="chips-row">
                {list.slice(0, 3).map((j) => (
                  <span key={j.id} className={`chip ${j.status} ${ctx.conflictIds.has(j.id!) ? 'conflict' : ''}`} style={{ ['--c' as string]: ctx.colorOf(j) }}
                    onClick={(e) => { e.stopPropagation(); ctx.nav(`/job/${j.id}`); }} {...ctx.dragProps(j)}>
                    {j.time ? `${j.time} ` : ''}{ctx.data.clients.get(j.clientId)?.name ?? j.title}
                  </span>
                ))}
                {leads.length > 0 && <span className="chip lead">{leads.length} relance{leads.length > 1 ? 's' : ''}</span>}
                {list.length > 3 && <span className="more">+{list.length - 3}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="cal-legend small muted">
        {ctx.prefs.colorBy === 'employe' && (
          <>
            <span><span className="dot" style={{ background: OWNER_COLOR }} /> Toi</span>
            {ctx.data.memberList.filter((m) => m.role !== 'vendeur').map((m) => <span key={m.id}><span className="dot" style={{ background: ctx.memberColor(m) }} /> {m.name.split(' ')[0]}</span>)}
          </>
        )}
        {ctx.prefs.colorBy === 'type' && ctx.prefs.types.map((t) => <span key={t.key}><span className="dot" style={{ background: t.color }} /> {t.label}</span>)}
        {ctx.prefs.colorBy === 'statut' && (['planifie', 'fait', 'facture'] as const).map((k) => <span key={k}><span className="dot" style={{ background: STATUS_COLOR[k] }} /> {JOB_STATUS_LABEL[k]}</span>)}
        {ctx.canEdit && <span className="hide-mobile">· Glisse un job sur une autre journée pour le déplacer</span>}
      </div>
    </div>
    {mobile && (
      <div className="card ag-month-day">
        <div className="card-head">
          <div><h2 style={{ marginBottom: 2, textTransform: 'capitalize' }}>{dayLabel(sel)}</h2><div className="small muted">{selJobs.length ? `${selJobs.length} job${selJobs.length > 1 ? 's' : ''}` : 'Rien de prévu'}</div></div>
          <button className="btn small" onClick={() => onOpenDay?.(sel)}>Ouvrir la journée</button>
        </div>
        {selJobs.map((j) => <JobBlock key={j.id} ctx={ctx} j={j} />)}
        {ctx.leadsOn(sel).map((l) => <LeadItem key={l.id} l={l} />)}
        {!selJobs.length && ctx.canEdit && <button className="btn accent" onClick={() => ctx.nav(`/job/new?d=${sel}`)}><Plus size={16} /> Planifier un job</button>}
      </div>
    )}
    </>
  );
}

function ListView({ ctx, from, byDay, sortDay, today, q, setQ, onPick }: {
  ctx: Ctx; from: string; byDay: Map<string, Job[]>; sortDay: (l: Job[]) => Job[]; today: string; q: string; setQ: (v: string) => void; onPick: (d: string) => void;
}) {
  const days = Array.from({ length: 60 }, (_, i) => addDays(from, i)).filter((d) => (byDay.get(d)?.length ?? 0) > 0 || ctx.leadsOn(d).length > 0);
  return (
    <div className="card">
      <label className="row ag-search"><Search size={16} className="muted" /><input placeholder="Chercher un client, une adresse, un job…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {days.length === 0 ? (
        <div className="empty"><CalendarDays size={34} /> Rien de prévu dans les 60 prochains jours{q ? ' pour cette recherche' : ''}.</div>
      ) : days.map((d) => {
        const list = sortDay(byDay.get(d) ?? []);
        return (
          <div key={d} className="al-day">
            <button className={`al-head ${d === today ? 'today' : ''}`} onClick={() => onPick(d)}>
              <span style={{ textTransform: 'capitalize' }}>{dayLabel(d)}</span>
              <WeatherChip w={ctx.weather[d]} />
            </button>
            {list.map((j) => <JobBlock key={j.id} ctx={ctx} j={j} />)}
            {ctx.leadsOn(d).map((l) => <LeadItem key={l.id} l={l} />)}
          </div>
        );
      })}
    </div>
  );
}

/** Reporter un job ou toute la journée (pluie, imprévu). */
function PostponeModal({ jobs, label, from, weather, onClose }: { jobs: Job[]; label: string; from: string; weather: Record<string, DayWeather>; onClose: () => void }) {
  const notify = useToast();
  const [date, setDate] = useState(addDays(from, 1));
  const [time, setTime] = useState(jobs.length === 1 ? jobs[0].time : '');
  const nextMonday = addDays(weekStart(from), 7);
  // Prochaine journée de semaine sans mauvais temps prévu
  const nextGood = (() => {
    for (let i = 1; i <= 14; i++) {
      const d = addDays(from, i);
      const dow = new Date(d + 'T12:00:00').getDay();
      if (dow !== 0 && dow !== 6 && weather[d] && !badWeather(weather[d])) return d;
    }
    return null;
  })();
  const options: [string, string][] = [[addDays(from, 1), 'Demain'], [nextMonday, 'Lundi prochain'], [addDays(from, 7), 'Dans 1 semaine']];
  if (nextGood) options.unshift([nextGood, 'Prochain beau jour']);

  const apply = async () => {
    for (const j of jobs) await db.jobs.update(j.id!, { date, remindedAt: undefined, ...(jobs.length === 1 ? { time } : {}) });
    await syncDayRoute(from).catch(() => undefined);
    notify(`${jobs.length > 1 ? `${jobs.length} jobs reportés` : 'Job reporté'} au ${formatDate(date)}${jobs.length === 1 && time ? ` à ${time}` : ''}. Pense à prévenir ${jobs.length > 1 ? 'les clients' : 'le client'} (bouton Rappel).`);
    onClose();
  };

  return (
    <Modal title={`Déplacer ${label}`} onClose={onClose}>
      <div className="chips" style={{ marginBottom: 12 }}>
        {options.map(([d, l]) => (
          <button key={l} className={`chip-btn ${date === d ? 'on' : ''}`} onClick={() => setDate(d)}>
            {l} · {dayLabel(d, { weekday: 'short', day: 'numeric' })} {weather[d] && <WeatherChip w={weather[d]} />}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label className="field">Nouvelle date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {jobs.length === 1 && <label className="field">Heure<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>}
      </div>
      {weather[date] && <div className={`notice ${badWeather(weather[date]) ? 'err' : 'ok'}`} style={{ marginTop: 12 }}>Météo prévue le {formatDate(date)}: <WeatherChip w={weather[date]} full /></div>}
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn accent" onClick={() => void apply()}><CalendarClock size={16} /> Déplacer</button>
      </div>
    </Modal>
  );
}
