import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { serverTimestamp } from 'firebase/firestore'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import { toDate, toDateKey } from '../../utils/format'
import { Ban, Check, ChevronRight, ClipboardList, CloudSun, Inbox, Moon, PartyPopper, Plus, Sun, Trophy, Zap } from 'lucide-react'
import Icon from '../ui/Icon'

const PRIORITIES = ['low', 'medium', 'high']
const TIME_GROUPS = [
  { id: 'morning', label_ru: 'Утро', label_en: 'Morning', label_kg: 'Эртең', icon: Sun, color: '#f0c45a' },
  { id: 'day',     label_ru: 'День', label_en: 'Day',     label_kg: 'Күндүз', icon: CloudSun, color: '#9a8cff' },
  { id: 'evening', label_ru: 'Вечер', label_en: 'Evening', label_kg: 'Кеч', icon: Moon, color: '#5ad1a5' },
  { id: 'none',    label_ru: 'Другое', label_en: 'Other',  label_kg: 'Башка', icon: ClipboardList, color: '#7a7a8c' },
]

function getGroupLabel(g, lang) {
  if (lang === 'ru') return g.label_ru
  if (lang === 'kg') return g.label_kg
  return g.label_en
}

function ProgressRing({ done, total }) {
  const { t, tp } = useLang()
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="tasks-progress-card card">
      <div
        className="tasks-ring"
        style={{ background: `conic-gradient(#7c5cff ${pct}%, #1f1f2b 0)` }}
      >
        <div className="tasks-ring-inner">
          <span className="tasks-ring-pct">{pct}%</span>
        </div>
      </div>
      <div>
        <div className="tasks-progress-title">
          {pct === 100 ? <Icon icon={PartyPopper} size="1em" /> : <Icon icon={Zap} size="1em" />} {pct === 100 ? t('tasks.dayDone') : t('tasks.dayProgress')}
        </div>
        <div className="tasks-progress-sub" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
          {tp('tasks.doneOfTotal', total, { done })}
        </div>
      </div>
      <div className="tasks-ring-count">
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>{done}</span>
        <span style={{ color: 'var(--text-muted)' }}>/{total}</span>
      </div>
    </div>
  )
}

