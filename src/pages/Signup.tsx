import { ArrowLeft, ArrowRight, Check, Rocket } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PRODUCT } from '../brand';
import { AddressInput } from '../components/AddressInput';
import { errMsg, useToast } from '../components/Toast';
import { DEFAULT_SETTINGS, saveSettings, type GeoPoint } from '../lib/db';
import { geocode } from '../lib/geo';
import { tr, useLang } from '../lib/i18n';
import { getFirebaseConfig, signInEmail, signOutSync, useSyncState } from '../lib/sync';
import { applyTrade, TRADE_GROUPS, TRADES, tradeServices, tradeTypes } from '../lib/templates';
import { TRADE_ICON } from '../lib/tradeIcons';
import { DEFAULT_AGENDA } from '../lib/agendaPrefs';

/** Assistant de démarrage d'une nouvelle entreprise: infos, métier, taxes, compte. */
export default function Signup() {
  const lang = useLang();
  const t = (fr: string, en: string) => tr(lang, fr, en);
  const nav = useNavigate();
  const notify = useToast();
  const st = useSyncState();
  const [params] = useSearchParams();
  const signedIn = st.status === 'ok' || st.status === 'syncing';
  const canAccount = !!getFirebaseConfig() && !signedIn;
  const steps = canAccount ? 4 : 3;
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ companyName: '', ownerName: '', phone: '', email: st.email ?? '', address: '', city: '', postalCode: '' });
  const [geo, setGeo] = useState<GeoPoint | undefined>();
  const [trades, setTrades] = useState<string[]>([]);
  const toggleTrade = (k: string) => setTrades((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const [taxes, setTaxes] = useState<boolean | null>(null);
  const [tps, setTps] = useState('');
  const [tvq, setTvq] = useState('');
  const [pw, setPw] = useState('');
  const [consent, setConsent] = useState(false);
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const ok1 = f.companyName.trim().length > 1 && f.ownerName.trim().length > 1;
  const ok2 = trades.length > 0;
  const ok3 = taxes !== null;
  const ok4 = /\S+@\S+\.\S+/.test(f.email) && pw.length >= 6 && consent;

  const finish = async () => {
    setBusy(true);
    try {
      const home = f.address.trim() || f.city.trim() ? [f.address, f.city, 'QC', f.postalCode].filter((x) => x.trim()).join(', ') : '';
      const homeGeo = geo ?? (home ? (await geocode(home).catch(() => null))?.geo : undefined);
      await saveSettings({
        ...DEFAULT_SETTINGS,
        companyName: f.companyName.trim(),
        legalName: f.companyName.trim(),
        ownerName: f.ownerName.trim(),
        phone: f.phone.trim(),
        email: f.email.trim(),
        address: f.address.trim(),
        city: f.city.trim(),
        postalCode: f.postalCode.trim().toUpperCase(),
        homeAddress: home,
        homeGeo,
        trade: trades[0],
        trades,
        agenda: { ...DEFAULT_AGENDA, types: tradeTypes(trades) },
        chargeTaxes: !!taxes,
        tpsNumber: tps.trim(),
        tvqNumber: tvq.trim(),
        paymentInstructions: f.email.trim() ? `Virement Interac à ${f.email.trim()}, comptant ou chèque.` : DEFAULT_SETTINGS.paymentInstructions,
        emailSignature: `${f.ownerName.trim()}\n${f.companyName.trim()}${f.phone ? '\n' + f.phone.trim() : ''}`,
        setupComplete: true,
        wantedPlan: params.get('forfait') ?? undefined,
        termsAcceptedAt: consent ? new Date().toISOString() : undefined,
      });
      await applyTrade(trades);
      if (canAccount) await signInEmail(f.email, pw, true);
      notify(t(`Bienvenue dans ${PRODUCT.name}, ${f.ownerName.split(' ')[0]}!`, `Welcome to ${PRODUCT.name}, ${f.ownerName.split(' ')[0]}!`));
      nav('/', { replace: true });
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="su">
      <div className="su-top">
        <Link to="/produit" className="lp-brand"><span className="lp-logo">{PRODUCT.name.slice(0, 1)}</span>{PRODUCT.name}</Link>
        <span className="small muted">{t('Étape', 'Step')} {step} / {steps}</span>
      </div>
      <div className="su-bar"><span style={{ width: `${(step / steps) * 100}%` }} /></div>

      <div className="su-card" key={step}>
        {step === 1 && signedIn && st.email && (
          <div className="notice" style={{ marginBottom: 14 }}>
            {t(`Tu es connecté avec ${st.email}, mais ce compte ne contient pas encore d’entreprise. Si tu avais déjà tout rempli, tes données sont sûrement dans un autre compte (ton autre courriel, ou « Continuer avec Google »).`, `You are signed in as ${st.email}, but this account has no business yet. If you already filled everything in, your data is probably in another account.`)}
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn small" onClick={() => void signOutSync().then(() => nav('/connexion', { replace: true }))}>{t('Me déconnecter et essayer un autre compte', 'Sign out and try another account')}</button>
            </div>
          </div>
        )}
        {step === 1 && (
          <>
            <h1>{t('Parle-nous de ton entreprise', 'Tell us about your business')}</h1>
            <p className="muted">{t('Ces infos apparaissent sur tes soumissions et factures. Tu pourras tout changer plus tard.', 'This appears on your quotes and invoices. You can change everything later.')}</p>
            <div className="form-grid">
              <label className="field full">{t('Nom de l’entreprise', 'Business name')} *<input id="su-company" autoFocus value={f.companyName} onChange={(e) => up({ companyName: e.target.value })} placeholder={t('ex.: Entretien Laval', 'e.g. Laval Maintenance')} /></label>
              <label className="field full">{t('Ton nom', 'Your name')} *<input id="su-owner" value={f.ownerName} onChange={(e) => up({ ownerName: e.target.value })} /></label>
              <label className="field">{t('Téléphone', 'Phone')}<input id="su-phone" type="tel" value={f.phone} onChange={(e) => up({ phone: e.target.value })} /></label>
              <label className="field">{t('Courriel', 'Email')}<input id="su-email" type="email" value={f.email} onChange={(e) => up({ email: e.target.value })} /></label>
              <label className="field full">{t('Adresse (point de départ des km)', 'Address (starting point for mileage)')}
                <AddressInput value={f.address} placeholder={t('ex.: 123 rue Principale, Laval', 'e.g. 123 Main St, Laval')} onChange={(v) => { up({ address: v }); setGeo(undefined); }} onPick={(label, g) => { up({ address: label }); setGeo(g); }} />
              </label>
              <label className="field">{t('Ville', 'City')}<input value={f.city} onChange={(e) => up({ city: e.target.value })} /></label>
              <label className="field">{t('Code postal', 'Postal code')}<input value={f.postalCode} onChange={(e) => up({ postalCode: e.target.value })} /></label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>{t('C’est quoi ton métier?', 'What’s your trade?')}</h1>
            <p className="muted">{t('Choisis tout ce que tu fais. L’app s’ajuste: codes de prix, types de jobs dans l’agenda et outils de ton métier. Tout se change plus tard.', 'Pick everything you do. The app adapts: price codes, job types and trade tools. You can change it later.')}</p>
            {TRADE_GROUPS.map((g) => (
              <div key={g.key} className="su-group">
                <div className="su-group-title">{g.label}</div>
                <div className="su-trades">
                  {TRADES.filter((x) => x.group === g.key).map((x) => {
                    const Icon = TRADE_ICON[x.key];
                    const on = trades.includes(x.key);
                    return (
                      <button key={x.key} type="button" className={on ? 'on' : ''} onClick={() => toggleTrade(x.key)} aria-pressed={on}>
                        <span className="su-ic">{Icon ? <Icon size={20} /> : x.emoji}</span>
                        <strong>{x.label}</strong>
                        <small>{x.desc}</small>
                        {on && <Check size={18} className="su-check" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {trades.length > 0 && (
              <div className="su-preview">
                {tradeServices(trades).slice(0, 8).map((sv) => (
                  <span key={sv.code}><b>{sv.code}</b> {sv.name}{sv.price ? ` · ${sv.price.toLocaleString('fr-CA')} $/${sv.unit}` : ''}</span>
                ))}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h1>{t('Taxes', 'Sales taxes')}</h1>
            <p className="muted">{t('Es-tu inscrit à la TPS et à la TVQ? Obligatoire dès 30 000 $ de revenus sur 4 trimestres — l’app te prévient quand tu approches.', 'Are you registered for GST and QST? Required once you pass $30,000 over 4 quarters — the app warns you when you get close.')}</p>
            <div className="su-yn">
              <button type="button" className={taxes === true ? 'on' : ''} onClick={() => setTaxes(true)}>{t('Oui, je charge les taxes', 'Yes, I charge taxes')}</button>
              <button type="button" className={taxes === false ? 'on' : ''} onClick={() => setTaxes(false)}>{t('Non, pas encore', 'Not yet')}</button>
            </div>
            {taxes && (
              <div className="form-grid" style={{ marginTop: 14 }}>
                <label className="field">{t('No TPS', 'GST no.')}<input value={tps} onChange={(e) => setTps(e.target.value)} placeholder="123456789 RT0001" /></label>
                <label className="field">{t('No TVQ', 'QST no.')}<input value={tvq} onChange={(e) => setTvq(e.target.value)} placeholder="1234567890 TQ0001" /></label>
              </div>
            )}
          </>
        )}

        {step === 4 && canAccount && (
          <>
            <h1>{t('Crée ton accès', 'Create your login')}</h1>
            <p className="muted">{t(`Pour retrouver tes données sur ton ordi et ton cell. ${PRODUCT.trialDays} jours gratuits, sans carte de crédit.`, `To get your data on your computer and phone. ${PRODUCT.trialDays} days free, no credit card.`)}</p>
            <div className="form-grid">
              <label className="field full">{t('Courriel de connexion', 'Login email')}<input id="su-login" type="email" autoComplete="username" value={f.email} onChange={(e) => up({ email: e.target.value })} /></label>
              <label className="field full">{t('Mot de passe (6 caractères minimum)', 'Password (6+ characters)')}<input id="su-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            </div>
            <label className="check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t('J’accepte les ', 'I accept the ')}<Link to="/conditions" target="_blank">{t('conditions d’utilisation', 'terms of use')}</Link>{t(' et la ', ' and the ')}<Link to="/confidentialite" target="_blank">{t('politique de confidentialité', 'privacy policy')}</Link>.</span>
            </label>
          </>
        )}

        <div className="su-nav">
          {step > 1 ? <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft size={16} /> {t('Retour', 'Back')}</button> : <Link className="btn" to="/produit"><ArrowLeft size={16} /> {t('Retour', 'Back')}</Link>}
          <span className="spacer" />
          {step < steps ? (
            <button className="btn accent big" disabled={(step === 1 && !ok1) || (step === 2 && !ok2) || (step === 3 && !ok3)} onClick={() => setStep(step + 1)}>{t('Continuer', 'Continue')} <ArrowRight size={18} /></button>
          ) : (
            <button className="btn accent big" disabled={busy || !ok3 || (canAccount && !ok4)} onClick={() => void finish()}><Rocket size={18} /> {busy ? '…' : t('Commencer', 'Get started')}</button>
          )}
        </div>
      </div>
      {!signedIn && <p className="su-foot small muted">{t('Déjà un compte?', 'Already have an account?')} <Link to="/connexion">{t('Se connecter', 'Log in')}</Link></p>}
    </div>
  );
}
