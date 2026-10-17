import { describe, expect, it } from 'vitest'
import { fuzzyMatch, highlightSegments } from './fuzzy'
import { rowsToText, textToRows } from './bulk'
import { evaluate, filterJson, JsonPathError } from './jsonpath'
import { newKeyValue } from './factory'

describe('fuzzy matching', () => {
  const rank = (q: string, items: string[]): string[] =>
    items
      .map((t) => ({ t, m: fuzzyMatch(q, t) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .map((x) => x.t)

  it('matches in-order characters and rejects others', () => {
    expect(fuzzyMatch('gu', 'Get user')?.indices).toEqual([0, 4])
    expect(fuzzyMatch('xyz', 'Get user')).toBeNull()
  })

  it('ranks substring and word-start matches first', () => {
    expect(rank('user', ['Create user', 'List users', 'Get user', 'Update secret'])).toEqual(['Get user', 'List users', 'Create user'])
    expect(rank('lu', ['Login', 'List users', 'Flux'])[0]).toBe('List users')
    expect(rank('env', ['Switch environment: Staging', 'New request'])).toEqual(['Switch environment: Staging'])
    expect(fuzzyMatch('user', 'Use no environment')).toBeNull()
    expect(fuzzyMatch('cs', 'Collection settings: Shop')?.indices).toEqual([0, 11])
    expect(fuzzyMatch('rcol', 'Run collection: Shop')).not.toBeNull()
  })

  it('splits text into highlight segments', () => {
    expect(highlightSegments('Get user', [0, 4])).toEqual([
      { text: 'G', hit: true },
      { text: 'et ', hit: false },
      { text: 'u', hit: true },
      { text: 'ser', hit: false }
    ])
  })
})

describe('bulk edit', () => {
  it('round-trips rows, keeping ids, descriptions and disabled state', () => {
    const rows = [
      { ...newKeyValue('Authorization', 'Bearer abc'), description: 'auth' },
      { ...newKeyValue('X-Trace', '1'), enabled: false },
      newKeyValue('Accept', 'application/json')
    ]
    const text = rowsToText(rows)
    expect(text).toBe('Authorization: Bearer abc\n// X-Trace: 1\nAccept: application/json')
    const back = textToRows(text, rows)
    expect(back).toEqual(rows)
  })

  it('parses key=value, values containing separators, comments and blank lines', () => {
    const rows = textToRows('page=2\nredirect=https://x.io/a?b=1\n\n# off: yes\nX-Time: 12:30\nflag', [])
    expect(rows.map((r) => [r.key, r.value, r.enabled])).toEqual([
      ['page', '2', true],
      ['redirect', 'https://x.io/a?b=1', true],
      ['off', 'yes', false],
      ['X-Time', '12:30', true],
      ['flag', '', true]
    ])
  })
})

describe('JSONPath', () => {
  const doc = {
    store: {
      book: [
        { category: 'reference', author: 'Nigel Rees', title: 'Sayings', price: 8.95 },
        { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword', price: 12.99, isbn: '0-553' },
        { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', price: 8.99, isbn: '0-679' }
      ],
      bicycle: { color: 'red', price: 19.95 }
    },
    'odd key': [1, 2, 3]
  }

  it('handles names, indexes, wildcards and recursion', () => {
    expect(evaluate(doc, '$.store.book[0].title')).toEqual(['Sayings'])
    expect(evaluate(doc, '$.store.book[-1].author')).toEqual(['Herman Melville'])
    expect(evaluate(doc, '$.store.book[*].author')).toHaveLength(3)
    expect(evaluate(doc, '$..price')).toEqual([8.95, 12.99, 8.99, 19.95])
    expect(evaluate(doc, "$['odd key'][1]")).toEqual([2])
    expect(evaluate(doc, '$.store.book[0,2].title')).toEqual(['Sayings', 'Moby Dick'])
    expect(evaluate(doc, '$.store.book[:2].price')).toEqual([8.95, 12.99])
    expect(evaluate(doc, '$.store.book.length')).toEqual([3])
  })

  it('supports filters with comparisons, existence, regex and boolean logic', () => {
    expect(evaluate(doc, '$.store.book[?(@.price < 10)].title')).toEqual(['Sayings', 'Moby Dick'])
    expect(evaluate(doc, '$.store.book[?(@.isbn)].title')).toEqual(['Sword', 'Moby Dick'])
    expect(evaluate(doc, "$.store.book[?(@.category == 'fiction' && @.price > 10)].title")).toEqual(['Sword'])
    expect(evaluate(doc, '$.store.book[?(@.author =~ /melville/i)].title')).toEqual(['Moby Dick'])
    expect(evaluate(doc, "$..book[?(@.price > 12 || @.category == 'reference')].title")).toEqual(['Sayings', 'Sword'])
  })

  it('accepts jq-style paths and reports bad input clearly', () => {
    expect(evaluate(doc, '.store.bicycle.color')).toEqual(['red'])
    expect(evaluate(doc, 'store.book[1].title')).toEqual(['Sword'])
    expect(filterJson(JSON.stringify(doc), '.store.bicycle')).toEqual({ result: { color: 'red', price: 19.95 }, count: 1 })
    expect(filterJson(JSON.stringify(doc), '$..isbn')).toEqual({ result: ['0-553', '0-679'], count: 2 })
    expect(() => evaluate(doc, '$.store.book[')).toThrow(JsonPathError)
    expect(() => filterJson('not json', '$')).toThrow(SyntaxError)
  })
})
