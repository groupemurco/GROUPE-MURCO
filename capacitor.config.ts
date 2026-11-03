import type { CapacitorConfig } from '@capacitor/cli';

// App mobile (Android / iPhone): la même app web, emballée en app native.
const config: CapacitorConfig = {
  appId: 'com.groupemurco.gestion',
  appName: 'Murco',
  webDir: 'dist',
  // L'app charge toujours la dernière version du site: plus besoin de réinstaller l'APK à chaque changement.
  // allowNavigation: l'app suit le site s'il déménage sur un domaine à soi (ex.: app.groupemurco.com)
  server: { url: 'https://groupemurco.github.io/GROUPE-MURCO/', androidScheme: 'https', allowNavigation: ['*.groupemurco.com', 'groupemurco.com'] },
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic' },
};

export default config;
