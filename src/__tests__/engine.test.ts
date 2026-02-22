import { describe, it, expect } from 'vitest'
import { extractTextFromLexical, countWords } from '../engine/lexicalParser.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'
import type { SpellCheckIssue, SpellCheckPluginConfig } from '../types.js'

// --- Lexical Parser Tests ---

describe('extractTextFromLexical', () => {
  it('should extract text from simple text node', () => {
    const node = {
      root: {
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'Hello world' },
            ],
          },
        ],
      },
    }
    expect(extractTextFromLexical(node)).toBe('Hello world')
  })

  it('should handle nested paragraphs', () => {
    const node = {
      root: {
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'First paragraph.' },
            ],
          },
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'Second paragraph.' },
            ],
          },
        ],
      },
    }
    const text = extractTextFromLexical(node)
    expect(text).toContain('First paragraph.')
    expect(text).toContain('Second paragraph.')
  })

  it('should skip code blocks', () => {
    const node = {
      root: {
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Normal text' }],
          },
          {
            type: 'code',
            children: [{ type: 'text', text: 'const x = 1' }],
          },
        ],
      },
    }
    const text = extractTextFromLexical(node)
    expect(text).toContain('Normal text')
    expect(text).not.toContain('const x')
  })

  it('should handle empty input', () => {
    expect(extractTextFromLexical(null)).toBe('')
    expect(extractTextFromLexical(undefined)).toBe('')
    expect(extractTextFromLexical({})).toBe('')
  })

  it('should handle deeply nested structures', () => {
    const node = {
      root: {
        children: [
          {
            type: 'listitem',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: 'Item 1' },
                ],
              },
            ],
          },
        ],
      },
    }
    expect(extractTextFromLexical(node)).toContain('Item 1')
  })

  it('should respect maxDepth', () => {
    // Build a deeply nested structure
    let current: Record<string, unknown> = { type: 'text', text: 'deep text' }
    for (let i = 0; i < 60; i++) {
      current = { type: 'paragraph', children: [current] }
    }
    const node = { root: current }
    // With default maxDepth of 50, the deep text should be skipped
    const text = extractTextFromLexical(node, 5)
    expect(text).not.toContain('deep text')
  })
})

describe('countWords', () => {
  it('should count words correctly', () => {
    expect(countWords('Hello world')).toBe(2)
    expect(countWords('Un deux trois quatre')).toBe(4)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })
})

// --- Filter Tests ---

describe('filterFalsePositives', () => {
  const baseIssue: SpellCheckIssue = {
    ruleId: 'GRAMMAR',
    category: 'GRAMMAR',
    message: 'Test issue',
    context: 'test context',
    offset: 0,
    length: 4,
    original: 'test',
    replacements: ['correct'],
    source: 'languagetool',
  }

  const config: SpellCheckPluginConfig = {
    skipRules: ['CUSTOM_SKIP_RULE'],
    skipCategories: ['STYLE'],
    customDictionary: ['TypeScript', 'Payload'],
  }

  it('should filter premium rules', () => {
    const issues = [{ ...baseIssue, isPremium: true }]
    expect(filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter default skip rules', () => {
    const issues = [{ ...baseIssue, ruleId: 'WHITESPACE_RULE' }]
    expect(filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter custom skip rules', () => {
    const issues = [{ ...baseIssue, ruleId: 'CUSTOM_SKIP_RULE' }]
    expect(filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter skip categories', () => {
    const issues = [{ ...baseIssue, category: 'STYLE' }]
    expect(filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter custom dictionary words', () => {
    const issues = [{ ...baseIssue, original: 'TypeScript' }]
    expect(filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should keep valid issues', () => {
    const issues = [baseIssue]
    expect(filterFalsePositives(issues, config)).toHaveLength(1)
  })

  it('should handle empty config', () => {
    const issues = [baseIssue]
    expect(filterFalsePositives(issues, {})).toHaveLength(1)
  })
})

describe('calculateScore', () => {
  it('should return 100 for no issues', () => {
    expect(calculateScore(500, 0)).toBe(100)
  })

  it('should return 100 for empty text', () => {
    expect(calculateScore(0, 0)).toBe(100)
  })

  it('should decrease with more issues', () => {
    const s1 = calculateScore(100, 1)
    const s2 = calculateScore(100, 5)
    expect(s1).toBeGreaterThan(s2)
  })

  it('should never go below 0', () => {
    expect(calculateScore(10, 100)).toBe(0)
  })

  it('should never exceed 100', () => {
    expect(calculateScore(1000, 0)).toBe(100)
  })
})
