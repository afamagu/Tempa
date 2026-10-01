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
  const [hasMore, setHasMore] = useState(false)
  const requestVersion = useRef(0)
  const [expanded, setExpanded] = useState(false)
  const [menuHeight, setMenuHeight] = useState(240)
  const menuRef = useRef<HTMLDivElement>(null)

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
  }

  function positionMenu() {
    const viewport = window.visualViewport
    const top = viewport?.offsetTop ?? 0
    const height = viewport?.height ?? window.innerHeight
    const left = viewport?.offsetLeft ?? 0
    const width = viewport?.width ?? window.innerWidth
    const rect = (field.current ?? wrapper.current)?.getBoundingClientRect()
    const menuWidth = Math.min(expanded ? 480 : 320, width - 16)
    const available = Math.max(80, height - 16)
    const desired = Math.min(expanded ? 440 : 280, available)
    const anchor = expanded ? top + 8 : (rect?.bottom ?? top) + 4
    setMenuHeight(desired)
    setPosition({ top: Math.max(top + 8, Math.min(anchor, top + height - desired - 8)), left: Math.max(left + 8, Math.min(rect?.left ?? left + 8, left + width - menuWidth - 8)), width: menuWidth })
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
    const version = ++requestVersion.current
    const timer = setTimeout(async () => {
      setLoading(true); setFailed(false); setPeople([]); setHighlighted(0)
      try {
        const result = await findCorrespondents(query)
        if (!cancelled && version === requestVersion.current) { setHasMore(!!result.hasMore); setPeople(result.people); setLoadedQuery(query); setFailed(result.error); setLoading(false) }
      } catch { if (!cancelled) { setFailed(true); setLoading(false) } }
    }, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    if (!trigger) return
    const reposition = () => positionMenu()
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.visualViewport?.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('scroll', reposition)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      window.visualViewport?.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('scroll', reposition)
    }
    // Presentation geometry follows the visible viewport, not the full page/editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!trigger, expanded])

  function closeMenu() { requestVersion.current++; setTrigger(null); setExpanded(false) }
  async function morePeople() {
    if (!trigger || loading || loadedQuery !== trigger.query) return
    const version = requestVersion.current
    setLoading(true)
    try {
      const result = await findCorrespondents(trigger.query, people.length)
      if (version !== requestVersion.current) return
      if (result.error) { setFailed(true); return }
      setPeople(current => [...current, ...result.people.filter(p => !current.some(c => c.userId === p.userId))])
      setHasMore(!!result.hasMore && result.people.length > 0)
    } catch { if (version === requestVersion.current) setFailed(true) }
    finally { if (version === requestVersion.current) setLoading(false) }
  }

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
    closeMenu()
  }

  function keyDown(event: React.KeyboardEvent) {
    if (!trigger || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation()
      setHighlighted((current) => Math.max(0, Math.min((expanded ? people.length : Math.min(6, people.length)) - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
    }
    if (event.key === 'Enter' && people[highlighted] && !loading && loadedQuery === trigger.query) { event.preventDefault(); event.stopPropagation(); choose(people[highlighted]) }
  }

  return <div ref={wrapper} className="relative" onInputCapture={(event) => { if (wrapper.current?.contains(event.target as Node) && !event.nativeEvent.isComposing) detect(event.target) }} onClickCapture={(event) => { if (!trigger) detect(event.target) }} onKeyUpCapture={(event) => { if (wrapper.current?.contains(event.target as Node) && !['Escape', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) detect(event.target) }} onKeyDownCapture={keyDown}>
    {children}
    {trigger && typeof document !== 'undefined' && createPortal(<>
      {expanded && <div className="fixed inset-0 z-[99] bg-foreground/35" onClick={closeMenu} aria-hidden="true" />}
      <div ref={menuRef} data-correspondent-menu className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border border-accent/30 bg-background shadow-xl" style={{ ...position, maxHeight: menuHeight }}>
        <CorrespondentMenu people={loadedQuery === trigger.query ? (expanded ? people : people.slice(0, 6)) : []} highlighted={highlighted} choose={choose} loading={loading || loadedQuery !== trigger.query} failed={failed} limitReached={limitReached} id={id} close={closeMenu} expand={() => setExpanded(true)} expanded={expanded} hasMore={people.length > 6 || hasMore} canLoadMore={hasMore} loadMore={morePeople} query={trigger.query} search={(value) => setTrigger({ ...trigger, query: value })} />
      </div>
    </>, document.body)}
  </div>
}

function CorrespondentMenu({ people, highlighted, choose, loading, failed, limitReached, id, close, expand, expanded, hasMore, query, search, canLoadMore, loadMore }: {
  people: CorrespondentChoice[]; highlighted: number; choose: (person: CorrespondentChoice) => void;
  loading: boolean; failed: boolean; limitReached: boolean; id: string; close: () => void; expand: () => void;
  expanded: boolean; hasMore: boolean; canLoadMore: boolean; loadMore: () => void; query: string; search: (value: string) => void
}) {
  const t = useTranslations('Correspondents')
  return <>
    <div className="flex shrink-0 items-center justify-between gap-3 bg-accent/15 px-3 py-2">
      <p className="text-xs font-semibold">{t('heading')}</p>
      <button type="button" onClick={close} aria-label={t('close')} className="rounded-full px-3 py-1 text-xl">×</button>
    </div>
    {expanded && <input autoFocus value={query} onChange={event => search(event.target.value.slice(0,60))} aria-label={t('search')} placeholder={t('search')} className="m-2 shrink-0 rounded-md border border-foreground/20 bg-transparent p-2 text-base" />}
    <div role="listbox" id={id} aria-label={t('heading')} className="min-h-0 overflow-y-auto overscroll-contain p-2">
      {people.map((person, index) => <button key={person.userId} role="option" aria-selected={index === highlighted} type="button" onPointerDown={(event) => { if (event.pointerType !== 'touch') event.preventDefault() }} onClick={() => choose(person)} className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left ${index === highlighted ? 'bg-accent/10' : 'hover:bg-foreground/5'}`}>
        <ProfileIdentityMark identifier={person.userId} markUrl={person.markUrl} size="sm"/><span className="min-w-0 break-words text-sm font-medium">{person.pseudonym}</span>
      </button>)}
      {limitReached && <p role="status" className="px-2 py-2 text-sm text-foreground/65">{t('limit')}</p>}
      {!people.length && <p role="status" className="px-2 py-3 text-sm text-foreground/65">{t(loading ? 'loading' : failed ? 'failed' : 'empty')}</p>}
    </div>
    {expanded && canLoadMore && <button type="button" disabled={loading} onClick={loadMore} className="shrink-0 border-t border-foreground/10 px-3 py-3 text-sm underline">{t(loading ? 'loading' : 'more')}</button>}
    {!expanded && hasMore && <button type="button" onClick={expand} className="shrink-0 border-t border-foreground/10 px-3 py-3 text-sm underline underline-offset-4">{t('seeAll')}</button>}
  </>
}
