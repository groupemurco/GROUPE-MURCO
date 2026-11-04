import { useEffect, useRef, useState } from 'react';
import { BrandColorCard } from '../components/BrandColorCard';
import { applyAccent, colorFromLogo } from '../lib/accent';
import { publishLeadForm } from '../lib/crm';
import { errMsg, useConfirm, useToast } from '../components/Toast';
import { getSettings, saveSettings, type Settings } from '../lib/db';
import { buildBackup, restoreBackup } from '../lib/exportZip';
import { AddressInput } from '../components/AddressInput';
import { drivingDistance, geocode, mapsLastError } from '../lib/geo';
import { configFromLink, deleteMyAccount, deviceLink, getFirebaseConfig, parseFirebaseConfig, resetPassword, saveFirebaseConfig, signInEmail, signInGoogle, signOutSync, useSyncState } from '../lib/sync';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Trash2, Upload } from 'lucide-react';
import { useBilling } from '../lib/billing';
import { useSettings } from '../lib/hooks';
import { isNative } from '../lib/native';
import { connectGmail, isGmailConnected } from '../lib/gmail';
import { downloadBlob, todayISO } from '../lib/utils';
import { UpdateCard } from '../components/UpdateCard';

async function logoToPng(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export default function SettingsPage() {
  const notify = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [orig, setOrig] = useState<Settings | null>(null);
  const [homeCheck, setHomeCheck] = useState('');
  useEffect(() => { getSettings().then((x) => { setS(x); setOrig(x); }); }, []);
  const st = useSyncState();
  const [params] = useSearchParams();
  // Arrivée depuis la liste « Démarrage »: aller directement à la bonne section
  const scrolled = useRef('');
  useEffect(() => {
    const sec = params.get('s');
    if (!sec || !s || scrolled.current === sec) return; // une seule fois: sinon la page remonte à chaque lettre tapée
    scrolled.current = sec;
    const t = setTimeout(() => document.getElementById(sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => clearTimeout(t);
  }, [params, s]);
  if (st.role === 'employe' || st.role === 'vendeur') {
    // Les membres de l'équipe ne voient que leur connexion
    return (
      <>
        <div className="page-head"><h1>Paramètres</h1></div>
        <SyncSection />
      </>
    );
  }
  if (!s) return null;

  const up = (p: Partial<Settings>) => setS({ ...s, ...p });
  // Couleur: enregistrée tout de suite (aperçu en direct partout)
  const setBrand = (c: string, extra: Partial<Settings> = {}) => {
    setS((x) => (x ? { ...x, ...extra, brandColor: c } : x));
    setOrig((x) => (x ? { ...x, ...extra, brandColor: c } : x));
    applyAccent(c);
    void saveSettings({ ...extra, brandColor: c }).then(async () => {
      if (s.leadForm) await publishLeadForm(true).catch(() => undefined);
    });
  };
  const txt = (k: keyof Settings, label: string, opts: { full?: boolean; type?: string; placeholder?: string } = {}) => (
    <label className={`field ${opts.full ? 'full' : ''}`}>
      {label}
      <input type={opts.type ?? 'text'} value={String(s[k] ?? '')} placeholder={opts.placeholder}
        onChange={(e) => up({ [k]: opts.type === 'number' ? Number(e.target.value) : e.target.value } as Partial<Settings>)} />
    </label>
  );

  const save = async () => {
    // N'enregistre que ce qui a changé (les autres champs ont pu être modifiés sur un autre appareil)
    const patch: Partial<Settings> = {};
    (Object.keys(s) as (keyof Settings)[]).forEach((k) => {
      if (JSON.stringify(s[k]) !== JSON.stringify(orig?.[k])) (patch as Record<string, unknown>)[k] = s[k];
    });
    if ('homeAddress' in patch && !('homeGeo' in patch)) patch.homeGeo = undefined;
    await saveSettings(patch);
    const fresh = await getSettings();
    setS(fresh);
    setOrig(fresh);
    notify('Paramètres enregistrés');
  };

  const checkHome = async () => {
    setHomeCheck('Recherche…');
    try {
      const r = await geocode(s.homeAddress);
      if (!r) return setHomeCheck('Adresse introuvable — ajoute la ville et le code postal.');
      up({ homeGeo: r.geo });
      await saveSettings({ homeAddress: s.homeAddress, homeGeo: r.geo });
      setHomeCheck(`Trouvée: ${r.label}`);
    } catch (e) {
      setHomeCheck(`${errMsg(e)}`);
    }
  };

  const origin = window.location.origin;

  return (
    <>
      <div className="page-head">
        <h1>Paramètres</h1>
        <button className="btn accent" onClick={save}>Enregistrer</button>
      </div>

      <div className="card" id="compagnie">
        <h2>Ma compagnie (apparaît sur les factures et soumissions)</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          {s.logo ? <img src={s.logo} alt="Logo" style={{ maxHeight: 60, maxWidth: 200 }} /> : <span className="muted small">Aucun logo</span>}
          <label className="btn small">
            Choisir le logo
            <input type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const logo = await logoToPng(f);
              const c = s.brandColor ? null : await colorFromLogo(logo).catch(() => null);
              if (c) {
                setBrand(c, { logo });
                notify('Logo ajouté — l’app prend maintenant la couleur de ton logo');
              } else up({ logo });
            }} />
          </label>
          {s.logo && <button className="btn small danger" onClick={() => up({ logo: undefined })}>Retirer</button>}
        </div>
        <div className="form-grid">
          {txt('ownerName', 'Ton nom')}
          {txt('companyName', 'Nom affiché')}
          {txt('legalName', 'Nom légal (bas de facture)')}
          {txt('address', 'Adresse', { full: true })}
          {txt('city', 'Ville')}
          {txt('province', 'Province')}
          {txt('postalCode', 'Code postal')}
          {txt('phone', 'Téléphone', { type: 'tel' })}
          {txt('email', 'Courriel', { type: 'email' })}
          {txt('website', 'Site web', { placeholder: 'www.monentreprise.com' })}
          {s.website?.includes('@') && <div className="full small" style={{ color: 'var(--red)' }}>Le champ « Site web » contient un courriel: écris plutôt l’adresse de ton site (ex.: www.monentreprise.com). Il n’est pas imprimé tant que c’est un courriel.</div>}
          {txt('neq', 'NEQ')}
          {txt('tpsNumber', 'No TPS (laisse vide si pas inscrit)', { placeholder: '123456789 RT0001' })}
          {txt('tvqNumber', 'No TVQ (laisse vide si pas inscrit)', { placeholder: '1234567890 TQ0001' })}
          {txt('rbqNumber', 'Licence RBQ (si applicable)')}
        </div>
      </div>

      <BrandColorCard value={s.brandColor} logo={s.logo} company={s.companyName} onChange={(c) => setBrand(c)} />

      <div className="card" id="domicile">
        <h2>Domicile — point de départ du journal de bord</h2>
        <div className="form-grid">
          <label className="field full">Adresse du domicile
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <AddressInput value={s.homeAddress} onChange={(v) => up({ homeAddress: v, homeGeo: undefined })} onPick={(label, geo) => { up({ homeAddress: label, homeGeo: geo }); setHomeCheck(`${label}`); }} placeholder="ex.: 16, rue Fortin, Sherrington, QC" />
              <button className="btn" onClick={checkHome}>Vérifier</button>
            </div>
          </label>
        </div>
        {homeCheck && <div className="small" style={{ marginTop: 6 }}>{homeCheck}</div>}
        <div className="form-grid" style={{ marginTop: 12 }}>
          {txt('vehicle', 'Véhicule (marque, modèle, année)')}
          {txt('kmRateFirst5000', 'Taux $/km (5 000 premiers)', { type: 'number' })}
          {txt('kmRateAfter5000', 'Taux $/km (après 5 000)', { type: 'number' })}
          {txt('kmCost', 'Coût réel d’un km (rentabilité)', { type: 'number' })}
          {txt('laborCostPerHour', 'Coût d’une heure de main-d’œuvre (0 = toi)', { type: 'number' })}
        </div>
        <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={s.autoTripFromInvoices} onChange={(e) => up({ autoTripFromInvoices: e.target.checked })} /> Ajouter automatiquement le trajet au journal de bord pour chaque facture</label>
        <label className="check"><input type="checkbox" checked={s.autoTripRoundTrip} onChange={(e) => up({ autoTripRoundTrip: e.target.checked })} /> Compter l’aller-retour</label>
      </div>

      <div className="card">
        <h2>Taxes, numérotation et textes</h2>
        <label className="check" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={s.chargeTaxes} onChange={(e) => up({ chargeTaxes: e.target.checked })} /> Je charge la TPS/TVQ
        </label>
        <div className="small muted" style={{ marginBottom: 12 }}>« Oui » seulement si inscrit. Obligatoire dès 30 000 $ de revenus sur 4 trimestres. S’applique aux nouvelles factures.</div>
        <div className="form-grid">
          {txt('tpsRate', 'TPS %', { type: 'number' })}
          {txt('tvqRate', 'TVQ %', { type: 'number' })}
          {txt('invoicePrefix', 'Préfixe factures')}
          {txt('nextInvoiceNumber', 'Prochain no de facture', { type: 'number' })}
          {txt('quotePrefix', 'Préfixe soumissions')}
          {txt('nextQuoteNumber', 'Prochain no de soumission', { type: 'number' })}
          {txt('paymentTermsDays', 'Délai de paiement (jours, 0 = sur réception)', { type: 'number' })}
          {txt('quoteValidityDays', 'Validité soumission (jours)', { type: 'number' })}
          <label className="field full">Notes par défaut — factures<textarea value={s.invoiceNotes} onChange={(e) => up({ invoiceNotes: e.target.value })} /></label>
          <label className="field full">Notes par défaut — soumissions<textarea value={s.quoteNotes} onChange={(e) => up({ quoteNotes: e.target.value })} /></label>
          <label className="field full">Modes de paiement<textarea value={s.paymentInstructions} onChange={(e) => up({ paymentInstructions: e.target.value })} /></label>
          <label className="field full">Conditions (bas de facture)<textarea value={s.invoiceConditions} onChange={(e) => up({ invoiceConditions: e.target.value })} /></label>
          <label className="field full">Signature des courriels<textarea value={s.emailSignature} onChange={(e) => up({ emailSignature: e.target.value })} /></label>
        </div>
      </div>

      <div className="card" id="anglais">
        <h2>Textes en anglais (clients anglophones)</h2>
        <p className="small muted">Pour un client marqué « English », les factures, soumissions, le lien client et les courriels sont en anglais. Laisse vide pour utiliser le texte anglais par défaut.</p>
        <div className="form-grid">
          {txt('invoiceNotesEn', 'Notes — invoices', { full: true, placeholder: 'Thank you for your business!' })}
          {txt('quoteNotesEn', 'Notes — quotes', { full: true, placeholder: 'This quote is valid 30 days.' })}
          {txt('paymentInstructionsEn', 'Payment methods', { full: true, placeholder: 'Interac e-Transfer, cash or cheque.' })}
          {txt('invoiceConditionsEn', 'Conditions (bottom of invoice)', { full: true, placeholder: 'Payment due by the date shown.' })}
        </div>
      </div>

      <div className="card">
        <h2>Avis clients</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Après une job payée, envoie « Demander un avis »: 4-5 étoiles → le client est invité sur ta fiche Google; 1-3 étoiles → le commentaire reste privé, pour toi.</p>
        <div className="form-grid">
          {txt('googleReviewUrl', 'Lien de ta fiche Google (« Demander des avis »)', { full: true, placeholder: 'https://g.page/r/…/review' })}
        </div>
      </div>

      <AiSection s={s} up={up} />
      <MapsSection s={s} up={up} />

      <SyncSection />
      <UpdateCard />

      <div className="card">
        <h2>Paiement par carte de crédit (Stripe)</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Tes clients paient leur facture par carte (ou Apple Pay / Google Pay) directement dans le lien client. Le paiement s’ajoute tout seul à la facture. Frais Stripe: environ 2,9 % + 0,30 $ par paiement (au Québec, la loi interdit de les refacturer au client).</p>
        <label className="check"><input type="checkbox" checked={s.cardPayments} onChange={(e) => up({ cardPayments: e.target.checked, paymentsEndpoint: s.paymentsEndpoint || defaultEndpoint() })} /> Offrir le paiement par carte dans le lien client</label>
        {s.cardPayments && (
          <div className="form-grid" style={{ marginTop: 10 }}>
            {txt('paymentsEndpoint', 'Adresse du service de paiement', { full: true, placeholder: 'https://northamerica-northeast1-<projet>.cloudfunctions.net' })}
          </div>
        )}
        <details style={{ marginTop: 12 }}>
          <summary><strong>Comment l’activer (une seule fois)</strong></summary>
          <ol className="small" style={{ lineHeight: 1.6 }}>
            <li>Crée un compte sur <a href="https://dashboard.stripe.com/register" target="_blank" rel="noreferrer">stripe.com</a> (Canada, ton compte bancaire d’entreprise).</li>
            <li>Dans Firebase, passe au forfait <strong>Blaze</strong> (paiement à l’usage; à ton volume, ça reste à 0 $ ou presque).</li>
            <li>Suis la section « Paiement par carte » du fichier README du projet: elle installe le service de paiement et les règles de sécurité en un clic avec GitHub.</li>
            <li>Dans Stripe → Développeurs → Webhooks, ajoute l’adresse <code>…/stripeWebhook</code> (événement <code>checkout.session.completed</code>).</li>
            <li>Coche la case ci-dessus et enregistre.</li>
          </ol>
        </details>
      </div>

      <div className="card">
        <h2>Gmail</h2>
        <div className="form-grid">
          {txt('googleClientId', 'ID client OAuth Google', { full: true, placeholder: 'xxxxxxxx.apps.googleusercontent.com' })}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!s.googleClientId} onClick={async () => {
            try { await saveSettings({ googleClientId: s.googleClientId }); await connectGmail(s.googleClientId); notify('Gmail connecté'); } catch (e) { notify(errMsg(e), 'err'); }
          }}>Tester la connexion</button>
          <span className="small muted">{isGmailConnected() ? 'Connecté' : 'Non connecté'}</span>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary><strong>Comment obtenir l’ID client (une seule fois, ~10 min)</strong></summary>
          <ol className="small" style={{ lineHeight: 1.6 }}>
            <li>Va sur <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">console.cloud.google.com</a> avec ton compte Gmail et crée un projet « Murco ».</li>
            <li>Menu <em>API et services → Bibliothèque</em>: active <strong>Gmail API</strong>.</li>
            <li><em>API et services → Écran de consentement OAuth</em>: type « Externe », nom « Murco », ton courriel. Dans « Utilisateurs test », ajoute ton adresse Gmail.</li>
            <li><em>Identifiants → Créer des identifiants → ID client OAuth</em> → type <strong>Application Web</strong>.</li>
            <li>Dans « Origines JavaScript autorisées », ajoute: <code>{origin}</code></li>
            <li>Copie l’« ID client » (finit par <code>.apps.googleusercontent.com</code>) et colle-le ci-dessus.</li>
          </ol>
        </details>
      </div>

      <div className="card">
        <h2>Comptable</h2>
        <div className="form-grid">
          {txt('accountantName', 'Nom du comptable')}
          {txt('accountantEmail', 'Courriel du comptable', { type: 'email' })}
        </div>
      </div>

      <PrivacyCard onRestored={async () => setS(await getSettings())} />

      <div className="card">
        <h2>Installer sur ton téléphone</h2>
        <ul className="small" style={{ lineHeight: 1.6 }}>
          <li><strong>iPhone</strong>: ouvre le lien dans Safari → bouton Partager → « Sur l’écran d’accueil ».</li>
          <li><strong>Android</strong>: ouvre dans Chrome → menu ⋮ → « Installer l’application ».</li>
        </ul>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn accent" onClick={save}>Enregistrer</button></div>
    </>
  );
}

