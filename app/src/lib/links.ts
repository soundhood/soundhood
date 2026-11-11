// Reading links out of shared or pasted text.

/** A pure playlist link (list= without a specific video) downloads every entry. */
export function isPlaylistLink(url: string): boolean {
  return /[?&]list=/.test(url) && !/[?&]v=/.test(url) && !/youtu\.be\//.test(url);
}

export function firstUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0] : "";
}
