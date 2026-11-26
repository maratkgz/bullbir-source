import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'

import { useAuth } from './context/AuthContext'
import { useOnlineStatus } from './hooks/useOnlineStatus'

import Splash from './components/ui/Splash'
import Offline from './components/Offline'
import AppLayout from './components/layout/AppLayout'
import PrivateRoute, { SessionUnavailable } from './components/auth/PrivateRoute'

import Login from './components/auth/Login'
import Register from './components/auth/Register'
import VerifyEmail from './components/auth/VerifyEmail'
import ForgotPassword from './components/auth/ForgotPassword'
import Onboarding from './components/onboarding/Onboarding'

import Dashboard from './components/modules/Dashboard'
import TaskTracker from './components/modules/TaskTracker'
import Journal from './components/modules/Journal'
import Calendar from './components/modules/Calendar'
import Finance from './components/modules/Finance'
import MoodTracker from './components/modules/MoodTracker'
import Notes from './components/modules/Notes'
import Goals from './components/modules/Goals'
import Pomodoro from './components/modules/Pomodoro'
import Reminders from './components/modules/Reminders'
import Settings from './components/settings/Settings'
import ShiftTracker from './components/modules/ShiftTracker'
import SavingsGoals from './components/modules/SavingsGoals'
import PersonalProgress from './components/modules/PersonalProgress'
import Profile from './components/modules/Profile'
import CompletionHistory from './components/modules/CompletionHistory'
import Habits from './components/modules/Habits'
import Mandala from './components/modules/mandala/Mandala'
import Assistant from './components/modules/assistant/Assistant'
import AiAdmin from './components/admin/AiAdmin'
import Landing from './components/Landing'

// Where a verified user belongs. Only a loaded profile can say "onboarding not done"; while it is
// loading or failed, /app's PrivateRoute waits or shows the retry screen.
function homeFor({ profileStatus, onboardingDone }) {
  return profileStatus === 'ready' && !onboardingDone ? '/onboarding' : '/app/dashboard'
}

// Redirect already-authenticated users away from auth pages.
function PublicRoute({ children }) {
  const auth = useAuth()
  if (auth.loading) return <Splash />
  if (auth.user && auth.isVerified) return <Navigate to={homeFor(auth)} replace />
  return children
}

function VerifyRoute() {
  const auth = useAuth()
  const { user, loading, isVerified, pendingEmail } = auth
  if (loading) return <Splash />
  // Reachable signed in but unverified, or right after sign-up (no session yet, pendingEmail).
  if (!user) return pendingEmail ? <VerifyEmail /> : <Navigate to="/login" replace />
  if (isVerified) return <Navigate to={homeFor(auth)} replace />
  return <VerifyEmail />
}

function OnboardingRoute() {
  const { user, loading, sessionUnknown, isVerified, profileStatus, onboardingDone } = useAuth()
  if (loading) return <Splash />
  if (sessionUnknown) return <SessionUnavailable />
  if (!user) return <Navigate to="/login" replace />
  if (!isVerified) return <Navigate to="/verify-email" replace />
  if (profileStatus === 'idle' || profileStatus === 'loading') return <Splash />
  if (profileStatus === 'error') return <SessionUnavailable />
  if (onboardingDone) return <Navigate to="/app/dashboard" replace />
  return <Onboarding />
}

export default function App() {
  const { loading } = useAuth()
  const online = useOnlineStatus()
  const location = useLocation()
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), 1600)
    return () => clearTimeout(id)
  }, [])

  return (
    <>
      <AnimatePresence>{(showSplash || loading) && <Splash key="splash" />}</AnimatePresence>
      <AnimatePresence>{!online && <Offline key="offline" />}</AnimatePresence>

      <Routes location={location}>
        <Route path="/" element={<Landing />} />
        <Route path="/login"element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/verify-email" element={<VerifyRoute />} />
        <Route path="/onboarding" element={<OnboardingRoute />} />

        <Route path="/app" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="tasks" element={<TaskTracker />} />
          <Route path="journal" element={<Journal />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="finance" element={<Finance />} />
          <Route path="mood" element={<MoodTracker />} />
          <Route path="notes" element={<Notes />} />
          <Route path="goals" element={<Goals />} />
          <Route path="pomodoro" element={<Pomodoro />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="settings" element={<Settings />} />
          <Route path="shifts" element={<ShiftTracker />} />
          <Route path="savings" element={<SavingsGoals />} />
          <Route path="progress" element={<PersonalProgress />} />
          <Route path="profile" element={<Profile />} />
          <Route path="completion-history" element={<CompletionHistory />} />
          <Route path="habits" element={<Habits />} />
          <Route path="mandala" element={<Mandala />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="admin/ai" element={<AiAdmin />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
