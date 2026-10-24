/**
 * components/NoteEditor.tsx — the local-only rich editor used by sticky notes
 *
 * Tiptap is only the editing surface. lib/noteDoc.ts remains the format and
 * sanitisation boundary, and callers still encrypt the resulting JSON before
 * any IndexedDB write. Unsupported nodes and marks are disabled here and
 * stripped again at that boundary.
 */

'use client'

import { Extension, type Editor } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  documentFitsEditorLimits,
  findAllowedNoteUrls,
  isAllowedNoteUrl,
  sanitizeNoteDocument,
  type NoteDocument,
  type NoteFontFamily,
  type NoteFontSize,
} from '@/lib/noteDoc'
import type { NoteTone } from './StickyNoteView'

const NoteLimits = Extension.create({
  name: 'lokrNoteLimits',
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction(transaction) {
        if (!transaction.docChanged) return true
        return documentFitsEditorLimits(sanitizeNoteDocument(transaction.doc.toJSON()))
      },
    })]
  },
})

function linkHref(node: ProseMirrorNode): string | null {
  const href = node.marks.find(mark => mark.type.name === 'link')?.attrs.href
  return isAllowedNoteUrl(href) ? href : null
}

function normalizePastedLinks(fragment: Fragment): Fragment {
  const children: ProseMirrorNode[] = []
  for (let index = 0; index < fragment.childCount; index += 1) {
    const child = fragment.child(index)
    if (child.isText) {
      const href = linkHref(child)
      if (href) {
        while (index + 1 < fragment.childCount && linkHref(fragment.child(index + 1)) === href) index += 1
        children.push(child.type.schema.text(href, child.marks))
      } else {
        const safeMarks = child.marks.filter(mark => mark.type.name !== 'link')
        children.push(safeMarks.length === child.marks.length ? child : child.type.schema.text(child.text ?? '', safeMarks))
      }
      continue
    }
    children.push(child.content.size > 0 ? child.copy(normalizePastedLinks(child.content)) : child)
  }
  return Fragment.fromArray(children)
}

const NoteLinkPasteSafety = Extension.create({
  name: 'lokrNoteLinkPasteSafety',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPasted(slice) {
          return new Slice(normalizePastedLinks(slice.content), slice.openStart, slice.openEnd)
        },
      },
    })]
  },
})

const NoteWebAutolink = Extension.create({
  name: 'lokrNoteWebAutolink',
  addProseMirrorPlugins() {
    const link = this.editor.schema.marks.link
    return [new Plugin({
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged) || oldState.doc.eq(newState.doc)) return null
        const transaction = newState.tr
        newState.doc.descendants((node, position) => {
          if (!node.isText || !node.text || node.marks.some(mark => mark.type === link)) return
          for (const range of findAllowedNoteUrls(node.text)) {
            // Typing waits for the separating space. Pasted URLs are handled by
            // the link extension's paste rule even when they end the document.
            if (!/^[.,;:!?)}\]]*\s/.test(node.text.slice(range.to))) continue
            transaction.addMark(position + range.from, position + range.to, link.create({ href: range.href }))
          }
        })
        return transaction.steps.length > 0 ? transaction : null
      },
    })]
  },
})

const NOTE_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: {
      autolink: false,
      linkOnPaste: true,
      markdownLinks: false,
      openOnClick: false,
      defaultProtocol: 'https',
      protocols: [],
      isAllowedUri: url => isAllowedNoteUrl(url),
      shouldAutoLink: url => isAllowedNoteUrl(url),
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer',
        class: null,
      },
    },
    heading: { levels: [1, 2] },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  NoteLinkPasteSafety,
  NoteWebAutolink,
  NoteLimits,
]

export function useNoteEditor(
  initial: NoteDocument,
  onChange: (_document: NoteDocument) => void,
  onOpenLink: (_href: string) => void,
): Editor | null {
  return useEditor({
    extensions: NOTE_EXTENSIONS,
    content: initial,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': 'Note',
        'aria-multiline': 'true',
        'autocomplete': 'off',
        'spellcheck': 'false',
      },
      handleClick(_view, _position, event) {
        const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
        const href = anchor?.getAttribute('href')
        if (event.button !== 0 || !isAllowedNoteUrl(href)) return false
        event.preventDefault()
        if (!event.ctrlKey && !event.metaKey) return true
        onOpenLink(href)
        return true
      },
    },
    onUpdate: ({ editor }) => onChange(sanitizeNoteDocument(editor.getJSON())),
  })
}

const FONT_CLASSES: Record<NoteFontFamily, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  mono: 'font-mono',
}

