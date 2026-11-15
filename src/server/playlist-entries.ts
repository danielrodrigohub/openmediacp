export type PlaylistEntry = string | { folder: string; ids: string[] };

// Shared by the browser editor and the server validators so both sides accept
// the same size. 500 covers a full folder of videos while keeping the schedule
// and playout ordering cheap to rewrite.
export const maxPlaylistEntries = 500;
export const maxPlaylistVideos = 500;

export function playlistAssetIds(entries: PlaylistEntry[]) {
  return [...new Set(entries.flatMap(entry => typeof entry === 'string' ? [entry] : entry.ids))];
}
