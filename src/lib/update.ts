import { useEffect, useState } from 'react';
import { isNative, PUBLIC_URL } from './native';

// L'app installée (APK) contient son propre code: elle ne se met pas à jour toute seule.
// Au démarrage, elle regarde la version du site; si une version plus récente existe, on propose le téléchargement.
export const APK_URL = 'https://github.com/groupemurco/GROUPE-MURCO/releases/download/android-latest/Murco.apk';
const SKIP_KEY = 'murco.skipVersion';

export function useAppUpdate(): { available: boolean; dismiss: () => void } {
  const [remote, setRemote] = useState<string | null>(null);
  useEffect(() => {
    if (!isNative() || __APP_VERSION__.time === 0) return;
    const check = () =>
      fetch(`${PUBLIC_URL.replace(/\/?$/, '/')}version.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((v: { sha: string; time: number } | null) => {
          if (v && v.sha !== __APP_VERSION__.sha && v.time > __APP_VERSION__.time && localStorage.getItem(SKIP_KEY) !== v.sha) setRemote(v.sha);
        })
        .catch(() => undefined);
    void check();
    const t = setInterval(check, 6 * 3600_000);
    return () => clearInterval(t);
  }, []);
  return {
    available: !!remote,
    dismiss: () => {
      if (remote) localStorage.setItem(SKIP_KEY, remote);
      setRemote(null);
    },
  };
}
