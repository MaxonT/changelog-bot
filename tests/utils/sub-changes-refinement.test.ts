import { describe, expect, test } from '@jest/globals';
import { detectPrSubChangesFromCommits } from '@/utils/sub-changes.js';
import { buildReleaseDraft } from '@/utils/release-draft.js';
import { buildSectionFromRelease } from '@/utils/release-section.js';
import { validateReleaseResult } from '@/utils/release-validation.js';
import type { PullRef } from '@/types/github.js';

// Regression fixture for #371: the commits of PR #366 as they were merged.
const PR_366_TITLE =
  'fix(classification): support breaking change footers and git revert subjects';
const PR_366_COMMITS = [
  {
    sha: 'a366001',
    subject:
      'fix: classify breaking change footers and git revert subjects (#365)',
  },
  {
    sha: 'a366002',
    subject:
      'refactor(classification): refine breaking change metadata and git parsing boundaries',
  },
  {
    sha: 'a366003',
    subject:
      'refactor(classification): restrict breaking footer scope and narrow provider prompt contract',
  },
  {
    sha: 'a366004',
    subject:
      'refactor(classification): allow multi-paragraph breaking change footer descriptions',
  },
];

function pullRequestsFor(
  commits: readonly { sha: string }[],
  pr: PullRef,
): Record<string, PullRef[]> {
  return Object.fromEntries(commits.map((commit) => [commit.sha, [pr]]));
}

const PR_366: PullRef = {
  number: 366,
  title: PR_366_TITLE,
  author: 'johnnylemonny',
  url: 'https://github.com/necoz-oss/changelog-bot/pull/366',
};

describe('sub-change expansion of refinement commits (#371)', () => {
  test('does not split PR #366 into its refinement commits', () => {
    expect(
      detectPrSubChangesFromCommits(366, PR_366_TITLE, PR_366_COMMITS),
    ).toBeNull();
  });

  test('keeps PR #366 as one Fixed entry under its own title', () => {
    const draft = buildReleaseDraft({
      version: '0.12.0',
      date: '2026-11-19',
      commitList: PR_366_COMMITS,
      pullRequestsBySha: pullRequestsFor(PR_366_COMMITS, PR_366),
      owner: 'necoz-oss',
      repo: 'changelog-bot',
    });

    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0]).toMatchObject({
      id: 'pr:366',
      origin: { kind: 'pull-request', number: 366 },
      title: 'support breaking change footers and git revert subjects',
      pr: 366,
    });
    expect(draft.assignments['pr:366']).toBe('Fixed');

    // Every source commit is still accounted for, so completeness validation holds.
    expect(
      draft.excludedChanges.map((excluded) => [
        excluded.change.id,
        excluded.reason,
      ]),
    ).toEqual(
      PR_366_COMMITS.map((commit) => [
        `commit:${commit.sha}`,
        'collapsed-into-pr',
      ]),
    );
    expect(validateReleaseResult(draft).kind).toBe('release');

    const section = buildSectionFromRelease(draft);
    expect(section).toContain(
      '### Fixed\n\n- support breaking change footers and git revert subjects by @johnnylemonny in [#366]',
    );
    expect(section).not.toContain('### Changed');
    expect(section).not.toContain('refine breaking change metadata');
  });

  test('does not split a PR made only of distinct refactor commits', () => {
    expect(
      detectPrSubChangesFromCommits(200, 'refactor: parser overhaul', [
        { sha: 'r1', subject: 'refactor: extract AST parser helper' },
        { sha: 'r2', subject: 'refactor(cli): split argument validation' },
      ]),
    ).toBeNull();
  });

  test('still expands distinct feature and fix commits next to a refactor', () => {
    const commits = [
      { sha: 'm1', subject: 'feat: add OAuth login provider' },
      { sha: 'm2', subject: 'refactor(auth): share the token store' },
      { sha: 'm3', subject: 'fix: resolve race condition in token refresh' },
    ];

    expect(
      detectPrSubChangesFromCommits(
        201,
        'feat: authentication and profile management',
        commits,
      ),
    ).toEqual([
      {
        subIndex: 1,
        title: 'add OAuth login provider',
        rawTitle: 'feat: add OAuth login provider',
        commitSha: 'm1',
      },
      {
        subIndex: 2,
        title: 'resolve race condition in token refresh',
        rawTitle: 'fix: resolve race condition in token refresh',
        commitSha: 'm3',
      },
    ]);

    const draft = buildReleaseDraft({
      version: '1.0.0',
      date: '2026-11-20',
      commitList: commits,
      pullRequestsBySha: pullRequestsFor(commits, {
        number: 201,
        title: 'feat: authentication and profile management',
        author: 'alice',
      }),
      owner: 'acme',
      repo: 'tool',
    });

    expect(draft.changes.map((change) => change.id)).toEqual([
      'pr:201:c1',
      'pr:201:c2',
    ]);
    expect(validateReleaseResult(draft).kind).toBe('release');
  });

  test('gives the same result on repeated runs', () => {
    const run = () =>
      buildReleaseDraft({
        version: '0.12.0',
        date: '2026-11-19',
        commitList: PR_366_COMMITS,
        pullRequestsBySha: pullRequestsFor(PR_366_COMMITS, PR_366),
        owner: 'necoz-oss',
        repo: 'changelog-bot',
      });

    expect(run()).toEqual(run());
  });
});
