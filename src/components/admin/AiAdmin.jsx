import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import { useAiLibrary, AI_DOMAINS_COLLECTION, AI_INTENTS_COLLECTION } from '../../ai/useAiLibrary'
import { useIsAdmin } from '../../ai/useAiState'
import { pick } from '../../ai/library/schema'
import { BUILTIN_DOMAINS, BUILTIN_INTENTS } from '../../ai/library'
import DomainEditor, { emptyDomain } from './DomainEditor'
import IntentEditor, { emptyIntent } from './IntentEditor'
import { saveEntry, disableEntry, removeEntry, downloadJson, cleanEntry } from './adminIo'
import { Ban, Lock, MessageCircle, Settings } from 'lucide-react'
import Icon from '../ui/Icon'
import '../modules/assistant/Assistant.css'

const builtinDomainIds = new Set(BUILTIN_DOMAINS.map((d) => d.id))
const builtinIntentIds = new Set(BUILTIN_INTENTS.map((i) => i.id))

function Row({ label, source, onEdit, onDisable, onReset, t }) {
  return (
    <div className="card ai-admin-row">
      <strong>{label}</strong>
      <span className={`ai-tag ai-tag--${source}`}>{t(`ai.admin.source.${source}`)}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>{t('ai.admin.edit')}</button>
      {onDisable && <button type="button" className="btn btn-ghost btn-sm" onClick={onDisable}>{t('ai.admin.disable')}</button>}
      {onReset && <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>{t('ai.admin.reset')}</button>}
    </div>
  )
}

/** Admin-only editor of the assistant's knowledge library (Firestore over built-in files). */
export default function AiAdmin() {
  const { t, lang } = useLang()
  const toast = useToast()
  const isAdmin = useIsAdmin()
  const { domains, intents, remoteDomains, remoteIntents, rejected } = useAiLibrary()
  const [editing, setEditing] = useState(null) // { kind: 'domain'|'intent', item, isNew }
  const [isSaving, setIsSaving] = useState(false)

  if (!isAdmin) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7)' }}>
        <h3><Icon icon={Lock} size="1em" /> {t('ai.admin.only')}</h3>
        <p className="text-secondary">{t('ai.admin.howTo')}</p>
        <Link className="btn btn-secondary" to="/app/assistant">← {t('nav.assistant')}</Link>
      </div>
    )
  }

  const run = async (fn, okKey = 'common.saved') => {
    setIsSaving(true)
    try { await fn(); toast.success(t(okKey)); setEditing(null) } catch { toast.error(t('common.error')) } finally { setIsSaving(false) }
  }

  const disabledDomains = remoteDomains.filter((d) => d.disabled)
  const disabledIntents = remoteIntents.filter((d) => d.disabled)
  const collectionOf = (kind) => (kind === 'domain' ? AI_DOMAINS_COLLECTION : AI_INTENTS_COLLECTION)
  const resetHandler = (kind, item) => (item.source === 'builtin' ? null : () => run(() => removeEntry(collectionOf(kind), item.id)))
  const disableHandler = (kind, item, builtinIds) => (builtinIds.has(item.id) ? () => run(() => disableEntry(collectionOf(kind), item.id)) : () => run(() => removeEntry(collectionOf(kind), item.id)))

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="module-header">
        <div>
          <h2><Icon icon={Settings} size="1em" /> {t('ai.admin.title')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{t('ai.admin.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => downloadJson('bullbir-ai-library.json', { domains: domains.map(cleanEntry), intents: intents.map(cleanEntry) })}>
          {t('ai.admin.exportAll')}
        </button>
      </div>

      {rejected.length > 0 && (
        <div className="card"><strong>{t('ai.admin.rejected')}</strong>
          <ul className="ai-errors">{rejected.map((r) => <li key={r.id}>{r.id}: {r.problems[0]}</li>)}</ul>
        </div>
      )}

      <div className="module-header">
        <h3>{t('ai.admin.domains', { n: domains.length })}</h3>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ kind: 'domain', item: emptyDomain(), isNew: true })}>+ {t('ai.admin.newDomain')}</button>
      </div>
      <div className="ai-admin-list">
        {domains.map((d) => (
          <Row key={d.id} t={t} label={`${d.icon} ${pick(d.title, lang)} (${d.id})`} source={d.source}
            onEdit={() => setEditing({ kind: 'domain', item: d, isNew: false })}
            onDisable={d.id === 'universal' ? null : disableHandler('domain', d, builtinDomainIds)}
            onReset={resetHandler('domain', d)} />
        ))}
        {disabledDomains.map((d) => (
          <Row key={d.id} t={t} label={<><Icon icon={Ban} size="1em" /> {d.id}</>} source="override" onEdit={() => run(() => removeEntry(AI_DOMAINS_COLLECTION, d.id))} />
        ))}
      </div>

      <div className="module-header">
        <h3>{t('ai.admin.intents', { n: intents.length })}</h3>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ kind: 'intent', item: emptyIntent(), isNew: true })}>+ {t('ai.admin.newIntent')}</button>
      </div>
      <div className="ai-admin-list">
        {intents.map((i) => (
          <Row key={i.id} t={t} label={<><Icon icon={MessageCircle} size="1em" /> {i.id} — {(i.patterns?.[lang] || i.patterns?.ru || [])[0] || ''}</>} source={i.source}
            onEdit={() => setEditing({ kind: 'intent', item: i, isNew: false })}
            onDisable={i.id === 'fallback' ? null : disableHandler('intent', i, builtinIntentIds)}
            onReset={resetHandler('intent', i)} />
        ))}
        {disabledIntents.map((i) => (
          <Row key={i.id} t={t} label={<><Icon icon={Ban} size="1em" /> {i.id}</>} source="override" onEdit={() => run(() => removeEntry(AI_INTENTS_COLLECTION, i.id))} />
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.isNew ? t('ai.admin.create') : t('ai.admin.edit')} maxWidth={900}>
        {editing?.kind === 'domain' && (
          <DomainEditor key={editing.item.id || 'new'} initial={editing.item} isNew={editing.isNew} isSaving={isSaving}
            onCancel={() => setEditing(null)} onSave={(d) => run(() => saveEntry(AI_DOMAINS_COLLECTION, d))} />
        )}
        {editing?.kind === 'intent' && (
          <IntentEditor key={editing.item.id || 'new'} initial={editing.item} isNew={editing.isNew} isSaving={isSaving}
            onCancel={() => setEditing(null)} onSave={(i) => run(() => saveEntry(AI_INTENTS_COLLECTION, i))} />
        )}
      </Modal>
    </div>
  )
}
