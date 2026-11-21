import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeLinting = vi.fn();

vi.mock('../services/lint-orchestrator.js', () => ({
  LintOrchestrator: class {
    executeLinting = executeLinting;
    formatResults = () => ({ violationOutput: [], summaryOutput: '' });
  },
}));

vi.mock('../config/config-loader.js', () => ({
  loadConfig: vi.fn(async () => ({ rootDir: '/project' })),
}));

const { default: Check } = await import('./check.js');

async function runCheck(): Promise<{ exitCode: number; message?: string }> {
  try {
    await Check.run(['/project', '--no-color'], import.meta.url);
    return { exitCode: 0 };
  } catch (error) {
    const err = error as { oclif?: { exit?: number }; message?: string };
    return { exitCode: err.oclif?.exit ?? -1, message: err.message };
  }
}

const singleProjectResult = (hasViolations: boolean) => ({
  hasViolations,
  fileCount: 1,
  analysisTimeMs: 1,
  violations: [],
});

const workspaceResult = (hasViolations: boolean) => ({
  hasViolations,
  workspaceResult: {
    type: 'pnpm',
    root: '/project',
    packageResults: [],
    packageBoundaryViolations: [],
    totalFileCount: 0,
    totalTimeMs: 1,
  },
});

describe('check command exit codes', () => {
  beforeEach(() => {
    executeLinting.mockReset();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('exits 0 when no violations are found', async () => {
    executeLinting.mockResolvedValue(singleProjectResult(false));

    expect(await runCheck()).toEqual({ exitCode: 0 });
  });

  it('exits 1 when violations are found', async () => {
    executeLinting.mockResolvedValue(singleProjectResult(true));

    const { exitCode, message } = await runCheck();

    expect(exitCode).toBe(1);
    expect(message).not.toContain('Internal error');
  });

  it('exits 1 when violations are found in workspace mode', async () => {
    executeLinting.mockResolvedValue(workspaceResult(true));

    const { exitCode, message } = await runCheck();

    expect(exitCode).toBe(1);
    expect(message).not.toContain('Internal error');
  });

  it('exits 0 in workspace mode without violations', async () => {
    executeLinting.mockResolvedValue(workspaceResult(false));

    expect(await runCheck()).toEqual({ exitCode: 0 });
  });

  it('exits 2 with an internal error message when linting throws', async () => {
    executeLinting.mockRejectedValue(new Error('boom'));

    const { exitCode, message } = await runCheck();

    expect(exitCode).toBe(2);
    expect(message).toContain('Internal error: boom');
  });
});
