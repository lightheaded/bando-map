/// <reference types="vite/client" />

/** App version from package.json, injected at build time (vite.config.ts `define`). */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /**
   * Sentry ingest key for the browser, supplied by the deploy workflow. Absent
   * in a clone and in local builds, which turns error reporting off.
   */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
