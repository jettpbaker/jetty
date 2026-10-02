import { sendJourney } from './turn-send'

// Many small deltas: 3 items × 20 chunks, 60 ms apart.
export default [sendJourney('turn.stream', { JETTY_ECHO_CHUNKS: '20', JETTY_ECHO_CHUNK_MS: '60' })]
