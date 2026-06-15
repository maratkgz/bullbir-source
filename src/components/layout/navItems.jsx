// Shared navigation definition for Sidebar / BottomNav.
const I = (props) => ({
  ...props,
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

export const NAV_ITEMS = [
  {
    to: '/app/dashboard',
    key: 'nav.dashboard',
    icon: (
      <svg {...I()}>
        <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
      </svg>
    ),
  },
  {
    to: '/app/tasks',
    key: 'nav.tasks',
    icon: (
      <svg {...I()}>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
      </svg>
    ),
  },
  {
    to: '/app/journal',
    key: 'nav.journal',
    icon: (
      <svg {...I()}>
        <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z" />
        <path d="M8 7h7M8 11h7" />
      </svg>
    ),
  },
  {
    to: '/app/calendar',
    key: 'nav.calendar',
    icon: (
      <svg {...I()}>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </svg>
    ),
  },
  {
    to: '/app/finance',
    key: 'nav.finance',
    icon: (
      <svg {...I()}>
        <path d="M3 17l5-5 4 4 8-8" />
        <path d="M16 8h4v4" />
      </svg>
    ),
  },
  {
    to: '/app/mood',
    key: 'nav.mood',
    icon: (
      <svg {...I()}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <path d="M9 9h.01M15 9h.01" />
      </svg>
    ),
  },
  {
    to: '/app/notes',
    key: 'nav.notes',
    icon: (
      <svg {...I()}>
        <path d="M4 4h12l4 4v12H4Z" />
        <path d="M16 4v4h4M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    to: '/app/goals',
    key: 'nav.goals',
    icon: (
      <svg {...I()}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </svg>
    ),
  },
  {
    to: '/app/pomodoro',
    key: 'nav.pomodoro',
    icon: (
      <svg {...I()}>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2M9 2h6" />
      </svg>
    ),
  },
  {
    to: '/app/reminders',
    key: 'nav.reminders',
    icon: (
      <svg {...I()}>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    ),
  },
]

// Items shown in the mobile bottom nav (max 5).
export const BOTTOM_NAV_ITEMS = [
  NAV_ITEMS[0],
  NAV_ITEMS[1],
  NAV_ITEMS[3],
  NAV_ITEMS[4],
  NAV_ITEMS[6],
]
