import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateHttpStartup,
  resolveHttpBindHost,
  HTTP_S2S_MISSING_ERROR,
  HTTP_S2S_INSECURE_DEV_WARNING,
} from '../http-startup.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const entry = path.join(repoRoot, 'src/index.ts');

const CANARY_SECRET = 's2s-canary-do-not-log-9f3a7c';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

describe('evaluateHttpStartup', () => {
  it('refuses when CONDUIT_S2S_SECRET is unset', () => {
    expect(evaluateHttpStartup({})).toEqual({ allow: false });
    expect(evaluateHttpStartup({ CONDUIT_S2S_SECRET: '' })).toEqual({ allow: false });
  });

  it('refuses when MCP_ALLOW_INSECURE_DEV is anything other than 1', () => {
    expect(evaluateHttpStartup({ MCP_ALLOW_INSECURE_DEV: 'true' })).toEqual({ allow: false });
    expect(evaluateHttpStartup({ MCP_ALLOW_INSECURE_DEV: '0' })).toEqual({ allow: false });
  });

  it('allows insecure startup only when MCP_ALLOW_INSECURE_DEV=1 and the secret is empty', () => {
    expect(evaluateHttpStartup({ MCP_ALLOW_INSECURE_DEV: '1' })).toEqual({
      allow: true,
      insecureDev: true,
    });
  });

  it('allows a normal startup when the secret is set and does not treat the dev flag as insecure', () => {
    expect(
      evaluateHttpStartup({
        CONDUIT_S2S_SECRET: CANARY_SECRET,
        MCP_ALLOW_INSECURE_DEV: '1',
      })
    ).toEqual({ allow: true, insecureDev: false });
  });

  it('startup messages never include a secret value', () => {
    expect(HTTP_S2S_MISSING_ERROR).not.toContain(CANARY_SECRET);
    expect(HTTP_S2S_INSECURE_DEV_WARNING).not.toContain(CANARY_SECRET);
    expect(HTTP_S2S_MISSING_ERROR).toMatch(/Refusing to start/);
    expect(HTTP_S2S_INSECURE_DEV_WARNING).toMatch(/WARNING/);
    expect(HTTP_S2S_INSECURE_DEV_WARNING).toMatch(/MCP_ALLOW_INSECURE_DEV=1/);
  });
});

describe('resolveHttpBindHost', () => {
  it('defaults to 127.0.0.1 when MCP_HTTP_HOST is unset or empty', () => {
    expect(resolveHttpBindHost({})).toBe('127.0.0.1');
    expect(resolveHttpBindHost({ MCP_HTTP_HOST: '' })).toBe('127.0.0.1');
  });

  it('uses an explicit MCP_HTTP_HOST', () => {
    expect(resolveHttpBindHost({ MCP_HTTP_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });
});

interface StartedServer {
  child: ChildProcess;
  output: () => string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
  stop: () => Promise<void>;
}

function startProcess(env: Record<string, string>): StartedServer {
  const child = spawn(process.execPath, [tsxCli, entry], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let combined = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    combined += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    combined += chunk;
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  const waitFor = (pattern: RegExp, timeoutMs = 15000) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${pattern}. output=${combined}`));
      }, timeoutMs);
      const check = () => {
        if (pattern.test(combined)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout?.on('data', check);
      child.stderr?.on('data', check);
      child.on('exit', check);
      check();
    });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const result = await Promise.race([
      exit,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (result === null) {
      child.kill('SIGKILL');
      await exit;
    }
  };

  return { child, output: () => combined, exit, waitFor, stop };
}

describe('HTTP process startup', () => {
  it('exits non-zero when CONDUIT_S2S_SECRET is unset', async () => {
    const server = startProcess({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: '0',
    });
    const result = await Promise.race([
      server.exit,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`still running: ${server.output()}`)), 15000)
      ),
    ]);
    expect(result.code).not.toBe(0);
    expect(server.output()).toContain(HTTP_S2S_MISSING_ERROR);
    expect(server.output()).not.toContain(HTTP_S2S_INSECURE_DEV_WARNING);
  }, 20000);

  it('exits non-zero when MCP_ALLOW_INSECURE_DEV is not exactly 1', async () => {
    const server = startProcess({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: '0',
      MCP_ALLOW_INSECURE_DEV: 'true',
    });
    const result = await server.exit;
    expect(result.code).not.toBe(0);
    expect(server.output()).toContain(HTTP_S2S_MISSING_ERROR);
  }, 20000);

  it('starts with a loud warning when MCP_ALLOW_INSECURE_DEV=1 and the secret is empty', async () => {
    const port = await freePort();
    const server = startProcess({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_ALLOW_INSECURE_DEV: '1',
      // error hides logger.info, so the warning must not go through logger.warn.
      LOG_LEVEL: 'error',
    });
    try {
      await server.waitFor(/WITHOUT service-to-service authentication/);
      const deadline = Date.now() + 10000;
      let health: Response | undefined;
      let lastError: unknown;
      while (Date.now() < deadline) {
        try {
          health = await fetch(`http://127.0.0.1:${port}/health`);
          if (health.ok) break;
        } catch (error) {
          lastError = error;
          health = undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!health?.ok) {
        throw lastError instanceof Error ? lastError : new Error(`health check failed: ${server.output()}`);
      }
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });
      const output = server.output();
      expect(output).toContain(HTTP_S2S_INSECURE_DEV_WARNING);
      expect(output).not.toContain(HTTP_S2S_MISSING_ERROR);
      expect(server.child.exitCode).toBeNull();
    } finally {
      await server.stop();
    }
  }, 20000);

  it('starts when the secret is set, binds to 127.0.0.1, and does not print the secret', async () => {
    const server = startProcess({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: '0',
      CONDUIT_S2S_SECRET: CANARY_SECRET,
    });
    try {
      await server.waitFor(/listening on HTTP/);
      const output = server.output();
      expect(output).not.toContain(CANARY_SECRET);
      expect(output).not.toContain(HTTP_S2S_MISSING_ERROR);
      expect(output).not.toContain(HTTP_S2S_INSECURE_DEV_WARNING);
      expect(output).toContain('"host":"127.0.0.1"');
    } finally {
      await server.stop();
    }
  }, 20000);

  it('does not apply the HTTP secret check to the stdio transport', async () => {
    const server = startProcess({
      MCP_TRANSPORT: 'stdio',
    });
    try {
      await server.waitFor(/stdio/);
      expect(server.output()).not.toContain(HTTP_S2S_MISSING_ERROR);
      expect(server.output()).not.toContain(CANARY_SECRET);
    } finally {
      await server.stop();
    }
  }, 20000);
});
