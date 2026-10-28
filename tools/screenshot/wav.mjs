// A silent WAV the webview can really decode, so the fixture "plays" through the app's own
// audio path. Shared by Node (the desktop asset route) and the page (read_file_bytes on Android).

/** Sample rate of the fixture audio: 8 kHz, 8-bit mono keeps a 4-minute track under 2 MB. */
export const WAV_RATE = 8000;

/** A silent 8-bit mono PCM WAV of `seconds`, as bytes. */
export function silentWav(seconds) {
  const samples = Math.max(1, Math.floor(seconds * WAV_RATE));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WAV_RATE, true);
  view.setUint32(28, WAV_RATE, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // unsigned 8-bit PCM: 128 is silence
  return bytes;
}
