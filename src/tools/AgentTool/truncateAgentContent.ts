import { DEFAULT_MAX_RESULT_SIZE_CHARS } from '../../constants/toolLimits.js'

/**
 * Truncate an array of text content blocks so the total character count
 * stays within `maxChars`. Keeps the *tail* (most recent output) and
 * prepends a truncation notice when content is trimmed.
 */
export function truncateAgentContent(
  content: Array<{ type: 'text'; text: string }>,
  maxChars: number = DEFAULT_MAX_RESULT_SIZE_CHARS,
): Array<{ type: 'text'; text: string }> {
  const totalChars = content.reduce((sum, block) => sum + block.text.length, 0)
  if (totalChars <= maxChars) {
    return content
  }
  const truncationNote = `[Result truncated: ${totalChars} chars exceeded ${maxChars} char limit. Showing final portion.]`
  const budget = maxChars - truncationNote.length
  const kept: Array<{ type: 'text'; text: string }> = []
  let remaining = budget
  for (let i = content.length - 1; i >= 0 && remaining > 0; i--) {
    const block = content[i]!
    if (block.text.length <= remaining) {
      kept.unshift(block)
      remaining -= block.text.length
    } else {
      kept.unshift({
        type: 'text' as const,
        text: block.text.slice(block.text.length - remaining),
      })
      remaining = 0
    }
  }
  kept.unshift({ type: 'text' as const, text: truncationNote })
  return kept
}
