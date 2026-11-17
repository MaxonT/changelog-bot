import { isArray } from '@/utils/is.js';
import {
  CONVENTIONAL_BREAKING_PREFIX_RE,
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
 * Pattern matching an unindented Conventional Commit breaking change footer.
 * WHY: Conventional Commits 1.0.0 requires uppercase tokens ('BREAKING CHANGE'
 * or 'BREAKING-CHANGE') followed by ': ' and a non-empty description.
 */
const BREAKING_FOOTER_TOKEN_PATTERN =
  /^(?:BREAKING CHANGE|BREAKING-CHANGE):\s+(\S.*)$/;

/**
 * Check whether a commit body contains an authentic Conventional Commit breaking change footer.
 * WHY: Distinguishes genuine unindented footer declarations from lowercase tokens,
 * empty descriptions, and indented examples embedded in documentation or prose.
 * @param body Full commit body text (excluding subject).
 * @returns True when an explicit breaking change footer is declared.
 */
export function hasConventionalBreakingFooter(body?: string): boolean {
  if (!body || !body.trim()) return false;

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    // Footer tokens MUST NOT be indented (e.g. 4-space indented code blocks or examples)
    if (line.startsWith(' ') || line.startsWith('\t')) {
      continue;
    }
    if (BREAKING_FOOTER_TOKEN_PATTERN.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a commit subject or body contains an explicit breaking change declaration.
 * @param subject Commit subject line.
 * @param body Optional commit body text.
 * @returns True when a breaking prefix ('type!:') or breaking footer is present.
 */
export function hasConventionalBreakingDeclaration(
  subject: string,
  body?: string,
): boolean {
  return (
    CONVENTIONAL_BREAKING_PREFIX_RE.test(subject) ||
    hasConventionalBreakingFooter(body)
  );
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
