import { describe, it, expect } from 'vitest'
import { validateDomain, ITEM_TYPES, FREQS, DIRECTION_KINDS } from '../library/schema'
import { emptyCell, emptyMandala, normalizeCell, normalizeMandala, patchForCell } from '../../components/modules/mandala/mandalaModel'
import { mandalaFromDomain, makeSrc, parseSrc, resolveSrc } from './mandalaGenerator'

const L = (s) => ({ en: `${s} en`, kg: `${s} kg`, ru: `${s} ru` })
const steps = (n) => Array.from({ length: n }, (_, k) => ({ ...L(`Step ${k}`), minutes: 20 }))
const dir = (d, actionPatch = () => ({})) => ({
  title: L(`Dir ${d}`),
  milestones: [],
  actions: Array.from({ length: 8 }, (_, a) => ({ ...L(`Act ${d}.${a}`), ...actionPatch(a) })),
})
const domain = (patch = {}) => ({
  id: 'demo', icon: '*', title: L('Demo'), keywords: { en: ['demo'], kg: ['демо'], ru: ['демо'] },
  directions: Array.from({ length: 8 }, (_, d) => dir(d)),
  ...patch,
})
const withAction = (patch) => domain({ directions: Array.from({ length: 8 }, (_, d) => dir(d, (a) => (d === 0 && a === 0 ? patch : {}))) })

describe('schema extension', () => {
  it('exports the new enums', () => {
    expect(ITEM_TYPES).toEqual(['habit', 'milestone', 'quality'])
    expect(FREQS).toEqual(['daily', '3w', 'weekly'])
    expect(DIRECTION_KINDS).toEqual(['direct', 'support', 'character'])
  })

  it('keeps old domains (no new fields) valid', () => {
    expect(validateDomain(domain())).toEqual([])
  })

  it('accepts fully typed actions, direction kinds and spares', () => {
    const d = withAction({ type: 'milestone', minutes: 60, easy: L('Easy'), steps: steps(6) })
    const full = { ...d, directions: d.directions.map((x, i) => ({ ...x, kind: DIRECTION_KINDS[i % 3] })), spares: [dir(9), dir(10)] }
    expect(validateDomain(full)).toEqual([])
    expect(validateDomain(withAction({ type: 'habit', freq: '3w', minutes: 5 }))).toEqual([])
  })

  it.each([
    [{ type: 'task' }, 'type'],
    [{ freq: 'hourly' }, 'freq'],
    [{ type: 'milestone', freq: 'daily' }, 'only for habits'],
    [{ minutes: 3 }, 'minutes'],
    [{ minutes: 12.5 }, 'minutes'],
    [{ easy: { en: 'x' } }, 'easy'],
    [{ type: 'habit', steps: steps(6) }, 'steps'],
    [{ type: 'milestone', steps: steps(4) }, 'steps'],
    [{ type: 'milestone', steps: steps(13) }, 'steps'],
    [{ type: 'milestone', steps: [...steps(5), { ...L('x'), minutes: 0 }] }, 'minutes'],
  ])('rejects action %j', (patch, fragment) => {
    const errors = validateDomain(withAction(patch))
    expect(errors.join('\n')).toContain(fragment)
  })

  it('rejects a bad kind and bad spares', () => {
    const d = domain()
    expect(validateDomain({ ...d, directions: d.directions.map((x) => ({ ...x, kind: 'other' })) })[0]).toContain('kind')
    expect(validateDomain({ ...d, spares: Array.from({ length: 9 }, (_, k) => dir(k)) })[0]).toContain('spares')
    expect(validateDomain({ ...d, spares: [{ ...dir(1), actions: [] }] })[0]).toContain('spares[0].actions')
  })
})

