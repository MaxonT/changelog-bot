import { describe, expect, jest, test } from '@jest/globals';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs } from '@/lib/cli-args.js';
import { executeChangelogRun } from '@/lib/changelog-run.js';
import {
  evaluateChangelogCheck,
  formatChangelogCheckFailure,
} from '@/lib/changelog-check.js';
import { writeChangelog } from '@/lib/changelog-file.js';
import { prepareExistingChangelog } from '@/lib/release-context.js';
import { buildChangelogLlmOutput } from '@/utils/llm-output.js';
import {
  createChangelogRunDeps,
  createMockAppConfig,
  createMockCliOptions,
  createMockReleasePlan,
} from '../fixtures/changelog-run.js';
import { ChangelogDriftError, mapErrorToExitCode } from '@/lib/errors.js';
import { CliOptionsSchema, type CliOptions } from '@/schema/cli.js';
import { PROVIDER_OPENAI } from '@/constants/provider.js';
import type { AppConfig } from '@/types/config.js';
import type { ReleasePlan } from '@/lib/release-context.js';

const APP_CONFIG: AppConfig = {
  github: {
    apiBase: 'https://api.github.com',
    repoFullName: 'octo/repo',
  },
  providers: {
    openai: { model: 'mock-openai' },
    anthropic: { model: 'mock-anthropic' },
    gemini: { model: 'mock-gemini' },
    xai: { model: 'mock-xai' },
  },
  typesafe: { model: 'jev-latest' },
};

type TempChangelog = {
  directory: string;
  changelogPath: string;
};

function createTempChangelog(content?: string): TempChangelog {
  const directory = mkdtempSync(join(tmpdir(), 'changelog-bot-check-'));
  const changelogPath = join(directory, 'CHANGELOG.md');

  if (content !== undefined) {
    writeFileSync(changelogPath, content, 'utf8');
  }

  return { directory, changelogPath };
}

function createCheckCli(changelogPath: string): CliOptions {
  return CliOptionsSchema.parse({
    check: true,
    changelogPath,
    provider: PROVIDER_OPENAI,
    releaseTag: 'v1.2.3',
    releaseName: '1.2.3',
    releaseBody: 'release notes',
    noAi: true,
  });
}

function createCheckDeps(params: {
  changelogPath: string;
  existingChangelog: string;
  generatedChangelog: string;
}) {
  const logMessages: string[] = [];
  const writes: Array<{ changelogPath: string; content: string }> = [];
  let pullRequestCalls = 0;
  let tokenChecks = 0;
  const releasePlan: ReleasePlan = {
    owner: 'octo',
    repo: 'repo',
    repoPath: '.',
    changelogPath: params.changelogPath,
    releaseRef: 'v1.2.3',
    version: '1.2.3',
    prevRef: 'v1.2.2',
    date: '2026-11-18',
  };

  const deps = {
    resolveReleasePlan: () => releasePlan,
    gitMergedPRs: () => '',
    prepareExistingChangelog: () => params.existingChangelog,
    commitsInRange: () => [],
    resolveRunCredentials: async () => ({
      token: undefined,
      hasProviderKey: false,
    }),
    buildChangelogLlmOutput: async () => ({
      llm: {
        new_section_markdown: 'generated section',
        pr_title: 'docs(changelog): 1.2.3',
        pr_body: 'body',
      },
      aiUsed: false,
      fallbackReasons: [],
    }),
    finalizeChangelogUpdate: (finalizeParams: { llm: unknown }) => ({
      llm: finalizeParams.llm,
      updated: params.generatedChangelog,
    }),
    writeChangelog: (changelogPath: string, content: string) => {
      writes.push({ changelogPath, content });
    },
    ensureGithubTokenRequired: () => {
      tokenChecks++;
    },
    createPR: async () => {
      pullRequestCalls++;
      return 1;
    },
  };

  return {
    deps,
    logMessages,
    writes,
    get pullRequestCalls() {
      return pullRequestCalls;
    },
    get tokenChecks() {
      return tokenChecks;
    },
  };
}

async function runCheck(params: {
  changelogPath: string;
  existingChangelog: string;
  generatedChangelog: string;
}) {
  const harness = createCheckDeps(params);
  const log = (message: string) => harness.logMessages.push(message);

  await executeChangelogRun({
    cli: createCheckCli(params.changelogPath),
    appConfig: APP_CONFIG,
    log,
    deps: harness.deps,
  });

  return harness;
}

async function captureRunFailure(params: {
  changelogPath: string;
  existingChangelog: string;
  generatedChangelog: string;
}) {
  try {
    await runCheck(params);
  } catch (error) {
    return error;
  }

  throw new Error('Expected check mode to fail');
}

