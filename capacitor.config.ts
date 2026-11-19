import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.leonidapp.companion',
  appName: 'LeonidApp',
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
