import { Switch } from '@/components/ui/switch'
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
  return (
    <div className='flex flex-col'>
      {agentBehaviours.map(({ key, label, defaultEnabled }) => (
        <div key={key} className='appearance-option-row'>
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <Switch
            id={`${id}-${key}`}
            checked={pending[key] ?? chrome?.agentBehaviours?.[key] ?? defaultEnabled}
            onCheckedChange={(enabled) => toggle(key, enabled)}
            className='mr-2'
          />
        </div>
      ))}
    </div>
  )
}
