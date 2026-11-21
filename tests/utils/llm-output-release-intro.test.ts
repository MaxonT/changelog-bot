// @ts-nocheck
import { describe, expect, test } from '@jest/globals';
import { buildChangelogLlmOutput } from '@/utils/llm-output.js';

const provider = {
  name: 'openai',
  modelName: 'mock',
  supports: {
    jsonMode: true,
    streaming: false,
    reasoning: false,
    maxOutputTokens: 1000,
  },
  generate: async () => {
    throw new Error('Unexpected model call');
  },
  classifyChanges: async () => {
    throw new Error('Unexpected classification call');
  },
};

describe('llm-output release intro', () => {
  test('keeps release-note text written before the first heading', async () => {
    const result = await buildChangelogLlmOutput({
      owner: 'octo',
      repo: 'repo',
      version: '1.0.0',
      date: '2024-01-01',
      releaseRef: 'v1.0.0',
      prevRef: 'v0.9.0',
      releaseBody: [
        'Thanks to everyone who helped ship this release.',
        '',
        'Upgrading is a drop-in change.',
        '',
        "## What's Changed",
        '- feat: add feature by @alice in https://github.com/octo/repo/pull/7',
      ].join('\n'),
      language: 'en',
      existingChangelog: '',
      commitList: [],
      prs: '',
      prMapBySha: {},
      titleToPr: {},
      provider,
      providerConfig: { apiKey: '', model: 'mock-model' },
      hasProviderKey: false,
      token: undefined,
      githubApiBase: 'https://api.github.com',
      noAi: true,
      requireProvider: false,
      failOnLlmError: false,
    });

    expect(result.llm.new_section_markdown).toContain(
      [
        '## [v1.0.0] - 2024-01-01',
        '',
        'Thanks to everyone who helped ship this release.',
        '',
        'Upgrading is a drop-in change.',
        '',
        '### Added',
      ].join('\n'),
    );
  });
});
