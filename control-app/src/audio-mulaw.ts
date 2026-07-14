// control-app/src/audio-mulaw.ts
// mu-law (G.711 PCMU) <-> 16-bit PCM, plus a minimal WAV writer.
// Telnyx streams PCMU 8kHz mono (160 bytes = 20ms per frame). The AI brain's STT
// wants a WAV, so we decode mu-law -> PCM16 and wrap it in a WAV header.

// Standard G.711 mu-law decode table approach (ITU-T G.711).
export function muLawByteToPcm16(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

export function pcm16ToMuLawByte(sample: number): number {
  const BIAS = 0x84, CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode a mu-law buffer to 16-bit PCM (little-endian). */
export function muLawToPcm16(mu: Buffer): Buffer {
  const out = Buffer.alloc(mu.length * 2);
  for (let i = 0; i < mu.length; i++) out.writeInt16LE(muLawByteToPcm16(mu[i]), i * 2);
  return out;
}

/** Encode 16-bit PCM (little-endian) to mu-law. */
export function pcm16ToMuLaw(pcm: Buffer): Buffer {
  const out = Buffer.alloc(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = pcm16ToMuLawByte(pcm.readInt16LE(i * 2));
  return out;
}

/** Wrap raw PCM16 mono in a WAV container. */
export function pcm16ToWav(pcm: Buffer, sampleRate = 8000): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM fmt chunk size
  header.writeUInt16LE(1, 20);           // audio format = PCM
  header.writeUInt16LE(1, 22);           // channels = mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate = rate * blockAlign
  header.writeUInt16LE(2, 32);           // block align = channels * bytesPerSample
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

/** Convenience: mu-law frames straight to a WAV buffer. */
export function muLawToWav(mu: Buffer, sampleRate = 8000): Buffer {
  return pcm16ToWav(muLawToPcm16(mu), sampleRate);
}

/** Mean absolute amplitude of PCM16 — cheap energy measure for silence detection. */
export function pcm16Energy(pcm: Buffer): number {
  if (pcm.length < 2) return 0;
  let sum = 0; const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) sum += Math.abs(pcm.readInt16LE(i * 2));
  return sum / n;
}
