/**
 * lib/noteFind.ts — find in an open note (task 2.9), pure
 *
 * The editor's find plugin (components/NoteEditor.tsx) only draws decorations
 * from these ranges; nothing here touches the note's JSON, storage or the
 * console, and the term lives only in the open note's memory.
 *
 * A run is the text of one block (paragraph, heading, list or checklist item,
 * table cell, code block) between line breaks, so a match can cross formatting
 * (a half-bold word) but never a block edge or a hard break.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface TextRun {
  text: string
  /** Document position of the run's first character */
  start: number
}

export interface FindRange {
  from: number
  to: number
}

interface FoldedRun {
  folded: string
  /** For each UTF-16 unit of `folded`, where its character starts and ends in the document */
  from: number[]
  to: number[]
}

export type FindIndex = readonly FoldedRun[]

/** Every text run in the document, in document order. */
export function findTextRuns(doc: ProseMirrorNode): TextRun[] {
  const runs: TextRun[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    let text = ''
    let start = position + 1
    node.forEach((child, offset) => {
      if (child.isText) {
        if (text === '') start = position + 1 + offset
        text += child.text ?? ''
        return
      }
      // A hard break (the only other inline node) ends the run
      if (text !== '') runs.push({ text, start })
      text = ''
    })
    if (text !== '') runs.push({ text, start })
    return false
  })
  return runs
}

// Lowercased one character at a time, so a character whose lowercase is longer
// (Turkish İ becomes "i̇") still maps exactly back onto the document.
// toLowerCase, not toLocaleLowerCase: the result is the same on every computer.
function fold(text: string, start: number): FoldedRun {
  let folded = ''
  const from: number[] = []
  const to: number[] = []
  let offset = 0
  for (const character of text) {
    const lower = character.toLowerCase()
    for (let unit = 0; unit < lower.length; unit += 1) {
      from.push(start + offset)
      to.push(start + offset + character.length)
    }
    folded += lower
    offset += character.length
  }
  return { folded, from, to }
}

export function buildFindIndex(runs: readonly TextRun[]): FindIndex {
  return runs.map(run => fold(run.text, run.start))
}

/** The term as it is compared; '' (nothing to find) when it is empty or only spaces. */
export function normalizeFindTerm(term: string): string {
  return term.trim() === '' ? '' : fold(term, 0).folded
}

/** Case-insensitive, non-overlapping matches in document order. */
export function findMatches(index: FindIndex, term: string): FindRange[] {
  const needle = normalizeFindTerm(term)
  const matches: FindRange[] = []
  if (needle === '') return matches
  for (const run of index) {
    let at = run.folded.indexOf(needle)
    while (at !== -1) {
      const from = run.from[at]
      const to = run.to[at + needle.length - 1]
      // A match starting inside the previous one's expanded character is skipped
      if (matches.length === 0 || from >= matches[matches.length - 1].to) matches.push({ from, to })
      at = run.folded.indexOf(needle, at + needle.length)
    }
  }
  return matches
}

/** The first match at or after `position`, wrapping to the first; -1 when there are none. */
export function matchAtOrAfter(matches: readonly FindRange[], position: number): number {
  if (matches.length === 0) return -1
  const index = matches.findIndex(match => match.from >= position)
  return index === -1 ? 0 : index
}

// Drawing thousands of highlights (a one-letter term on a full note) took over
// the 50 ms per-keystroke budget; the count stays exact (Elijah, 2.9 Execute).
export const FIND_DRAW_LIMIT = 1000

/** The slice of matches to highlight: at most `limit`, centred on the current one. */
export function drawnMatchRange(count: number, current: number, limit = FIND_DRAW_LIMIT): { start: number; end: number } {
  if (count <= limit) return { start: 0, end: count }
  const start = Math.min(Math.max(0, current - Math.floor(limit / 2)), count - limit)
  return { start, end: start + limit }
}

/** Next (+1) or previous (-1) match, wrapping round at both ends. */
export function stepMatch(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}
