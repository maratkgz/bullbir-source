export default function EmptyState({ message, icon, action }) {
  return (
    <div className="empty-state">
      {icon || (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h12l4 4v12H4Z" />
          <path d="M16 4v4h4" />
        </svg>
      )}
      <p>{message}</p>
      {action}
    </div>
  )
}
