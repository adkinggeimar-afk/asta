import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 44100;
const DURATION_SECONDS = 8; // Exact 8s period; all component frequencies are multiples of 0.125 Hz for zero-click seamless loop
const NUM_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;

function writeStereoWav(filePath: string, renderSample: (t: number) => [number, number]): void {
  const dataSize = NUM_SAMPLES * 4; // 2 channels * 2 bytes per 16-bit sample
  const buffer = Buffer.allocUnsafe(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(2, 22); // Stereo
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 4, 28); // Byte rate
  buffer.writeUInt16LE(4, 32); // Block align
  buffer.writeUInt16LE(16, 34); // Bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const [leftRaw, rightRaw] = renderSample(t);
    const left = Math.max(-1, Math.min(1, leftRaw));
    const right = Math.max(-1, Math.min(1, rightRaw));
    buffer.writeInt16LE(Math.round(left * 32767), offset);
    buffer.writeInt16LE(Math.round(right * 32767), offset + 2);
    offset += 4;
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, filePath);
}

export function ensurePresetAudioFiles(audioDir: string): {
  ambientPath: string;
  horizonPath: string;
} {
  fs.mkdirSync(audioDir, { recursive: true });
  const ambientPath = path.join(audioDir, 'preset-ambient.wav');
  const horizonPath = path.join(audioDir, 'preset-horizon.wav');

  if (!fs.existsSync(ambientPath)) {
    writeStereoWav(ambientPath, (t) => {
      const twoPi = Math.PI * 2;
      const swell = 0.72 + 0.28 * Math.sin(twoPi * 0.125 * t);
      const shimmer = 0.85 + 0.15 * Math.sin(twoPi * 0.25 * t);
      // Warm Am9 studio pad (all frequencies exact multiples of 0.125 Hz)
      const bass = 0.24 * Math.sin(twoPi * 110.0 * t);
      const fifth = 0.18 * Math.sin(twoPi * 165.0 * t + 0.3);
      const root = 0.16 * Math.sin(twoPi * 220.0 * t);
      const minorThirdL = 0.12 * Math.sin(twoPi * 261.625 * t);
      const minorThirdR = 0.12 * Math.sin(twoPi * 261.75 * t + 0.8);
      const ninthL = 0.08 * Math.sin(twoPi * 493.875 * t);
      const ninthR = 0.08 * Math.sin(twoPi * 494.0 * t + 1.1);

      const left = (bass + fifth + root + minorThirdL * shimmer + ninthL) * swell * 0.65;
      const right = (bass + fifth + root + minorThirdR * shimmer + ninthR) * swell * 0.65;
      return [left, right];
    });
  }

  if (!fs.existsSync(horizonPath)) {
    writeStereoWav(horizonPath, (t) => {
      const twoPi = Math.PI * 2;
      const swellA = 0.7 + 0.3 * Math.sin(twoPi * 0.125 * t);
      const swellB = 0.7 + 0.3 * Math.cos(twoPi * 0.125 * t);
      // Calm Dsus2 ambient horizon chords (exact 0.125 Hz harmonic grid)
      const sub = 0.22 * Math.sin(twoPi * 146.875 * t);
      const fifth = 0.18 * Math.sin(twoPi * 220.0 * t + 0.4);
      const octave = 0.14 * Math.sin(twoPi * 293.75 * t);
      const majorSecondL = 0.11 * Math.sin(twoPi * 330.0 * t) * swellA;
      const majorSecondR = 0.11 * Math.sin(twoPi * 330.125 * t + 0.7) * swellB;
      const highFifth = 0.07 * Math.sin(twoPi * 440.0 * t) * swellB;

      const left = (sub + fifth + octave + majorSecondL + highFifth) * 0.65;
      const right = (sub + fifth + octave + majorSecondR + highFifth) * 0.65;
      return [left, right];
    });
  }

  return { ambientPath, horizonPath };
}
