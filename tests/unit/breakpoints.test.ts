import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without type declarations
import { BREAKPOINTS, breakpointFor, down, up } from '../../src/styles/breakpoints.js'

describe('breakpoints', () => {
  it('uses the agreed list', () => {
    expect(BREAKPOINTS).toEqual({ xs: 320, sm: 360, md: 600, lg: 900, xl: 1200, '2xl': 1600 })
  })

  it.each([
    [300, 'xs'], [320, 'xs'], [359, 'xs'], [360, 'sm'], [599, 'sm'], [600, 'md'],
    [768, 'md'], [899, 'md'], [900, 'lg'], [1024, 'lg'], [1199, 'lg'], [1200, 'xl'],
    [1366, 'xl'], [1599, 'xl'], [1600, '2xl'], [1920, '2xl'],
  ])('width %i → %s', (width, name) => {
    expect(breakpointFor(width)).toBe(name)
  })

  it('builds min/max queries without overlap', () => {
    expect(up('md')).toBe('(min-width: 600px)')
    expect(down('md')).toBe('(max-width: 599px)')
  })
})
