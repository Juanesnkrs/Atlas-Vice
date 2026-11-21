// Estado honesto de error de datos: mensaje claro en español neutro + botón «Reintentar».
// Se muestra cuando la API falla, responde 429 o no está configurada; nunca se sustituye por datos inventados.
import { PalmButton } from './PalmButton';

interface ApiErrorStateProps {
  /** Mensaje ya redactado para la persona usuaria (ver `describeApiError`). */
  message: string;
  onRetry?: () => void;
  title?: string;
  /** Bloque compacto (dentro de una tarjeta) en lugar de ocupar el alto de la vista. */
  compact?: boolean;
  retrying?: boolean;
}

export function ApiErrorState({
  message,
  onRetry,
  title = 'No pudimos cargar los datos',
  compact = false,
  retrying = false,
}: ApiErrorStateProps) {
  return (
    <div className={compact ? 'p-2' : 'flex min-h-[50dvh] items-center justify-center p-6'}>
      <section
        role="alert"
        className={`glass mx-auto max-w-md rounded-2xl text-center ${compact ? 'p-5' : 'p-8'}`}
        aria-labelledby="api-error-title"
      >
        <h2 id="api-error-title" className="font-display text-xl font-bold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-vice-text/85">{message}</p>
        {onRetry && (
          <div className="mt-5 flex justify-center">
            <PalmButton type="button" onClick={onRetry} loading={retrying}>
              Reintentar
            </PalmButton>
          </div>
        )}
      </section>
    </div>
  );
}