function TaskRow({ task, onCheck, onEdit, onSkip }) {
  const { t, lang } = useLang()
  const done = task.status === 'done'
  const skipped = task.status === 'skipped'
  const pct = (task.subtasks || []).length > 0
    ? Math.round(((task.subtasks || []).filter(s => s.done).length / task.subtasks.length) * 100)
    : null

  return (
    <motion.div
      className={`task-row-item${done ? ' done' : ''}${skipped ? ' skipped' : ''}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      layout
    >
      <button
        className={`task-checkbox${done ? ' checked' : ''}`}
        onClick={(e) => { e.stopPropagation(); onCheck(task) }}
        aria-label={done ? t('tasks.markUndone') : t('tasks.markDone')}
        aria-pressed={done}
      >
        {done && (
          <Icon icon={Check} size={13} style={{ color: '#fff' }} />
        )}
      </button>

      <div className="task-row-content" onClick={() => onEdit(task)}>
        <span className={`task-row-title${done || skipped ? ' muted' : ''}`}>
          {task.title}
        </span>
        {pct !== null && (
          <div className="task-sub-progress">
            <div className="task-sub-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {task.priority === 'high' && !done && !skipped && (
        <span className="task-prio-badge high">!</span>
      )}
      {skipped && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><Icon icon={Ban} size="1em" label={t('tasks.skipped')} /></span>
      )}
      {!done && !skipped && (
        <button
          className="task-skip-btn"
          onClick={(e) => { e.stopPropagation(); onSkip(task) }}
          title={t('tasks.skip')}
          aria-label={t('tasks.skipTask')}
        >
          <Icon icon={ChevronRight} size={16} />
        </button>
      )}
    </motion.div>
  )
}

function GroupHeader({ group, count, total, lang }) {
  return (
    <div className="task-group-header">
      <span className="task-group-icon"><Icon icon={group.icon} size="1em" /></span>
      <span className="task-group-label" style={{ color: group.color }}>{getGroupLabel(group, lang)}</span>
      <span className="task-group-count">{count}/{total}</span>
      <div className="task-group-line" />
    </div>
  )
}

function SkipModal({ open, onClose, onConfirm }) {
  const { t } = useLang()
  const [reason, setReason] = useState('')
  const submit = () => { onConfirm(reason.trim()); setReason('') }
  const close = () => { setReason(''); onClose() }
  return (
    <Modal open={open} onClose={close} title={t('tasks.skipTitle')} maxWidth={420}>
      <div className="field">
        <label>{t('tasks.skipReason')}</label>
        <textarea className="textarea" rows={3} placeholder={t('tasks.skipReasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={submit}>{t('tasks.skip')}</button>
      </div>
    </Modal>
  )
}

function emptyTask() {
  return { title: '', description: '', priority: 'medium', tags: [], deadline: '', subtasks: [], status: 'todo', timeGroup: 'day' }
}

function TaskModal({ open, onClose, task, onSave, onDelete }) {
  const { t, lang } = useLang()
  const [form, setForm] = useState(emptyTask())
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')

  useEffect(() => {
    if (task) {
      const dl = toDate(task.deadline)
      setForm({ ...emptyTask(), ...task, deadline: dl ? toDateKey(dl) : '', tags: task.tags || [], subtasks: task.subtasks || [] })
    } else {
      setForm(emptyTask())
    }
  }, [task, open])

  const addTag = () => {
    const v = tagInput.trim()
    if (v && !form.tags.includes(v)) setForm(f => ({ ...f, tags: [...f.tags, v] }))
    setTagInput('')
  }
  const addSub = () => {
    const v = subInput.trim()
    if (v) setForm(f => ({ ...f, subtasks: [...f.subtasks, { title: v, done: false }] }))
    setSubInput('')
  }

  const submit = () => {
    if (!form.title.trim()) return
    onSave({ ...form, title: form.title.trim(), deadline: form.deadline || null })
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? t('common.edit') : t('tasks.new')}>
      <div className="field">
        <label>{t('common.title')}</label>
        <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus required />
      </div>
      <div className="field">
        <label>{t('common.description')}</label>
        <textarea className="textarea" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>{t('tasks.priority')}</label>
          <select className="select" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            {PRIORITIES.map(p => <option key={p} value={p}>{t(`tasks.${p}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t('tasks.deadline')}</label>
          <input type="date" className="input" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
        </div>
      </div>

      <div className="field">
        <label>{t('tasks.timeOfDay')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TIME_GROUPS.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => setForm(f => ({ ...f, timeGroup: g.id }))}
              style={{
                padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600,
                background: form.timeGroup === g.id ? '#7c5cff' : 'var(--surface-2)',
                color: form.timeGroup === g.id ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${form.timeGroup === g.id ? '#7c5cff' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}
            ><Icon icon={g.icon} size="1em" /> {getGroupLabel(g, lang)}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t('tasks.tags')}</label>
        <div className="chip-input">
          {form.tags.map(tag => (
            <span key={tag} className="chip-removable">#{tag}
              <button type="button" onClick={() => setForm(f => ({ ...f, tags: f.tags.filter(x => x !== tag) }))}>×</button>
            </span>
          ))}
          <input className="input" style={{ flex: 1, minWidth: 100 }} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder={t('tasks.addTag')} />
        </div>
      </div>

      <div className="field">
        <label>{t('tasks.subtasks')}</label>
        <div className="list-stack">
          {form.subtasks.map((s, i) => (
            <div key={i} className="subtask-row">
              <button type="button" aria-label={t('tasks.toggleSubtask')} aria-pressed={s.done} className={`checkbox ${s.done ? 'checked' : ''}`} onClick={() => setForm(f => ({ ...f, subtasks: f.subtasks.map((x, j) => j === i ? { ...x, done: !x.done } : x) }))}>
                {s.done && <Icon icon={Check} size={12} />}
              </button>
              <span style={{ flex: 1, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--text-muted)' : 'var(--text)' }}>{s.title}</span>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setForm(f => ({ ...f, subtasks: f.subtasks.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
          <div className="chip-input">
            <input className="input" style={{ flex: 1 }} value={subInput} onChange={e => setSubInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSub())} placeholder={t('tasks.addSubtask')} />
            <button type="button" className="btn btn-secondary" onClick={addSub}>{t('common.add')}</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 4 }}>
        {task
          ? <button type="button" className="btn btn-danger" onClick={() => onDelete(task.id)}>{t('common.delete')}</button>
          : <span />
        }
        <button type="button" className="btn btn-primary" onClick={submit}>{t('common.save')}</button>
      </div>
    </Modal>
  )
}

export default function TaskTracker() {
  const { items, loading, add, update, remove } = useCollection('tasks')
  const { t, lang } = useLang()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('today') // today | week | done
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [skipTask, setSkipTask] = useState(null)

  const todayKey = toDateKey()

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(null); setModalOpen(true)
      params.delete('new'); setParams(params, { replace: true })
    }
  }, [params, setParams])

  const todayTasks = useMemo(() =>
    items.filter(tk => {
      const dl = toDate(tk.deadline)
      return !dl || toDateKey(dl) === todayKey
    }),
    [items, todayKey]
  )

  const weekTasks = useMemo(() => {
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
    return items.filter(tk => {
      const dl = toDate(tk.deadline)
      return !dl || dl <= weekEnd
    }).filter(tk => tk.status !== 'done')
  }, [items])

  const doneTasks = useMemo(() => items.filter(tk => tk.status === 'done'), [items])

  const displayTasks = tab === 'today' ? todayTasks : tab === 'week' ? weekTasks : doneTasks

  const grouped = useMemo(() => {
    const map = {}
    TIME_GROUPS.forEach(g => { map[g.id] = [] })
    displayTasks.forEach(tk => {
      const grp = tk.timeGroup || 'none'
      if (map[grp]) map[grp].push(tk)
      else map.none.push(tk)
    })
    return map
  }, [displayTasks])

  const doneCount = useMemo(() => todayTasks.filter(tk => tk.status === 'done').length, [todayTasks])
  const totalCount = todayTasks.length

  const openNew = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (task) => { setEditing(task); setModalOpen(true) }

  const save = async (data) => {
    const { id: _id, createdAt: _ca, updatedAt: _ua, completedAt: _co, skippedAt: _sk, skipReason: _sr, ...clean } = data
    try {
      if (editing) await update(editing.id, clean)
      else await add(clean)
      toast.success(t('common.saved'))
      setModalOpen(false)
    } catch (e) {
      console.error('save error', e)
      toast.error(t('common.error'))
    }
  }

  const del = async (id) => {
    try {
      await remove(id); toast.success(t('common.saved')); setModalOpen(false)
    } catch (e) {
      toast.error(t('common.error'))
    }
  }

  const markDone = async (task) => {
    try {
      if (task.status === 'done') await update(task.id, { status: 'todo', completedAt: null })
      else await update(task.id, { status: 'done', completedAt: serverTimestamp() })
    } catch (e) {
      toast.error(t('common.error'))
    }
  }

  const confirmSkip = async (reason) => {
    if (!skipTask) return
    try {
      await update(skipTask.id, { status: 'skipped', skippedAt: serverTimestamp(), skipReason: reason || '' })
      setSkipTask(null)
    } catch (e) {
      toast.error(t('common.error'))
    }
  }

  const TABS = [
    { id: 'today', label: t('common.today') },
    { id: 'week',  label: t('tasks.week') },
    { id: 'done',  label: t('tasks.done') },
  ]

  return (
    <div>
      {/* Header */}
      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}>{t('nav.tasks')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {t('tasks.doneToday', { done: doneCount, total: totalCount })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={openNew}>
            <Icon icon={Plus} size={18} />
            {t('tasks.new')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tasks-tabs">
        {TABS.map(tab_ => (
          <button
            key={tab_.id}
            className={`tasks-tab${tab === tab_.id ? ' active' : ''}`}
            onClick={() => setTab(tab_.id)}
          >{tab_.label}</button>
        ))}
      </div>

      {/* Progress ring — today only */}
      {tab === 'today' && totalCount > 0 && (
        <ProgressRing done={doneCount} total={totalCount} />
      )}

      {/* Task list by group */}
      {loading ? (
        <div className="list-stack" style={{ marginTop: 16 }}>
          {[0,1,2,3].map(i => <div key={i} className="skeleton-pulse" style={{ height: 52 }} />)}
        </div>
      ) : displayTasks.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', marginTop: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>
            {tab === 'done' ? <Icon icon={Trophy} size="1em" /> : <Icon icon={Inbox} size="1em" />}
          </div>
          <h3>{tab === 'done' ? t('tasks.emptyDone') : t('tasks.empty')}</h3>
          {tab !== 'done' && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openNew}>
              + {t('tasks.new')}
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TIME_GROUPS.map(g => {
            const tasks = grouped[g.id] || []
            if (tasks.length === 0) return null
            const groupDone = tasks.filter(tk => tk.status === 'done').length
            return (
              <div key={g.id}>
                <GroupHeader
                  group={g}
                  count={groupDone}
                  total={tasks.length}
                  lang={lang}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, marginBottom: 8 }}>
                  {tasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onCheck={markDone}
                      onEdit={openEdit}
                      onSkip={setSkipTask}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {modalOpen && (
          <TaskModal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null) }} task={editing} onSave={save} onDelete={del} />
        )}
        {skipTask && (
          <SkipModal open={!!skipTask} onClose={() => setSkipTask(null)} onConfirm={confirmSkip} />
        )}
      </AnimatePresence>
    </div>
  )
}
