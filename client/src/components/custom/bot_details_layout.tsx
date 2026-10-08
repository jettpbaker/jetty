import type { Bot } from '@jetty/shared/wire'

import { useState, type ReactNode } from 'react'

import { BotOverview } from './bot_overview'
import {
  DetailsChatPanel,
  DetailsLayout,
  DetailsPane,
  DetailsTabPanel,
  useDetailsLayout,
} from './details_layout'
import { BotDetailsTabs } from './thread_details_tabs'

// A bot's chat with its details pane: Overview only, and the chat as a tab while the pane is full width.
export function BotDetailsLayout({ bot, children }: { bot: Bot; children: ReactNode }) {
  const layout = useDetailsLayout()
  const { open, full, narrow, expanded, setExpanded, setChatSlot } = layout
  const [pickedTab, setTab] = useState('overview')
  // Opening always shows Overview, even where the chat would be a tab of its own.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTab('overview')
  }
  const tab = full ? pickedTab : 'overview'
  return (
    <DetailsLayout
      layout={layout}
      label='Bot details'
      pane={
        <DetailsPane
          label='Bot details'
          tab={tab}
          onTabChange={setTab}
          full={full}
          narrow={narrow}
          expanded={expanded}
          onExpandedChange={setExpanded}
          tabs={<BotDetailsTabs chat={full} />}
        >
          <DetailsChatPanel tab={tab} slotRef={setChatSlot} />
          <DetailsTabPanel value='overview' tab={tab}>
            {open && <BotOverview bot={bot} />}
          </DetailsTabPanel>
        </DetailsPane>
      }
    >
      {children}
    </DetailsLayout>
  )
}
