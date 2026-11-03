import { ArrowRight, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PRODUCT } from '../brand';
import { errMsg, useToast } from '../components/Toast';
import { tr, useLang } from '../lib/i18n';
import { getFirebaseConfig, parseFirebaseConfig, resetPassword, saveFirebaseConfig, signInEmail, signInGoogle } from '../lib/sync';
import { isPunchApp } from '../lib/team';

/** Connexion à un compte existant (nouvel appareil, employé, etc.). */
export default function Login() {
  const lang = useLang();
  const t = (fr: string, en: string) => tr(lang, fr, en);
  const nav = useNavigate();
  const notify = useToast();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const configured = !!getFirebaseConfig();
  const [linkText, setLinkText] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
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
      </div>
      <div className="su-card" style={{ maxWidth: 440 }}>
        <h1>{isPunchApp() ? t('Pointage', 'Time clock') : t('Bon retour!', 'Welcome back!')}</h1>
        {!configured ? (
          <div className="grid" style={{ gap: 10 }}>
            <div className="notice">{t('Cette adresse ne sait pas encore où sont tes données. Colle un lien client que tu as déjà envoyé (dans tes textos ou courriels), ou le lien « Connecter un appareil »: tes données reviennent après la connexion.', 'This address does not know where your data is yet. Paste a client link you already sent (from your texts or emails), or the “Connect a device” link: your data comes back after you sign in.')}</div>
            <textarea rows={3} value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="https://…/#/p/…?c=…" aria-label={t('Lien client', 'Client link')} />
            <button type="button" className="btn accent big" onClick={() => {
              const cfg = parseFirebaseConfig(linkText);
              if (!cfg) return notify(t('Ce lien ne contient pas l’information. Prends un lien client envoyé à un client (il finit par « c=… »).', 'This link does not contain it. Use a link sent to a client (it ends with “c=…”).'), 'err');
              saveFirebaseConfig(cfg);
              notify(t('C’est bon! Connecte-toi maintenant avec ton compte.', 'All set! Now sign in with your account.'));
              setTimeout(() => location.reload(), 700);
            }}>{t('Retrouver mes données', 'Find my data')}</button>
          </div>
        ) : (
          <form className="grid" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void run(() => signInEmail(email, pw)); }}>
            <label className="field">{t('Courriel', 'Email')}<input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">{t('Mot de passe', 'Password')}<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <button className="btn accent big" disabled={busy || !email || !pw}><LogIn size={18} /> {t('Se connecter', 'Log in')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(signInGoogle)}>{t('Continuer avec Google', 'Continue with Google')}</button>
            <button type="button" className="btn small" style={{ justifySelf: 'start' }} disabled={busy} onClick={async () => {
              if (!email) return notify(t('Écris ton courriel d’abord.', 'Enter your email first.'), 'err');
              try { await resetPassword(email); notify(t('Courriel de réinitialisation envoyé.', 'Reset email sent.')); } catch (e) { notify(errMsg(e), 'err'); }
            }}>{t('Mot de passe oublié', 'Forgot password')}</button>
          </form>
        )}
      </div>
      {isPunchApp() ? (
        <p className="su-foot small muted">{t('Première fois? Ouvre le lien d’invitation que ton patron t’a envoyé par texto.', 'First time? Open the invitation link your boss texted you.')}</p>
      ) : (
        <p className="su-foot small muted">{t('Pas encore de compte?', 'No account yet?')} <Link to="/demarrer">{t(`Essai gratuit ${PRODUCT.trialDays} jours`, `${PRODUCT.trialDays}-day free trial`)} <ArrowRight size={13} /></Link></p>
      )}
    </div>
  );
}
