import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resetModelStringsForTestingOnly } from '../../bootstrap/state.js'
import { getSmallFastModel } from './model.js'

// Snapshot relevant env vars so we can restore after each test
const originalEnv = {
  CLAUDE_CODE_SMALL_FAST_MODEL: process.env.CLAUDE_CODE_SMALL_FAST_MODEL,
  ANTHROPIC_SMALL_FAST_MODEL: process.env.ANTHROPIC_SMALL_FAST_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
}

function clearSmallFastEnv(): void {
  delete process.env.CLAUDE_CODE_SMALL_FAST_MODEL
  delete process.env.ANTHROPIC_SMALL_FAST_MODEL
  delete process.env.OPENAI_MODEL
  delete process.env.GEMINI_MODEL
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GITHUB
}

beforeEach(() => {
  // Force re-initialization of model strings state so each test picks up the
  // provider env var set for that test. Without this, the first test to run
  // caches a provider and later tests get stale strings.
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetModelStringsForTestingOnly()
})

describe('getSmallFastModel — env var override priority', () => {
  test('CLAUDE_CODE_SMALL_FAST_MODEL is the highest priority override', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'my-provider-agnostic-model'
    // Legacy var set too — new var should win
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'legacy-model'

    expect(getSmallFastModel()).toBe('my-provider-agnostic-model')
  })

  test('ANTHROPIC_SMALL_FAST_MODEL still works as a legacy fallback', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'legacy-migrated-from-claude-code'

    expect(getSmallFastModel()).toBe('legacy-migrated-from-claude-code')
  })

  test('overrides win across every provider (OpenAI)', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'forced-override'

    expect(getSmallFastModel()).toBe('forced-override')
  })

  test('overrides win across every provider (Gemini)', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.CLAUDE_CODE_SMALL_FAST_MODEL = 'forced-override'

    expect(getSmallFastModel()).toBe('forced-override')
  })
})

describe('getSmallFastModel — provider defaults (no overrides)', () => {
  test('Anthropic firstParty returns a Haiku model', () => {
    clearProviderEnv()
    clearSmallFastEnv()

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('OpenAI provider returns gpt-4o-mini even when OPENAI_MODEL is set to gpt-4.1', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    // User's main-loop model is expensive — small/fast must ignore it
    process.env.OPENAI_MODEL = 'gpt-4.1'

    expect(getSmallFastModel()).toBe('gpt-4o-mini')
  })

  test('OpenAI provider returns gpt-4o-mini when OPENAI_MODEL is unset', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'

    expect(getSmallFastModel()).toBe('gpt-4o-mini')
  })

  test('Gemini provider returns flash-lite even when GEMINI_MODEL is set to pro-preview', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    // User's main-loop model is expensive — small/fast must ignore it
    process.env.GEMINI_MODEL = 'gemini-2.5-pro-preview'

    expect(getSmallFastModel()).toBe('gemini-2.0-flash-lite')
  })

  test('Gemini provider returns flash-lite when GEMINI_MODEL is unset', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_GEMINI = '1'

    expect(getSmallFastModel()).toBe('gemini-2.0-flash-lite')
  })

  test('Bedrock provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

    // Bedrock IDs look like "us.anthropic.claude-haiku-4-5-...-v1:0"
    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('Vertex provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_VERTEX = '1'

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })

  test('Foundry provider returns a Haiku-family model', () => {
    clearProviderEnv()
    clearSmallFastEnv()
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'

    expect(getSmallFastModel().toLowerCase()).toContain('haiku')
  })
})

describe('getSmallFastModel — never leaks main-loop model', () => {
  // Parameterized across every non-Anthropic provider to ensure that setting
  // the user's main model env var (which may be an expensive model) never
  // bleeds into the small/fast tier used by compaction and other side-calls.
  test.each([
    ['openai', 'CLAUDE_CODE_USE_OPENAI', 'OPENAI_MODEL', 'gpt-4.1'],
    ['gemini', 'CLAUDE_CODE_USE_GEMINI', 'GEMINI_MODEL', 'gemini-2.5-pro-preview'],
  ] as const)(
    '%s: expensive main model env var does not leak into small/fast',
    (_name, providerEnv, modelEnv, expensiveModel) => {
      clearProviderEnv()
      clearSmallFastEnv()
      process.env[providerEnv] = '1'
      process.env[modelEnv] = expensiveModel

      expect(getSmallFastModel()).not.toBe(expensiveModel)
    },
  )
})
