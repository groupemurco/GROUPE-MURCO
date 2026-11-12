import { Mic,
  CalendarDays, Camera, ChevronLeft, Crown, Download, Lock, Inbox, Clock, ClipboardList, FileText, LayoutGrid, Moon, Plus, Search, Sparkles, Sun, SunMoon, Timer, X, Zap, ImagePlus, type LucideIcon,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { PortalWatcher } from './components/PortalWatcher';
import { LeaChat } from './components/LeaChat';
import { duo } from './components/Icons';
import { CommandPalette } from './components/CommandPalette';
import { SyncBadge } from './components/SyncBadge';
import { ToastProvider } from './components/Toast';
import { useSettings } from './lib/hooks';
import { cycleTheme, getTheme, type ThemePref } from './lib/theme';
import Dashboard from './pages/Dashboard';
import { lazyPage, preloadPages } from './lib/lazyPage';
const Accountant = lazyPage(() => import('./pages/Accountant'));
const Agenda = lazyPage(() => import('./pages/Agenda'));
const ClientDetail = lazyPage(() => import('./pages/ClientDetail'));
const Clients = lazyPage(() => import('./pages/Clients'));
const DocEditor = lazyPage(() => import('./pages/DocEditor'));
const DocList = lazyPage(() => import('./pages/DocList'));
const ExpenseEditor = lazyPage(() => import('./pages/ExpenseEditor'));
const Expenses = lazyPage(() => import('./pages/Expenses'));
const Express = lazyPage(() => import('./pages/Express'));
const VoiceJob = lazyPage(() => import('./pages/VoiceJob'));
const QuickQuote = lazyPage(() => import('./pages/QuickQuote'));
const Trade = lazyPage(() => import('./pages/Trade'));
const Estimator = lazyPage(() => import('./pages/Estimator'));
const Orders = lazyPage(() => import('./pages/Orders'));
const GmailPage = lazyPage(() => import('./pages/GmailPage'));
const JobEditor = lazyPage(() => import('./pages/JobEditor'));
const Logbook = lazyPage(() => import('./pages/Logbook'));
const Library = lazyPage(() => import('./pages/Library'));
const Reports = lazyPage(() => import('./pages/Reports'));
const Portal = lazyPage(() => import('./pages/Portal'));
const Services = lazyPage(() => import('./pages/Services'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'));
const Leads = lazyPage(() => import('./pages/Leads'));
const LeadForm = lazyPage(() => import('./pages/LeadForm'));
const Join = lazyPage(() => import('./pages/Join'));
const Timesheets = lazyPage(() => import('./pages/Timesheets'));
const Team = lazyPage(() => import('./pages/Team'));
const Landing = lazyPage(() => import('./pages/Landing'));
const Signup = lazyPage(() => import('./pages/Signup'));
const Login = lazyPage(() => import('./pages/Login'));
const Legal = lazyPage(() => import('./pages/Legal'));
const Subscription = lazyPage(() => import('./pages/Subscription'));
const PunchApp = lazyPage(() => import('./pages/PunchApp'));
const PunchPage = lazyPage(() => import('./pages/Punch'));
const Projects = lazyPage(() => import('./pages/Projects'));
const ProjectDetail = lazyPage(() => import('./pages/Projects').then((m) => ({ default: m.ProjectDetail })));
// Les pages de tous les jours se chargent en arrière-plan dès que l'accueil est affiché: la navigation reste instantanée
preloadPages([() => import('./pages/Agenda'), () => import('./pages/DocEditor'), () => import('./pages/DocList'), () => import('./pages/JobEditor'), () => import('./pages/Express'), () => import('./pages/Clients'), () => import('./pages/Expenses')]);
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
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
  sep?: boolean;
  roles?: Role[]; // rôles qui voient l'élément (tous si absent → propriétaire/admin seulement)
}

const NAV: NavItem[] = [
  { to: '/', label: 'Accueil', short: 'Accueil', icon: duo('home'), end: true },
  { to: '/demandes', label: 'Demandes', short: 'Demandes', icon: duo('inbox'), roles: ['vendeur'] },
  { to: '/agenda', label: 'Agenda', short: 'Agenda', icon: duo('calendar'), roles: ['employe', 'vendeur'] },
  { to: '/pointage', label: 'Heures (pointage)', short: 'Pointage', icon: duo('clock'), roles: ['employe', 'vendeur'] },
  { to: '/factures', label: 'Factures', short: 'Factures', icon: duo('invoice') },
  { to: '/soumissions', label: 'Soumissions', short: 'Soumissions', icon: duo('quote'), roles: ['vendeur'] },
  { to: '/clients', label: 'Clients', short: 'Clients', icon: duo('clients'), roles: ['vendeur'] },
  { to: '/projets', label: 'Projets', short: 'Projets', icon: duo('briefcase') },
  { to: '/equipe', label: 'Équipe', short: 'Équipe', icon: duo('clients') },
  { to: '/rapports', label: 'Chiffres et taxes', short: 'Chiffres', icon: duo('chart') },
  { to: '/estimateur', label: 'Estimateur de projet', short: 'Estimer', icon: duo('spark') },
  { to: '/metier', label: 'Calculs et matériaux', short: 'Calculs', icon: duo('calc') },
  { to: '/achats', label: 'Achats de matériaux', short: 'Achats', icon: duo('cart') },
  { to: '/codes', label: 'Mes prix et services', short: 'Prix', icon: duo('tag'), sep: true },
  { to: '/km', label: 'Kilométrage', short: 'Km', icon: duo('car') },
  { to: '/depenses', label: 'Dépenses et reçus', short: 'Reçus', icon: duo('wallet') },
  { to: '/classeur', label: 'Mes documents', short: 'Documents', icon: duo('folder') },
  { to: '/gmail', label: 'Gmail', short: 'Gmail', icon: duo('mail') },
  { to: '/comptable', label: 'Pour le comptable', short: 'Comptable', icon: duo('book') },
  { to: '/abonnement', label: 'Abonnement', short: 'Abonnement', icon: duo('crown') },
  { to: '/parametres', label: 'Paramètres', short: 'Paramètres', icon: duo('settings'), roles: ['employe', 'vendeur'] },
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

// Menu de gauche (ordi): l'essentiel; le reste est replié dans « Plus »
const SIDE_MAIN = ['/', '/clients', '/soumissions', '/factures', '/agenda', '/depenses', '/parametres'];
const SIDE_MORE: { title: string; items: string[] }[] = [
  { title: 'Ventes', items: ['/demandes', '/projets'] },
  { title: 'Travail', items: ['/pointage', '/equipe', '/estimateur', '/metier', '/achats'] },
  { title: 'Argent', items: ['/km', '/classeur', '/rapports', '/comptable'] },
  { title: 'Réglages', items: ['/codes', '/gmail', '/abonnement'] },
];

const PAGE_TITLE: [RegExp, string][] = [
  [/^\/doc\//, 'Facture / soumission'], [/^\/job\//, 'Job'], [/^\/depenses\/.+/, 'Reçu'], [/^\/clients\/.+/, 'Client'],
  [/^\/projets\/.+/, 'Projet'], [/^\/express/, 'Facture express'], [/^\/dicter/, 'Assistant'], [/^\/soumission-ia/, 'Soumission IA'], [/^\/achats\/.+/, 'Commande'], [/^\/temps/, 'Feuilles de temps'],
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
  { label: 'Soumission IA', icon: Sparkles, to: '/soumission-ia', roles: ['vendeur'] },
  { label: 'Nouvelle demande', icon: Inbox, to: '/demandes?new=1', roles: ['vendeur'] },
  { label: 'Facture complète', icon: FileText, to: '/doc/new?type=invoice' },
];

const THEME_LABEL: Record<ThemePref, string> = { system: 'Thème: auto', dark: 'Thème: sombre', light: 'Thème: clair' };
const THEME_ICON: Record<ThemePref, LucideIcon> = { system: SunMoon, dark: Moon, light: Sun };

const PUBLIC = ['/p/', '/demande/', '/rejoindre', '/produit', '/demarrer', '/connexion', '/confidentialite', '/conditions'];

export default function App() {
  const loc = useLocation();
  // Pages publiques (client, formulaire, invitation, page de vente, inscription): sans le menu de l'app
  return <ToastProvider><Suspense fallback={<Splash />}>{PUBLIC.some((p) => loc.pathname.startsWith(p)) ? <PublicRoutes /> : <Gate />}</Suspense></ToastProvider>;
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

  // Documents dont le numéro de client avait une erreur d'arrondi: on les remet sur le bon client (une seule fois, sans rien effacer)
  useEffect(() => {
    if (!full) return;
    const ts = [4000, 15000].map((ms) => setTimeout(() => void import('./lib/repair').then((m) => m.repairClientIds()).catch(() => 0), ms));
    return () => ts.forEach(clearTimeout);
  }, [full]);

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
            {(() => {
              const staff = role === 'employe' || role === 'vendeur';
              const mainPaths = staff ? [...SIDE_MAIN.slice(0, -1), '/demandes', '/pointage', '/parametres'] : SIDE_MAIN;
              const pick = (paths: string[]) => paths.map((to) => NAV.find((n) => n.to === to)).filter((n): n is NavItem => !!n && canSee(n, role));
              const link = (n: NavItem) => (
                <NavLink key={n.to} to={n.to} end={n.end}>
                  <span className="ico"><n.icon size={18} /></span>
                  {n.label}
                </NavLink>
              );
              const more = SIDE_MORE.map((g) => ({ title: g.title, items: pick(g.items.filter((to) => !mainPaths.includes(to))) })).filter((g) => g.items.length);
              const inMore = more.some((g) => g.items.some((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to))));
              return (
                <>
                  <div className="nav-group-box">{pick(mainPaths).map(link)}</div>
                  {more.length > 0 && (
                    <details className="nav-more" open={inMore || undefined}>
                      <summary>Plus</summary>
                      {more.map((g) => (
                        <div key={g.title} className="nav-group-box">
                          <div className="nav-group">{g.title}</div>
                          {g.items.map(link)}
                        </div>
                      ))}
                    </details>
                  )}
                </>
              );
            })()}
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
          {!isRoot && (
            <header className="topbar">
              <button className="tb-btn tb-back" onClick={goBack} aria-label="Retour"><ChevronLeft size={26} /> Retour</button>
              <div className="tb-title"><span>{pageTitle}</span></div>
            </header>
          )}
          {full && !loc.pathname.startsWith('/abonnement') && (billing.kind === 'expired' || billing.kind === 'past_due' || (billing.kind === 'trial' && (billing.daysLeft ?? 99) <= 7)) && (
            <Link to="/abonnement" className={`bill-banner ${billing.kind === 'trial' ? '' : 'bad'}`}>
              <Crown size={16} />
              <span>{billing.kind === 'trial' ? `Essai gratuit: ${billing.daysLeft} jour${(billing.daysLeft ?? 0) > 1 ? 's' : ''} restant${(billing.daysLeft ?? 0) > 1 ? 's' : ''}` : billing.kind === 'past_due' ? 'Paiement de l’abonnement en retard' : 'Essai terminé: tes données sont en lecture seule'}</span>
              <strong>{billing.kind === 'past_due' ? 'Mettre à jour' : 'Choisir un forfait'} →</strong>
            </Link>
          )}
          <div className="page-anim" key={'/' + path.split('/')[1]}>
          {locked ? <Paywall /> : (
          <Suspense fallback={<div className="skel-wrap" aria-busy="true"><div className="skel hero" /><div className="skel row" /><div className="skel row" /></div>}>
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
            <Route path="/soumission-ia" element={<QuickQuote />} />
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
          </Suspense>
          )}
          </div>
        </main>

        {full && !editor && !loc.pathname.startsWith('/dicter') && <LeaChat />}
        {full && <PortalWatcher />}

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
