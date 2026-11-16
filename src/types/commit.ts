// Minimal commit shape used across utils and libs
export type CommitLite = {
  /** Short commit SHA returned by git log. */
  sha: string;
  /** Commit subject line used for changelog entries. */
  subject: string;
  /** Optional commit body text including footers. */
  body?: string;
};
