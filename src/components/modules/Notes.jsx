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

  const notePreview = (n) => (n.content || '').replace(/<[^>]+>/g, ' ').slice(0, 120)
  const noteDate = (n) => {
    const d = n.updatedAt?.seconds ? new Date(n.updatedAt.seconds * 1000) : null
    if (!d) return ''
    const today = new Date(); const diff = (today - d) / 86400000
    if (diff < 1) return 'Сегодня'
    if (diff < 2) return 'Вчера'
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  const NoteCard = ({ n }) => (
    <div
      className={`note-card${activeId === n.id ? ' active' : ''}${n.pinned ? ' pinned' : ''}`}
      onClick={() => setActiveId(n.id)}
    >
      {n.pinned && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#9a8cff"><path d="M16 3l5 5-4 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4Z"/></svg>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9a8cff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Закреплено</span>
        </div>
      )}
      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
        {n.title || t('common.untitled')}
      </div>
      {notePreview(n) && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
          {notePreview(n)}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500 }}>{noteDate(n)}</div>
    </div>
  )

  const list = (
    <div className="notes-sidebar">
      <div className="module-header" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{t('notes.title')}</h2>
        <button className="btn btn-primary" onClick={() => createNote()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t('notes.new')}
        </button>
      </div>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input className="input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('notes.search')} />
      </div>
      {pinned.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#9a8cff', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            {t('notes.pinned')}
          </div>
          {pinned.map(n => <NoteCard key={`p-${n.id}`} n={n} />)}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '16px 0 10px' }}>
            Все заметки
          </div>
        </>
      )}
      {roots.filter(n => !n.pinned).map(n => (
        <div key={n.id}>
          <NoteCard n={n} />
          {childrenOf(n.id).map(c => <NoteCard key={c.id} n={c} />)}
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
