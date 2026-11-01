import { Mic,
  CalendarDays, Camera, ChevronLeft, Crown, Download, Lock, FolderOpen, TrendingUp, Inbox, Clock, Briefcase, UsersRound, Car, ClipboardList, FileText, Home, LayoutGrid, Mail, Moon, Package, Plus, Search, Settings, Sparkles, Sun, SunMoon, Tag, Timer, Users, X, Zap, ImagePlus, Truck, Wrench, type LucideIcon, ScrollText,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CommandPalette } from './components/CommandPalette';
import { SyncBadge } from './components/SyncBadge';
import { ToastProvider } from './components/Toast';
import { useSettings } from './lib/hooks';
import { cycleTheme, getTheme, type ThemePref } from './lib/theme';
import Accountant from './pages/Accountant';
import Agenda from './pages/Agenda';
import ClientDetail from './pages/ClientDetail';
import Clients from './pages/Clients';
import Dashboard from './pages/Dashboard';
import DocEditor from './pages/DocEditor';
import DocList from './pages/DocList';
import ExpenseEditor from './pages/ExpenseEditor';
import Expenses from './pages/Expenses';
import Express from './pages/Express';
import VoiceJob from './pages/VoiceJob';
import Trade from './pages/Trade';
import Estimator from './pages/Estimator';
import Orders from './pages/Orders';
import GmailPage from './pages/GmailPage';
import JobEditor from './pages/JobEditor';
import Logbook from './pages/Logbook';
import Library from './pages/Library';
import Reports from './pages/Reports';
import Portal from './pages/Portal';
import Services from './pages/Services';
import SettingsPage from './pages/SettingsPage';
import Leads from './pages/Leads';
import LeadForm from './pages/LeadForm';
import Join from './pages/Join';
import PunchPage from './pages/Punch';
import Timesheets from './pages/Timesheets';
import Team from './pages/Team';
import Projects, { ProjectDetail } from './pages/Projects';
import Landing from './pages/Landing';
import Signup from './pages/Signup';
import Login from './pages/Login';
import Legal from './pages/Legal';
import Subscription from './pages/Subscription';
import PunchApp from './pages/PunchApp';
import { isPunchApp } from './lib/team';
import { useBilling } from './lib/billing';
import { PRODUCT } from './brand';
import { CompanyMark } from './components/CompanyMark';
import { isBooted, onBooted } from './lib/templates';
import { useSyncState, type Role } from './lib/sync';
import { db } from './lib/db';
import { APK_URL, useAppUpdate } from './lib/update';
import { isNative } from './lib/native';
import { applyAccent } from './lib/accent';

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  end?: boolean;
  sep?: boolean;
  roles?: Role[]; // rôles qui voient l'élément (tous si absent → propriétaire/admin seulement)
}

const NAV: NavItem[] = [
  { to: '/', label: 'Accueil', short: 'Accueil', icon: Home, end: true },
  { to: '/demandes', label: 'Demandes', short: 'Demandes', icon: Inbox, roles: ['vendeur'] },
  { to: '/agenda', label: 'Agenda', short: 'Agenda', icon: CalendarDays, roles: ['employe', 'vendeur'] },
  { to: '/pointage', label: 'Heures (pointage)', short: 'Pointage', icon: Clock, roles: ['employe', 'vendeur'] },
  { to: '/factures', label: 'Factures', short: 'Factures', icon: FileText },
  { to: '/soumissions', label: 'Soumissions', short: 'Soumissions', icon: ClipboardList, roles: ['vendeur'] },
  { to: '/clients', label: 'Clients', short: 'Clients', icon: Users, roles: ['vendeur'] },
  { to: '/projets', label: 'Projets', short: 'Projets', icon: Briefcase },
  { to: '/equipe', label: 'Équipe', short: 'Équipe', icon: UsersRound },
  { to: '/rapports', label: 'Chiffres et taxes', short: 'Chiffres', icon: TrendingUp },
  { to: '/estimateur', label: 'Estimateur de projet', short: 'Estimer', icon: Sparkles },
  { to: '/metier', label: 'Calculs et matériaux', short: 'Calculs', icon: Wrench },
  { to: '/achats', label: 'Achats de matériaux', short: 'Achats', icon: Truck },
  { to: '/codes', label: 'Mes prix et services', short: 'Prix', icon: Tag, sep: true },
  { to: '/km', label: 'Kilométrage', short: 'Km', icon: Car },
  { to: '/depenses', label: 'Dépenses et reçus', short: 'Reçus', icon: Camera },
  { to: '/classeur', label: 'Mes documents', short: 'Documents', icon: FolderOpen },
  { to: '/gmail', label: 'Gmail', short: 'Gmail', icon: Mail },
  { to: '/comptable', label: 'Pour le comptable', short: 'Comptable', icon: Package },
  { to: '/abonnement', label: 'Abonnement', short: 'Abonnement', icon: Crown },
  { to: '/parametres', label: 'Paramètres', short: 'Paramètres', icon: Settings, roles: ['employe', 'vendeur'] },
];

