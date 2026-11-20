const DIFF_FILE_HEADER = ['--- a/CHANGELOG.md', '+++ b/CHANGELOG.md'];

/**
 * Create a simple unified-style diff between two strings.
 * @param oldText Original text (left side).
 * @param newText Updated text (right side).
 * @returns Unified diff as a string with simple +/-/ context lines.
 */
export function diffChangelog(oldText: string, newText: string): string {
  return [...DIFF_FILE_HEADER, ...diffChangelogLines(oldText, newText)].join(
    '\n',
  );
}

/**
 * Compute the body of a changelog diff without the file header lines.
 * WHY: Callers that print their own context (such as `--check`) need the
 * diff lines alone, without depending on how many header lines precede them.
 * @param oldText Original text (left side).
 * @param newText Updated text (right side).
 * @returns Diff lines, each prefixed with ` ` (context), `-` (removed) or `+` (added).
 */
export function diffChangelogLines(oldText: string, newText: string): string[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const oldLen = oldLines.length;
  const newLen = newLines.length;

  // Fast paths / early returns
  if (oldText === newText) {
    return oldLines.map((line) => ' ' + line);
  }
  if (oldLen === 0 && newLen === 0) {
    return [];
  }
  if (oldLen === 0) {
    return newLines.map((line) => '+' + line);
  }
  if (newLen === 0) {
    return oldLines.map((line) => '-' + line);
  }

  // Build the Longest Common Subsequence (LCS) matrix.
  const lcs: number[][] = Array.from({ length: oldLen + 1 }, () =>
    Array(newLen + 1).fill(0),
  );
  for (let oldIdx = oldLen - 1; oldIdx >= 0; oldIdx--) {
    for (let newIdx = newLen - 1; newIdx >= 0; newIdx--) {
      if (oldLines[oldIdx] === newLines[newIdx]) {
        lcs[oldIdx][newIdx] = lcs[oldIdx + 1][newIdx + 1] + 1;
      } else {
        lcs[oldIdx][newIdx] = Math.max(
          lcs[oldIdx + 1][newIdx],
          lcs[oldIdx][newIdx + 1],
        );
      }
    }
  }

  // Reconstruct diff from the LCS matrix.
  const diffLines: string[] = [];
  const addContext = (line: string) => diffLines.push(' ' + line);
  const addRemoval = (line: string) => diffLines.push('-' + line);
  const addAddition = (line: string) => diffLines.push('+' + line);

  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLen && newIndex < newLen) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      addContext(oldLines[oldIndex]);
      oldIndex++;
      newIndex++;
    } else if (lcs[oldIndex + 1][newIndex] >= lcs[oldIndex][newIndex + 1]) {
      addRemoval(oldLines[oldIndex]);
      oldIndex++;
    } else {
      addAddition(newLines[newIndex]);
      newIndex++;
    }
  }
  while (oldIndex < oldLen) {
    addRemoval(oldLines[oldIndex]);
    oldIndex++;
  }
  while (newIndex < newLen) {
    addAddition(newLines[newIndex]);
    newIndex++;
  }
  return diffLines;
}
