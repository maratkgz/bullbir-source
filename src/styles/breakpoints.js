// The one list of BullBir breakpoints (mobile-first, min-width). CSS media queries can't read
// variables, so stylesheets use these same numbers literally — see the comment in variables.css.
//   xs  320–359   small phones
//   sm  360–599   phones            → bottom navigation
//   md  600–899   large phones / small tablets → icon-only sidebar
//   lg  900–1199  tablets / small laptops      → compact sidebar with labels
//   xl  1200–1599 laptops / desktops           → full sidebar
//   2xl 1600+     large screens                → full sidebar, content centred at 1440px
export const BREAKPOINTS = Object.freeze({ xs: 320, sm: 360, md: 600, lg: 900, xl: 1200, '2xl': 1600 })

const ORDER = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']

/** `(min-width: …px)` query for a breakpoint name. */
export const up = (name) => `(min-width: ${BREAKPOINTS[name]}px)`

/** `(max-width: …px)` query: strictly below the breakpoint. */
export const down = (name) => `(max-width: ${BREAKPOINTS[name] - 1}px)`

/** Breakpoint name for a viewport width (widths under 320 count as xs). */
export function breakpointFor(width) {
  let current = 'xs'
  ORDER.forEach((name) => {
    if (width >= BREAKPOINTS[name]) current = name
  })
  return current
}
