import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/** Exact origins only: LAN access is opt-in, never reflected with credentials. */
export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const origins = (env['CORS_ORIGINS'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS debe contener orígenes HTTP(S) exactos'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS no permite comodines, credenciales ni rutas');
    }
  }
  if (env['NODE_ENV'] === 'development') {
    origins.push('http://localhost:8081', 'http://127.0.0.1:8081', 'http://localhost:8082', 'http://127.0.0.1:8082');
  }
  return { origin: [...new Set(origins)], credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] };
}
