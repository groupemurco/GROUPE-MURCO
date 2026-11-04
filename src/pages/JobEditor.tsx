import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, Camera, Check, ChevronLeft, FileText, Navigation, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AddressInput } from '../components/AddressInput';
import { ClientPicker } from '../components/ClientPicker';
import { JobDoneSheet } from '../components/JobDoneSheet';
import { LineItems } from '../components/LineItems';
import { MediaGallery } from '../components/MediaGallery';
import { ReminderModal } from '../components/ReminderModal';
import { errMsg, useConfirm, useToast } from '../components/Toast';
import { guessType, JOB_COLORS, useAgendaPrefs } from '../lib/agendaPrefs';
import { jobIcon } from '../lib/jobIcons';
import { blankJob, completeJob, JOB_STATUS_LABEL, jobToInvoice, RECURRENCE_LABEL, syncDayRoute } from '../lib/agenda';
import { db, type Job, type JobStatus, type Recurrence } from '../lib/db';
import { directionsLink } from '../lib/geo';
import { useSettings } from '../lib/hooks';
import { useSyncState } from '../lib/sync';
import { AdminNote } from '../components/AdminNote';
import { addDays, formatDate, lineAmount, money, todayISO } from '../lib/utils';
import { NumInput } from '../components/NumInput';

