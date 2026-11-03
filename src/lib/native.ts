import { Capacitor } from '@capacitor/core';

// Pont entre l'app web et l'app installée (Android / iPhone).
// Dans le navigateur, on utilise les fonctions du web; dans l'app native, les modules Capacitor.

export const isNative = () => Capacitor.isNativePlatform();

/** Adresse publique de l'app web (pour les liens envoyés aux clients et aux autres appareils). */
export const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || 'https://groupemurco.github.io/GROUPE-MURCO/';

export function publicBase(): string {
  // App installée qui charge le site en ligne: les liens suivent l'adresse réelle (ex.: un domaine à soi)
  if (isNative()) return /^https:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? `${location.origin}${location.pathname.replace(/[^/]*$/, '')}` : PUBLIC_URL.replace(/\/?$/, '/');
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`; // dossier de l'app (index.html ou pointage.html)
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function writeCache(blob: Blob, name: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const safe = name.replace(/[^\w.\-àâäéèêëîïôöùûüç ]/gi, '_');
  const r = await Filesystem.writeFile({ path: safe, data: await blobToBase64(blob), directory: Directory.Cache });
  return r.uri;
}

/** Partage un ou plusieurs fichiers (texto, Gmail, Messenger, Drive…). Retourne false si impossible. */
export async function shareFiles(files: { blob: Blob; name: string }[], title: string, text?: string): Promise<boolean> {
  if (isNative()) {
    const { Share } = await import('@capacitor/share');
    const urls = await Promise.all(files.map((f) => writeCache(f.blob, f.name)));
    await Share.share({ title, text, files: urls, dialogTitle: title }).catch(() => undefined);
    return true;
  }
  const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
  if (navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list, title, text });
    } catch {
      /* partage annulé */
    }
    return true;
  }
  return false;
}

/** Partage un lien (texte + adresse). */
export async function shareLink(title: string, text: string, url: string): Promise<boolean> {
  // Sans adresse à part: le lien est déjà dans le texte (certaines apps ne gardent que l'adresse sinon)
  const extra = url ? { url } : {};
  if (isNative()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, text, ...extra, dialogTitle: title }).catch(() => undefined);
    return true;
  }
  if (navigator.share) {
    await navigator.share({ title, text, ...extra }).catch(() => undefined);
    return true;
  }
  return false;
}

/** Enregistre un fichier: téléchargement dans le navigateur, feuille de partage / Fichiers dans l'app. */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (isNative()) {
    await shareFiles([{ blob, name }], name);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
