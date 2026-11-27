import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '../../../hooks/useCollection'
import { useLocalStorage } from '../../../hooks/useLocalStorage'
import { useIsMobile } from '../../../hooks/useMediaQuery'
import { useLang } from '../../../context/LangContext'
import { useAiLibrary } from '../../../ai/useAiLibrary'
import { useToast } from '../../ui/Toast'
import Modal from '../../ui/Modal'
import { toDateKey } from '../../../utils/format'
import MandalaGrid from './MandalaGrid'
import MandalaMobile from './MandalaMobile'
import CellEditor from './CellEditor'
import MandalaAiFill from './MandalaAiFill'
import MandalaPlanner from './MandalaPlanner'
import ManualCreate from './ManualCreate'
import MandalaWizard from './wizard/MandalaWizard'
import { ProgressRing, MandalaList, DirectionLegend } from './MandalaParts'
import { mandalaPace } from '../../../ai/engine/pace'
import { regenerateItem, regenerateDirection } from '../../../ai/engine/regenerate'
import { CalendarDays, Sparkles, MessageCircle } from 'lucide-react'
import Icon from '../../ui/Icon'
import { emptyMandala, normalizeMandala, getCell, patchForCell, mandalaStats } from './mandalaModel'
import './Mandala.css'
import '../assistant/Assistant.css'

const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.2, 1.45, 1.75]
const DEFAULT_ZOOM_INDEX = 3

function ZoomControls({ index, onChange, t }) {
  return (
    <div className="mandala-zoom" role="group" aria-label={t('mandala.zoom')}>
      <button type="button" className="btn btn-secondary btn-sm" disabled={index === 0}
        onClick={() => onChange(index - 1)} aria-label={t('mandala.zoomOut')}>−</button>
      <span>{Math.round(ZOOM_STEPS[index] * 100)}%</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={index === ZOOM_STEPS.length - 1}
        onClick={() => onChange(index + 1)} aria-label={t('mandala.zoomIn')}>+</button>
    </div>
  )
}

const editorTitle = (editing, t) => editing && {
  center: t('mandala.mainGoal'),
  direction: t('mandala.direction', { n: (editing.d ?? 0) + 1 }),
  action: t('mandala.action', { n: (editing.a ?? 0) + 1 }),
}[editing.kind]

/** Cell key for the editor: changes when the cell is regenerated so the form resets. */
const editorKey = (editing, cell) => `${JSON.stringify(editing)}:${cell.src}:${cell.text}`

