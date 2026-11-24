import { FileText } from 'lucide-react'
import Icon from './Icon'
export default function EmptyState({ message, icon, action }) {
  return (
    <div className="empty-state">
      {icon || (
        <Icon icon={FileText} size={48} />
      )}
      <p>{message}</p>
      {action}
    </div>
  )
}
