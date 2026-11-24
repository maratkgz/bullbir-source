import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCollection } from '../../../hooks/useCollection'
import { useLocalStorage } from '../../../hooks/useLocalStorage'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'
import Modal from '../../ui/Modal'
import { toDateKey } from '../../../utils/format'
import MandalaGrid from './MandalaGrid'
import CellEditor from './CellEditor'
import MandalaAiFill from './MandalaAiFill'
import MandalaPlanner from './MandalaPlanner'
import { mandalaPace } from '../../../ai/engine/pace'
import { CalendarDays, Sparkles } from 'lucide-react'
import Icon from '../../ui/Icon'
import {
  LIMITS, DIRECTION_COLORS, emptyMandala, normalizeMandala, getCell, patchForCell,
  mandalaStats, directionProgress,
} from './mandalaModel'
import './Mandala.css'
import '../assistant/Assistant.css'

const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.2, 1.45, 1.75]
const DEFAULT_ZOOM_INDEX = 3

function ProgressRing({ value, size = 44 }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="mandala-ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="mandala-ring-bg" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        className="mandala-ring-fg"
        strokeDasharray={c}
        strokeDashoffset={c - (c * value) / 100}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{value}%</text>
    </svg>
  )
}

function MandalaList({ mandalas, onOpen, onCreate, t }) {
  if (mandalas.length === 0) {
    return (
      <div className="card mandala-empty">
        <div className="mandala-empty-art" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <span key={i} className={i === 4 ? 'is-core' : ''} />)}
        </div>
        <h3>{t('mandala.emptyTitle')}</h3>
        <p>{t('mandala.emptyText')}</p>
        <button className="btn btn-primary" onClick={onCreate}>+ {t('mandala.new')}</button>
      </div>
    )
  }
  return (
    <div className="mandala-list">
      {mandalas.map((m, i) => {
        const stats = mandalaStats(m)
        return (
          <motion.button
            key={m.id}
            type="button"
            className="card mandala-card"
            onClick={() => onOpen(m.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <ProgressRing value={stats.progress} />
            <div className="mandala-card-body">
              <div className="mandala-card-title">{m.title || t('mandala.untitled')}</div>
              <div className="mandala-card-meta">
                {t('mandala.statsLine', {
                  dirs: stats.directions, done: stats.actionsDone, total: stats.actions,
                })}
              </div>
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}

function DirectionLegend({ mandala, onOpen, t }) {
  return (
    <div className="mandala-legend">
      {mandala.directions.map((dir, d) => {
        const progress = directionProgress(dir)
        return (
          <button
            key={d}
            type="button"
            className="mandala-legend-item"
            style={{ '--c': DIRECTION_COLORS[d], '--p': `${progress}%` }}
            onClick={() => onOpen({ kind: 'direction', d })}
          >
            <span className="mandala-legend-name">{dir.text || t('mandala.direction', { n: d + 1 })}</span>
            <span className="mandala-legend-pct">{progress}%</span>
            <span className="mandala-legend-bar" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export default function Mandala() {
  const { items, loading, add, update, remove } = useCollection('mandalas')
  const { t } = useLang()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [zoomIndex, setZoomIndex] = useLocalStorage('bb_mandala_zoom', DEFAULT_ZOOM_INDEX)
  const [editing, setEditing] = useState(null) // cell ref
  const [isSaving, setIsSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [fillWithAi, setFillWithAi] = useState(true)

  const mandalas = useMemo(() => items.map(normalizeMandala), [items])
  const activeId = params.get('id')
  const active = mandalas.find((m) => m.id === activeId) || null
  const todayKey = toDateKey()
  const safeZoomIndex = Math.min(Math.max(Number(zoomIndex) || 0, 0), ZOOM_STEPS.length - 1)

  const openMandala = (id) => setParams(id ? { id } : {})

  const createMandala = async (e) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    try {
      const id = await add(emptyMandala(title))
      setCreateOpen(false)
      setNewTitle('')
      if (id) {
        openMandala(id)
        if (fillWithAi) setAiOpen(true)
      }
    } catch {
      toast.error(t('common.error'))
    }
  }

  const saveCell = async (cell) => {
    if (!active || !editing) return
    setIsSaving(true)
    try {
      await update(active.id, patchForCell(active, editing, cell))
      setEditing(null)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsSaving(false)
    }
  }

  const applyAi = async (patch) => {
    if (!active) return
    setIsSaving(true)
    try {
      await update(active.id, patch)
      setAiOpen(false)
      toast.success(t('ai.fill.done'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsSaving(false)
    }
  }

  const deleteMandala = async () => {
    if (!active) return
    try {
      await remove(active.id)
      setConfirmDelete(false)
      openMandala(null)
      toast.success(t('common.done'))
    } catch {
      toast.error(t('common.error'))
    }
  }

  const editingTitle = editing && {
    center: t('mandala.mainGoal'),
    direction: t('mandala.direction', { n: (editing.d ?? 0) + 1 }),
    action: t('mandala.action', { n: (editing.a ?? 0) + 1 }),
  }[editing.kind]

  const stats = active ? mandalaStats(active) : null
  const pace = active ? mandalaPace(active) : null

  return (
    <div>
      <div className="module-header">
        <div>
          {active ? (
            <button type="button" className="btn btn-ghost btn-sm mandala-back" onClick={() => openMandala(null)}>
              ← {t('mandala.all')}
            </button>
          ) : null}
          <h2 style={{ letterSpacing: '-0.02em' }}>{active ? active.title || t('mandala.untitled') : t('nav.mandala')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {active
              ? t('mandala.statsLine', { dirs: stats.directions, done: stats.actionsDone, total: stats.actions })
              : t('mandala.subtitle')}
          </p>
        </div>
        {active ? (
          <div className="mandala-toolbar">
            <ProgressRing value={stats.progress} size={48} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAiOpen(true)}><Icon icon={Sparkles} size="1em" /> {t('ai.fill.button')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlanOpen(true)}><Icon icon={CalendarDays} size="1em" /> {t('ai.plan.button')}</button>
            <div className="mandala-zoom" role="group" aria-label={t('mandala.zoom')}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={safeZoomIndex === 0}
                onClick={() => setZoomIndex(safeZoomIndex - 1)} aria-label={t('mandala.zoomOut')}>−</button>
              <span>{Math.round(ZOOM_STEPS[safeZoomIndex] * 100)}%</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={safeZoomIndex === ZOOM_STEPS.length - 1}
                onClick={() => setZoomIndex(safeZoomIndex + 1)} aria-label={t('mandala.zoomIn')}>+</button>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
              {t('common.delete')}
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ {t('mandala.new')}</button>
        )}
      </div>

      {!active && !loading && (
        <MandalaList mandalas={mandalas} onOpen={openMandala} onCreate={() => setCreateOpen(true)} t={t} />
      )}
      {!active && activeId && !loading && <p className="text-secondary">{t('mandala.notFound')}</p>}

      {active && (
        <>
          {pace && pace.status !== 'not-started' && (
            <p className={`ai-pace ai-pace--${pace.status}`}>
              {t(`ai.pace.${pace.status}`, {
                rate: pace.weeklyRate, required: pace.requiredRate, delay: pace.delayWeeks ?? '—', date: pace.projectedDate ?? '—',
              })}
            </p>
          )}
          <p className="mandala-hint">{t('mandala.hint')}</p>
          <MandalaGrid mandala={active} zoom={ZOOM_STEPS[safeZoomIndex]} todayKey={todayKey} onOpen={setEditing} />
          <DirectionLegend mandala={active} onOpen={setEditing} t={t} />
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editingTitle || ''}>
        {editing && active && (
          <CellEditor
            key={JSON.stringify(editing)}
            cell={getCell(active, editing)}
            kind={editing.kind}
            isSaving={isSaving}
            onSave={saveCell}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('mandala.new')}>
        <form onSubmit={createMandala} className="mandala-editor">
          <label className="mandala-field">
            <span>{t('mandala.mainGoal')}</span>
            <input
              className="input"
              autoFocus
              value={newTitle}
              maxLength={LIMITS.text}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('mandala.placeholder.center')}
            />
          </label>
          <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>{t('mandala.createHint')}</p>
          <label className="mandala-check">
            <input type="checkbox" checked={fillWithAi} onChange={(e) => setFillWithAi(e.target.checked)} />
            <span><Icon icon={Sparkles} size="1em" /> {t('ai.fill.onCreate')}</span>
          </label>
          <div className="flex gap-3 justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={!newTitle.trim()}>{t('common.create')}</button>
          </div>
        </form>
      </Modal>

      <Modal open={aiOpen && !!active} onClose={() => setAiOpen(false)} title={t('ai.fill.title')} maxWidth={620}>
        {aiOpen && active && (
          <MandalaAiFill key={active.id} mandala={active} isSaving={isSaving} onApply={applyAi} onCancel={() => setAiOpen(false)} />
        )}
      </Modal>

      <Modal open={planOpen && !!active} onClose={() => setPlanOpen(false)} title={t('ai.plan.title')} maxWidth={620}>
        {planOpen && active && (
          <MandalaPlanner
            mandala={active}
            onCancel={() => setPlanOpen(false)}
            onDone={(n) => { setPlanOpen(false); toast.success(t('ai.plan.added', { n })) }}
          />
        )}
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('mandala.deleteTitle')}>
        <p className="text-secondary">{t('mandala.deleteText')}</p>
        <div className="flex gap-3 justify-between" style={{ marginTop: 'var(--space-4)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger" onClick={deleteMandala}>{t('common.delete')}</button>
        </div>
      </Modal>
    </div>
  )
}
