import { describe, it, expect } from 'vitest'
import { regenerateItem, regenerateDirection, lighterCell } from './regenerate'
import { mandalaFromDomain } from './mandalaGenerator'
import { normalizeMandala } from '../../components/modules/mandala/mandalaModel'

const L = (s) => ({ en: `${s} en`, kg: `${s} kg`, ru: `${s} ru` })
const dir = (prefix, d, patch = () => ({})) => ({
  title: L(`${prefix} Dir ${d}`),
  milestones: [],
  actions: Array.from({ length: 8 }, (_, a) => ({ ...L(`${prefix} Act ${d}.${a}`), ...patch(a) })),
})
const mkDomain = (id, prefix, { spares = 0, patch } = {}) => ({
  id, icon: '*', title: L(id), keywords: { en: [id], kg: [id], ru: [id] },
  directions: Array.from({ length: 8 }, (_, d) => dir(prefix, d, patch && ((a) => patch(d, a)))),
  spares: Array.from({ length: spares }, (_, k) => dir(`${prefix} Spare`, k)),
})

const HEALTH = mkDomain('health', 'H', {
  spares: 2,
  patch: (d, a) => (d === 0 && a === 0
    ? { type: 'habit', freq: 'daily', minutes: 40, easy: L('Easy run') }
    : { type: 'habit', freq: 'daily', minutes: 30 }),
})
const UNIVERSAL = mkDomain('universal', 'U')
const DOMAINS = [UNIVERSAL, HEALTH]
const OPTS = { domains: DOMAINS, lang: 'en' }
const base = () => ({ id: 'm1', ...normalizeMandala(mandalaFromDomain(HEALTH, 'Run', 'en')) })
const snapshot = (m) => JSON.stringify(m)

describe('regenerateItem — too_hard', () => {
  it('uses the library easy variant first', () => {
    const m = base()
    const before = snapshot(m)
    const next = regenerateItem(m, 0, 0, 'too_hard', OPTS)
    expect(next.directions[0].actions[0]).toMatchObject({ text: 'Easy run en', minutes: 20, src: 'health:0:0' })
    expect(snapshot(m)).toBe(before)
    expect(next).not.toBe(m)
  })

  it('then lightens: halves minutes (min 5) and lowers frequency daily → 3w → weekly', () => {
    let m = regenerateItem(base(), 0, 0, 'too_hard', OPTS)
    m = regenerateItem(m, 0, 0, 'too_hard', OPTS)
    expect(m.directions[0].actions[0]).toMatchObject({ text: 'Easy run en', minutes: 10, freq: '3w' })
    m = regenerateItem(m, 0, 0, 'too_hard', OPTS)
    m = regenerateItem(m, 0, 0, 'too_hard', OPTS)
    expect(m.directions[0].actions[0]).toMatchObject({ minutes: 5, freq: 'weekly' })
  })

  it('lightens a cell without a template (user-written)', () => {
    expect(lighterCell({ text: 'Mine', type: 'habit', freq: '', minutes: 0, src: '' }))
      .toMatchObject({ text: 'Mine', minutes: 10, freq: '3w' })
    expect(lighterCell({ text: 'Big', type: 'milestone', freq: '', minutes: 60, src: '' }))
      .toMatchObject({ minutes: 30, freq: '' })
  })
})

