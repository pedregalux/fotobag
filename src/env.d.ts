// Los secretos no están en wrangler.jsonc, así que `wrangler types` no los ve.
// Este archivo se fusiona con el Env generado en worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    ADMIN_CODE: string;
  }
}