export default function JobEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const wantPhoto = params.get('photo') === '1';
  const nav = useNavigate();
  const notify = useToast();
  const ask = useConfirm();
  const s = useSettings();
  const prefs = useAgendaPrefs();
  const [j, setJ] = useState<Job | null>(null);
  // Le formulaire affiché doit correspondre à la page (évite d'enregistrer l'ancien job sur « Nouveau job »)
  const loadKey = `${id}|${params.toString()}`;
  const [loadedFor, setLoadedFor] = useState('');
  const [savedAddress, setSavedAddress] = useState('');
  const [doneSheet, setDoneSheet] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(() => !matchMedia('(max-width: 860px)').matches);
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const clients = useLiveQuery(() => db.clients.orderBy('name').toArray(), []) ?? [];
  const services = useLiveQuery(() => db.services.orderBy('order').toArray(), []) ?? [];
  const members = useLiveQuery(() => db.members.toArray(), []) ?? [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const st = useSyncState();
  const full = st.role === 'owner' || st.role === 'admin' || st.role === 'vendeur';
  const todayJobs = useLiveQuery(() => db.jobs.where('date').between(addDaysSafe(-1), addDaysSafe(1), true, true).toArray(), []) ?? [];

  useEffect(() => {
    (async () => {
      if (isNew) {
        setJ({ ...blankJob(params.get('d') || todayISO(), Number(params.get('client')) || 0), time: params.get('t') || '', projectId: Number(params.get('project')) || undefined });
        setSavedAddress('');
        setLoadedFor(`${id}|${params.toString()}`);
      } else {
        const x = await db.jobs.get(Number(id));
        if (!x) return nav('/agenda');
        setJ(x);
        setSavedAddress(x.address);
        setLoadedFor(`${id}|${params.toString()}`);
      }
    })();
  }, [id, isNew, params, nav]);

  if (!j || loadedFor !== loadKey) return null;
  const client = clients.find((c) => c.id === j.clientId);
  const up = (p: Partial<Job>) => setJ((x) => ({ ...x!, ...p }));
  const total = j.items.reduce((a, it) => a + lineAmount(it), 0);

  // « Photo de job » depuis le bouton + : choisir le job d'abord
  if (isNew && wantPhoto && todayJobs.length > 0 && !j.clientId) {
    return (
      <div className="express">
        <div className="page-head"><h1>Photo pour quel job?</h1></div>
        <div className="big-list">
          {todayJobs.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).map((x) => (
            <button key={x.id} className="big-item" onClick={() => nav(`/job/${x.id}?photo=1`, { replace: true })}>
              <Camera size={22} />
              <div className="grow">
                <div className="t">{clients.find((c) => c.id === x.clientId)?.name ?? 'Client'}</div>
                <div className="small muted">{formatDate(x.date)} · {x.title}</div>
              </div>
            </button>
          ))}
          <button className="big-item" onClick={() => up({ clientId: -1 })}>
            <Plus size={22} /><div className="grow"><div className="t">Nouveau job</div></div>
          </button>
        </div>
      </div>
    );
  }

  const save = async (patch: Partial<Job> = {}, quiet = false): Promise<Job | null> => {
    if (!j.clientId || j.clientId < 0) {
      notify('Choisis un client.', 'err');
      return null;
    }
    setBusy(true);
    try {
      const toSave: Job = { ...j, ...patch, items: j.items.filter((it) => it.code || it.description.trim() || it.unitPrice) };
      if (toSave.address.trim() !== savedAddress.trim()) toSave.geo = undefined;
      const newId = await db.jobs.put(toSave);
      const saved = { ...toSave, id: newId };
      setJ(saved);
      setSavedAddress(saved.address);
      if (saved.status !== 'planifie') await syncDayRoute(saved.date).catch(() => undefined);
      if (!quiet) notify('Job enregistré');
      if (isNew) {
        setLoadedFor(`${newId}|${wantPhoto ? 'photo=1' : ''}`);
        nav(`/job/${newId}${wantPhoto ? '?photo=1' : ''}`, { replace: true });
      }
      return saved;
    } catch (e) {
      notify(errMsg(e), 'err');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const markDone = async () => {
    const x = await save({}, true);
    if (!x?.id) return;
    const r = await completeJob(x.id, st.role === 'owner' || st.role === 'admin');
    setJ({ ...x, status: 'fait', nextJobId: r.next?.id ?? x.nextJobId });
    if (r.next) notify(`Job terminé · prochain planifié le ${formatDate(r.next.date)}`);
    setDoneSheet(r.trips.reduce((a, t) => a + t.totalKm, 0));
  };

  const invoice = async () => {
    const x = await save({}, true);
    if (!x?.id) return;
    try {
      nav(`/doc/${await jobToInvoice(x.id)}`);
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  const remove = async () => {
    if (!j.id) return nav('/agenda');
    if (!(await ask({ title: 'Supprimer ce job?', message: 'Les photos liées restent dans la fiche du client.', confirm: 'Supprimer', danger: true }))) return;
    const copy = { ...j };
    await db.jobs.delete(j.id);
    await syncDayRoute(j.date).catch(() => undefined);
    notify('Job supprimé', 'ok', { label: 'Annuler', run: () => void db.jobs.put(copy) });
    nav(`/agenda?d=${j.date}`);
  };

  const address = j.address || client?.address || '';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link to={`/agenda?d=${j.date}`} className="back-link"><ChevronLeft size={16} /> Agenda</Link></div>
          <h1>{isNew ? 'Nouveau job' : client?.name ?? 'Job'} {j.id && <span className={`badge ${j.status === 'planifie' ? 'blue' : j.status === 'fait' ? 'green' : 'gray'}`} style={{ verticalAlign: 'middle' }}>{JOB_STATUS_LABEL[j.status]}</span>}</h1>
        </div>
        <div className="actions editor-bar">
          <button className="btn accent" onClick={() => save()} disabled={busy}><Save size={17} /> Enregistrer</button>
          {j.id && j.status === 'planifie' && <button className="btn" onClick={markDone}><Check size={17} /> Fait</button>}
          {full && j.id && (j.docId ? <Link className="btn primary" to={`/doc/${j.docId}`}><FileText size={17} /> Voir la facture</Link> : <button className="btn primary" onClick={invoice}><FileText size={17} /> Facturer</button>)}
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <div className="field full">Client *
            {full ? <ClientPicker value={j.clientId > 0 ? j.clientId : 0} onChange={(id) => { up({ clientId: id }); if (isNew) setTimeout(() => { const el = document.getElementById('job-title'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); (el as HTMLInputElement | null)?.focus(); }, 250); }} autoFocus={isNew && !(j.clientId > 0)} /> : <strong style={{ color: 'var(--ink)' }}>{client?.name ?? '—'}</strong>}
          </div>
          <label className="field">Date<input type="date" value={j.date} onChange={(e) => up({ date: e.target.value })} /></label>
          <label className="field">Heure<input type="time" value={j.time} onChange={(e) => up({ time: e.target.value })} /></label>
          <label className="field">Durée prévue
            <select value={j.durationMin} onChange={(e) => up({ durationMin: Number(e.target.value) })}>
              {[30, 60, 90, 120, 180, 240, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </select>
          </label>
          <label className="field full">Description de la job
            <input id="job-title" value={j.title} placeholder="ex.: Nettoyage de gouttières + lavage de vitres" onChange={(e) => up({ title: e.target.value })} />
          </label>
          <label className="field full">Adresse
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <AddressInput value={j.address} placeholder={client?.address || 'Adresse des travaux'} onChange={(v) => up({ address: v })} onPick={(label, geo) => { up({ address: label, geo }); setSavedAddress(label); }} />
              {address && <a className="btn icon-btn" href={directionsLink(s.homeAddress || '', address)} target="_blank" rel="noreferrer" aria-label="Itinéraire"><Navigation size={17} /></a>}
            </div>
          </label>
          {full && (
            <div className="field full">Type de job
              <div className="chips">
                {prefs.types.map((t) => {
                  const on = (j.type ?? guessType(j, prefs.types)?.key) === t.key;
                  return (
                    <button key={t.key} type="button" className={`chip-btn type-chip ${on ? 'on' : ''}`} style={{ ['--c' as string]: t.color }} onClick={() => up({ type: j.type === t.key ? undefined : t.key })}>
                      {(() => { const I = jobIcon(t.icon); return <I size={14} className="type-ico" style={{ ['--tc' as string]: t.color }} />; })()} {t.label}
                    </button>
                  );
                })}
              </div>
              <div className="row small muted" style={{ gap: 8, marginTop: 8 }}>
                Couleur dans l’agenda
                <span className="swatches" style={{ marginTop: 0 }}>
                  {['', ...JOB_COLORS].map((c) => (
                    <button key={c || 'auto'} type="button" className={`sw ${c ? '' : 'auto'} ${(j.color ?? '') === c ? 'on' : ''}`} style={{ background: c || 'var(--surface)' }} aria-label={c ? `Couleur ${c}` : 'Couleur automatique'} title={c ? c : 'Automatique'} onClick={() => up({ color: c || undefined })} />
                  ))}
                </span>
              </div>
            </div>
          )}
          {full && (
            <div className="field full">Équipe assignée
              <div className="chips">
                {members.filter((m) => m.active).map((m) => {
                  const on = j.assignees?.includes(m.id!);
                  return (
                    <button key={m.id} type="button" className={`chip-btn ${on ? 'on' : ''}`} onClick={() => up({ assignees: on ? j.assignees!.filter((x) => x !== m.id) : [...(j.assignees ?? []), m.id!] })}>
                      <span className="dot" style={{ background: m.color }} /> {m.name}
                    </button>
                  );
                })}
                {members.filter((m) => m.active).length === 0 && <span className="small muted">Ajoute ton équipe dans « Équipe ».</span>}
              </div>
            </div>
          )}
          <label className="field full">Notes internes <span className="small muted">— visibles par l’équipe</span><textarea value={j.notes} placeholder="Code de porte, chien, échelle de 32 pi…" onChange={(e) => up({ notes: e.target.value })} /></label>
          {j.id ? <AdminNote refKey={`job:${j.id}`} /> : null}
        </div>
        <details className="more-inline" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
          <summary><strong>Plus d’options</strong> <small>{JOB_STATUS_LABEL[j.status]}{j.recurrence !== 'none' ? ` · ${RECURRENCE_LABEL[j.recurrence]}` : ''}{j.projectId ? ' · projet' : ''}</small></summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
          <label className="field">Statut
            <select value={j.status} onChange={(e) => up({ status: e.target.value as JobStatus })}>
              {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map((k) => <option key={k} value={k}>{JOB_STATUS_LABEL[k]}</option>)}
            </select>
          </label>
          {full && (
            <label className="field">Projet
              <select value={j.projectId ?? ''} onChange={(e) => up({ projectId: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">—</option>
                {projects.filter((p) => !j.clientId || p.clientId === j.clientId || p.id === j.projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="field">Récurrence
            <select value={j.recurrence} onChange={(e) => up({ recurrence: e.target.value as Recurrence })}>
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((k) => <option key={k} value={k}>{RECURRENCE_LABEL[k]}</option>)}
            </select>
          </label>
          {j.recurrence === 'months' && (
            <label className="field">Aux combien de mois<NumInput value={j.recurEveryMonths ?? 6} onChange={(n) => up({ recurEveryMonths: n })} /></label>
          )}
          </div>
        </details>
        {j.recurrence !== 'none' && <div className="small muted" style={{ marginTop: 8 }}>Quand ce job est marqué « Fait », le prochain se planifie tout seul.</div>}
      </div>

      <div className="card">
        <div className="card-head"><h2>Travaux prévus (codes)</h2><span className="spacer" />{full && total > 0 && <strong>{money(total)}</strong>}</div>
        {full ? (
          <LineItems items={j.items} services={services} onChange={(items) => up({ items })} />
        ) : (
          <table className="list"><tbody>
            {j.items.map((it, i) => <tr key={i}><td><b style={{ color: 'var(--amber-ink)' }}>{it.code}</b> {it.description}</td><td className="num">{it.quantity} {it.unit}</td></tr>)}
            {j.items.length === 0 && <tr><td className="muted">—</td></tr>}
          </tbody></table>
        )}
      </div>

      {j.id ? (
        <MediaGallery link={{ jobId: j.id, docId: j.docId, clientId: j.clientId }} kinds={['avant', 'apres', 'job']} title="Photos du job" autoOpenCamera={wantPhoto} />
      ) : (
        <div className="notice info">Enregistre le job pour ajouter des photos avant/après.</div>
      )}

      <div className="row">
        {j.id && j.status === 'planifie' && <button className="btn" onClick={() => setRemind(true)}><Bell size={16} /> Rappel au client</button>}
        <span className="spacer" />
        {full && <button className="btn danger" onClick={remove}><Trash2 size={16} /> Supprimer</button>}
      </div>

      {doneSheet !== null && j.id && <JobDoneSheet job={j} client={client} canBill={full} routeKm={doneSheet} onClose={() => setDoneSheet(null)} />}
      {remind && j.id && <ReminderModal job={j} client={client} onClose={() => setRemind(false)} />}
    </>
  );
}

const addDaysSafe = (n: number) => addDays(todayISO(), n);
