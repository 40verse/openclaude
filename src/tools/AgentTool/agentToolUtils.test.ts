import { describe, expect, test } from 'bun:test'
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from '../../constants/toolLimits.js'
import { truncateAgentContent } from './truncateAgentContent.js'

describe('truncateAgentContent', () => {
  test('returns content unchanged when under the limit', () => {
    const content = [
      { type: 'text' as const, text: 'Hello world' },
      { type: 'text' as const, text: 'Second block' },
    ]
    const result = truncateAgentContent(content)
    expect(result).toEqual(content)
  })

  test('returns content unchanged when exactly at the limit', () => {
    const text = 'x'.repeat(DEFAULT_MAX_RESULT_SIZE_CHARS)
    const content = [{ type: 'text' as const, text }]
    const result = truncateAgentContent(content)
    expect(result).toEqual(content)
  })

  test('truncates content over the limit to within budget', () => {
    const overSize = DEFAULT_MAX_RESULT_SIZE_CHARS + 10_000
    const content = [{ type: 'text' as const, text: 'a'.repeat(overSize) }]
    const result = truncateAgentContent(content)

    const resultChars = result.reduce((sum, b) => sum + b.text.length, 0)
    // Total output (including truncation note) should stay within a
    // reasonable bound of the limit.
    expect(resultChars).toBeLessThanOrEqual(
      DEFAULT_MAX_RESULT_SIZE_CHARS + 200,
    )
  })

  test('prepends truncation message when truncating', () => {
    const limit = 200
    const content = [{ type: 'text' as const, text: 'x'.repeat(500) }]
    const result = truncateAgentContent(content, limit)

    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0]!.text).toContain(
      '[Result truncated: 500 chars exceeded 200 char limit.',
    )
  })

  test('keeps tail blocks and trims front blocks', () => {
    // Use a large enough limit that the truncation note doesn't eat
    // significantly into the budget for the content blocks we care about.
    const limit = 500
    const content = [
      { type: 'text' as const, text: 'A'.repeat(300) },
      { type: 'text' as const, text: 'B'.repeat(200) },
      { type: 'text' as const, text: 'C'.repeat(100) },
    ]
    // total = 600, over limit of 500
    const result = truncateAgentContent(content, limit)

    // The last block (C's) should be fully preserved
    const lastBlock = result[result.length - 1]!
    expect(lastBlock.text).toBe('C'.repeat(100))

    // The second-to-last block (B's) should be fully preserved
    const secondLast = result[result.length - 2]!
    expect(secondLast.text).toBe('B'.repeat(200))

    // First block is the truncation notice
    expect(result[0]!.text).toContain('[Result truncated:')

    // A block should be partially truncated (only tail kept)
    const aBlock = result[1]!
    expect(aBlock.text).toMatch(/^A+$/)
    expect(aBlock.text.length).toBeLessThan(300)
  })

  test('handles multiple blocks with partial truncation', () => {
    const limit = 500
    const content = [
      { type: 'text' as const, text: 'A'.repeat(300) },
      { type: 'text' as const, text: 'B'.repeat(300) },
    ]
    // total = 600, over limit of 500
    const result = truncateAgentContent(content, limit)

    expect(result[0]!.text).toContain('[Result truncated:')
    // Total output should be within the limit + truncation note overhead
    const totalOut = result.reduce((s, b) => s + b.text.length, 0)
    expect(totalOut).toBeLessThanOrEqual(limit + 200)
  })
})
