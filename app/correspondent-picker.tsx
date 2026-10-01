'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { closeHistory } from '@tiptap/pm/history'
import { useTranslations } from 'next-intl'
import ProfileIdentityMark from './profile-identity-mark'
import { findCorrespondents } from './correspondent-actions'
import { correspondentTrigger, type CorrespondentTrigger, type CorrespondentChoice } from '@/lib/correspondent-trigger'

type TextField = HTMLTextAreaElement | HTMLInputElement

/** Shared by controlled textareas and Tiptap. Inserts through the owning
 * state/editor API so selection, draft autosave, markup and undo all survive. */
export default function CorrespondentPicker({ children, editor, onChange, onSelect, maxLength }: {
  children: React.ReactNode; editor?: Editor | null; onChange?: (value: string) => void;
  onSelect?: (person: CorrespondentChoice) => boolean | void; maxLength?: number
}) {
  const id = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const field = useRef<TextField | null>(null)
  const completed = useRef<{ from: number; to: number } | null>(null)
  const [trigger, setTrigger] = useState<CorrespondentTrigger | null>(null)
  const [people, setPeople] = useState<CorrespondentChoice[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 300 })
  const [below, setBelow] = useState(true)

  function detect(target?: EventTarget | null) {
    let next: CorrespondentTrigger | null = null
    if (editor) {
      const { $from, empty } = editor.state.selection
      if (empty) {
        const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
        const local = correspondentTrigger(text)
        if (local) next = { ...local, from: $from.pos - (text.length - local.from), to: $from.pos }
      }
    } else if ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && onChange) {
      field.current = target
      if (target.selectionStart === target.selectionEnd) next = correspondentTrigger(target.value, target.selectionStart ?? target.value.length)
    }
    if (next && completed.current?.from === next.from && next.to >= completed.current.to) next = null
    setLimitReached(false)
    setTrigger(next)
    if (next) {
      const rect = (field.current ?? wrapper.current)?.getBoundingClientRect()
      if (rect) {
        const fitsBelow = window.innerHeight - rect.bottom >= 220
        setBelow(fitsBelow)
        setPosition({ top: fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - 4), left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), width: Math.min(320, window.innerWidth - 16) })
      }
    }
  }

  useEffect(() => {
    if (!editor) return
    const update = () => detect()
    editor.on('selectionUpdate', update); editor.on('update', update)
    return () => { editor.off('selectionUpdate', update); editor.off('update', update) }
    // The editor owns the selection source; detect uses no changing props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const query = trigger?.query
  useEffect(() => {
    if (query === undefined) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true); setFailed(false); setPeople([]); setHighlighted(0)
      try {
        const result = await findCorrespondents(query)
        if (!cancelled) { setPeople(result.people); setLoadedQuery(query); setFailed(result.error); setLoading(false) }
      } catch { if (!cancelled) { setFailed(true); setLoading(false) } }
    }, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    if (!trigger) return
    function dismiss(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node) && !(event.target as Element)?.closest?.('[data-correspondent-menu]')) setTrigger(null)
    }
    const close = () => setTrigger(null)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [trigger])

  function choose(person: CorrespondentChoice) {
    if (!trigger || loading || loadedQuery !== trigger.query) return
    if (onSelect?.(person) === false) { setLimitReached(true); return }
    const inserted = `@${person.pseudonym} `
    if (editor) {
      editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true }).insertContentAt({ from: trigger.from, to: trigger.to }, [{ type: 'text', text: inserted }]).run()
    } else if (field.current && onChange) {
      const element = field.current
      const value = element.value.slice(0, trigger.from) + inserted + element.value.slice(trigger.to)
      if (maxLength && value.length > maxLength) return
      onChange(value)
      const cursor = trigger.from + inserted.length
      requestAnimationFrame(() => { element.focus(); element.setSelectionRange(cursor, cursor) })
    }
    completed.current = { from: trigger.from, to: trigger.from + inserted.length }
    setTrigger(null)
  }

  function keyDown(event: React.KeyboardEvent) {
    if (!trigger || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTrigger(null) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation()
      setHighlighted((current) => Math.max(0, Math.min(people.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
    }
    if (event.key === 'Enter' && people[highlighted] && !loading && loadedQuery === trigger.query) { event.preventDefault(); event.stopPropagation(); choose(people[highlighted]) }
  }

  return <div ref={wrapper} className="relative" onInputCapture={(event) => { if (!event.nativeEvent.isComposing) detect(event.target) }} onClickCapture={(event) => detect(event.target)} onKeyUpCapture={(event) => { if (!['Escape', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) detect(event.target) }} onKeyDownCapture={keyDown}>
    {children}
    {trigger && typeof document !== 'undefined' && createPortal(<CorrespondentMenu people={loadedQuery === trigger.query ? people : []} highlighted={highlighted} choose={choose} loading={loading || loadedQuery !== trigger.query} failed={failed} limitReached={limitReached} id={id} position={position} below={below}/>, document.body)}
  </div>
}

function CorrespondentMenu({ people, highlighted, choose, loading, failed, limitReached, id, position, below }: {
  people: CorrespondentChoice[]; highlighted: number; choose: (person: CorrespondentChoice) => void;
  loading: boolean; failed: boolean; limitReached: boolean; id: string; position: { top: number; left: number; width: number }; below: boolean
}) {
  const t = useTranslations('Correspondents')
  return <div data-correspondent-menu className="fixed z-[100] max-h-64 overflow-auto rounded-lg border border-foreground/15 bg-background p-2 shadow-lg" style={{ ...position, transform: below ? undefined : 'translateY(-100%)' }}>
    <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/55">{t('heading')}</p>
    <div role="listbox" id={id} aria-label={t('heading')}>
      {people.map((person, index) => <button key={person.userId} role="option" aria-selected={index === highlighted} type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => choose(person)} className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left ${index === highlighted ? 'bg-accent/10' : 'hover:bg-foreground/5'}`}>
        <ProfileIdentityMark identifier={person.userId} markUrl={person.markUrl} size="sm"/><span className="min-w-0 break-words text-sm font-medium">{person.pseudonym}</span>
      </button>)}
    </div>
    {limitReached && <p role="status" className="px-2 py-2 text-sm text-foreground/65">{t('limit')}</p>}
    {!people.length && <p role="status" className="px-2 py-3 text-sm text-foreground/65">{t(loading ? 'loading' : failed ? 'failed' : 'empty')}</p>}
  </div>
}
