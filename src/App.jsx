import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'

import { useAuth } from './context/AuthContext'
import { useOnlineStatus } from './hooks/useOnlineStatus'

import Splash from './components/ui/Splash'
import Offline from './components/Offline'
import AppLayout from './components/layout/AppLayout'
import PrivateRoute from './components/auth/PrivateRoute'

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

// Redirect already-authenticated users away from auth pages.
function PublicRoute({ children }) {
  const { user, loading, isVerified, onboardingDone } = useAuth()
  if (loading) return <Splash />
  if (user && isVerified) {
    return <Navigate to={onboardingDone ? '/app/dashboard' : '/onboarding'} replace />
  }
  return children
}

function VerifyRoute() {
  const { user, loading, isVerified, onboardingDone } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (isVerified) return <Navigate to={onboardingDone ? '/app/dashboard' : '/onboarding'} replace />
  return <VerifyEmail />
}

function OnboardingRoute() {
  const { user, loading, isVerified, onboardingDone } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (!isVerified) return <Navigate to="/verify-email" replace />
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
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
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
        </Route>

        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Routes>
    </>
  )
}
