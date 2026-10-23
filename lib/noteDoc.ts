/**
 * lib/noteDoc.ts — the allowed rich-document format for encrypted notes
 *
 * This module is deliberately independent of Tiptap. The editor is an input
 * surface, not the trust boundary: every loaded and saved document is reduced
 * to this small schema before it can reach IndexedDB. That keeps future editor
 * upgrades from quietly widening what encrypted notes may contain.
 */

export const NOTE_TEXT_MAX = 20_000
// Leaves room inside the encrypted blob's 256 KiB cap for title and presentation fields.
export const NOTE_DOCUMENT_MAX_BYTES = 250 * 1024

export const NOTE_FONT_FAMILIES = ['sans', 'serif', 'mono'] as const
export type NoteFontFamily = typeof NOTE_FONT_FAMILIES[number]
export const DEFAULT_NOTE_FONT_FAMILY: NoteFontFamily = 'sans'

export const NOTE_FONT_SIZES = ['small', 'normal', 'large'] as const
export type NoteFontSize = typeof NOTE_FONT_SIZES[number]
export const DEFAULT_NOTE_FONT_SIZE: NoteFontSize = 'normal'

const INLINE_MARKS = ['bold', 'italic', 'underline', 'strike'] as const
type NoteMarkType = typeof INLINE_MARKS[number]

export interface NoteDocMark {
  type: NoteMarkType
}

/** Structurally compatible with Tiptap's JSONContent, without importing the editor into pure tests. */
export interface NoteDocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: NoteDocNode[]
  text?: string
  marks?: NoteDocMark[]
}

export interface NoteDocument extends NoteDocNode {
  type: 'doc'
  content: NoteDocNode[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markKey(marks: NoteDocMark[] | undefined): string {
  return marks?.map(mark => mark.type).join('|') ?? ''
}

function sanitizeMarks(value: unknown): NoteDocMark[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<NoteMarkType>()
  const marks: NoteDocMark[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.type !== 'string') continue
    if (!(INLINE_MARKS as readonly string[]).includes(candidate.type)) continue
    const type = candidate.type as NoteMarkType
    if (!seen.has(type)) {
      seen.add(type)
      marks.push({ type })
    }
  }
  marks.sort((a, b) => INLINE_MARKS.indexOf(a.type) - INLINE_MARKS.indexOf(b.type))
  return marks.length > 0 ? marks : undefined
}

function pushText(target: NoteDocNode[], text: string, marks: NoteDocMark[] | undefined) {
  if (!text) return
  const previous = target[target.length - 1]
  if (previous?.type === 'text' && markKey(previous.marks) === markKey(marks)) {
    previous.text = `${previous.text ?? ''}${text}`
    return
  }
  const node: NoteDocNode = { type: 'text', text }
  if (marks) node.marks = marks
  target.push(node)
}

function sanitizeInline(value: unknown): NoteDocNode[] {
  if (!Array.isArray(value)) return []
  const result: NoteDocNode[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.type !== 'string') continue
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      pushText(result, candidate.text, sanitizeMarks(candidate.marks))
    } else if (candidate.type === 'hardBreak') {
      result.push({ type: 'hardBreak' })
    }
  }
  return result
}

function paragraphFrom(value: unknown): NoteDocNode {
  const content = isRecord(value) ? sanitizeInline(value.content) : []
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function sanitizeListItem(value: unknown, task: boolean): NoteDocNode | null {
  if (!isRecord(value) || value.type !== (task ? 'taskItem' : 'listItem')) return null
  const rawContent = Array.isArray(value.content) ? value.content : []
  const content: NoteDocNode[] = []
  for (const child of rawContent) {
    if (!isRecord(child)) continue
    if (child.type === 'paragraph') content.push(paragraphFrom(child))
    else if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
      const nested = sanitizeBlock(child)
      if (nested) content.push(nested)
    }
  }
  if (content.length === 0 || content[0].type !== 'paragraph') content.unshift({ type: 'paragraph' })
  const item: NoteDocNode = { type: task ? 'taskItem' : 'listItem', content }
  if (task) item.attrs = { checked: isRecord(value.attrs) && value.attrs.checked === true }
  return item
}

