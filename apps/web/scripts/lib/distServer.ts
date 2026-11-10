import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static server for the built app (backlog QA-02 checks).
 *
 * Serves `dist/` the way a static host would, with one deliberate difference:
 * document navigations to unknown paths fall back to `index.html`, because that
 * is how the SPA is deployed. Asset requests that miss return 404, so a missing
 * precached file cannot hide behind the shell.
 *
 * Plain `node:http` on purpose: the scripts run under Bun but need no Bun-only
 * API (and so no extra global type package).
 */
export interface DistServer {
  readonly url: string;
  stop(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Starts the static server and resolves once the port is bound. */
export async function serveDist(
  distDir: string,
  port: number,
): Promise<DistServer> {
  const root = resolve(distDir);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requested = normalize(
      url.pathname === '/' ? '/index.html' : url.pathname,
    );
    const filePath = resolve(join(root, requested));
    const insideRoot = filePath === root || filePath.startsWith(root + '/');
    const acceptsHtml = request.headers.accept?.includes('text/html') === true;

    const send = (path: string): void => {
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        // `no-cache` (revalidate), never `no-store`: the Cache API refuses to
        // store a `no-store` response, which would silently break precaching.
        'cache-control': 'no-cache',
      });
      createReadStream(path).pipe(response);
    };

    void (async () => {
      if (insideRoot && (await isFile(filePath))) {
        send(filePath);
        return;
      }
      const shell = join(root, 'index.html');
      if (acceptsHtml && (await isFile(shell))) {
        send(shell);
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
    })();
  });

  await new Promise<void>((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

/** Runs the production build; throws with the exit code on failure. */
export async function buildApp(appDir: string): Promise<void> {
  const child = spawn('bunx', ['--bun', 'vite', 'build'], {
    cwd: appDir,
    stdio: 'inherit',
  });
  const code = await new Promise<number>((resolveExit) => {
    child.on('exit', (exitCode) => resolveExit(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`vite build failed (exit ${code})`);
}

/**
 * Copies `dist/` into a throwaway directory. The update check rewrites the
 * served worker to simulate a deployment, and that must never touch the real
 * build output.
 */
export async function copyDist(
  distDir: string,
): Promise<{ dist: string; dispose: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'stationeers-dist-'));
  const dist = join(root, 'dist');
  await cp(distDir, dist, { recursive: true });
  return {
    dist,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/** Path of the apps/web package directory (the scripts live in it). */
export function appDir(): string {
  return resolve(fileURLToPath(new URL('../..', import.meta.url)));
}
