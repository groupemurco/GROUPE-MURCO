import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/figtree';
import './styles.css';
import './polish.css';
import './finish.css';
import { tap } from './lib/celebrate';
import { applyStoredAccent } from './lib/accent';
import { applyTheme } from './lib/theme';
import { isNative } from './lib/native';
import { onSyncState, startSync } from './lib/sync';
import { bootstrap } from './lib/templates';
import './lib/portal';
import './lib/team';
import './lib/crm';
import './lib/billing';

applyTheme();
applyStoredAccent();
bootstrap().catch(() => undefined);
startSync();
// Nouvel appareil d'un compte existant: les réglages arrivent du nuage, puis on complète la liste de prix si elle est vide
let booted = false;
onSyncState((st) => {
  if (st.status === 'ok' && !booted) {
    booted = true;
    bootstrap().catch(() => undefined);
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

// Mode hors-ligne / installation comme application mobile
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

// Retour tactile léger sur les actions principales
document.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement | null)?.closest('.btn.accent, .home-actions button, .tab-create, .lea-bubble')) tap();
}, { passive: true });