describe('mandala cell model', () => {
  it('has defaults for the new fields', () => {
    expect(emptyCell()).toMatchObject({ type: '', freq: '', minutes: 0, src: '' })
    expect(emptyMandala('x').directions[0].kind).toBe('')
  })

  it('normalizes old docs without the new fields', () => {
    const m = normalizeMandala({ title: 'Old', directions: [{ text: 'D', actions: [{ text: 'A', done: true }] }] })
    expect(m.directions[0].actions[0]).toMatchObject({ text: 'A', done: true, type: '', freq: '', minutes: 0, src: '' })
    expect(m.directions[0].kind).toBe('')
  })

  it('keeps valid values and drops invalid ones', () => {
    expect(normalizeCell({ text: 'x', type: 'quality', freq: 'weekly', minutes: 45, src: 'health:3:5' }))
      .toMatchObject({ type: 'quality', freq: 'weekly', minutes: 45, src: 'health:3:5' })
    expect(normalizeCell({ type: 'x', freq: 'y', minutes: -3, src: 42 })).toMatchObject({ type: '', freq: '', minutes: 0, src: '' })
    expect(normalizeCell({ minutes: 999, src: 'a'.repeat(200) })).toMatchObject({ minutes: 120 })
    expect(normalizeCell({ src: 'a'.repeat(200) }).src).toHaveLength(80)
    expect(normalizeMandala({ directions: [{ kind: 'support' }, { kind: 'bad' }] }).directions.map((d) => d.kind).slice(0, 2))
      .toEqual(['support', ''])
  })

  it('keeps direction kind when a direction cell is saved', () => {
    const m = normalizeMandala({ directions: [{ text: 'D', kind: 'character' }] })
    const patch = patchForCell(m, { kind: 'direction', d: 0 }, { ...m.directions[0], text: 'New' })
    expect(patch.directions[0]).toMatchObject({ text: 'New', kind: 'character' })
  })
})

describe('library refs', () => {
  it('round-trips src refs', () => {
    expect(makeSrc('health', 3, 5)).toBe('health:3:5')
    expect(makeSrc('health', 's1')).toBe('health:s1')
    expect(makeSrc('health', 2, 4, 3)).toBe('health:2:4@3')
    expect(parseSrc('health:s1:4@2')).toEqual({ domainId: 'health', dir: 's1', action: 4, counter: 2 })
    expect(parseSrc('health:3')).toEqual({ domainId: 'health', dir: '3', action: null, counter: 0 })
    expect(parseSrc('nonsense')).toBeNull()
    expect(parseSrc('')).toBeNull()
  })

  it('resolves refs to templates, including spares', () => {
    const d = domain({ spares: [dir(7)] })
    expect(resolveSrc([d], 'demo:2:1').action.en).toBe('Act 2.1 en')
    expect(resolveSrc([d], 'demo:s0:3').action.en).toBe('Act 7.3 en')
    expect(resolveSrc([d], 'other:2:1')).toBeNull()
  })
})

describe('mandalaFromDomain with typed templates', () => {
  it('copies type/freq/minutes/src and the direction kind', () => {
    const base = withAction({ type: 'habit', freq: '3w', minutes: 40 })
    const d = { ...base, directions: base.directions.map((x, i) => (i === 0 ? { ...x, kind: 'support' } : x)) }
    const m = mandalaFromDomain(d, 'Goal', 'en')
    expect(m.directions[0].kind).toBe('support')
    expect(m.directions[0].src).toBe('demo:0')
    expect(m.directions[0].actions[0]).toMatchObject({ type: 'habit', freq: '3w', minutes: 40, src: 'demo:0:0' })
  })

  it('infers type and default minutes when the template has none', () => {
    const d = withAction({ en: 'Pass the exam', kg: 'Экзаменди тапшыруу', ru: 'Сдать экзамен' })
    const cell = mandalaFromDomain(d, 'Goal', 'ru').directions[0].actions[0]
    expect(cell).toMatchObject({ text: 'Сдать экзамен', type: 'milestone', freq: '', minutes: 60, src: 'demo:0:0' })
    const habit = mandalaFromDomain(d, 'Goal', 'en').directions[1].actions[0]
    expect(habit).toMatchObject({ type: 'habit', freq: 'daily', minutes: 20 })
  })
})