function sanitizeList(value: Record<string, unknown>, type: 'bulletList' | 'orderedList' | 'taskList'): NoteDocNode {
  const task = type === 'taskList'
  const expectedItem = task ? 'taskItem' : 'listItem'
  const rawItems = Array.isArray(value.content) ? value.content : []
  const content = rawItems
    .filter(item => isRecord(item) && item.type === expectedItem)
    .map(item => sanitizeListItem(item, task))
    .filter((item): item is NoteDocNode => item !== null)
  const list: NoteDocNode = { type, content: content.length > 0 ? content : [sanitizeListItem({ type: expectedItem }, task)!] }
  if (type === 'orderedList') {
    const start = isRecord(value.attrs) && typeof value.attrs.start === 'number' && Number.isInteger(value.attrs.start) && value.attrs.start > 0
      ? value.attrs.start
      : 1
    list.attrs = { start }
  }
  return list
}

function sanitizeTableCell(value: unknown): NoteDocNode | null {
  if (!isRecord(value) || (value.type !== 'tableCell' && value.type !== 'tableHeader')) return null
  const rawContent = Array.isArray(value.content) ? value.content : []
  const paragraphs = rawContent
    .filter(child => isRecord(child) && child.type === 'paragraph')
    .map(paragraphFrom)
  return {
    type: value.type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
  }
}

function sanitizeTable(value: Record<string, unknown>): NoteDocNode | null {
  const rawRows = Array.isArray(value.content) ? value.content : []
  const rows: NoteDocNode[] = []
  for (const row of rawRows) {
    if (!isRecord(row) || row.type !== 'tableRow') continue
    const rawCells = Array.isArray(row.content) ? row.content : []
    const cells = rawCells.map(sanitizeTableCell).filter((cell): cell is NoteDocNode => cell !== null)
    if (cells.length > 0) rows.push({ type: 'tableRow', content: cells })
  }
  return rows.length > 0 ? { type: 'table', content: rows } : null
}

function sanitizeBlock(value: unknown): NoteDocNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'paragraph') return paragraphFrom(value)
  if (value.type === 'heading') {
    const level = isRecord(value.attrs) && value.attrs.level === 2 ? 2 : 1
    const content = sanitizeInline(value.content)
    return content.length > 0 ? { type: 'heading', attrs: { level }, content } : { type: 'heading', attrs: { level } }
  }
  if (value.type === 'bulletList' || value.type === 'orderedList' || value.type === 'taskList') {
    return sanitizeList(value, value.type)
  }
  if (value.type === 'table') return sanitizeTable(value)
  return null
}

/** Reduce editor or imported JSON to the exact nodes, marks and attributes Lokr supports. */
export function sanitizeNoteDocument(value: unknown): NoteDocument {
  if (!isRecord(value) || value.type !== 'doc' || !Array.isArray(value.content)) {
    throw new Error('Malformed note document.')
  }
  const content = value.content.map(sanitizeBlock).filter((node): node is NoteDocNode => node !== null)
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}

/** Convert a 2.1 plain body without losing blank lines or a trailing newline. */
export function plainTextToDocument(text: string): NoteDocument {
  return {
    type: 'doc',
    content: text.split('\n').map(line => line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }),
  }
}

function inlineText(node: NoteDocNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(inlineText).join('')
}

function blockText(node: NoteDocNode): string {
  if (node.type === 'paragraph' || node.type === 'heading') return inlineText(node)
  if (node.type === 'listItem' || node.type === 'taskItem') return (node.content ?? []).map(blockText).join('\n')
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
    return (node.content ?? []).map(blockText).join('\n')
  }
  if (node.type === 'tableCell' || node.type === 'tableHeader') return (node.content ?? []).map(blockText).join('\n')
  if (node.type === 'tableRow') return (node.content ?? []).map(blockText).join(' | ')
  if (node.type === 'table') return (node.content ?? []).map(blockText).join('\n')
  return ''
}

/** Plain text used by search, cards and later CSV export. */
export function documentToPlainText(document: NoteDocument): string {
  return document.content.map(blockText).join('\n')
}

export function assertDocumentTextLimit(document: NoteDocument): void {
  if (documentToPlainText(document).length > NOTE_TEXT_MAX) {
    throw new Error(`Body is over ${NOTE_TEXT_MAX.toLocaleString('en-US')} characters.`)
  }
}

export function documentFitsEditorLimits(document: NoteDocument): boolean {
  return documentToPlainText(document).length <= NOTE_TEXT_MAX &&
    new TextEncoder().encode(JSON.stringify(document)).byteLength <= NOTE_DOCUMENT_MAX_BYTES
}

export function isNoteFontFamily(value: unknown): value is NoteFontFamily {
  return typeof value === 'string' && (NOTE_FONT_FAMILIES as readonly string[]).includes(value)
}

export function isNoteFontSize(value: unknown): value is NoteFontSize {
  return typeof value === 'string' && (NOTE_FONT_SIZES as readonly string[]).includes(value)
}
