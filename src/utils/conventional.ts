import { isArray } from '@/utils/is.js';
import {
  CONVENTIONAL_BREAKING_FOOTER_RE,
  GIT_REVERT_SUBJECT_RE,
} from '@/constants/conventional.js';

/**
 * Build a flexible conventional prefix regex that accepts optional scope and
 * optional breaking marker `!` before the colon.
 * WHY: This is a reusable helper used by multiple modules; keeping it in utils
 * avoids coupling regex construction to constants definitions.
 * @param types Single commit type or list of types (e.g., 'feat' or ['feat','fix']).
 * @returns Case-insensitive RegExp matching the conventional prefix portion.
 */
export function flexPrefixRe(types: string | string[]): RegExp {
  const body = isArray(types) ? types.join('|') : types;
  // Matches: "type!:", "type(scope):", "type(scope)!:" (no space between type and scope)
  // Pattern: ^(type)(!:|(\(scope\))?:|(\(scope\))!:) with non-capturing alternation for scope and breaking marker
  return new RegExp(`^(${body})(?:!:|(?:\\([^)]*\\))?!?:)`, 'i');
}

/**
 * Check whether text contains a Conventional Commit breaking change footer.
 * @param text Optional commit body, footer, or full commit message.
 * @returns True when a breaking change footer is present.
 */
export function hasBreakingFooter(text?: string): boolean {
  return Boolean(text && CONVENTIONAL_BREAKING_FOOTER_RE.test(text));
}

/**
 * Extract a breaking change footer line from commit text.
 * WHY: Surfacing breaking change footers to LLMs or diagnostics clarifies
 * why a commit was assigned to Breaking Changes without dumping entire bodies.
 * @param text Commit body or full message.
 * @returns Extracted breaking change footer string or null when absent.
 */
export function extractBreakingChangeFooter(text?: string): string | null {
  if (!text) return null;
  const match = CONVENTIONAL_BREAKING_FOOTER_RE.exec(text);
  if (!match) return null;
  const matchedLine = text.slice(match.index).split(/\r?\n/)[0]?.trim();
  return matchedLine || null;
}

/**
 * Check whether a title or subject line represents a git revert.
 * WHY: Covers both Conventional Commit `revert:` / `revert(scope):` and standard
 * `git revert` subjects (`Revert "<subject>"`), preventing false keyword classification.
 * @param rawTitle Commit subject or PR title.
 * @returns True when the title indicates a revert commit.
 */
export function isRevertTitle(rawTitle: string): boolean {
  const trimmed = rawTitle.trim();
  return (
    GIT_REVERT_SUBJECT_RE.test(trimmed) ||
    flexPrefixRe('revert').test(trimmed) ||
    /^revert\s+(?:commit\b|pr\b|#\d+)/i.test(trimmed)
  );
}