describe('changelog check mode', () => {
  test('parses --check as a boolean CLI flag', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'changelog-bot-check-'));

    try {
      const cli = await parseCliArgs(['node', 'cli', '--check'], {
        cwd: directory,
      });

      expect(cli.check).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('exits successfully without writing when the changelog is in sync', async () => {
    const generatedChangelog = [
      '# Changelog',
      '',
      '## [v1.2.3] - 2026-11-18',
      '',
      '### Added',
      '- generated feature',
      '',
      '[v1.2.3]: https://github.com/octo/repo/compare/v1.2.2...v1.2.3',
      '',
    ].join('\n');
    const temp = createTempChangelog(generatedChangelog);

    try {
      const harness = await runCheck({
        changelogPath: temp.changelogPath,
        existingChangelog: generatedChangelog,
        generatedChangelog,
      });

      expect(readFileSync(temp.changelogPath, 'utf8')).toBe(generatedChangelog);
      expect(harness.writes).toEqual([]);
      expect(harness.pullRequestCalls).toBe(0);
      expect(harness.tokenChecks).toBe(0);
      expect(harness.logMessages).toContain(
        `${temp.changelogPath} is up to date.`,
      );
    } finally {
      rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  test('fails with a diff when the committed changelog is out of date', async () => {
    const committedChangelog = [
      '# Changelog',
      '',
      '## [v1.2.2] - 2026-11-01',
      '',
      '### Added',
      '- old feature',
      '',
    ].join('\n');
    const generatedChangelog = [
      '# Changelog',
      '',
      '## [v1.2.3] - 2026-11-18',
      '',
      '### Added',
      '- generated feature',
      '',
      '[v1.2.3]: https://github.com/octo/repo/compare/v1.2.2...v1.2.3',
      '',
    ].join('\n');
    const temp = createTempChangelog(committedChangelog);

    try {
      const error = await captureRunFailure({
        changelogPath: temp.changelogPath,
        existingChangelog: committedChangelog,
        generatedChangelog,
      });

      expect(error).toBeInstanceOf(ChangelogDriftError);
      expect(mapErrorToExitCode(error)).not.toBe(0);
      expect((error as Error).message).toContain(
        `${temp.changelogPath} is out of date`,
      );
      expect((error as Error).message).toContain('+## [v1.2.3] - 2026-11-18');
      expect(readFileSync(temp.changelogPath, 'utf8')).toBe(committedChangelog);
    } finally {
      rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  test('fails without writing when the changelog file is missing', async () => {
    const temp = createTempChangelog();

    try {
      const error = await captureRunFailure({
        changelogPath: temp.changelogPath,
        existingChangelog: '',
        generatedChangelog: '# Changelog\n\n## [v1.2.3] - 2026-11-18\n',
      });

      expect(error).toBeInstanceOf(ChangelogDriftError);
      expect(mapErrorToExitCode(error)).not.toBe(0);
      expect((error as Error).message).toContain(
        `${temp.changelogPath} does not exist`,
      );
    } finally {
      rmSync(temp.directory, { recursive: true, force: true });
    }
  });
});

describe('changelog check failure preview', () => {
  test('previews changed lines when the drift follows many unchanged lines', () => {
    const unchanged = Array.from(
      { length: 50 },
      (_, index) => `- unchanged entry ${index + 1}`,
    );
    const committedChangelog = [
      '# Changelog',
      ...unchanged,
      '- committed entry',
      '',
    ].join('\n');
    const generatedChangelog = [
      '# Changelog',
      ...unchanged,
      '- generated entry',
      '',
    ].join('\n');

    const result = evaluateChangelogCheck({
      changelogPath: 'CHANGELOG.md',
      fileExists: true,
      actualChangelog: committedChangelog,
      generatedChangelog,
    });

    expect(result.status).toBe('out-of-date');
    if (result.status !== 'out-of-date') return;

    const message = formatChangelogCheckFailure(result);

    expect(message).toContain('-- committed entry');
    expect(message).toContain('+- generated entry');
    expect(message).not.toContain('unchanged entry');
    expect(message).not.toContain('--- a/CHANGELOG.md');
    expect(message).not.toContain('+++ b/CHANGELOG.md');
  });

  test('caps the preview and counts the changed lines left out', () => {
    const generatedChangelog = Array.from(
      { length: 45 },
      (_, index) => `- generated entry ${index + 1}`,
    ).join('\n');

    const result = evaluateChangelogCheck({
      changelogPath: 'CHANGELOG.md',
      fileExists: true,
      actualChangelog: '# Changelog',
      generatedChangelog,
    });

    expect(result.status).toBe('out-of-date');
    if (result.status !== 'out-of-date') return;

    const message = formatChangelogCheckFailure(result);

    // 45 additions plus the removed heading: 46 changed lines, 40 shown.
    expect(message).toContain('-# Changelog');
    expect(message).toContain('+- generated entry 39');
    expect(message).not.toContain('+- generated entry 40');
    expect(message).toContain('... (6 more changed lines omitted)');
  });
});

describe('changelog check mode with real generation and finalization', () => {
  const previousRelease = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [v1.2.2] - 2026-05-01',
    '',
    '### Added',
    '- previous release feature',
    '',
  ].join('\n');

  function createRealRunDeps(
    changelogPath: string,
    overrides: Parameters<typeof createChangelogRunDeps>[0] = {},
  ) {
    // WHY: Only Git and GitHub stay mocked; reading, generating, finalizing
    // and writing the changelog all run the production code paths.
    return createChangelogRunDeps(
      {
        resolveReleasePlan: jest.fn(() =>
          createMockReleasePlan({ changelogPath }),
        ),
        prepareExistingChangelog,
        commitsInRange: jest.fn(() => [
          { sha: 'abcdef1', subject: 'feat: add export support' },
          { sha: 'abcdef2', subject: 'fix: handle empty exports' },
        ]),
        buildChangelogLlmOutput,
        ...overrides,
      },
      { useRealFinalization: true },
    );
  }

  function createReleaseCli(
    changelogPath: string,
    overrides: Partial<CliOptions>,
  ): CliOptions {
    return createMockCliOptions({
      changelogPath,
      dryRun: false,
      noAi: true,
      releaseBody: '',
      ...overrides,
    });
  }

  test('passes on a freshly generated changelog and fails once an entry is edited', async () => {
    const appConfig = createMockAppConfig();
    const temp = createTempChangelog(previousRelease);

    try {
      // 1. Generate the changelog the way a release would, writing the file.
      await executeChangelogRun({
        cli: createReleaseCli(temp.changelogPath, { output: 'file' }),
        appConfig,
        log: jest.fn(),
        deps: createRealRunDeps(temp.changelogPath, { writeChangelog }),
      });

      const generated = readFileSync(temp.changelogPath, 'utf8');
      expect(generated).not.toBe(previousRelease);
      expect(generated).toContain('## [v1.2.3]');
      expect(generated).toContain('add export support');
      expect(generated).toContain('previous release feature');

      // 2. Check the same release inputs against the generated file.
      const checkWrite = jest.fn<(path: string, content: string) => void>();
      const checkDeps = createRealRunDeps(temp.changelogPath, {
        writeChangelog: checkWrite,
      });
      const checkLog = jest.fn<(message: string) => void>();

      await executeChangelogRun({
        cli: createReleaseCli(temp.changelogPath, { check: true }),
        appConfig,
        log: checkLog,
        deps: checkDeps,
      });

      expect(checkLog).toHaveBeenCalledWith(
        `${temp.changelogPath} is up to date.`,
      );
      expect(readFileSync(temp.changelogPath, 'utf8')).toBe(generated);

      // 3. Edit a generated release entry by hand.
      const edited = generated.replace(
        'add export support',
        'add export support (edited by hand)',
      );
      expect(edited).not.toBe(generated);
      writeFileSync(temp.changelogPath, edited, 'utf8');

      // 4. The same check now reports drift.
      const driftDeps = createRealRunDeps(temp.changelogPath, {
        writeChangelog: checkWrite,
      });
      const error = await executeChangelogRun({
        cli: createReleaseCli(temp.changelogPath, { check: true }),
        appConfig,
        log: jest.fn(),
        deps: driftDeps,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ChangelogDriftError);
      expect((error as Error).message).toContain(
        `${temp.changelogPath} is out of date`,
      );
      expect((error as Error).message).toContain('(edited by hand)');

      // 5. Neither check run modified the file or tried to deliver anything.
      expect(readFileSync(temp.changelogPath, 'utf8')).toBe(edited);
      expect(checkWrite).not.toHaveBeenCalled();
      for (const deps of [checkDeps, driftDeps]) {
        expect(deps.createPR).not.toHaveBeenCalled();
        expect(deps.ensureGithubTokenRequired).not.toHaveBeenCalled();
        expect(deps.writeStdout).not.toHaveBeenCalled();
      }
    } finally {
      rmSync(temp.directory, { recursive: true, force: true });
    }
  });
});
