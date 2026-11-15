# Public HLS continuity

The public `/live/<channel>/llhls.m3u8` URL is handled by `hls:8090`, not the OME schedule. The web player can continue to use its isolated OME inputs.

The HLS worker reads `in_` / `marked_` for OBS and `auto_` for AutoDJ. It copies H.264/AAC into complete MPEG-TS segments without another video encode. Only one generation is appended to the public timeline. Before switching, two complete segments must exist. Each change has `EXT-X-DISCONTINUITY`; MPEG-TS PTS/DTS/PCR clocks and continuity counters are translated to a single advancing timeline without modifying encoded video/audio payloads; media and discontinuity sequences persist across worker restarts. Codec headers belong to the new source, rather than to a previous OME scheduled track.

OBS wins while the raw ingest is available. Six seconds of explicit missing-ingest observations permit fallback; network/probe errors have a longer 30-second grace. A marked-source interruption while raw OBS remains connected retries that source instead of alternating with AutoDJ. HLS playback has a segment buffer, so switching is not instantaneous or a visual crossfade.

The service uses the existing data volume, a bounded rolling playlist, and five-minute segment retention. Nginx/Caddy must route the exact public master plus `/hls/<channel>/<generation>/seg<number>.ts` to this worker. Internal OME source manifests and segments stay on the existing OME proxy. Disable proxy caching for the master playlist. No additional public listening port is needed.

Validation:

- `node --test tests/hls-timeline.test.mjs`
- `scripts/hls-switch-smoke.mjs` inside the playout container tests an isolated temporary channel, synthetic live signal, both transitions and continuous FFmpeg decoding. It cleans up its channel and publishers.
- Inspect `X-OpenBroadcast-Source` and verify the media sequence increases. Compare source state over multiple reloads while OBS remains on.

References: [HLS discontinuities](https://www.rfc-editor.org/rfc/rfc8216#section-4.3.2.3), [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2).