const canSee = (n: { roles?: Role[] }, role: Role) => role === 'owner' || role === 'admin' || !!n.roles?.includes(role);

// Barre du bas sur cellulaire: '+' = bouton Créer au centre, 'menu' = toutes les sections
const MOBILE_TABS: Record<Role, string[]> = {
  owner: ['/', '/agenda', '+', '/factures', 'menu'],
  admin: ['/', '/agenda', '+', '/factures', 'menu'],
  vendeur: ['/demandes', '/agenda', '+', '/soumissions', 'menu'],
  employe: ['/agenda', '/pointage', '+', 'menu'],
};

const EXTRA: NavItem[] = [{ to: '/temps', label: 'Feuilles de temps', short: 'Heures', icon: Timer }];

const MENU_GROUPS: { title: string; items: string[] }[] = [
  { title: 'Ventes', items: ['/demandes', '/soumissions', '/factures', '/clients', '/projets'] },
  { title: 'Terrain', items: ['/agenda', '/pointage', '/estimateur', '/metier', '/achats', '/equipe', '/temps'] },
  { title: 'Argent et papiers', items: ['/depenses', '/km', '/classeur', '/rapports', '/comptable'] },
  { title: 'Outils', items: ['/', '/codes', '/gmail', '/abonnement', '/parametres'] },
];

// Menu de gauche (ordi): les sections, dans l'ordre où on s'en sert
const SIDE_GROUPS: { title: string; items: string[] }[] = [
  { title: '', items: ['/'] },
  { title: 'Mes ventes', items: ['/demandes', '/soumissions', '/factures', '/clients', '/projets'] },
  { title: 'Mon travail', items: ['/agenda', '/pointage', '/equipe', '/estimateur', '/metier', '/achats'] },
  { title: 'Mon argent', items: ['/depenses', '/km', '/classeur', '/rapports', '/comptable'] },
  { title: 'Réglages', items: ['/codes', '/gmail', '/abonnement', '/parametres'] },
];

