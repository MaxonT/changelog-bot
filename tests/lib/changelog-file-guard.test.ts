// WHY: readChangelog() must keep working when the caught value is not an object.
// The real filesystem only throws Error objects, so node:fs has to be mocked to
// feed it a primitive or null throw.

// @ts-ignore: ESM mocking API is available at runtime; typings for unstable_mockModule are missing in @types/jest.
import { jest } from '@jest/globals';

const readFileSyncMock = jest.fn<() => string>();
const writeFileSyncMock = jest.fn();

// @ts-ignore: unstable_mockModule typings are missing in @types/jest.
jest.unstable_mockModule('node:fs', () => ({
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
}));

const { beforeEach, describe, expect, test } = await import('@jest/globals');
const { readChangelog } = await import('@/lib/changelog-file.js');

/**
 * Run a function and return whatever it threw, keeping the thrown value intact.
 * @param run Function expected to throw.
 * @returns The thrown value.
 */
function captureThrow(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error('expected the function to throw');
}

describe('readChangelog error handling', () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  test('returns an empty string for ENOENT file errors', () => {
    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    expect(readChangelog('CHANGELOG.md')).toBe('');
  });

  test('rethrows non-ENOENT filesystem errors unchanged', () => {
    const permissionError = Object.assign(new Error('denied'), {
      code: 'EACCES',
    });
    readFileSyncMock.mockImplementation(() => {
      throw permissionError;
    });

    expect(captureThrow(() => readChangelog('CHANGELOG.md'))).toBe(
      permissionError,
    );
  });

  test('rethrows a string throw unchanged', () => {
    readFileSyncMock.mockImplementation(() => {
      throw 'boom';
    });

    expect(captureThrow(() => readChangelog('CHANGELOG.md'))).toBe('boom');
  });

  test('rethrows a null throw unchanged', () => {
    readFileSyncMock.mockImplementation(() => {
      throw null;
    });

    expect(captureThrow(() => readChangelog('CHANGELOG.md'))).toBeNull();
  });

  test('rethrows an error without a code property unchanged', () => {
    const plainError = new Error('no code');
    readFileSyncMock.mockImplementation(() => {
      throw plainError;
    });

    expect(captureThrow(() => readChangelog('CHANGELOG.md'))).toBe(plainError);
  });
});
