import { describe, expect, test } from '@jest/globals';

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs } from '@/lib/cli-args.js';
import { executeChangelogRun } from '@/lib/changelog-run.js';
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
      expect(readFileSync(temp.changelogPath, 'utf8')).toBe(
        committedChangelog,
      );
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
