import type { ReactElement } from 'react'

export function DeleteConversationModal(props: {
  deleteConvRemoveKb: boolean
  onClose: () => void
  onToggleDeleteKb: (next: boolean) => void
  onConfirmDelete: () => void
}): ReactElement {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-conv-title"
      onClick={props.onClose}
    >
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h2 id="delete-conv-title" className="modal-title">
          Delete this chat?
        </h2>
        <p className="muted modal-text">
          The conversation and its messages will be removed from this device. This cannot be undone.
        </p>
        <label className="modal-check">
          <input
            type="checkbox"
            checked={props.deleteConvRemoveKb}
            onChange={(e) => props.onToggleDeleteKb(e.target.checked)}
          />
          <span>Also delete knowledge base content saved from this chat (via &quot;Save chat to knowledge base&quot;)</span>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={props.onConfirmDelete}>
            Delete chat
          </button>
        </div>
      </div>
    </div>
  )
}
