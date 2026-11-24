// One place to change BullBir module icons (Lucide). Used by navigation, the landing page
// and module headers. Import individual icons only — keeps the bundle small.
import {
  House, ListChecks, Repeat, NotebookPen, Calendar, TrendingUp, Smile, FileText, Target,
  Grid3x3, Bot, Timer, Bell, CalendarClock, PiggyBank, ChartLine, User, History, Settings,
  Trophy, GraduationCap, BookOpen,
} from 'lucide-react'

export const MODULE_ICONS = {
  dashboard: House,
  tasks: ListChecks,
  habits: Repeat,
  journal: NotebookPen,
  calendar: Calendar,
  finance: TrendingUp,
  mood: Smile,
  notes: FileText,
  goals: Target,
  mandala: Grid3x3,
  assistant: Bot,
  pomodoro: Timer,
  reminders: Bell,
  shifts: CalendarClock,
  savings: PiggyBank,
  progress: ChartLine,
  profile: User,
  history: History,
  settings: Settings,
  achievements: Trophy,
  // Reserved for upcoming learning modules.
  courses: GraduationCap,
  lessons: BookOpen,
}
