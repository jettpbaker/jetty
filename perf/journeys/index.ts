import type { Journey } from '../journey'

import appLaunch from './app-launch'
import composerKey from './composer-key'
import prDiff from './pr-diff'
import prOpen from './pr-open'
import threadOpen from './thread-open'
import threadSwitch from './thread-switch'
import turnSend from './turn-send'
import turnStream from './turn-stream'

export const journeys: Journey[] = [
  ...appLaunch,
  ...threadSwitch,
  ...threadOpen,
  ...turnSend,
  ...turnStream,
  ...prOpen,
  ...prDiff,
  ...composerKey,
]

export function journeyId(journey: Journey) {
  return `${journey.name}/${journey.case}`
}
