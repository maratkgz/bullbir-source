import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Splash from '../ui/Splash'

export default function PrivateRoute({ children }) {
  const { user, loading, isVerified, onboardingDone } = useAuth()
  const location = useLocation()

  if (loading) return <Splash />

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (!isVerified) return <Navigate to="/verify-email" replace />
  if (!onboardingDone) return <Navigate to="/onboarding" replace />

  return children
}
