import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'

const __dirname = import.meta.dirname;

// Development-only Land Portal integration. The API key is read here, on the Node side,
// and is attached to outgoing requests here. The browser never sees it.

// Endpoints of the Land Portal V2 API that the app uses, with the HTTP methods each accepts.
// Anything not listed is refused, so the proxy cannot be used to reach other URLs.
const LANDPORT_V2_BASE = 'https://api.landportal.com/v2';
const LANDPORT_ROUTES: { pattern: RegExp; methods: string[] }[] = [
  { pattern: /^\/filter-data$/, methods: ['POST'] },
  { pattern: /^\/filter-data\/filters$/, methods: ['GET'] },
  { pattern: /^\/filter-data\/filters\/[A-Za-z0-9_]+\/values$/, methods: ['GET'] },
  { pattern: /^\/exports$/, methods: ['GET', 'POST'] },
  { pattern: /^\/exports\/[A-Za-z0-9_-]+$/, methods: ['GET'] },
];

const MAX_BODY_BYTES = 1_000_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function landportalPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'landportal-api',
    apply: 'serve',
    configureServer(server) {
      // Status check used by the Integrations page.
      server.middlewares.use('/api/integrations/landportal', async (_req, res) => {
        const send = (body: Record<string, unknown>) =>
          sendJson(res, 200, { ...body, checkedAt: new Date().toISOString() });

        const key = env.LANDPORT_V2_API_KEY;
        if (!key) return send({ state: 'not-configured' });

        try {
          const response = await fetch(`${LANDPORT_V2_BASE}/filter-data/filters`, {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) return send({ state: 'connected', httpStatus: response.status });
          if (response.status === 401 || response.status === 403) {
            return send({ state: 'rejected', httpStatus: response.status });
          }
          return send({ state: 'error', httpStatus: response.status });
        } catch {
          return send({ state: 'unreachable' });
        }
      });

      // Forwards /api/landportal/<endpoint> to the Land Portal API with the key attached.
      server.middlewares.use('/api/landportal', async (req, res) => {
        const key = env.LANDPORT_V2_API_KEY;
        if (!key) {
          return sendJson(res, 503, { success: false, message: 'Land Portal is not configured' });
        }

        const method = (req.method ?? 'GET').toUpperCase();
        const url = new URL(req.url ?? '/', 'http://localhost');
        const endpoint = url.pathname.replace(/\/+$/, '') || '/';
        const route = LANDPORT_ROUTES.find((r) => r.pattern.test(endpoint));
        if (!route) {
          return sendJson(res, 404, { success: false, message: 'Unknown Land Portal endpoint' });
        }
        if (!route.methods.includes(method)) {
          return sendJson(res, 405, { success: false, message: `${method} is not supported for ${endpoint}` });
        }

        let body: string | undefined;
        if (method === 'POST') {
          try {
            body = await readBody(req);
          } catch {
            return sendJson(res, 400, { success: false, message: 'Request body is too large' });
          }
        }

        try {
          const upstream = await fetch(`${LANDPORT_V2_BASE}${endpoint}${url.search}`, {
            method,
            headers: {
              Authorization: `Bearer ${key}`,
              Accept: 'application/json',
              ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body,
            signal: AbortSignal.timeout(30000),
          });
          const text = await upstream.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return sendJson(res, 502, {
              success: false,
              message: `Land Portal returned a non-JSON response (HTTP ${upstream.status})`,
            });
          }
          return sendJson(res, upstream.status, parsed);
        } catch {
          return sendJson(res, 502, { success: false, message: 'Land Portal did not respond' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), landportalPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@/components': path.resolve(__dirname, './src/components'),
        '@/pages': path.resolve(__dirname, './src/pages'),
        '@/services': path.resolve(__dirname, './src/services'),
        '@/types': path.resolve(__dirname, './src/types'),
        '@/utils': path.resolve(__dirname, './src/utils'),
        '@/lib': path.resolve(__dirname, './src/lib'),
        '@/hooks': path.resolve(__dirname, './src/hooks'),
      },
    },
  };
});
