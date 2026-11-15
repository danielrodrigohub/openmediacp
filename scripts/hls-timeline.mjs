// A single HLS media timeline across independent encoders. MPEG-TS carries fresh
// codec headers; DISCONTINUITY tells clients to reset timestamps and decoder state.
export class Timeline {
  constructor(saved = {}, initialTargetDuration = 12) {
    this.transport = saved.transport ?? {};
    this.next = saved.next ?? Math.floor(Date.now() / 1000);
    const storedEntries = saved.entries ?? [];
    const dropped = storedEntries.slice(0, Math.max(0, storedEntries.length - 4));
    this.discontinuity = (saved.discontinuity ?? 0) + dropped.filter(entry => entry.boundary).length;
    this.entries = storedEntries.slice(-4);
    this.targetDuration = Math.max(saved.targetDuration ?? initialTargetDuration, initialTargetDuration, ...this.entries.map(entry => Math.ceil(entry.duration)));
    this.generation = saved.generation ?? null;
  }
  append(generation, segments) {
    let changed = false;
    for (const segment of segments) {
      if (this.entries.some(entry => entry.uri === segment.uri)) continue;
      const boundary = this.generation !== null && this.generation !== generation;
      this.targetDuration = Math.max(this.targetDuration, Math.ceil(segment.duration));
      this.entries.push({...segment, sequence: this.next++, boundary});
      this.generation = generation;
      changed = true;
    }
    while (this.entries.length > 4) {
      if (this.entries.shift().boundary) this.discontinuity++;
    }
    return changed;
  }
  render() {
    // Keep the public live window bounded while allowing longer source GOPs.
    return ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-MEDIA-SEQUENCE:${this.entries[0]?.sequence ?? this.next}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${this.discontinuity}`,
      ...this.entries.flatMap(e => [...(e.boundary ? ['#EXT-X-DISCONTINUITY'] : []),
        `#EXTINF:${e.duration.toFixed(6)},`, e.uri]), ''].join('\n');
  }
}
export function parseSegments(text, prefix) {
  let duration;
  const segments=[];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) duration=Number(line.slice(8).split(',')[0]);
    else if (/^seg\d+\.ts$/.test(line) && duration > 0 && duration <= 12) {
      segments.push({duration, uri: prefix + line, file: line}); duration=undefined;
    }
  }
  return segments;
}
// A timeout is not a disconnection. Brief missed probes must not alternate sources.
export function chooseSource(previous, raw, marked, auto, markEnabled, missingSince, now) {
  if (raw === true) {
    const source=!markEnabled?'in':marked===true?'marked':marked===null&&previous==='marked'?'marked':auto===true?'auto':'emergency';
    return {source,missingSince:null};
  }
  if (previous === 'in' || previous === 'marked') {
    const since=missingSince ?? now;
    const grace=raw === false ? 6000 : 30000;
    if (now - since < grace) return {source: previous, missingSince: since};
  }
  return {source:auto === true ? 'auto' : 'emergency', missingSince: missingSince ?? now};
}
