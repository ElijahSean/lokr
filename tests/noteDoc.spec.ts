/** Pure rich-document conversion and schema-boundary specs (task 2.2). */
import { describe, expect, it } from 'vitest'
import {
  assertDocumentTextLimit,
  documentToPlainText,
  documentFitsEditorLimits,
  findAllowedNoteUrls,
  isAllowedNoteUrl,
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
  it('keeps allowed nodes and marks while dropping unsafe links, styles, images and scripts', () => {
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

  it('keeps web links, replaces a concealed label, and strips unsafe stored links', () => {
    const sanitized = sanitizeNoteDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bank', marks: [{ type: 'link', attrs: { href: 'https://evil.example', target: '_self' } }] },
          { type: 'text', text: '.com', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://evil.example' } }] },
          { type: 'text', text: ' unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        ],
      }],
    })

    expect(sanitized).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'https://evil.example', marks: [{ type: 'link', attrs: { href: 'https://evil.example' } }] },
          { type: 'text', text: ' unsafe' },
        ],
      }],
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

describe('note URL validation', () => {
  it.each([
    'http://example.com',
    'https://example.com/path?q=1',
    'HTTPS://EXAMPLE.COM/path',
  ])('allows an explicit web URL: %s', value => {
    expect(isAllowedNoteUrl(value)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'file:///C:/secret.txt',
    'mailto:x@example.com',
    'tel:+15551212',
    'www.example.com',
    'example.com',
    'https://',
    ' https://example.com',
  ])('refuses a non-web or malformed URL: %s', value => {
    expect(isAllowedNoteUrl(value)).toBe(false)
  })

  it('finds explicit web URLs without their trailing sentence punctuation', () => {
    expect(findAllowedNoteUrls('see https://example.com/path?q=1, then HTTPS://EXAMPLE.COM.')).toEqual([
      { href: 'https://example.com/path?q=1', from: 4, to: 32 },
      { href: 'HTTPS://EXAMPLE.COM', from: 39, to: 58 },
    ])
  })
})
