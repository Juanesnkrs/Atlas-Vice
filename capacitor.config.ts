import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.atlasvice.app',
  appName: 'ATLAS VICE',
  webDir: 'dist',
  backgroundColor: '#160B14',
  android: {
    backgroundColor: '#160B14',
  },
  ios: {
    backgroundColor: '#160B14',
    contentInset: 'never',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
