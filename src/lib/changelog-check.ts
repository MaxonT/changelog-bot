import { diffChangelogLines } from '@/lib/changelog-diff.js';

const MAX_REPORTED_DIFF_LINES = 40;

/** Outcome of comparing generated changelog content with the committed file. */
export type ChangelogCheckResult =
  | {
      /** Generated content exactly matches the committed changelog. */
      status: 'in-sync';
      /** Path to the compared changelog file. */
      changelogPath: string;
    }
  | {
      /** Generated content differs from the committed changelog. */
      status: 'out-of-date';
      /** Path to the compared changelog file. */
      changelogPath: string;
      /** Line-level diff between committed and generated content, without file headers. */
      diffLines: string[];
    }
  | {
      /** No changelog file exists at the configured path. */
      status: 'missing';
      /** Path to the missing changelog file. */
      changelogPath: string;
    };

/** Inputs required to compare generated and committed changelog content. */
export type EvaluateChangelogCheckParams = {
  /** Path to the changelog file being checked. */
  changelogPath: string;
  /** Whether the changelog file exists on disk. */
  fileExists: boolean;
  /** Changelog content currently committed to disk. */
  actualChangelog: string;
  /** Changelog content the CLI would generate for this run. */
  generatedChangelog: string;
};

/**
 * Compare generated changelog content with the committed file.
 * @param params Changelog path, existence flag, and both content snapshots.
 * @returns Whether the file is in sync, out of date, or missing.
 */
export function evaluateChangelogCheck(
  params: EvaluateChangelogCheckParams,
): ChangelogCheckResult {
  const { changelogPath, fileExists, actualChangelog, generatedChangelog } =
    params;

  if (!fileExists) {
    return { status: 'missing', changelogPath };
  }

  if (actualChangelog === generatedChangelog) {
    return { status: 'in-sync', changelogPath };
  }

  return {
    status: 'out-of-date',
    changelogPath,
    diffLines: diffChangelogLines(actualChangelog, generatedChangelog),
  };
}

/**
 * Format a failed check as an actionable error message with a diff preview.
 * WHY: CI logs must identify the stale file and the generated lines that differ
 * without requiring a separate dry-run invocation.
 * @param result Failed changelog check result.
 * @returns Error message suitable for stderr and exit-code handling.
 */
export function formatChangelogCheckFailure(
  result: Exclude<ChangelogCheckResult, { status: 'in-sync' }>,
): string {
  if (result.status === 'missing') {
    return `Changelog check failed: ${result.changelogPath} does not exist.`;
  }

  // WHY: The diff carries every unchanged line as context, so a preview cut
  // from the top can be all context when the drift sits deep in the file.
  // Only added and removed lines tell CI which lines to fix.
  const changedLines = result.diffLines.filter(
    (line) => line.startsWith('+') || line.startsWith('-'),
  );
  const displayedLines = changedLines.slice(0, MAX_REPORTED_DIFF_LINES);
  const remainingCount = changedLines.length - displayedLines.length;
  const preview = displayedLines.join('\n');
  const overflowNotice =
    remainingCount > 0
      ? `\n... (${remainingCount} more changed lines omitted)`
      : '';

  return [
    `Changelog check failed: ${result.changelogPath} is out of date.`,
    'Generated changelog differs from the committed file:',
    `${preview}${overflowNotice}`,
  ].join('\n');
}
