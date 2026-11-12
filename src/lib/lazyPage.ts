import { lazy, type ComponentType } from 'react';

/**
 * Page chargée à la demande. Si le fichier n'existe plus (une nouvelle version a été publiée pendant que l'app était ouverte),
 * on recharge l'app une fois au lieu d'afficher une page blanche.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e) => {
      try {
        if (!sessionStorage.getItem('murco.reloaded')) {
          sessionStorage.setItem('murco.reloaded', '1');
          location.reload();
          return new Promise<{ default: T }>(() => undefined);
        }
      } catch { /* stockage indisponible */ }
      throw e;
    }),
  );
}

/** Précharge des pages quand le navigateur n'a rien d'autre à faire. */
export function preloadPages(loads: (() => Promise<unknown>)[]) {
  if (typeof window === 'undefined') return;
  const run = () => loads.forEach((l) => void l().catch(() => undefined));
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
