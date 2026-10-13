import type { ApprovalDecision } from '@jetty/shared/items'

export function acpPermissionOutcome(
  options: Record<string, unknown>[] | undefined,
  decision: ApprovalDecision
) {
  const kind =
    decision === 'deny' ? 'reject_once' : decision === 'always' ? 'allow_always' : 'allow_once'
  const option =
    options?.find((o) => o.kind === kind) ??
    options?.find((o) => o.kind === 'allow_once' && decision !== 'deny')
  return {
    outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' },
  }
}