const SIZE_CLASSES: Record<NoteFontSize, string> = {
  small: 'text-sm leading-6',
  normal: 'text-base leading-7',
  large: 'text-lg leading-8',
}

interface NoteEditorSurfaceProps {
  editor: Editor | null
  fontFamily: NoteFontFamily
  fontSize: NoteFontSize
  tone: NoteTone
  textClass: string
  placeholderClass: string
  linedClass: string
  lined: boolean
}

/** The editor DOM is styled only with literal Tailwind classes; note HTML is never generated. */
export function NoteEditorSurface({
  editor,
  fontFamily,
  fontSize,
  tone,
  textClass,
  placeholderClass,
  linedClass,
  lined,
}: NoteEditorSurfaceProps) {
  const tableTone = tone === 'light-text'
    ? '[&_td]:border-ink-text [&_th]:border-ink-text [&_th]:bg-white/10'
    : '[&_td]:border-slate-100 [&_th]:border-slate-100 [&_th]:bg-black/5 dark:[&_th]:bg-white/10'
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto rounded-xl ${FONT_CLASSES[fontFamily]} ${SIZE_CLASSES[fontSize]} ${textClass} ${placeholderClass} ${
      lined ? `${linedClass} bg-local` : ''
    } ${tableTone}`}>
      <EditorContent
        editor={editor}
        className="min-h-full [&_.tiptap]:min-h-full [&_.tiptap]:outline-none [&_.tiptap]:pb-10 [&_p]:min-h-[1.5em] [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_a]:cursor-pointer [&_a]:underline [&_a]:decoration-2 [&_a]:underline-offset-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2 [&_li[data-type=taskItem]>label]:mt-1 [&_li[data-type=taskItem]>div]:min-w-0 [&_li[data-type=taskItem]>div]:flex-1 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed [&_td]:border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold [&_.selectedCell]:bg-black/10 dark:[&_.selectedCell]:bg-white/15"
      />
    </div>
  )
}

interface ToolbarProps {
  editor: Editor | null
  buttonClass: string
  activeClass: string
}

export function NoteFormattingToolbar({ editor, buttonClass, activeClass }: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      strike: current?.isActive('strike') ?? false,
      h1: current?.isActive('heading', { level: 1 }) ?? false,
      h2: current?.isActive('heading', { level: 2 }) ?? false,
      bullet: current?.isActive('bulletList') ?? false,
      ordered: current?.isActive('orderedList') ?? false,
      task: current?.isActive('taskList') ?? false,
      table: current?.isActive('table') ?? false,
    }),
  })
  if (!editor || !state) return null

  const button = (active: boolean) => `${buttonClass} ${active ? activeClass : ''}`
  return (
    <div role="toolbar" aria-label="Text formatting" className="contents">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Bold" aria-pressed={state.bold} title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()} className={`${button(state.bold)} font-bold`}>B</button>
        <button type="button" aria-label="Italic" aria-pressed={state.italic} title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()} className={`${button(state.italic)} italic`}>I</button>
        <button type="button" aria-label="Underline" aria-pressed={state.underline} title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()} className={`${button(state.underline)} underline`}>U</button>
        <button type="button" aria-label="Strikethrough" aria-pressed={state.strike} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} className={`${button(state.strike)} line-through`}>S</button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Heading 1" aria-pressed={state.h1} disabled={state.table} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={button(state.h1)}>H1</button>
        <button type="button" aria-label="Heading 2" aria-pressed={state.h2} disabled={state.table} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={button(state.h2)}>H2</button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Bulleted list" aria-pressed={state.bullet} disabled={state.table} onClick={() => editor.chain().focus().toggleBulletList().run()} className={button(state.bullet)}>Bullets</button>
        <button type="button" aria-label="Numbered list" aria-pressed={state.ordered} disabled={state.table} onClick={() => editor.chain().focus().toggleOrderedList().run()} className={button(state.ordered)}>Numbers</button>
        <button type="button" aria-label="Checklist" aria-pressed={state.task} disabled={state.table} onClick={() => editor.chain().focus().toggleTaskList().run()} className={button(state.task)}>Checklist</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {!state.table ? (
          <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className={button(false)}>Table 3×3</button>
        ) : (
          <>
            <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} className={button(false)}>+ Row</button>
            <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} className={button(false)}>− Row</button>
            <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} className={button(false)}>+ Column</button>
            <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()} className={button(false)}>− Column</button>
            <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} className={button(false)}>Delete table</button>
          </>
        )}
      </div>
    </div>
  )
}