describe('regenerateItem — not_me', () => {
  it('picks an action not already in the mandala, from the same direction first', () => {
    const m = base()
    const hollow = { ...m, directions: m.directions.map((d, k) => (k === 1 ? { ...d, actions: d.actions.map((a, j) => (j === 0 ? { ...a, text: '' } : a)) } : d)) }
    // Direction 0 is full in the mandala, so its own actions are excluded; next comes direction 1's free one.
    const next = regenerateItem(hollow, 0, 0, 'not_me', OPTS)
    expect(next.directions[0].actions[0]).toMatchObject({ text: 'H Act 1.0 en', src: 'health:1:0@1', type: 'habit' })
  })

  it('takes spares, then the universal domain, and rotates deterministically', () => {
    const m = base()
    const a = regenerateItem(m, 0, 0, 'not_me', OPTS)
    const b = regenerateItem(m, 0, 0, 'not_me', OPTS)
    expect(a).toEqual(b) // deterministic
    expect(a.directions[0].actions[0].text).toBe('H Spare Act 0.0 en')
    const c = regenerateItem(a, 0, 0, 'not_me', OPTS)
    expect(c.directions[0].actions[0].src).toMatch(/@2$/)
    expect(c.directions[0].actions[0].text).not.toBe(a.directions[0].actions[0].text)
  })

  it('falls back to universal when the domain has nothing left', () => {
    const noSpares = { ...HEALTH, spares: [] }
    const m = { id: 'm', ...normalizeMandala(mandalaFromDomain(noSpares, 'Run', 'en')) }
    const next = regenerateItem(m, 3, 2, 'not_me', { domains: [UNIVERSAL, noSpares], lang: 'en' })
    expect(next.directions[3].actions[2].src).toMatch(/^universal:/)
  })

  it('never replaces a done cell and ignores unknown reasons / bad indexes', () => {
    const m = base()
    const done = { ...m, directions: m.directions.map((d, k) => (k === 0 ? { ...d, actions: d.actions.map((a, j) => (j === 0 ? { ...a, done: true } : a)) } : d)) }
    expect(regenerateItem(done, 0, 0, 'not_me', OPTS).directions[0].actions[0].text).toBe('H Act 0.0 en')
    expect(regenerateItem(m, 0, 0, 'whatever', OPTS)).toEqual(m)
    expect(regenerateItem(m, 9, 0, 'not_me', OPTS)).toEqual(m)
  })

  it('works for user cells without src, using the mandala goal', () => {
    const m = normalizeMandala({ title: 'Run', center: { text: 'Run' }, directions: [{ text: 'Mine', actions: [{ text: 'My own thing' }] }] })
    const next = regenerateItem(m, 0, 0, 'not_me', { domains: [UNIVERSAL], lang: 'ru' })
    expect(next.directions[0].actions[0]).toMatchObject({ text: 'U Act 0.0 ru', src: 'universal:0:0@1' })
  })
})

describe('regenerateDirection', () => {
  it('replaces title and actions from spares but keeps done cells', () => {
    const m = base()
    const withDone = { ...m, directions: m.directions.map((d, k) => (k === 2 ? { ...d, actions: d.actions.map((a, j) => (j === 4 ? { ...a, done: true, doneAt: '2026-01-01' } : a)) } : d)) }
    const before = snapshot(withDone)
    const next = regenerateDirection(withDone, 2, 'not_me', OPTS)
    expect(next.directions[2]).toMatchObject({ text: 'H Spare Dir 0 en', src: 'health:s0@1' })
    expect(next.directions[2].actions[0]).toMatchObject({ text: 'H Spare Act 0.0 en', src: 'health:s0:0' })
    expect(next.directions[2].actions[4]).toMatchObject({ text: 'H Act 2.4 en', done: true })
    expect(next.directions[1]).toBe(withDone.directions[1])
    expect(snapshot(withDone)).toBe(before)
  })

  it('rotates spares, then universal directions', () => {
    let m = regenerateDirection(base(), 2, 'not_me', OPTS)
    m = regenerateDirection(m, 2, 'not_me', OPTS)
    expect(m.directions[2].text).toBe('H Spare Dir 1 en')
    m = regenerateDirection(m, 2, 'not_me', OPTS)
    expect(m.directions[2].src).toMatch(/^universal:/)
  })

  it('too_hard lightens every open action of the direction', () => {
    const next = regenerateDirection(base(), 1, 'too_hard', OPTS)
    expect(next.directions[1].actions.every((a) => a.minutes === 15 && a.freq === '3w')).toBe(true)
    expect(next.directions[0]).toEqual(base().directions[0])
  })
})