function AiSection({ s, up }: { s: Settings; up: (p: Partial<Settings>) => void }) {
  const st = useSyncState();
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const on = s.aiAssistant !== false;
  const test = async () => {
    setBusy(true);
    setResult('Test…');
    try {
      const { AiAssistant } = await import('../lib/ai');
      const a = new AiAssistant({ company: s.companyName, services: [], clients: () => [], today: new Date().toISOString().slice(0, 10), model: s.aiModel || undefined });
      const r = await Promise.race([
        a.send('Test de connexion: réponds seulement « Prête! »'),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout: aucune réponse de Google après 30 s')), 30000)),
      ]);
      setResult(`Ça marche (${a.modelName}) — « ${r.text} »`);
    } catch (e) {
      const { aiErrorMessage } = await import('../lib/ai');
      const raw = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code ?? '';
      setResult(`${aiErrorMessage(e).replace(' J’utilise l’assistant de base.', '')} — DÉTAIL: ${code} ${raw}`.slice(0, 600));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" id="ia">
      <h2>Assistant IA</h2>
      <p className="small muted">Tu parles normalement (« facture pour Denise, 60 pieds de gouttières »): l’assistant trouve le client, te demande ce qui manque et prépare tout. Tu confirmes toujours avant que ce soit créé. Il utilise Gemini (Google) à travers ton Firebase: pas de clé à gérer, et c’est gratuit ou presque pour ton volume.</p>
      {!st.configured ? (
        <div className="notice">Connecte d’abord la synchronisation Firebase (plus bas). Sans ça, l’assistant de base (sans IA) est utilisé.</div>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={on} onChange={(e) => up({ aiAssistant: e.target.checked })} /> Utiliser l’assistant IA (sinon l’assistant de base, sans Internet)</label>
          <label className="field" style={{ marginTop: 10 }}>Nom de ta secrétaire IA
            <input value={s.aiName ?? ''} placeholder="Ex.: Léa" onChange={(e) => up({ aiName: e.target.value })} />
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy || !on} onClick={test}>Tester</button>
            <span className="small">{result}</span>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary><strong>L’activer dans Firebase (une seule fois, ~2 min)</strong></summary>
            <ol className="small" style={{ lineHeight: 1.6 }}>
              <li>Va sur <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">console.firebase.google.com</a> et ouvre ton projet.</li>
              <li>Dans le menu de gauche: <em>Créer (Build) → AI Logic</em> → « Commencer ».</li>
              <li>Choisis <strong>Gemini Developer API</strong> (celle avec le volume gratuit) et confirme. Firebase active tout seul ce qu’il faut.</li>
              <li>Reviens ici et clique « Tester ». C’est tout: ça marche sur ton téléphone aussi.</li>
            </ol>
            <label className="field" style={{ marginTop: 8 }}>Modèle (avancé — laisse vide)
              <input value={s.aiModel ?? ''} placeholder="automatique (Gemini Flash)" onChange={(e) => up({ aiModel: e.target.value.trim() })} />
            </label>
          </details>
        </>
      )}
    </div>
  );
}

