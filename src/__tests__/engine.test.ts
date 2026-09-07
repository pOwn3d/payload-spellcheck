import { describe, it, expect } from 'vitest'
import { extractTextFromLexical, countWords } from '../engine/lexicalParser.js'
import {
  filterFalsePositives,
  calculateScore,
  DEFAULT_SKIP_RULES,
  DEFAULT_SKIP_CATEGORIES,
} from '../engine/filters.js'
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
    contextOffset: 0,
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

  it('should filter premium rules', async () => {
    const issues = [{ ...baseIssue, isPremium: true }]
    expect(await filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter default skip rules', async () => {
    const issues = [{ ...baseIssue, ruleId: 'WHITESPACE_RULE' }]
    expect(await filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter custom skip rules', async () => {
    const issues = [{ ...baseIssue, ruleId: 'CUSTOM_SKIP_RULE' }]
    expect(await filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter skip categories', async () => {
    const issues = [{ ...baseIssue, category: 'STYLE' }]
    expect(await filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should filter custom dictionary words', async () => {
    const issues = [{ ...baseIssue, original: 'TypeScript' }]
    expect(await filterFalsePositives(issues, config)).toHaveLength(0)
  })

  it('should keep valid issues', async () => {
    const issues = [baseIssue]
    expect(await filterFalsePositives(issues, config)).toHaveLength(1)
  })

  it('should handle empty config', async () => {
    const issues = [baseIssue]
    expect(await filterFalsePositives(issues, {})).toHaveLength(1)
  })

  // Regression: the whole point of this plugin is reporting misspellings.
  // 'TYPOS' (English) and MORFOLOGIK_RULE_FR_FR (French) used to sit in the
  // default skip lists, so every spelling mistake was discarded before ever
  // reaching the user. Guard both, with an empty config so only defaults apply.
  it('should report English spelling mistakes by default', async () => {
    const issues = [
      { ...baseIssue, ruleId: 'MORFOLOGIK_RULE_EN_US', category: 'TYPOS', original: 'recieve' },
    ]
    expect(await filterFalsePositives(issues, {})).toHaveLength(1)
  })

  it('should report French spelling mistakes by default', async () => {
    const issues = [
      { ...baseIssue, ruleId: 'MORFOLOGIK_RULE_FR_FR', category: 'TYPOS', original: 'developement' },
    ]
    expect(await filterFalsePositives(issues, {})).toHaveLength(1)
  })

  it('should still let a consumer opt back into skipping spelling', async () => {
    const issues = [
      { ...baseIssue, ruleId: 'MORFOLOGIK_RULE_FR_FR', category: 'TYPOS', original: 'developement' },
    ]
    expect(await filterFalsePositives(issues, { skipCategories: ['TYPOS'] })).toHaveLength(0)
  })

  // Regression: skipRules/skipCategories are additive, so before
  // overrideDefaultSkip* no default entry could be removed without forking.
  it('should let a consumer remove a default skip rule', async () => {
    const issues = [{ ...baseIssue, ruleId: 'DASH_RULE' }]
    // Default behaviour: filtered out.
    expect(await filterFalsePositives(issues, {})).toHaveLength(0)
    // Override: the same rule now reaches the user.
    const overridden = await filterFalsePositives(issues, {
      overrideDefaultSkipRules: DEFAULT_SKIP_RULES.filter((r) => r !== 'DASH_RULE'),
    })
    expect(overridden).toHaveLength(1)
  })

  it('should let a consumer remove a default skip category', async () => {
    const issues = [{ ...baseIssue, category: 'TYPOGRAPHY' }]
    expect(await filterFalsePositives(issues, {})).toHaveLength(0)
    const overridden = await filterFalsePositives(issues, {
      overrideDefaultSkipCategories: DEFAULT_SKIP_CATEGORIES.filter((c) => c !== 'TYPOGRAPHY'),
    })
    expect(overridden).toHaveLength(1)
  })

  it('should disable all default filtering with an empty override', async () => {
    const issues = [{ ...baseIssue, ruleId: 'WHITESPACE_RULE' }]
    expect(await filterFalsePositives(issues, { overrideDefaultSkipRules: [] })).toHaveLength(1)
  })

  it('should keep skipRules additive on top of an override', async () => {
    const issues = [{ ...baseIssue, ruleId: 'WHITESPACE_RULE' }]
    const filtered = await filterFalsePositives(issues, {
      overrideDefaultSkipRules: [],
      skipRules: ['WHITESPACE_RULE'],
    })
    expect(filtered).toHaveLength(0)
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