export default function Mandala() {
  const { items, loading, add, update, remove } = useCollection('mandalas')
  const { t, lang } = useLang()
  const toast = useToast()
  const isMobile = useIsMobile()
  const { domains } = useAiLibrary()
  const [params, setParams] = useSearchParams()
  const [zoomIndex, setZoomIndex] = useLocalStorage('bb_mandala_zoom', DEFAULT_ZOOM_INDEX)
  const [editing, setEditing] = useState(null) // cell ref
  const [isSaving, setIsSaving] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)

  const mandalas = useMemo(() => items.map((m) => normalizeMandala(m)), [items])
  const activeId = params.get('id')
  const active = mandalas.find((m) => m.id === activeId) || null
  const isWizard = !activeId && params.get('new') === '1'
  const todayKey = toDateKey()
  const safeZoomIndex = Math.min(Math.max(Number(zoomIndex) || 0, 0), ZOOM_STEPS.length - 1)

  const openMandala = (id) => setParams(id ? { id } : {})
  const openWizard = () => setParams({ new: '1' })

  // Every save is a partial update: fields this screen doesn't touch (checks, linkedIds, interview…) stay.
  const saveFields = async (patch, onSuccess) => {
    if (!active) return
    setIsSaving(true)
    try {
      await update(active.id, patch)
      onSuccess?.()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsSaving(false)
    }
  }

  const createDoc = async (doc, afterOpen) => {
    setIsSaving(true)
    try {
      const id = await add(doc)
      if (id) {
        openMandala(id)
        afterOpen?.()
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsSaving(false)
    }
  }

  const createManual = (title, fillWithAi) => {
    setManualOpen(false)
    createDoc(emptyMandala(title), fillWithAi ? () => setAiOpen(true) : undefined)
  }

  const createFromWizard = (doc) => createDoc(doc, () => toast.success(t('mandala.wizard.built')))

  const saveCell = (cell) => {
    if (!editing) return
    saveFields(patchForCell(active, editing, cell), () => setEditing(null))
  }

  const regenerate = (reason) => {
    if (!active || !editing || editing.kind === 'center') return
    const options = { domains, lang }
    const next = editing.kind === 'action'
      ? regenerateItem(active, editing.d, editing.a, reason, options)
      : regenerateDirection(active, editing.d, reason, options)
    const changed = JSON.stringify(next.directions[editing.d]) !== JSON.stringify(active.directions[editing.d])
    if (!changed) {
      toast.info(t('mandala.regen.none'))
      return
    }
    saveFields({ directions: next.directions }, () => toast.success(t('mandala.regen.done')))
  }

  const applyAi = (patch) => saveFields(patch, () => {
    setAiOpen(false)
    toast.success(t('ai.fill.done'))
  })

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

  const stats = active ? mandalaStats(active) : null
  const pace = active ? mandalaPace(active) : null
  const editingCell = editing && active ? getCell(active, editing) : null
  const heading = active ? active.title || t('mandala.untitled') : isWizard ? t('mandala.wizard.title') : t('nav.mandala')
  const subheading = active
    ? t('mandala.statsLine', { dirs: stats.directions, done: stats.actionsDone, total: stats.actions })
    : isWizard ? t('mandala.wizard.subtitle') : t('mandala.subtitle')

  return (
    <div>
      <div className="module-header">
        <div>
          {(active || isWizard) && (
            <button type="button" className="btn btn-ghost btn-sm mandala-back" onClick={() => openMandala(null)}>
              ← {t('mandala.all')}
            </button>
          )}
          <h2 style={{ letterSpacing: '-0.02em' }}>{heading}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>{subheading}</p>
        </div>
        {active && (
          <div className="mandala-toolbar">
            <ProgressRing value={stats.progress} size={48} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAiOpen(true)}><Icon icon={Sparkles} size="1em" /> {t('ai.fill.button')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlanOpen(true)}><Icon icon={CalendarDays} size="1em" /> {t('mandala.launchPlan')}</button>
            {!isMobile && <ZoomControls index={safeZoomIndex} onChange={setZoomIndex} t={t} />}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
              {t('common.delete')}
            </button>
          </div>
        )}
        {!active && !isWizard && (
          <button type="button" className="btn btn-primary" onClick={openWizard}>
            <Icon icon={MessageCircle} size="1em" /> {t('mandala.wizard.create')}
          </button>
        )}
      </div>

      {isWizard && (
        <MandalaWizard
          isBusy={isSaving}
          onCreate={createFromWizard}
          onManual={() => setManualOpen(true)}
          onCancel={() => openMandala(null)}
        />
      )}

      {!active && !isWizard && !loading && (
        <MandalaList mandalas={mandalas} onOpen={openMandala} onCreate={openWizard} onManual={() => setManualOpen(true)} t={t} />
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
          {isMobile ? (
            <MandalaMobile key={active.id} mandala={active} todayKey={todayKey} onOpen={setEditing} />
          ) : (
            <>
              <p className="mandala-hint">{t('mandala.hint')}</p>
              <MandalaGrid key={active.id} mandala={active} zoom={ZOOM_STEPS[safeZoomIndex]} todayKey={todayKey} onOpen={setEditing} />
            </>
          )}
          <DirectionLegend mandala={active} onOpen={setEditing} t={t} />
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editorTitle(editing, t) || ''}>
        {editingCell && (
          <CellEditor
            key={editorKey(editing, editingCell)}
            cell={editingCell}
            kind={editing.kind}
            isSaving={isSaving}
            onSave={saveCell}
            onRegenerate={domains.length ? regenerate : undefined}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title={t('mandala.new')}>
        {manualOpen && <ManualCreate onCreate={createManual} onCancel={() => setManualOpen(false)} />}
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
            onDone={(n) => { setPlanOpen(false); toast.success(t('launch.done', { n })) }}
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
