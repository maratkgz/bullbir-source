import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import { toDate, toDateKey } from '../../utils/format'

const COLUMNS = [
  { id: 'todo', key: 'tasks.todo' },
  { id: 'inProgress', key: 'tasks.inProgress' },
  { id: 'done', key: 'tasks.done' },
]
const PRIORITIES = ['low', 'medium', 'high']

function TaskCard({ task, onOpen }) {
  const { t } = useLang()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  const dl = toDate(task.deadline)
  const overdue = dl && dl < new Date(toDateKey()) && task.status !== 'done'
  const subDone = (task.subtasks || []).filter((s) => s.done).length

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0 }}
      className={`task-card ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task)}
    >
      <span className={`task-title ${task.status === 'done' ? 'done' : ''}`}>{task.title}</span>
      <div className="task-meta">
        <span className={`prio prio-${task.priority || 'medium'}`}>{t(`tasks.${task.priority || 'medium'}`)}</span>
        {dl && (
          <span className={`deadline-chip ${overdue ? 'overdue' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
            {dl.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        )}
        {(task.subtasks || []).length > 0 && (
          <span className="deadline-chip">{subDone}/{task.subtasks.length}</span>
        )}
      </div>
      {(task.tags || []).length > 0 && (
        <div className="task-tags">
          {task.tags.map((tag) => (
            <span key={tag} className="tag-chip">#{tag}</span>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function Column({ col, tasks, onOpen }) {
  const { t } = useLang()
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  return (
    <div ref={setNodeRef} className="kanban-col" style={isOver ? { outline: '2px dashed var(--primary)' } : undefined}>
      <div className="kanban-col-head">
        <h3>{t(col.key)}</h3>
        <span className="kanban-count">{tasks.length}</span>
      </div>
      <div className="kanban-list">
        <AnimatePresence>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpen} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function emptyTask() {
  return { title: '', description: '', priority: 'medium', tags: [], deadline: '', subtasks: [], status: 'todo' }
}

function TaskModal({ open, onClose, task, onSave, onDelete }) {
  const { t } = useLang()
  const [form, setForm] = useState(emptyTask())
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')

  useEffect(() => {
    if (task) {
      const dl = toDate(task.deadline)
      setForm({
        ...emptyTask(),
        ...task,
        deadline: dl ? toDateKey(dl) : '',
        tags: task.tags || [],
        subtasks: task.subtasks || [],
      })
    } else {
      setForm(emptyTask())
    }
  }, [task, open])

  const addTag = () => {
    const v = tagInput.trim()
    if (v && !form.tags.includes(v)) setForm((f) => ({ ...f, tags: [...f.tags, v] }))
    setTagInput('')
  }
  const addSub = () => {
    const v = subInput.trim()
    if (v) setForm((f) => ({ ...f, subtasks: [...f.subtasks, { title: v, done: false }] }))
    setSubInput('')
  }

  const submit = () => {
    if (!form.title.trim()) return
    onSave({
      ...form,
      title: form.title.trim(),
      deadline: form.deadline || null,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? t('common.edit') : t('tasks.new')}>
      <div className="field">
        <label>{t('common.title')}</label>
        <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
      </div>
      <div className="field">
        <label>{t('common.description')}</label>
        <textarea className="textarea" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
        <div className="field">
          <label>{t('tasks.priority')}</label>
          <select className="select" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(`tasks.${p}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t('tasks.deadline')}</label>
          <input type="date" className="input" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </div>
      </div>
      <div className="field">
        <label>{t('tasks.tags')}</label>
        <div className="chip-input">
          {form.tags.map((tag) => (
            <span key={tag} className="chip-removable">#{tag}
              <button onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== tag) }))}>×</button>
            </span>
          ))}
          <input className="input" style={{ flex: 1, minWidth: 120 }} value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder={t('tasks.addTag')} />
        </div>
      </div>
      <div className="field">
        <label>{t('tasks.subtasks')}</label>
        <div className="list-stack">
          {form.subtasks.map((s, i) => (
            <div key={i} className="subtask-row">
              <button className={`checkbox ${s.done ? 'checked' : ''}`} onClick={() => setForm((f) => ({ ...f, subtasks: f.subtasks.map((x, j) => j === i ? { ...x, done: !x.done } : x) }))}>
                {s.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
              </button>
              <span style={{ flex: 1, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--text-muted)' : 'var(--text)' }}>{s.title}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setForm((f) => ({ ...f, subtasks: f.subtasks.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
          <div className="chip-input">
            <input className="input" style={{ flex: 1 }} value={subInput} onChange={(e) => setSubInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSub())} placeholder={t('tasks.addSubtask')} />
            <button className="btn btn-secondary" onClick={addSub}>{t('common.add')}</button>
          </div>
        </div>
      </div>
      <div className="flex gap-3" style={{ justifyContent: 'space-between' }}>
        {task ? <button className="btn btn-danger" onClick={() => onDelete(task.id)}>{t('common.delete')}</button> : <span />}
        <button className="btn btn-primary" onClick={submit}>{t('common.save')}</button>
      </div>
    </Modal>
  )
}

export default function TaskTracker() {
  const { items, loading, add, update, remove } = useCollection('tasks')
  const { t } = useLang()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState('board')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filterPrio, setFilterPrio] = useState('all')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  )

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(null)
      setModalOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const filtered = useMemo(
    () => (filterPrio === 'all' ? items : items.filter((tk) => tk.priority === filterPrio)),
    [items, filterPrio],
  )

  const byCol = useMemo(() => {
    const map = { todo: [], inProgress: [], done: [] }
    filtered.forEach((tk) => { (map[tk.status] || map.todo).push(tk) })
    return map
  }, [filtered])

  const onDragEnd = ({ active, over }) => {
    if (!over) return
    const task = items.find((x) => x.id === active.id)
    if (task && task.status !== over.id) update(task.id, { status: over.id })
  }

  const openNew = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (task) => { setEditing(task); setModalOpen(true) }

  const save = async (data) => {
    if (editing) await update(editing.id, data)
    else await add(data)
    toast.success(t('common.saved'))
    setModalOpen(false)
  }
  const del = async (id) => { await remove(id); toast.success(t('common.saved')); setModalOpen(false) }

  return (
    <div>
      <div className="page-header">
        <div className="view-toggle">
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>{t('tasks.board')}</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>{t('tasks.list')}</button>
        </div>
        <div className="flex gap-3 items-center">
          <select className="select" style={{ width: 'auto' }} value={filterPrio} onChange={(e) => setFilterPrio(e.target.value)}>
            <option value="all">{t('common.all')}</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(`tasks.${p}`)}</option>)}
          </select>
          <button className="btn btn-primary" onClick={openNew}>+ {t('tasks.new')}</button>
        </div>
      </div>

      {!loading && items.length === 0 ? (
        <EmptyState message={t('tasks.empty')} action={<button className="btn btn-primary" onClick={openNew}>+ {t('tasks.new')}</button>} />
      ) : view === 'board' ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="kanban">
            {COLUMNS.map((col) => (
              <Column key={col.id} col={col} tasks={byCol[col.id]} onOpen={openEdit} />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="list-stack">
          {filtered.map((task) => (
            <div key={task.id} className="task-card" onClick={() => openEdit(task)} style={{ cursor: 'pointer' }}>
              <div className="flex items-center gap-3">
                <button
                  className={`checkbox ${task.status === 'done' ? 'checked' : ''}`}
                  onClick={(e) => { e.stopPropagation(); update(task.id, { status: task.status === 'done' ? 'todo' : 'done' }) }}
                >
                  {task.status === 'done' && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
                <span className={`task-title ${task.status === 'done' ? 'done' : ''}`} style={{ flex: 1 }}>{task.title}</span>
                <span className={`prio prio-${task.priority || 'medium'}`}>{t(`tasks.${task.priority || 'medium'}`)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} task={editing} onSave={save} onDelete={del} />
    </div>
  )
}
