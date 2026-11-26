import { Component } from 'react'
import { RotateCw } from 'lucide-react'
import Icon from './ui/Icon'
import { useLang } from '../context/LangContext'
import { reportError } from '../monitoring/reportError'

function Fallback({ onRetry }) {
  const { t } = useLang()
  return (
    <div className="card" role="alert" style={{ margin: 'var(--space-4, 16px)', textAlign: 'center', padding: 24 }}>
      <h2 style={{ marginBottom: 8 }}>{t('common.error')}</h2>
      <p className="text-muted" style={{ marginBottom: 16 }}>{t('errorBoundary.body')}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        <Icon icon={RotateCw} size="1em" /> {t('common.retry')}
      </button>
    </div>
  )
}

/**
 * Catches render errors in one section so the rest of the app keeps working (instead of a blank
 * screen) and reports the error to the server. Reset by changing `resetKey` (e.g. the route).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    reportError('render', error, info?.componentStack)
  }

  componentDidUpdate(prev) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.setState({ hasError: false })
  }

  retry() {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) return <Fallback onRetry={this.retry} />
    return this.props.children
  }
}
