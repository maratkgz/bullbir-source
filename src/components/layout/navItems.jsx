// Shared navigation definition for Sidebar / BottomNav.
// Icons come from src/config/moduleIcons.js — change a module icon there.
import Icon from '../ui/Icon'
import { MODULE_ICONS } from '../../config/moduleIcons'

const NAV_ICON_SIZE = 22
const navIcon = (module) => <Icon icon={MODULE_ICONS[module]} size={NAV_ICON_SIZE} />

export const NAV_ITEMS = [
  { to: '/app/dashboard', key: 'nav.dashboard', icon: navIcon('dashboard') },
  { to: '/app/tasks', key: 'nav.tasks', icon: navIcon('tasks') },
  { to: '/app/habits', key: 'nav.habits', icon: navIcon('habits') },
  { to: '/app/journal', key: 'nav.journal', icon: navIcon('journal') },
  { to: '/app/calendar', key: 'nav.calendar', icon: navIcon('calendar') },
  { to: '/app/finance', key: 'nav.finance', icon: navIcon('finance') },
  { to: '/app/mood', key: 'nav.mood', icon: navIcon('mood') },
  { to: '/app/notes', key: 'nav.notes', icon: navIcon('notes') },
  { to: '/app/goals', key: 'nav.goals', icon: navIcon('goals') },
  { to: '/app/mandala', key: 'nav.mandala', icon: navIcon('mandala') },
  { to: '/app/assistant', key: 'nav.assistant', icon: navIcon('assistant') },
  { to: '/app/pomodoro', key: 'nav.pomodoro', icon: navIcon('pomodoro') },
  { to: '/app/reminders', key: 'nav.reminders', icon: navIcon('reminders') },
  { to: '/app/shifts', key: 'shift.nav', icon: navIcon('shifts') },
  { to: '/app/savings', key: 'sav.nav', icon: navIcon('savings') },
  { to: '/app/progress', key: 'prog.nav', icon: navIcon('progress') },
  { to: '/app/profile', key: 'nav.profile', icon: navIcon('profile') },
  { to: '/app/completion-history', key: 'nav.history', icon: navIcon('history') },
]

// Items shown in the mobile bottom nav (max 5).
const BOTTOM_NAV_PATHS = [
  '/app/dashboard',
  '/app/tasks',
  '/app/journal',
  '/app/calendar',
  '/app/progress',
]

export const BOTTOM_NAV_ITEMS = BOTTOM_NAV_PATHS.map((path) =>
  NAV_ITEMS.find((item) => item.to === path),
)
