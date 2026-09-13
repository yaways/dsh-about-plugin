/**
 * jsdom stand-in for @deepseek-ai/dsh-client-ui-primitives.
 *
 * The real library ships as a browser closure-factory bundle that registers
 * through window.__ModuleLoader__ — unusable inside vitest. The stub keeps
 * the component contract (variant/size/tone props, RiskConfirmation's
 * acknowledge gate) so the About section's state machine stays testable.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type TagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'

export function Button({ children, ...rest }: {
  variant?: string
  size?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest}>{children}</button>
}

export function Tag({ tone, children }: { tone?: TagTone, children?: ReactNode }) {
  return <span data-testid="tag" data-tone={tone}>{children}</span>
}

export interface RiskConfirmationProps {
  open: boolean
  title: string
  description: string
  acknowledgeLabel: string
  cancelLabel: string
  closeLabel: string
  confirmLabel: string
  acknowledged: boolean
  disabled?: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

export function RiskConfirmation({
  open, title, description, acknowledgeLabel, confirmLabel, acknowledged, disabled,
  onAcknowledgedChange, onCancel, onConfirm,
}: RiskConfirmationProps) {
  if (!open) return null
  return (
    <div role="dialog" aria-label={title}>
      <p>{description}</p>
      <label>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={event => onAcknowledgedChange(event.currentTarget.checked)}
        />
        {acknowledgeLabel}
      </label>
      <button type="button" onClick={onCancel}>cancel</button>
      <button type="button" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  )
}
