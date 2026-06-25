import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from 'firebase/auth'
import { doc, updateDoc, collection, getDocs } from 'firebase/firestore'
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useTheme } from '../../context/ThemeContext'
import { auth, db, storage, firebaseReady } from '../../firebase/config'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'

const XP = { task: 5, journal: 10, mood: 5, shift: 15, goal: 50, habit: 3 }
const calcLevel = (xp) => Math.floor(Math.sqrt(xp / 50)) + 1
const xpForLvl = (n) => (n - 1) * (n - 1) * 50

const TABS = ['personal', 'security', 'appearance', 'notifications', 'public', 'data']

function Toggle({ on, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`prof-toggle ${on ? 'on' : ''}`}
    >
      <motion.span
        className="prof-toggle-thumb"
        animate={{ x: on ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      />
    </button>
  )
}

function TRow({ label, sub, on, onChange }) {
  return (
    <div className="prof-trow">
      <div className="prof-trow-text">
        <span className="prof-trow-label">{label}</span>
        {sub && <span className="prof-trow-sub">{sub}</span>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  )
}

function SaveIcon({ status }) {
  if (status === 'saving') return <span className="spinner sm" style={{ width: 14, height: 14 }} />
  if (status === 'saved') return (
    <motion.svg initial={{ scale: 0 }} animate={{ scale: 1 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </motion.svg>
  )
  return null
}

function Field({ label, value, onSave, type = 'text', maxLength, hint, readOnly }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [status, setStatus] = useState(null)
  const ref = useRef(null)

  useEffect(() => { setDraft(value ?? '') }, [value])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  const commit = async () => {
    if (draft === (value ?? '')) { setEditing(false); return }
    setEditing(false)
    setStatus('saving')
    try {
      await onSave?.(draft)
      setStatus('saved')
      setTimeout(() => setStatus(null), 1500)
    } catch {
      setDraft(value ?? '')
      setStatus(null)
    }
  }

  return (
    <div className="prof-field">
      <span className="prof-field-label">{label}</span>
      <div className="prof-field-body">
        {readOnly ? (
          <span className="prof-fval">{value || '—'}</span>
        ) : editing ? (
          <input
            ref={ref}
            className="input prof-finput"
            type={type}
            value={draft}
            maxLength={maxLength}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setEditing(false); setDraft(value ?? '') }
            }}
          />
        ) : (
          <span className={`prof-fval ${!readOnly ? 'editable' : ''}`} onClick={!readOnly ? () => setEditing(true) : undefined}>
            {draft || <em className="text-muted">—</em>}
          </span>
        )}
        <div className="prof-fstatus">
          <SaveIcon status={status} />
          {!status && !readOnly && !editing && (
            <button className="prof-edit-btn" onClick={() => setEditing(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {hint && <span className="prof-field-hint">{hint}</span>}
    </div>
  )
}

export default function Profile() {
  const { user, profile, refreshProfile, resendVerification } = useAuth()
  const { t, lang, setLang, languages } = useLang()
  const { isDark, toggleTheme } = useTheme()
  const toast = useToast()

  const [tab, setTab] = useState('personal')
  const [totalXp, setTotalXp] = useState(0)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [pwForm, setPwForm] = useState({ cur: '', next: '', confirm: '' })
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [delModal, setDelModal] = useState(false)
  const [delPw, setDelPw] = useState('')
  const [delText, setDelText] = useState('')
  const [bioLen, setBioLen] = useState(0)
  const fileRef = useRef(null)

  const [fontSize, setFontSize] = useLocalStorage('bb_fontSize', 'md')
  const [startScreen, setStartScreen] = useLocalStorage('bb_startScreen', '/app/dashboard')
  const [notif, setNotif] = useLocalStorage('bb_notif', {
    master: true, tasks: true, digest: true, shifts: true, achievements: true, weekly: true, email: false,
    quietEnabled: false, quietFrom: '22:00', quietTo: '08:00',
  })
  const [isPublic, setIsPublic] = useLocalStorage('bb_public', false)
  const [pubVis, setPubVis] = useLocalStorage('bb_pubVis', { avatar: true, level: true, badges: true, streaks: false })

  useEffect(() => { setBioLen((profile?.bio || '').length) }, [profile])

  useEffect(() => {
    const map = { sm: '14px', md: '16px', lg: '18px' }
    document.documentElement.style.setProperty('--base-font-size', map[fontSize] || '16px')
  }, [fontSize])

  useEffect(() => {
    if (!user || !firebaseReady) return
    const uid = user.uid
    ;(async () => {
      try {
        const [tasks, journal, moods, shifts, goals, habits] = await Promise.all([
          getDocs(collection(db, 'users', uid, 'tasks')),
          getDocs(collection(db, 'users', uid, 'journalEntries')),
          getDocs(collection(db, 'users', uid, 'moods')),
          getDocs(collection(db, 'users', uid, 'shifts')),
          getDocs(collection(db, 'users', uid, 'savingsGoals')),
          getDocs(collection(db, 'users', uid, 'habits')),
        ])
        let xp = 0
        xp += tasks.docs.filter(d => d.data().completed).length * XP.task
        xp += journal.size * XP.journal
        xp += moods.size * XP.mood
        xp += shifts.docs.filter(d => d.data().status === 'done').length * XP.shift
        xp += goals.docs.filter(d => d.data().archived && d.data().current >= d.data().target).length * XP.goal
        habits.docs.forEach(d => { xp += (d.data().completedDates?.length || 0) * XP.habit })
        setTotalXp(xp)
      } catch {}
    })()
  }, [user])

  const providers = user?.providerData?.map(p => p.providerId) || []
  const hasEmail = providers.includes('password')
  const hasGoogle = providers.includes('google.com')

  const displayName = profile?.displayName || user?.displayName || ''
  const email = user?.email || ''
  const phone = user?.phoneNumber || profile?.phone || ''
  const photoURL = user?.photoURL || null
  const initial = (displayName || email || '?').charAt(0).toUpperCase()

  const level = calcLevel(totalXp)
  const prevLvlXp = xpForLvl(level)
  const nextLvlXp = xpForLvl(level + 1)
  const xpPct = nextLvlXp > prevLvlXp ? Math.min(100, ((totalXp - prevLvlXp) / (nextLvlXp - prevLvlXp)) * 100) : 100

  const saveField = async (field, value) => {
    if (!firebaseReady) throw new Error('not ready')
    if (field === 'displayName') await updateProfile(auth.currentUser, { displayName: value })
    await updateDoc(doc(db, 'users', user.uid), { [field]: value })
    await refreshProfile()
  }

  const pickAvatar = async (file) => {
    if (!file || !firebaseReady) return
    setAvatarBusy(true)
    try {
      const r = sRef(storage, `avatars/${user.uid}`)
      await uploadBytes(r, file)
      const url = await getDownloadURL(r)
      await updateProfile(auth.currentUser, { photoURL: url })
      await updateDoc(doc(db, 'users', user.uid), { photoURL: url })
      await refreshProfile()
      toast.success(t('profile.avatar.updated'))
    } catch (e) { toast.error(e.message) }
    finally { setAvatarBusy(false) }
  }

  const changePw = async () => {
    if (pwForm.next !== pwForm.confirm) { setPwErr(t('auth.passwordMatch')); return }
    if (pwForm.next.length < 6) { setPwErr(t('auth.passwordShort')); return }
    setPwErr(''); setPwBusy(true)
    try {
      const cred = EmailAuthProvider.credential(email, pwForm.cur)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, pwForm.next)
      setPwForm({ cur: '', next: '', confirm: '' })
      toast.success(t('profile.security.pwChanged'))
    } catch (e) { setPwErr(e.message) }
    finally { setPwBusy(false) }
  }

  const doDelete = async () => {
    try {
      if (hasEmail && delPw) {
        await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(email, delPw))
      }
      await deleteUser(auth.currentUser)
    } catch (e) { toast.error(e.message) }
  }

  const exportData = async () => {
    if (!firebaseReady) return
    toast.info(t('profile.data.exporting'))
    try {
      const cols = ['tasks', 'journalEntries', 'moods', 'shifts', 'savingsGoals', 'habits', 'transactions']
      const out = { at: new Date().toISOString(), user: { uid: user.uid, email, displayName } }
      for (const c of cols) {
        const snap = await getDocs(collection(db, 'users', user.uid, c))
        out[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      }
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })),
        download: `bullbir-${Date.now()}.json`,
      })
      a.click(); URL.revokeObjectURL(a.href)
      toast.success(t('profile.data.exported'))
    } catch (e) { toast.error(e.message) }
  }

  const clearCache = async () => {
    try {
      if ('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)))
      toast.success(t('profile.data.cacheCleared'))
    } catch { toast.error('Error') }
  }

  const pubLink = `https://bullbir.app/u/${(displayName || 'user').toLowerCase().replace(/\s+/g, '_')}`
  const confirmWord = lang === 'ru' ? 'УДАЛИТЬ' : 'DELETE'

  const createdDate = profile?.createdAt?.toDate
    ? profile.createdAt.toDate().toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'kg' ? 'ky-KG' : 'en-US', { month: 'long', year: 'numeric' })
    : null

  return (
    <div>
      {/* Hero */}
      <div className="prof-cover">
        <div className="prof-cover-glow" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setTab('personal')} style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}>
            ✏ {t('common.edit')}
          </button>
        </div>
      </div>
      <div className="prof-hero-body">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -48 }}>
          <button className="prof-avatar-btn" onClick={() => fileRef.current?.click()} disabled={avatarBusy}>
            {photoURL
              ? <img src={photoURL} alt="" className="prof-avatar-img" />
              : <div className="prof-avatar-ph">{initial}</div>
            }
            <div className="prof-avatar-ov">
              {avatarBusy
                ? <span className="spinner" style={{ borderColor: 'white', borderTopColor: 'transparent' }} />
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              }
            </div>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={e => { if (e.target.files?.[0]) pickAvatar(e.target.files[0]); e.target.value = '' }} />
        <div style={{ marginTop: 12 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>{displayName || t('profile.noName')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
            {email}{createdDate && ` · с ${createdDate}`}
          </div>
        </div>

        {/* XP Level card */}
        <div className="card" style={{ marginTop: 20, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>⭐</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                {t('profile.level')} {level}
              </span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#9a8cff' }}>
              {totalXp - prevLvlXp} / {nextLvlXp - prevLvlXp} XP
            </span>
          </div>
          <div style={{ height: 10, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden', marginTop: 14 }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${xpPct}%` }}
              transition={{ duration: 0.9, delay: 0.2, ease: 'easeOut' }}
              style={{ height: '100%', background: 'linear-gradient(90deg,#7c5cff,#9a8cff)', borderRadius: 99 }}
            />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500, marginTop: 10 }}>
            До уровня {level + 1} осталось {nextLvlXp - totalXp} XP
          </div>
        </div>

        {/* Achievements */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 14 }}>
            Достижения
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[
              { emoji: '🔥', label: 'Стрик', bg: '#5b4fcf' },
              { emoji: '⭐', label: 'Лучший день', bg: '#f47a55' },
              { emoji: '📚', label: 'Знания', bg: '#5ad1a5' },
              { emoji: '💰', label: 'Финансы', bg: '#f0c45a' },
            ].map(b => (
              <div key={b.emoji} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: b.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{b.emoji}</div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{b.label}</span>
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface-2)', border: '1.5px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, opacity: 0.5 }}>🔒</div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center' }}>Скоро</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="prof-tabs-wrap">
        <div className="prof-tabs">
          {TABS.map(k => (
            <button key={k} className={`prof-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {tab === k && <motion.span layoutId="prof-ind" className="prof-tab-ind" />}
              <span className="prof-tab-label">{t(`profile.tab.${k}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }} className="prof-stack">

          {/* ── Personal ── */}
          {tab === 'personal' && <>
            <div className="card prof-card-inner">
              <Field label={t('profile.field.displayName')} value={displayName} onSave={v => saveField('displayName', v)} maxLength={40} />
              <Field label={t('profile.field.firstName')} value={profile?.firstName || ''} onSave={v => saveField('firstName', v)} maxLength={30} />
              <Field label={t('profile.field.lastName')} value={profile?.lastName || ''} onSave={v => saveField('lastName', v)} maxLength={30} />
            </div>

            <div className="card prof-card-inner">
              <div className="prof-field">
                <span className="prof-field-label">{t('profile.field.email')}</span>
                <div className="prof-field-body">
                  <span className="prof-fval">{email || '—'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`prof-badge ${user?.emailVerified ? 'success' : 'warn'}`}>
                      {user?.emailVerified ? `✓ ${t('profile.email.verified')}` : t('profile.email.unverified')}
                    </span>
                    {!user?.emailVerified && (
                      <button className="btn btn-ghost btn-sm" onClick={async () => { await resendVerification(); toast.success(t('profile.email.sent')) }}>
                        {t('profile.email.resend')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {phone && (
                <div className="prof-field">
                  <span className="prof-field-label">{t('profile.field.phone')}</span>
                  <div className="prof-field-body">
                    <span className="prof-fval">{phone}</span>
                    <span className="prof-badge success">✓</span>
                  </div>
                </div>
              )}

              <div className="prof-field">
                <span className="prof-field-label">{t('profile.field.bio')}</span>
                <div style={{ flex: 1 }}>
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={150}
                    defaultValue={profile?.bio || ''}
                    placeholder={t('profile.field.bioPlaceholder')}
                    onChange={e => setBioLen(e.target.value.length)}
                    onBlur={e => saveField('bio', e.target.value)}
                    style={{ resize: 'vertical', fontFamily: 'inherit', display: 'block', width: '100%' }}
                  />
                  <span className="prof-field-hint">{bioLen}/150</span>
                </div>
              </div>

              <Field label={t('profile.field.birthDate')} value={profile?.birthDate || ''} type="date" onSave={v => saveField('birthDate', v)} />
            </div>

            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.field.language')}</span>
              <div className="prof-lang-row">
                {languages.map(l => (
                  <button key={l.code} className={`prof-lang-btn ${lang === l.code ? 'active' : ''}`} onClick={() => setLang(l.code)}>
                    <span style={{ fontSize: 18 }}>{l.flag}</span> {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card prof-card-inner">
              <div className="prof-field">
                <span className="prof-field-label">{t('profile.field.timezone')}</span>
                <div className="prof-field-body">
                  <span className="prof-fval">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                </div>
              </div>
            </div>
          </>}

          {/* ── Security ── */}
          {tab === 'security' && <>
            {hasEmail ? (
              <div className="card prof-card-inner">
                <span className="prof-card-title">{t('profile.security.password')}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  <input className="input" type="password" placeholder={t('profile.security.currentPw')} value={pwForm.cur} onChange={e => setPwForm(p => ({ ...p, cur: e.target.value }))} />
                  <input className="input" type="password" placeholder={t('profile.security.newPw')} value={pwForm.next} onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))} />
                  <input className="input" type="password" placeholder={t('profile.security.confirmPw')} value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
                  {pwErr && <p style={{ color: 'var(--error)', fontSize: 'var(--text-sm)' }}>{pwErr}</p>}
                  <button className="btn btn-primary" disabled={pwBusy || !pwForm.cur || !pwForm.next || !pwForm.confirm} onClick={changePw}>
                    {pwBusy ? <span className="spinner" /> : t('profile.security.changePw')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="card prof-card-inner">
                <p className="text-muted">{t('profile.security.googleOnly')}</p>
              </div>
            )}

            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.security.linked')}</span>
              <div className="prof-provider-list">
                {[
                  { label: 'Email', linked: hasEmail, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> },
                  { label: 'Google', linked: hasGoogle, icon: <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 0 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44c11 0 20-8.9 20-20 0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5.1A20 20 0 0 0 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.6 35.6 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg> },
                  ...(phone ? [{ label: t('profile.field.phone'), linked: true, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.4 2 2 0 0 1 3.6 2.22h3a2 2 0 0 1 2 1.72c.128.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.572 2.81.7A2 2 0 0 1 22 16.92z"/></svg> }] : []),
                ].map(({ label, linked, icon }) => (
                  <div key={label} className="prof-provider">
                    {icon}
                    <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
                    <span className={`prof-badge ${linked ? 'success' : 'muted'}`}>{linked ? `✓ ${t('profile.security.isLinked')}` : t('profile.security.notLinked')}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card prof-card-inner prof-danger-zone">
              <span className="prof-card-title" style={{ color: 'var(--error)' }}>{t('profile.security.danger')}</span>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)', margin: '8px 0 16px' }}>{t('profile.security.deleteWarn')}</p>
              <button className="btn prof-delete-btn" onClick={() => setDelModal(true)}>
                {t('profile.security.deleteBtn')}
              </button>
            </div>
          </>}

          {/* ── Appearance ── */}
          {tab === 'appearance' && <>
            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.appearance.theme')}</span>
              <div className="prof-choice-row">
                {[['light', '☀️', !isDark], ['dark', '🌙', isDark]].map(([k, emoji, active]) => (
                  <button key={k} className={`prof-choice-btn ${active ? 'active' : ''}`}
                    onClick={() => { if ((k === 'dark' && !isDark) || (k === 'light' && isDark)) toggleTheme() }}>
                    {emoji} {t(`profile.appearance.${k}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.appearance.fontSize')}</span>
              <div className="prof-choice-row">
                {[['sm', t('profile.appearance.fontSm'), 13], ['md', t('profile.appearance.fontMd'), 16], ['lg', t('profile.appearance.fontLg'), 19]].map(([k, label, sz]) => (
                  <button key={k} className={`prof-choice-btn ${fontSize === k ? 'active' : ''}`} onClick={() => setFontSize(k)} style={{ fontSize: sz }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.appearance.startScreen')}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {[['dashboard', 'nav.dashboard'], ['tasks', 'nav.tasks'], ['journal', 'nav.journal'], ['finance', 'nav.finance'], ['mood', 'nav.mood']].map(([slug, key]) => (
                  <button key={slug} className={`prof-choice-btn full ${startScreen === `/app/${slug}` ? 'active' : ''}`} onClick={() => setStartScreen(`/app/${slug}`)}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          </>}

          {/* ── Notifications ── */}
          {tab === 'notifications' && <>
            <div className="card prof-card-inner">
              <TRow label={t('profile.notif.master')} sub={t('profile.notif.masterSub')} on={notif.master} onChange={v => setNotif(p => ({ ...p, master: v }))} />
            </div>

            <div className="card prof-card-inner" style={{ opacity: notif.master ? 1 : 0.45, pointerEvents: notif.master ? 'auto' : 'none' }}>
              <span className="prof-card-title">{t('profile.notif.types')}</span>
              {[['tasks','profile.notif.tasks'],['digest','profile.notif.digest'],['shifts','profile.notif.shifts'],['achievements','profile.notif.achievements'],['weekly','profile.notif.weekly'],['email','profile.notif.email']].map(([k, lk]) => (
                <TRow key={k} label={t(lk)} on={notif[k]} onChange={v => setNotif(p => ({ ...p, [k]: v }))} />
              ))}
            </div>

            <div className="card prof-card-inner">
              <TRow label={t('profile.notif.quiet')} sub={t('profile.notif.quietSub')} on={notif.quietEnabled} onChange={v => setNotif(p => ({ ...p, quietEnabled: v }))} />
              <AnimatePresence>
                {notif.quietEnabled && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <div className="prof-quiet-row">
                      <label className="prof-quiet-label">{t('profile.notif.from')}
                        <input type="time" className="input" style={{ width: 'auto', marginTop: 6 }} value={notif.quietFrom} onChange={e => setNotif(p => ({ ...p, quietFrom: e.target.value }))} />
                      </label>
                      <label className="prof-quiet-label">{t('profile.notif.to')}
                        <input type="time" className="input" style={{ width: 'auto', marginTop: 6 }} value={notif.quietTo} onChange={e => setNotif(p => ({ ...p, quietTo: e.target.value }))} />
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>}

          {/* ── Public Profile ── */}
          {tab === 'public' && <>
            <div className="card prof-card-inner">
              <TRow label={t('profile.public.toggle')} sub={t('profile.public.toggleSub')} on={isPublic} onChange={setIsPublic} />
              <AnimatePresence>
                {isPublic && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <div className="prof-pub-link-row">
                      <span className="prof-pub-link">{pubLink}</span>
                      <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(pubLink); toast.success(t('profile.public.copied')) }}>
                        {t('profile.public.copy')}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {isPublic && <>
              <div className="card prof-card-inner">
                <span className="prof-card-title">{t('profile.public.show')}</span>
                {[['avatar','profile.public.showAvatar'],['level','profile.public.showLevel'],['badges','profile.public.showBadges'],['streaks','profile.public.showStreaks']].map(([k,lk]) => (
                  <TRow key={k} label={t(lk)} on={pubVis[k]} onChange={v => setPubVis(p => ({ ...p, [k]: v }))} />
                ))}
              </div>

              <div className="card prof-card-inner">
                <span className="prof-card-title">{t('profile.public.preview')}</span>
                <div className="prof-pub-preview">
                  {pubVis.avatar && (
                    photoURL
                      ? <img src={photoURL} alt="" className="prof-pub-avatar" />
                      : <div className="prof-pub-avatar-ph">{initial}</div>
                  )}
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{displayName || email}</p>
                    {pubVis.level && <p style={{ color: 'var(--primary)', fontSize: 'var(--text-sm)', margin: '4px 0' }}>{t('profile.level')} {level} · {totalXp} XP</p>}
                    {createdDate && <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{t('profile.public.since')} {createdDate}</p>}
                  </div>
                </div>
              </div>
            </>}
          </>}

          {/* ── Data ── */}
          {tab === 'data' && <>
            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.data.export')}</span>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)', margin: '8px 0 16px' }}>{t('profile.data.exportDesc')}</p>
              <button className="btn btn-secondary" onClick={exportData}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {t('profile.data.exportBtn')}
              </button>
            </div>

            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.data.cache')}</span>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)', margin: '8px 0 16px' }}>{t('profile.data.cacheDesc')}</p>
              <button className="btn btn-secondary" onClick={clearCache}>{t('profile.data.clearBtn')}</button>
            </div>

            <div className="card prof-card-inner">
              <span className="prof-card-title">{t('profile.data.plan')}</span>
              <div className="prof-plan-badge">✨ {t('profile.data.free')}</div>
            </div>
          </>}

        </motion.div>
      </AnimatePresence>

      {/* Delete modal */}
      <Modal open={delModal} onClose={() => { setDelModal(false); setDelPw(''); setDelText('') }} title={t('profile.security.deleteBtn')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ color: 'var(--error)', fontSize: 'var(--text-sm)' }}>{t('profile.security.deleteWarn')}</p>
          {hasEmail && (
            <input className="input" type="password" placeholder={t('profile.security.currentPw')} value={delPw} onChange={e => setDelPw(e.target.value)} />
          )}
          <input className="input" placeholder={`${t('profile.security.typeConfirm')}: "${confirmWord}"`} value={delText} onChange={e => setDelText(e.target.value)} />
          <button className="btn" style={{ background: 'var(--error)', color: '#fff', border: 'none' }} disabled={delText !== confirmWord} onClick={doDelete}>
            {t('profile.security.deleteBtn')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
