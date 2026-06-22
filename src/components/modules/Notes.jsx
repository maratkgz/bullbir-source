import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import RichEditor from '../ui/RichEditor'
import EmptyState from '../ui/EmptyState'
import { useIsMobile } from '../../hooks/useMediaQuery'

export default function Notes() {
  const { items, loading, add, update, remove } = useCollection('notes', { orderField: 'updatedAt' })
  const { t } = useLang()
  const toast = useToast()
  const isMobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const saveTimer = useRef(null)

  const active = useMemo(() => items.find((n) => n.id === activeId), [items, activeId])

  useEffect(() => {
    if (active) { setTitle(active.title || ''); setContent(active.content || '') }
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createNote = useCallback(async (parentId = null) => {
    const id = await add({ title: '', content: '', pinned: false, parentId })
    setActiveId(id)
    setTitle('')
    setContent('')
  }, [add])

  useEffect(() => {
    if (params.get('new') === '1') { createNote(); params.delete('new'); setParams(params, { replace: true }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const persist = (patch) => {
    if (!activeId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => update(activeId, patch).then(() => toast.success(t('common.saved'))), 700)
  }

  const onTitle = (v) => { setTitle(v); persist({ title: v }) }
  const onContent = (v) => { setContent(v); persist({ content: v }) }

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((n) => (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q))
  }, [items, search])

  const roots = filtered.filter((n) => !n.parentId)
  const childrenOf = (id) => filtered.filter((n) => n.parentId === id)
  const pinned = filtered.filter((n) => n.pinned)

  const NoteItem = ({ n, child }) => (
    <div className={`note-item ${activeId === n.id ? 'active' : ''} ${child ? 'child' : ''}`} onClick={() => setActiveId(n.id)}>
      {n.pinned && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-4 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4Z" /></svg>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || t('common.untitled')}</span>
    </div>
  )

  const list = (
    <div className="notes-sidebar">
      <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('notes.search')} />
      <button className="btn btn-primary btn-block" onClick={() => createNote()}>+ {t('notes.new')}</button>
      {pinned.length > 0 && <div className="section-title" style={{ margin: '12px 0 4px' }}>{t('notes.pinned')}</div>}
      {pinned.map((n) => <NoteItem key={`p-${n.id}`} n={n} />)}
      <div className="section-title" style={{ margin: '12px 0 4px' }}>{t('notes.title')}</div>
      {roots.map((n) => (
        <div key={n.id}>
          <NoteItem n={n} />
          {childrenOf(n.id).map((c) => <NoteItem key={c.id} n={c} child />)}
        </div>
      ))}
    </div>
  )

  if (!loading && items.length === 0) {
    return <EmptyState message={t('notes.empty')} action={<button className="btn btn-primary" onClick={() => createNote()}>+ {t('notes.new')}</button>} />
  }

  return (
    <div className="notes-layout">
      {(!isMobile || !activeId) && list}
      {active ? (
        <motion.div key={active.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
            {isMobile && <button className="btn btn-ghost" onClick={() => setActiveId(null)}>← {t('common.back')}</button>}
            <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
              <button className="btn btn-ghost" onClick={() => update(active.id, { pinned: !active.pinned })}>{active.pinned ? t('notes.unpin') : t('notes.pin')}</button>
              <button className="btn btn-ghost" onClick={() => createNote(active.id)}>+ {t('notes.subpage')}</button>
              <button className="btn btn-danger" onClick={async () => { await remove(active.id); setActiveId(null) }}>{t('common.delete')}</button>
            </div>
          </div>
          <input className="note-title-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder={t('common.untitled')} />
          <RichEditor value={content} onChange={onContent} placeholder={t('notes.placeholder')} />
        </motion.div>
      ) : (
        !isMobile && <EmptyState message={t('notes.empty')} />
      )}
    </div>
  )
}
