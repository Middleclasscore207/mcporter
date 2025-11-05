import { describe, expect, it, vi } from 'vitest';
import type { ServerDefinition } from '../src/config.js';

process.env.MCPORTER_DISABLE_AUTORUN = '1';
const cliModulePromise = import('../src/cli.js');

describe('CLI list timeout handling', () => {
  it('parses --timeout flag into list flags', async () => {
    const { extractListFlags } = await cliModulePromise;
    const args = ['--timeout', '7500', '--schema', 'server'];
    const flags = extractListFlags(args);
    expect(flags).toEqual({ schema: true, timeoutMs: 7500 });
    expect(args).toEqual(['server']);
  });

  it('honors --timeout when listing a single server', async () => {
    const { handleList } = await cliModulePromise;
    const definition: ServerDefinition = {
      name: 'slow-server',
      command: { kind: 'stdio', command: 'noop', args: [], cwd: process.cwd() },
      source: { kind: 'local', path: '/tmp/config.json' },
    };

    const runtime = {
      getDefinitions: () => [definition],
      getDefinition: () => definition,
      listTools: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ name: 'ok' }]), 50);
        }),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleList(runtime, ['--timeout', '10', 'slow-server']);

    const warningLines = warnSpy.mock.calls.map((call) => call[0]);
    expect(warningLines).toContain('  Tools: <timed out after 10ms>');
    expect(warningLines).toContain('  Reason: Timeout');

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
