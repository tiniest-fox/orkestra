// Type declarations for vite-plugin-pwa virtual modules.

declare module "virtual:pwa-register" {
  export type RegisterSWOptions = {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegistrationError?: (error: unknown) => void;
  };

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => void;
}
