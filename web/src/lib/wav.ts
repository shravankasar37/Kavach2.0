// Converts any recording the browser can play (m4a, ogg/opus WhatsApp voice notes, webm, mp3) into 16 kHz mono WAV,
// the format the VaaniShield voice-clone model expects. Runs on the phone.

async function decode16k(file: Blob, maxSeconds: number): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf);
  } finally {
    ctx.close();
  }
  const seconds = Math.min(decoded.duration, maxSeconds);
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * 16000)), 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0);
}

export async function toWav16k(file: Blob, maxSeconds = 60): Promise<Blob> {
  return encodeWav(await decode16k(file, maxSeconds));
}

/** Splits a recording into ~12 s WAV pieces: Whisper sometimes drops the end of longer Marathi clips. */
export async function splitWav16k(file: Blob, pieceSeconds = 12, maxSeconds = 180): Promise<Blob[]> {
  const pcm = await decode16k(file, maxSeconds);
  const step = pieceSeconds * 16000;
  const out: Blob[] = [];
  for (let i = 0; i < pcm.length; i += step) {
    // fold a tiny tail into the previous piece instead of sending a near-empty clip
    if (pcm.length - i < 2 * 16000 && out.length) {
      out[out.length - 1] = encodeWav(pcm.subarray(i - step, pcm.length));
      break;
    }
    out.push(encodeWav(pcm.subarray(i, i + step)));
  }
  return out;
}

function encodeWav(pcm: Float32Array): Blob {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, 16000, true);
  out.setUint32(28, 32000, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out], { type: "audio/wav" });
}
