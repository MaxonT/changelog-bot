import { describe, expect, test } from '@jest/globals';
import {
  extractLinkedIssueNumbers,
  MAX_LINKED_ISSUES_PER_PR,
} from '@/utils/why-issue-reference.js';

const repository = {
  owner: 'necoz-oss',
  repo: 'changelog-bot',
};

describe('why-issue-reference', () => {
  test('returns empty array when body is empty', () => {
    expect(extractLinkedIssueNumbers('', repository)).toEqual([]);
  });

  test('extracts issue numbers following closing keywords', () => {
    expect(extractLinkedIssueNumbers('Fixes #101', repository)).toEqual([101]);
    expect(extractLinkedIssueNumbers('fixes: #102', repository)).toEqual([102]);
    expect(extractLinkedIssueNumbers('Closes #103', repository)).toEqual([103]);
    expect(extractLinkedIssueNumbers('closed #104', repository)).toEqual([104]);
    expect(extractLinkedIssueNumbers('Resolves #105', repository)).toEqual([
      105,
    ]);
    expect(extractLinkedIssueNumbers('resolved: #106', repository)).toEqual([
      106,
    ]);
  });

  test('extracts issue number from markdown link with closing keyword', () => {
    const body =
      'Fixes [#201](https://github.com/necoz-oss/changelog-bot/issues/201)';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([201]);
  });

  test('extracts issue number from markdown target URL when label differs', () => {
    // WHY: The destination URL is authoritative; misleading or mismatched link labels
    // like [#201] pointing to issue 999 must extract 999, not 201.
    const body =
      'Fixes [#201](https://github.com/necoz-oss/changelog-bot/issues/999)';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([999]);
  });

  test('ignores markdown link when destination points to external repository', () => {
    // WHY: Prevent cross-repo closing links from accidentally resolving to current repo issues.
    const body =
      'Fixes [#201](https://github.com/other-org/other-repo/issues/201) and resolves #305';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([305]);
  });

  test('ignores markdown link when destination points to a pull request', () => {
    // WHY: PR links should not be treated as linked issues.
    const body =
      'Fixes [#201](https://github.com/necoz-oss/changelog-bot/pull/201)';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([]);
  });

  test('extracts issue number when matching full repo reference', () => {
    const body = 'Closes necoz-oss/changelog-bot#202';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([202]);
  });

  test('ignores issue references for external repositories', () => {
    const body = 'Fixes other-org/other-repo#999 and closes #301';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([301]);
  });

  test('extracts direct issue URLs matching the target repository', () => {
    const body = [
      'See problem description at:',
      'https://github.com/necoz-oss/changelog-bot/issues/401',
    ].join('\n');
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([401]);
  });

  test('ignores direct issue URLs for other repositories or pull requests', () => {
    const body = [
      'Related discussion:',
      'https://github.com/facebook/react/issues/501',
      'https://github.com/necoz-oss/changelog-bot/pull/502',
      'Resolves #503',
    ].join('\n');
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([503]);
  });

  test('ignores issue references inside HTML comments and code blocks', () => {
    // WHY: Template guidance like "<!-- Fixes #111 and closes #222 -->" or code examples
    // must not consume the MAX_LINKED_ISSUES_PER_PR budget or overshadow actual closing keywords.
    const body = [
      '<!-- Example: Fixes #111 and closes #222 -->',
      '',
      'Fixes #333',
      '',
      '```sh',
      '# git commit -m "Fixes #444 and closes #555"',
      '```',
      '',
      'Also tested with `Fixes #666` in inline code.',
    ].join('\n');

    expect(extractLinkedIssueNumbers(body, repository)).toEqual([333]);
  });

  test('deduplicates issue references in the same PR description', () => {
    const body = 'Fixes #601 and also resolves #601, see #601';
    expect(extractLinkedIssueNumbers(body, repository)).toEqual([601]);
  });

  test('bounds extracted issues by MAX_LINKED_ISSUES_PER_PR', () => {
    const body = 'Fixes #701, closes #702, and resolves #703';
    const result = extractLinkedIssueNumbers(body, repository);
    expect(result).toHaveLength(MAX_LINKED_ISSUES_PER_PR);
    expect(result).toEqual([701, 702]);
  });

  describe('encounter order across reference formats', () => {
    test('preserves encounter order when all references use closing keywords', () => {
      const body = 'Closes #101, fixes #102, and resolves #103';
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([101, 102]);
    });

    test('preserves encounter order when all references use direct issue URLs', () => {
      const body = [
        'See https://github.com/necoz-oss/changelog-bot/issues/201',
        'and https://github.com/necoz-oss/changelog-bot/issues/202',
        'also https://github.com/necoz-oss/changelog-bot/issues/203',
      ].join('\n');
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([201, 202]);
    });

    test('preserves encounter order when direct issue URL appears before closing keywords', () => {
      const body = [
        'Context described at https://github.com/necoz-oss/changelog-bot/issues/301.',
        'Fixes #302.',
        'Closes #303.',
      ].join('\n');
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([301, 302]);
    });

    test('preserves encounter order when closing keyword appears before direct issue URL', () => {
      const body = [
        'Fixes #302.',
        'Context described at https://github.com/necoz-oss/changelog-bot/issues/301.',
        'Closes #303.',
      ].join('\n');
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([302, 301]);
    });

    test('preserves encounter order with direct URLs and markdown closing links', () => {
      const body = [
        'See https://github.com/necoz-oss/changelog-bot/issues/401.',
        'Resolves [#402](https://github.com/necoz-oss/changelog-bot/issues/402).',
      ].join('\n');
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([401, 402]);
    });

    test('duplicate references across formats do not consume additional slots', () => {
      const body = [
        'See https://github.com/necoz-oss/changelog-bot/issues/501 for background.',
        'Fixes #501.',
        'Closes #502.',
      ].join('\n');
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([501, 502]);
    });

    test('excludes external repositories and ignored markdown while preserving valid encounter order', () => {
      const body = [
        '<!-- Fixes #901 -->',
        'https://github.com/other-org/other-repo/issues/902',
        'Fixes other-org/other-repo#903',
        'See https://github.com/necoz-oss/changelog-bot/issues/601.',
        '`Fixes #904`',
        '```sh',
        'Fixes #905',
        '```',
        'Resolves #602.',
        'Closes #603.',
      ].join('\n');
      expect(extractLinkedIssueNumbers(body, repository)).toEqual([601, 602]);
    });

    test('preserves deterministic behavior across repeated runs', () => {
      const body = [
        'Background: https://github.com/necoz-oss/changelog-bot/issues/701',
        'Fixes #702',
      ].join('\n');
      const run1 = extractLinkedIssueNumbers(body, repository);
      const run2 = extractLinkedIssueNumbers(body, repository);
      expect(run1).toEqual([701, 702]);
      expect(run2).toEqual(run1);
    });
  });
});
