import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useChrome } from '@/state'
import { useSetAgentBehaviour } from '@/state/models'
import { agentBehaviours, type AgentBehaviourKey } from '@jetty/shared/wire'
import { useId, useState } from 'react'

import './settings_sections.css'

export function SettingsAgentBehaviour() {
  const chrome = useChrome()
  const setAgentBehaviour = useSetAgentBehaviour()
  const [pending, setPending] = useState<Partial<Record<AgentBehaviourKey, boolean>>>({})
  // A toggle stands in until the server's push agrees, then the server owns it again, so a change
  // from another tab shows.
  const agreed = (Object.keys(pending) as AgentBehaviourKey[]).filter(
    (key) => chrome?.agentBehaviours?.[key] === pending[key]
  )
  if (agreed.length)
    setPending((current) => {
      const next = { ...current }
      for (const key of agreed) delete next[key]
      return next
    })
  const id = useId()
  function toggle(key: AgentBehaviourKey, enabled: boolean) {
    setPending((current) => ({ ...current, [key]: enabled }))
    setAgentBehaviour(key, enabled, () => setPending(({ [key]: _, ...rest }) => rest))
  }
  function enabled(key: AgentBehaviourKey) {
    const behaviour = agentBehaviours.find((each) => each.key === key)
    return pending[key] ?? chrome?.agentBehaviours?.[key] ?? behaviour?.defaultEnabled ?? false
  }
  // A behaviour's own switches show under it while it's on.
  return (
    <div className='flex flex-col'>
      {agentBehaviours.map((behaviour) =>
        'parent' in behaviour && !enabled(behaviour.parent) ? null : (
          <div
            key={behaviour.key}
            className={cn('appearance-option-row', 'parent' in behaviour && 'min-h-9 pl-5')}
          >
            <label htmlFor={`${id}-${behaviour.key}`}>{behaviour.label}</label>
            <Switch
              id={`${id}-${behaviour.key}`}
              checked={enabled(behaviour.key)}
              onCheckedChange={(checked) => toggle(behaviour.key, checked)}
              className='mr-2'
            />
          </div>
        )
      )}
    </div>
  )
}