const PAGE_TITLE: [RegExp, string][] = [
  [/^\/doc\//, 'Facture / soumission'], [/^\/job\//, 'Job'], [/^\/depenses\/.+/, 'Reçu'], [/^\/clients\/.+/, 'Client'],
  [/^\/projets\/.+/, 'Projet'], [/^\/express/, 'Facture express'], [/^\/dicter/, 'Assistant'], [/^\/achats\/.+/, 'Commande'], [/^\/temps/, 'Feuilles de temps'],
];
/** Où mène « Retour » quand on arrive directement sur une page (lien, notification). */
const PARENT: [RegExp, string][] = [
  [/^\/doc\//, '/factures'], [/^\/job\//, '/agenda'], [/^\/depenses\/.+/, '/depenses'], [/^\/clients\/.+/, '/clients'],
  [/^\/projets\/.+/, '/projets'], [/^\/temps/, '/equipe'], [/^\/achats\/.+/, '/achats'],
];

/** Routes d'édition: sur cellulaire, la barre du bas laisse place aux boutons de la page. */
const isEditorRoute = (p: string) => /^\/(doc|job)\//.test(p) || /^\/depenses\/.+/.test(p);

const QUICK: { label: string; icon: LucideIcon; to: string; roles?: Role[] }[] = [
  { label: 'Assistant', icon: Mic, to: '/dicter' },
  { label: 'Facture express', icon: Zap, to: '/express' },
  { label: 'Punch in / out', icon: Clock, to: '/pointage', roles: ['employe', 'vendeur'] },
  { label: 'Planifier un job', icon: CalendarDays, to: '/job/new' },
  { label: 'Photo de reçu', icon: Camera, to: '/depenses/new' },
  { label: 'Photo de job', icon: ImagePlus, to: '/job/new?photo=1', roles: ['employe', 'vendeur'] },
  { label: 'Soumission', icon: ClipboardList, to: '/doc/new?type=quote&format=lignes', roles: ['vendeur'] },
  { label: 'Devis détaillé', icon: ScrollText, to: '/doc/new?type=quote&format=devis', roles: ['vendeur'] },
  { label: 'Nouvelle demande', icon: Inbox, to: '/demandes?new=1', roles: ['vendeur'] },
  { label: 'Facture complète', icon: FileText, to: '/doc/new?type=invoice' },
];

const THEME_LABEL: Record<ThemePref, string> = { system: 'Thème: auto', dark: 'Thème: sombre', light: 'Thème: clair' };
const THEME_ICON: Record<ThemePref, LucideIcon> = { system: SunMoon, dark: Moon, light: Sun };

const PUBLIC = ['/p/', '/demande/', '/rejoindre', '/produit', '/demarrer', '/connexion', '/confidentialite', '/conditions'];

export default function App() {
  const loc = useLocation();
  // Pages publiques (client, formulaire, invitation, page de vente, inscription): sans le menu de l'app
  return <ToastProvider>{PUBLIC.some((p) => loc.pathname.startsWith(p)) ? <PublicRoutes /> : <Gate />}</ToastProvider>;
}

function PublicRoutes() {
  return (
        <Routes>
          <Route path="/p/:token" element={<Portal />} />
          <Route path="/demande/:owner" element={<LeadForm />} />
          <Route path="/rejoindre" element={<Join />} />
          <Route path="/produit" element={<Landing />} />
          <Route path="/demarrer" element={<Signup />} />
          <Route path="/connexion" element={<Login />} />
          <Route path="/confidentialite" element={<Legal kind="privacy" />} />
          <Route path="/conditions" element={<Legal kind="terms" />} />
        </Routes>
  );
}

/** Nouvel appareil ou nouveau visiteur: page de vente, assistant de démarrage ou chargement de l'entreprise. */
function Gate() {
  const st = useSyncState();
  const booted = useSyncExternalStore(onBooted, isBooted);
  const raw = useLiveQuery(() => db.settings.get('main').then((x) => x ?? null), []);
  const member = useLiveQuery(() => (st.memberId ? db.members.get(st.memberId) : undefined), [st.memberId]);
  const punchApp = isPunchApp();
  useEffect(() => {
    if (raw) applyAccent(raw.brandColor);
  }, [raw?.brandColor, raw]);
  if (!booted || raw === undefined) return <Splash />;
  const configured = !!(raw && (raw.setupComplete || raw.companyName));
  // App Pointage (pointage.html) ou employé en accès « Pointage seulement »: le gros bouton, rien d'autre
  if (configured && (punchApp || (st.role === 'employe' && member?.access !== 'complet' && member !== undefined))) {
    if (punchApp && (st.status === 'signedout' || st.status === 'off') && !raw?.setupComplete) return <Navigate to="/connexion" replace />;
    return <PunchApp />;
  }
  if (configured) return <Shell />;
  if (st.status === 'connecting' || st.status === 'syncing' || (st.status === 'ok' && st.role !== 'owner')) return <Splash text="Chargement de ton entreprise…" />;
  if (st.status === 'ok') return <Navigate to="/demarrer" replace />;
  return <Navigate to={punchApp ? '/connexion' : '/produit'} replace />;
}

function Paywall() {
  return (
    <div className="paywall">
      <Lock size={34} />
      <h1>Ton essai gratuit est terminé</h1>
      <p className="muted">Tes clients, factures et reçus sont en sécurité: tu peux toujours les consulter et les exporter. Choisis un forfait pour recommencer à créer des factures, des soumissions et des jobs.</p>
      <Link to="/abonnement" className="btn accent big"><Crown size={18} /> Voir les forfaits</Link>
    </div>
  );
}

function Splash({ text }: { text?: string }) {
  return (
    <div className="splash">
      <span className="lp-logo big">{PRODUCT.name.slice(0, 1)}</span>
      {text && <div className="muted">{text}</div>}
    </div>
  );
}

function Shell() {
  const s = useSettings();
  const st = useSyncState();
  const role = st.role;
  const full = role === 'owner' || role === 'admin';
  const nav = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const [fab, setFab] = useState(false);
  const [cmd, setCmd] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const ThemeIcon = THEME_ICON[theme];
  const update = useAppUpdate();
  const billing = useBilling();
  // Essai terminé: lecture et exportation seulement (pas de nouvelles factures, jobs, reçus)
  const locked = !billing.canWrite && (isEditorRoute(loc.pathname) || loc.pathname.startsWith('/express'));
  const newLeads = useLiveQuery(() => db.leads.where('stage').equals('nouveau').count(), []) ?? 0;
  const editor = isEditorRoute(loc.pathname);
  const findNav = (to: string) => NAV.find((n) => n.to === to) ?? EXTRA.find((n) => n.to === to);
  const leadsVisible = canSee(NAV[1], role);
  const path = loc.pathname;
  const tabs = MOBILE_TABS[role];
  const isRoot = tabs.includes(path) || (path === '/' && full) || (!full && path === tabs[0]);
  const pageTitle = PAGE_TITLE.find(([r]) => r.test(path))?.[1] ?? NAV.find((n) => n.to !== '/' && (path === n.to || path.startsWith(n.to + '/')))?.label ?? '';
  const goBack = () => {
    if (loc.key !== 'default' && window.history.length > 1) nav(-1);
    else nav(PARENT.find(([r]) => r.test(path))?.[1] ?? tabs[0].replace('+', '/'));
  };

  // Bouton « retour » du téléphone (Android): ferme d'abord ce qui est ouvert, puis revient en arrière
  const backRef = useRef<() => void>(() => undefined);
  backRef.current = () => {
    const modalClose = document.querySelector<HTMLButtonElement>('.modal-bg .modal [aria-label="Fermer"]');
    if (fab || more || cmd) {
      setFab(false);
      setMore(false);
      setCmd(false);
    } else if (modalClose) modalClose.click();
    else if (!isRoot) goBack();
    else void import('@capacitor/app').then(({ App: CapApp }) => CapApp.minimizeApp());
  };
  useEffect(() => {
    if (!isNative()) return;
    let off: (() => void) | undefined;
    void import('@capacitor/app').then(({ App: CapApp }) =>
      CapApp.addListener('backButton', () => backRef.current()).then((h) => (off = () => void h.remove())),
    );
    return () => off?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmd((x) => !x);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setMore(false);
    setFab(false);
  }, [loc.pathname]);

  return (
    <>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <CompanyMark s={s} size={36} />
            <div>
              {s.companyName}
              <small>Gestion d’entreprise</small>
            </div>
          </div>
          <SyncBadge />
          {full && (
            <button className="btn accent" style={{ margin: '0 4px 12px' }} onClick={() => nav('/express')}>
              <Zap size={17} /> Facture express
            </button>
          )}
          <nav className="nav">
            {SIDE_GROUPS.map((g) => {
              const items = g.items.map((to) => NAV.find((n) => n.to === to)).filter((n): n is NavItem => !!n && canSee(n, role));
              if (!items.length) return null;
              return (
                <div key={g.title || 'accueil'} className="nav-group-box">
                  {g.title && <div className="nav-group">{g.title}</div>}
                  {items.map((n) => (
                    <NavLink key={n.to} to={n.to} end={n.end}>
                      <span className="ico"><n.icon size={18} /></span>
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="side-foot">
            <button className="side-btn" onClick={() => setCmd(true)}>
              <Search size={16} /> Rechercher <kbd>Ctrl K</kbd>
            </button>
            <button className="side-btn" onClick={() => setThemeState(cycleTheme())}>
              <ThemeIcon size={16} /> {THEME_LABEL[theme]}
            </button>
          </div>
        </aside>

        <main className={`main ${editor ? 'is-editor' : ''}`}>
          <header className="topbar">
            {isRoot ? (
              <>
                <div className={`tb-title ${full ? 'with-ask' : ''}`}><CompanyMark s={s} /><span>{s.companyName}</span></div>
                {full && <Link to="/dicter" className="tb-ask" aria-label="Demander à l’assistant"><Mic size={16} /><span>Demande à ton assistant…</span></Link>}
              </>
            ) : (
              <>
                <button className="tb-btn tb-back" onClick={goBack} aria-label="Retour"><ChevronLeft size={26} /> Retour</button>
                <div className="tb-title"><span>{pageTitle}</span></div>
              </>
            )}
            <button className="tb-btn" onClick={() => setCmd(true)} aria-label="Rechercher"><Search size={21} /></button>
            <NavLink className="tb-btn" to="/parametres" aria-label={`Synchronisation: ${st.status}`}>
              <span className={`tb-dot ${st.status === 'ok' ? 'ok' : st.status === 'error' ? 'err' : ''}`} />
            </NavLink>
          </header>
          {full && !loc.pathname.startsWith('/abonnement') && (billing.kind === 'expired' || billing.kind === 'past_due' || (billing.kind === 'trial' && (billing.daysLeft ?? 99) <= 7)) && (
            <Link to="/abonnement" className={`bill-banner ${billing.kind === 'trial' ? '' : 'bad'}`}>
              <Crown size={16} />
              <span>{billing.kind === 'trial' ? `Essai gratuit: ${billing.daysLeft} jour${(billing.daysLeft ?? 0) > 1 ? 's' : ''} restant${(billing.daysLeft ?? 0) > 1 ? 's' : ''}` : billing.kind === 'past_due' ? 'Paiement de l’abonnement en retard' : 'Essai terminé: tes données sont en lecture seule'}</span>
              <strong>{billing.kind === 'past_due' ? 'Mettre à jour' : 'Choisir un forfait'} →</strong>
            </Link>
          )}
          <div className="page-anim" key={'/' + path.split('/')[1]}>
          {locked ? <Paywall /> : (
          <Routes>
            <Route path="/" element={full ? <Dashboard onSearch={() => setCmd(true)} /> : <Navigate to={role === 'vendeur' ? '/demandes' : '/pointage'} replace />} />
            <Route path="/demandes" element={<Leads />} />
            <Route path="/pointage" element={<PunchPage />} />
            <Route path="/temps" element={<Timesheets />} />
            <Route path="/equipe" element={<Team />} />
            <Route path="/projets" element={<Projects />} />
            <Route path="/projets/:id" element={<ProjectDetail />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/job/:id" element={<JobEditor />} />
            <Route path="/express" element={<Express />} />
            <Route path="/dicter" element={<VoiceJob />} />
            <Route path="/estimateur" element={<Estimator />} />
            <Route path="/metier" element={<Trade />} />
            <Route path="/achats" element={<Orders />} />
            <Route path="/achats/:id" element={<Orders />} />
            <Route path="/factures" element={<DocList type="invoice" />} />
            <Route path="/soumissions" element={<DocList type="quote" />} />
            <Route path="/doc/:id" element={<DocEditor />} />
            <Route path="/codes" element={<Services />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/km" element={<Logbook />} />
            <Route path="/depenses" element={<Expenses />} />
            <Route path="/depenses/:id" element={<ExpenseEditor />} />
            <Route path="/classeur" element={<Library />} />
            <Route path="/rapports" element={<Reports />} />
            <Route path="/gmail" element={<GmailPage />} />
            <Route path="/comptable" element={<Accountant />} />
            <Route path="/parametres" element={<SettingsPage />} />
            <Route path="/abonnement" element={<Subscription />} />
            <Route path="*" element={full ? <Dashboard onSearch={() => setCmd(true)} /> : <Navigate to="/agenda" replace />} />
          </Routes>
          )}
          </div>
        </main>

        {update.available && (
          <div className="update-bar">
            <Download size={18} />
            <span>Nouvelle version de l’app disponible</span>
            <a className="btn small accent" href={APK_URL} target="_blank" rel="noreferrer" onClick={update.dismiss}>Mettre à jour</a>
            <button className="icon-btn" aria-label="Plus tard" onClick={update.dismiss}><X size={16} /></button>
          </div>
        )}

        {!editor && (
          <nav className={`bottomnav cols-${MOBILE_TABS[role].length}`}>
            {MOBILE_TABS[role].map((to) => {
              if (to === '+') {
                return (
                  <button key="+" className={`tab-create ${fab ? 'open' : ''}`} aria-label="Ajouter" aria-expanded={fab} onClick={() => { setFab((x) => !x); setMore(false); }}>
                    <span><Plus size={26} /></span>
                  </button>
                );
              }
              if (to === 'menu') {
                return (
                  <button key="menu" className={more ? 'active' : ''} aria-expanded={more} onClick={() => { setMore((m) => !m); setFab(false); }}>
                    <span className="tab-ico"><LayoutGrid size={22} />{leadsVisible && newLeads > 0 && !MOBILE_TABS[role].includes('/demandes') && <i className="tab-badge">{newLeads}</i>}</span>
                    Menu
                  </button>
                );
              }
              const n = findNav(to)!;
              return (
                <NavLink key={n.to} to={n.to} end={n.end}>
                  <span className="tab-ico"><n.icon size={22} />{n.to === '/demandes' && newLeads > 0 && <i className="tab-badge">{newLeads}</i>}</span>
                  {n.short}
                </NavLink>
              );
            })}
          </nav>
        )}

        {fab && (
          <div className="sheet-wrap hide-desktop" onClick={() => setFab(false)}>
            <div className="sheet" role="dialog" aria-label="Créer" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-grip" />
              <div className="sheet-title">Créer</div>
              <div className="create-grid">
                {QUICK.filter((q) => canSee(q, role)).map((q) => (
                  <button key={q.to} onClick={() => nav(billing.canWrite || q.to === '/pointage' ? q.to : '/abonnement')}>
                    <span className="ci"><q.icon size={22} /></span>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {more && (
          <div className="sheet-wrap hide-desktop" onClick={() => setMore(false)}>
            <div className="sheet tall" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-grip" />
              <div className="sheet-head">
                <CompanyMark s={s} size={40} />
                <div><strong>{s.companyName}</strong><SyncBadge /></div>
                <button className="icon-btn" aria-label="Fermer" onClick={() => setMore(false)}><X size={20} /></button>
              </div>
              <button className="sheet-search" onClick={() => { setMore(false); setCmd(true); }}><Search size={18} /> Rechercher un client, une facture…</button>
              {MENU_GROUPS.map((g) => {
                const items = g.items.map(findNav).filter((n): n is NavItem => !!n && canSee(n, role));
                if (!items.length) return null;
                return (
                  <div key={g.title} className="menu-group">
                    <div className="menu-group-title">{g.title}</div>
                    <div className="menu-tiles">
                      {items.map((n) => (
                        <NavLink key={n.to} to={n.to} end={n.end}>
                          <span className="mi"><n.icon size={22} />{n.to === '/demandes' && newLeads > 0 && <i className="tab-badge">{newLeads}</i>}</span>
                          {n.short}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button className="sheet-row" onClick={() => setThemeState(cycleTheme())}><ThemeIcon size={18} /> {THEME_LABEL[theme]}</button>
            </div>
          </div>
        )}
        {cmd && <CommandPalette onClose={() => setCmd(false)} />}
      </div>
    </>
  );
}
