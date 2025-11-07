import { describe, expect, it } from 'vitest';
import { buildGenerateCliCommand, __test as generateInternals } from '../src/cli/generate-cli-runner.js';
import type { SerializedServerDefinition } from '../src/cli-metadata.js';

describe('generate-cli runner internals', () => {
  it('parses generate-cli flags including bundle/compile toggles', () => {
    const args = [
      '--server',
      'linear',
      '--command',
      'https://example.com/mcp.getComponents()',
      '--bundle',
      '--compile',
      '--minify',
    ];
    const parsed = generateInternals.parseGenerateFlags([...args]);
    expect(parsed.server).toBe('linear');
    expect(parsed.command).toBe('https://example.com/mcp');
    expect(parsed.bundle).toBe(true);
    expect(parsed.compile).toBe(true);
    expect(parsed.minify).toBe(true);
  });

  it('normalizes inferred names from URLs', () => {
    const args = ['--command', 'https://api.linear.app/mcp.getComponents'];
    const parsed = generateInternals.parseGenerateFlags([...args]);
    expect(parsed.command).toContain('https://');
    const inferred = generateInternals.inferNameFromCommand(parsed.command ?? '');
    expect(inferred).toBe('linear');
  });

  it('builds regenerate commands honoring global flags and invocation overrides', () => {
    const definition: SerializedServerDefinition = {
      name: 'demo',
      description: 'Demo server',
      command: { kind: 'http', url: 'https://demo.mcp' },
    };
    const invocation = {
      outputPath: 'out.ts',
      runtime: 'bun' as const,
      timeoutMs: 45_000,
      minify: true,
      bundle: 'out.bundle.js',
    };
    const command = buildGenerateCliCommand(invocation, definition, { '--config': '/tmp/mcporter.json' });
    expect(command).toContain('--config /tmp/mcporter.json');
    expect(command).toContain('--server demo');
    expect(command).toContain('--bundle out.bundle.js');
    expect(command).toContain('--timeout 45000');
    expect(command).toContain('--minify');
  });
});