function MapsSection({ s, up }: { s: Settings; up: (p: Partial<Settings>) => void }) {
  const notify = useToast();
  const [result, setResult] = useState('');
  const test = async () => {
    if (!s.googleMapsKey.trim()) return notify('Colle ta clé Google Maps.', 'err');
    await saveSettings({ googleMapsKey: s.googleMapsKey.trim() });
    setResult('Test…');
    try {
      const a = await geocode(s.homeAddress || 'Sherrington, QC');
      const b = await geocode('Saint-Jean-sur-Richelieu, QC');
      if (!a || !b) throw new Error('Adresse introuvable');
      const r = await drivingDistance(a.geo, b.geo);
      setResult(r.method === 'google'
        ? `Google Maps fonctionne: domicile → Saint-Jean-sur-Richelieu = ${r.km} km${r.durationMin ? ` (${r.durationMin} min)` : ''}`
        : `Google n’a pas répondu (${mapsLastError || 'API non activée'}). Distance de secours: ${r.km} km.`);
    } catch (e) {
      setResult(`${errMsg(e)} ${mapsLastError}`);
    }
  };
  return (
    <div className="card" id="maps">
      <h2>Google Maps (km et adresses)</h2>
      <p className="small muted">Avec ta clé Google Maps, les km du journal de bord sont calculés par Google Maps (même distance que dans l’app Google Maps), les adresses se complètent pendant que tu tapes et la carte du trajet s’affiche sur chaque facture.</p>
      <div className="form-grid">
        <label className="field full">Clé API Google Maps
          <input value={s.googleMapsKey} placeholder="AIza…" onChange={(e) => up({ googleMapsKey: e.target.value })} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={test}>Tester</button>
        <span className="small">{result}</span>
      </div>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <label className="field full">Clé Postes Canada AddressComplete (facultatif)
          <input value={s.canadaPostKey ?? ''} placeholder="AA11-AA11-AA11-AA11" onChange={(e) => up({ canadaPostKey: e.target.value })} />
        </label>
      </div>
      <p className="small muted">Avec une clé Postes Canada, les adresses proposées pendant la saisie sont les adresses officielles (code postal exact), comme sur le site de Postes Canada. Clé sur <a href="https://www.canadapost-postescanada.ca/ac/" target="_blank" rel="noreferrer">canadapost-postescanada.ca/ac</a>. Sans clé: Google Maps, sinon OpenStreetMap (gratuit).</p>
      <details style={{ marginTop: 12 }}>
        <summary><strong>Comment obtenir la clé (~5 min, gratuit pour ton volume)</strong></summary>
        <ol className="small" style={{ lineHeight: 1.6 }}>
          <li>Va sur <a href="https://console.cloud.google.com/google/maps-apis/start" target="_blank" rel="noreferrer">console.cloud.google.com → Google Maps Platform</a> (même projet que Gmail/Firebase si tu veux).</li>
          <li>Active ces API: <strong>Maps JavaScript API</strong>, <strong>Geocoding API</strong>, <strong>Routes API</strong>, <strong>Places API (New)</strong>, <strong>Maps Embed API</strong>.</li>
          <li><em>Clés et identifiants → Créer une clé API</em>. Restreins-la à « Sites Web » avec l’adresse de ton app: <code>{location.origin}/*</code></li>
          <li>Colle la clé ici, clique « Tester », puis « Enregistrer ». Elle se synchronise sur ton téléphone.</li>
        </ol>
        <p className="small muted">Google offre un crédit mensuel gratuit largement suffisant pour quelques centaines de factures par mois. Sans clé, l’app utilise OpenStreetMap (gratuit).</p>
      </details>
    </div>
  );
}

function SyncSection() {
  const notify = useToast();
  const ask = useConfirm();
  const st = useSyncState();
  const [params, setParams] = useSearchParams();
  const [cfgText, setCfgText] = useState(() => {
    const c = getFirebaseConfig();
    return c ? JSON.stringify(c, null, 1) : '';
  });
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  // Lien « connecter un autre appareil »
  useEffect(() => {
    const p = params.get('sync');
    if (!p) return;
    const cfg = configFromLink(p);
    setParams({}, { replace: true });
    if (cfg) {
      saveFirebaseConfig(cfg);
      notify('Configuration reçue — connecte-toi avec ton compte.');
      setTimeout(() => location.reload(), 800);
    }
  }, [params, setParams, notify]);

  const saveCfg = () => {
    const cfg = parseFirebaseConfig(cfgText);
    if (!cfg) return notify('Configuration invalide: colle un lien client déjà envoyé, le lien « Connecter un appareil » ou le bloc « firebaseConfig » de Firebase.', 'err');
    saveFirebaseConfig(cfg);
    notify('Configuration enregistrée — redémarrage…');
    setTimeout(() => location.reload(), 600);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const link = deviceLink();

  return (
    <div className="card" id="sync">
      <h2>Synchronisation (téléphone ↔ ordi)</h2>
      {!st.configured ? (
        <>
          <p className="small muted">Synchronise automatiquement factures, clients, km, reçus (avec photos) et paramètres entre tous tes appareils, en temps réel. Ça marche aussi sans Internet: tout se met à jour au retour du réseau.</p>
          <label className="field">Configuration Firebase (copiée de la console) — ou colle le lien « Connecter ton téléphone » d’un autre appareil
            <textarea rows={6} value={cfgText} placeholder={'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…"\n};'} onChange={(e) => setCfgText(e.target.value)} />
          </label>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={saveCfg}>Enregistrer la configuration</button>
          <details style={{ marginTop: 12 }}>
            <summary><strong>Comment créer ton espace Firebase (gratuit, ~10 min, une seule fois)</strong></summary>
            <ol className="small" style={{ lineHeight: 1.6 }}>
              <li>Va sur <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">console.firebase.google.com</a> → « Créer un projet » (nom: murco). Google Analytics: pas nécessaire.</li>
              <li><em>Créer → Authentication → Commencer</em>: active <strong>Adresse e-mail/Mot de passe</strong> (et Google si tu veux).</li>
              <li><em>Authentication → Paramètres → Domaines autorisés</em>: ajoute <code>{location.hostname}</code>.</li>
              <li><em>Créer → Firestore Database → Créer une base</em>, région <strong>northamerica-northeast1 (Montréal)</strong>, mode production.</li>
              <li>Onglet <em>Règles</em> de Firestore: remplace tout par le contenu du fichier <code>firestore.rules</code> du projet, puis « Publier ».</li>
              <li><em>Paramètres du projet → Vos applications → &lt;/&gt; Web</em> → nom « Murco » → copie le bloc <code>firebaseConfig</code> et colle-le ci-dessus.</li>
            </ol>
          </details>
        </>
      ) : st.status === 'signedout' || (st.status === 'error' && !st.email) ? (
        <>
          <p className="small muted">Connecte-toi avec le même compte sur ton ordi et ton téléphone. La première fois, clique « Créer mon compte ».</p>
          {st.error && <div className="notice err">{st.error}</div>}
          <div className="form-grid">
            <label className="field">Courriel<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">Mot de passe<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn accent" disabled={busy} onClick={() => run(() => signInEmail(email, pw))}>Se connecter</button>
            <button className="btn" disabled={busy} onClick={() => run(() => signInEmail(email, pw, true))}>Créer mon compte</button>
            {!isNative() && <button className="btn" disabled={busy} onClick={() => run(signInGoogle)}>Avec Google</button>}
            <button className="btn small" disabled={busy || !email} onClick={() => run(async () => { await resetPassword(email); notify('Courriel de réinitialisation envoyé.'); })}>Mot de passe oublié</button>
          </div>
        </>
      ) : (
        <>
          <div className={`notice ${st.status === 'error' ? 'err' : 'ok'}`}>
            {st.status === 'ok' && <>Synchronisé — compte <strong>{st.email}</strong>{st.lastSync && <> · dernière mise à jour {new Date(st.lastSync).toLocaleTimeString('fr-CA')}</>}</>}
            {(st.status === 'syncing' || st.status === 'connecting') && <>Synchronisation en cours ({st.email})…</>}
            {st.status === 'error' && <>{st.error}</>}
          </div>
          {st.error && st.status !== 'error' && <div className="notice">{st.error}</div>}
          {link && (
            <>
              <h3>Connecter ton téléphone (ou un autre ordi)</h3>
              <p className="small muted">Envoie-toi ce lien (courriel ou texto), ouvre-le sur l’autre appareil, puis connecte-toi avec le même courriel et mot de passe.</p>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input readOnly value={link} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => notify('Lien copié'))}>Copier</button>
              </div>
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn small" onClick={() => run(signOutSync)}>Se déconnecter</button>
            <button className="btn small danger" onClick={async () => { if (await ask({ title: 'Retirer la synchronisation de cet appareil?', message: 'Tes données restent ici et dans le nuage.', confirm: 'Retirer', danger: true })) { saveFirebaseConfig(null); location.reload(); } }}>Retirer la configuration</button>
          </div>
        </>
      )}
    </div>
  );
}

function defaultEndpoint(): string {
  const cfg = getFirebaseConfig();
  return cfg?.projectId ? `https://northamerica-northeast1-${cfg.projectId}.cloudfunctions.net` : '';
}

/** Loi 25: exporter, restaurer, supprimer le compte; liens vers la politique et les conditions. */
function PrivacyCard({ onRestored }: { onRestored: () => void }) {
  const notify = useToast();
  const ask = useConfirm();
  const nav = useNavigate();
  const st = useSyncState();
  const s = useSettings();
  const b = useBilling();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const owner = st.role === 'owner';
  const signedIn = st.status === 'ok' || st.status === 'syncing' || st.status === 'error';

  const del = async () => {
    if (b.kind === 'active' && !b.cancelAtPeriodEnd) return notify('Annule d’abord ton abonnement (Abonnement → Gérer mon abonnement), puis supprime ton compte.', 'err');
    const ok = await ask({
      title: owner ? 'Supprimer ton compte et toutes tes données?' : 'Quitter l’entreprise et supprimer ton accès?',
      message: owner
        ? `Clients, factures, soumissions, reçus, photos, journal de bord, équipe: tout sera effacé définitivement, sur tous tes appareils. Les lois fiscales t’obligent à garder tes registres 6 ans: exporte tes données avant. Cette action est irréversible.`
        : 'Ton accès à l’entreprise et ton compte seront supprimés. Tes heures pointées restent dans les registres de l’entreprise.',
      confirm: 'Supprimer définitivement',
      danger: true,
    });
    if (!ok) return;
    setBusy('del');
    try {
      await deleteMyAccount();
      notify('Compte et données supprimés.');
      nav('/produit', { replace: true });
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card" id="donnees">
      <h2>Mes données et confidentialité</h2>
      <p className="small muted">Tes données t’appartiennent. Exporte-les en tout temps (fichier structuré et photos) ou supprime ton compte. <Link to="/confidentialite">Politique de confidentialité</Link> · <Link to="/conditions">Conditions d’utilisation</Link>{s.termsAcceptedAt ? ` · acceptées le ${new Date(s.termsAcceptedAt).toLocaleDateString('fr-CA')}` : ''}</p>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={async () => { setBusy('exp'); try { downloadBlob(await buildBackup(), `${(s.companyName || 'donnees').replace(/[^\w-]+/g, '_')}_export_${todayISO()}.zip`); } finally { setBusy(''); } }}><Download size={16} /> Exporter toutes mes données</button>
        {owner && <button className="btn" onClick={() => restoreRef.current?.click()}><Upload size={16} /> Restaurer une sauvegarde</button>}
        <input ref={restoreRef} type="file" accept=".zip" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f || !(await ask({ title: 'Restaurer cette sauvegarde?', message: 'Toutes les données actuelles de cet appareil seront remplacées.', confirm: 'Restaurer', danger: true }))) return;
          try { await restoreBackup(f); notify('Sauvegarde restaurée'); onRestored(); } catch (err) { notify(errMsg(err), 'err'); }
        }} />
      </div>
      {signedIn && (
        <div className="danger-zone">
          <div>
            <strong>{owner ? 'Supprimer mon compte' : 'Quitter l’entreprise'}</strong>
            <div className="small muted">{owner ? 'Efface ton compte et toutes les données de ton entreprise.' : 'Supprime ton accès et ton compte.'}</div>
          </div>
          <button className="btn danger" disabled={!!busy} onClick={() => void del()}><Trash2 size={16} /> {busy === 'del' ? 'Suppression…' : owner ? 'Supprimer mon compte' : 'Quitter'}</button>
        </div>
      )}
    </div>
  );
}
