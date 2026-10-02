import { sendJourney } from './turn-send'

// Many small deltas: 3 items × 15 chunks, 60 ms apart.
export default [sendJourney('turn.stream', { JETTY_ECHO_CHUNKS: '15', JETTY_ECHO_CHUNK_MS: '60' })]
