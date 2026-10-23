/** Pure rich-document conversion and schema-boundary specs (task 2.2). */
import { describe, expect, it } from 'vitest'
import {
  assertDocumentTextLimit,
  documentToPlainText,
  documentFitsEditorLimits,
  plainTextToDocument,
  sanitizeNoteDocument,
  type NoteDocument,
} from '@/lib/noteDoc'

describe('plain text conversion', () => {
  it('keeps blank lines and a trailing line break exactly', () => {
    const plain = 'first\n\nthird\n'
    expect(documentToPlainText(plainTextToDocument(plain))).toBe(plain)
  })

  it('extracts headings, lists, task items and table cells as readable lines', () => {
    const document: NoteDocument = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
        ] },
        { type: 'taskList', content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }] },
        ] },
        { type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ] },
        ] },
      ],
    }
    expect(documentToPlainText(document)).toBe('Heading\nOne\nTwo\nDone\nA | B')
  })
})

describe('allowed document schema', () => {
  it('keeps allowed nodes and marks while dropping links, styles, images and scripts', () => {
    const sanitized = sanitizeNoteDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { style: 'color:red' },
          content: [
            { type: 'text', text: 'safe', marks: [
              { type: 'bold' },
              { type: 'link', attrs: { href: 'javascript:alert(1)' } },
              { type: 'textStyle', attrs: { color: 'red' } },
            ] },
            { type: 'image', attrs: { src: 'x', onerror: 'alert(1)' } },
          ],
        },
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      ],
    })
    expect(sanitized).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'safe', marks: [{ type: 'bold' }] }] }],
    })
  })

  it('normalizes merged cells and stored column widths', () => {
    const sanitized = sanitizeNoteDocument({
      type: 'doc',
      content: [{
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [{
            type: 'tableCell',
            attrs: { colspan: 3, rowspan: 2, colwidth: [300], style: 'color:red' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell', marks: [{ type: 'italic' }] }] }],
          }],
        }],
      }],
    })
    expect(sanitized.content[0].content?.[0].content?.[0].attrs).toEqual({ colspan: 1, rowspan: 1, colwidth: null })
  })

  it('rejects a malformed root and enforces the extracted-text cap', () => {
    expect(() => sanitizeNoteDocument(null)).toThrow('Malformed')
    expect(() => assertDocumentTextLimit(plainTextToDocument('x'.repeat(20_001)))).toThrow('20,000')
    expect(documentFitsEditorLimits({
      type: 'doc',
      content: Array.from({ length: 13_000 }, () => ({ type: 'paragraph' })),
    })).toBe(false)
  })
})
