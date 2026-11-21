import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { useAuthStore } from './store/useAuthStore';
import './store/useProgressStore';
import './styles/vice-nui.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      networkMode: 'offlineFirst',
      retry: 1,
    },
  },
});

void useAuthStore.getState().init();

// PWA ligera: el Service Worker solo se registra en produccion.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// Recuperacion ante un despliegue nuevo: si el navegador pide un chunk/CSS con un hash que ya no existe,
// se recarga UNA sola vez (marca en sessionStorage, solo un indicador: nunca datos de sesion) para tomar el index.html nuevo.
// La marca se retira tras 10 s de funcionamiento estable, de modo que un despliegue posterior pueda recuperarse otra vez.
const RELOAD_KEY = 'leonidapp_chunk_reload';
function reloadOnceForStaleAssets(): void {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return; // sin sessionStorage no se arriesga un bucle de recargas
  }
  window.location.reload();
}
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadOnceForStaleAssets();
});
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason instanceof Error ? event.reason.message : String(event.reason ?? '');
  if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)) {
    event.preventDefault();
    reloadOnceForStaleAssets();
  }
});
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* sin almacenamiento: nada que limpiar */
  }
}, 10_000);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No se encontró el elemento #root');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
