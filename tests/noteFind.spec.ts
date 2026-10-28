import { getSchema } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import {
  FIND_DRAW_LIMIT,
  buildFindIndex,
  drawnMatchRange,
  findMatches,
  findTextRuns,
  matchAtOrAfter,
  normalizeFindTerm,
  stepMatch,
} from '@/lib/noteFind'
import type { NoteDocNode } from '@/lib/noteDoc'

// The editor's node rules (components/NoteEditor.tsx), built without a browser.
// StarterKit's plain code block stands in for the highlighted one: same node, same text.
const schema = getSchema([
  StarterKit.configure({ blockquote: false, code: false, horizontalRule: false, heading: { levels: [1, 2] } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
])

const text = (value: string, marks?: NoteDocNode['marks']): NoteDocNode => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value })
const paragraph = (...content: NoteDocNode[]): NoteDocNode => ({ type: 'paragraph', content })
const doc = (...content: NoteDocNode[]) => ProseMirrorNode.fromJSON(schema, { type: 'doc', content })

function find(node: ProseMirrorNode, term: string) {
  return findMatches(buildFindIndex(findTextRuns(node)), term).map(range => node.textBetween(range.from, range.to))
}

describe('find in an open note (task 2.9)', () => {
  const everyBlock = doc(
    paragraph(text('Key in a paragraph')),
    { type: 'heading', attrs: { level: 1 }, content: [text('KEY heading')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('list key'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph(text('task kEy'))] }] },
    {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('cell key'))] }] }],
    },
    { type: 'codeBlock', attrs: { language: 'plaintext' }, content: [text('const key = 1')] },
    paragraph(text('https://key.example', [{ type: 'link', attrs: { href: 'https://key.example' } }])),
  )

  it('finds the term in every block type, ignoring case', () => {
    expect(find(everyBlock, 'key')).toEqual(['Key', 'KEY', 'key', 'kEy', 'key', 'key', 'key'])
    expect(find(everyBlock, 'KEY')).toHaveLength(7)
  })

  it('counts a word split across bold and plain text once', () => {
    const node = doc(paragraph(text('pass', [{ type: 'bold' }]), text('word here')))
    expect(find(node, 'password')).toEqual(['password'])
  })

  it('never matches across blocks or a hard break', () => {
    expect(find(doc(paragraph(text('foo')), paragraph(text('bar'))), 'foobar')).toEqual([])
    expect(find(doc(paragraph(text('foo'), { type: 'hardBreak' }, text('bar'))), 'foobar')).toEqual([])
    expect(find(doc(paragraph(text('foo'), { type: 'hardBreak' }, text('bar'))), 'bar')).toEqual(['bar'])
  })

  it('maps a lowercase that changes length exactly onto the document', () => {
    // İ lowercases to two UTF-16 units; the following match must not shift
    const node = doc(paragraph(text('İstanbul İ key')))
    expect('İ'.toLowerCase()).toHaveLength(2)
    expect(find(node, 'key')).toEqual(['key'])
    expect(find(node, 'i̇stanbul')).toEqual(['İstanbul'])
    expect(find(node, 'istanbul')).toEqual([])
    // A term ending on half of the expanded character still selects the whole character
    expect(find(node, 'i')).toEqual(['İ', 'İ'])
  })

  it('does not overlap candidates', () => {
    expect(find(doc(paragraph(text('aaa'))), 'aa')).toHaveLength(1)
    expect(find(doc(paragraph(text('aaaa'))), 'aa')).toHaveLength(2)
  })

  it('treats an empty or spaces-only term as nothing to find', () => {
    expect(normalizeFindTerm('')).toBe('')
    expect(normalizeFindTerm('   ')).toBe('')
    expect(find(everyBlock, '')).toEqual([])
    expect(find(everyBlock, '  ')).toEqual([])
  })

  it('keeps inner spaces as typed', () => {
    expect(find(doc(paragraph(text('a key, akey'))), ' key')).toEqual([' key'])
  })

  it('returns nothing for a missing term', () => {
    expect(find(everyBlock, 'absent')).toEqual([])
  })

  it('returns matches in document order', () => {
    const ranges = findMatches(buildFindIndex(findTextRuns(everyBlock)), 'key')
    expect(ranges.map(range => range.from)).toEqual([...ranges.map(range => range.from)].sort((a, b) => a - b))
  })

  it('steps and wraps at both ends', () => {
    expect(stepMatch(0, 3, 1)).toBe(1)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(-1, 3, -1)).toBe(2)
    expect(stepMatch(-1, 0, 1)).toBe(-1)
  })

  it('picks the first match at or after a position, wrapping to the first', () => {
    const matches = [{ from: 5, to: 8 }, { from: 20, to: 23 }]
    expect(matchAtOrAfter(matches, 0)).toBe(0)
    expect(matchAtOrAfter(matches, 6)).toBe(1)
    expect(matchAtOrAfter(matches, 30)).toBe(0)
    expect(matchAtOrAfter([], 0)).toBe(-1)
  })

  it('draws at most 1,000 highlights, centred on the current match', () => {
    expect(FIND_DRAW_LIMIT).toBe(1000)
    expect(drawnMatchRange(8, 3)).toEqual({ start: 0, end: 8 })
    expect(drawnMatchRange(7200, 0)).toEqual({ start: 0, end: 1000 })
    expect(drawnMatchRange(7200, 3000)).toEqual({ start: 2500, end: 3500 })
    expect(drawnMatchRange(7200, 7199)).toEqual({ start: 6200, end: 7200 })
    expect(drawnMatchRange(7200, -1)).toEqual({ start: 0, end: 1000 })
  })

  it('updates a 100,000-character note in under 50 ms per keystroke', () => {
    const line = 'recovery code ABCD-1234 for the account, '
    const lines = Array.from({ length: Math.ceil(100_000 / 2000) }, () => paragraph(text(line.repeat(Math.ceil(2000 / line.length)).slice(0, 2000))))
    const node = doc(...lines)
    expect(node.textContent.length).toBeGreaterThanOrEqual(100_000)
    // An edit rebuilds the index; each keystroke in the box is one search
    const started = performance.now()
    const index = buildFindIndex(findTextRuns(node))
    let count = 0
    for (const term of ['r', 're', 'rec', 'reco', 'recov']) count = findMatches(index, term).length
    const perKeystroke = (performance.now() - started) / 5
    expect(count).toBeGreaterThan(0)
    expect(perKeystroke).toBeLessThan(50)
  })
})
