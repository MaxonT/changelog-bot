import { readFileSync, writeFileSync } from 'node:fs';
import { isRecord } from '@/utils/is.js';

const CHANGELOG_FILE_ENCODING = 'utf8';

/** Content and existence state read from a changelog path. */
export type ChangelogFileSnapshot = {
  /** Whether the changelog file existed when it was read. */
  exists: boolean;
  /** UTF-8 changelog content; empty when the file does not exist. */
  content: string;
};

/**
 * Read changelog content together with its existence state.
 * WHY: Check mode must distinguish a missing file from an empty changelog.
 * @param path Absolute or relative path to the changelog file.
 * @returns File existence flag and UTF-8 content.
 */
export function readChangelogSnapshot(path: string): ChangelogFileSnapshot {
  try {
    return {
      exists: true,
      content: readFileSync(path, CHANGELOG_FILE_ENCODING),
    };
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return { exists: false, content: '' };
    }

    throw error;
  }
}

/**
 * Read changelog content from a file path.
 * @param path Absolute or relative path to the changelog file.
 * @returns Changelog text; returns an empty string when the file does not exist.
 */
export function readChangelog(path: string): string {
  return readChangelogSnapshot(path).content;
}

/**
 * Write changelog text to disk, overwriting any existing content.
 * @param path Destination file path.
 * @param content Changelog text to write.
 */
export function writeChangelog(path: string, content: string) {
  writeFileSync(path, content, CHANGELOG_FILE_ENCODING);
}
