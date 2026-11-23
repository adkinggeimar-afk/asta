import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCountdownParts,
  containsBengaliScript,
  extractYouTubeVideoId,
  formatUptime,
  isStreamStalled,
  maskStreamKey,
  normalizeMusicVolume,
  normalizeYouTubeIngestUrl,
  parseFfmpegFrameCount,
  scrubSecret,
  shouldAutoResumeFromEnv,
  validateAudioUploadMeta,
  validateCountdownInput,
  validateRtmpUrl,
  validateStreamKey,
} from './countdown.ts';

test('computeCountdownParts computes exact days, hours, minutes, seconds', () => {
  const now = Date.UTC(2026, 10, 22, 10, 0, 0);
  // 2 days, 3 hours, 45 minutes, 12 seconds ahead
  const target = new Date(now + ((2 * 86400) + (3 * 3600) + (45 * 60) + 12) * 1000).toISOString();
  const parts = computeCountdownParts(target, now);

  assert.equal(parts.isValid, true);
  assert.equal(parts.isCompleted, false);
  assert.equal(parts.days, 2);
  assert.equal(parts.hours, 3);
  assert.equal(parts.minutes, 45);
  assert.equal(parts.seconds, 12);
  assert.equal(parts.formattedClock, '02 : 03 : 45 : 12');
});

test('computeCountdownParts clamps completed or past targets cleanly', () => {
  const now = Date.UTC(2026, 10, 22, 10, 0, 0);
  const past = new Date(now - 5000).toISOString();
  const parts = computeCountdownParts(past, now);

  assert.equal(parts.isValid, true);
  assert.equal(parts.isCompleted, true);
  assert.equal(parts.totalMs, 0);
  assert.equal(parts.formattedClock, '00 : 00 : 00 : 00');
});

test('computeCountdownParts flags invalid target dates', () => {
  const parts = computeCountdownParts('not-a-date', Date.now());
  assert.equal(parts.isValid, false);
});

test('maskStreamKey and scrubSecret never expose sensitive suffix or full key', () => {
  assert.equal(maskStreamKey('abcd-efgh-1234-9x8z'), '••••-••••-9x8z');
  assert.equal(maskStreamKey('abc'), '••••');
  assert.equal(maskStreamKey(''), '');

  const scrubbed = scrubSecret(
    'Failed connecting to rtmp://a.rtmp.youtube.com/live2/my-secret-key-9988',
    'my-secret-key-9988',
  );
  assert.equal(scrubbed.includes('my-secret-key-9988'), false);
  assert.equal(scrubbed.includes('[REDACTED]'), true);
});

test('validateRtmpUrl accepts valid YouTube RTMP/RTMPS URLs and blocks unsafe inputs', () => {
  const primary = validateRtmpUrl('rtmp://a.rtmp.youtube.com/live2/');
  assert.equal(primary.ok, true);
  if (primary.ok) {
    assert.equal(primary.normalizedUrl, 'rtmp://a.rtmp.youtube.com/live2');
  }

  const rtmps = validateRtmpUrl('rtmps://a.rtmp.youtube.com:443/live2');
  assert.equal(rtmps.ok, true);

  assert.equal(validateRtmpUrl('http://a.rtmp.youtube.com/live2').ok, false);
  assert.equal(validateRtmpUrl('rtmp://127.0.0.1/live').ok, false);
  assert.equal(validateRtmpUrl('rtmp://localhost/live').ok, false);
  assert.equal(validateRtmpUrl('rtmp://a.rtmp.youtube.com/live2;rm -rf /').ok, false);
});

test('validateStreamKey validates key characters and length', () => {
  assert.equal(validateStreamKey('abcd-1234-efgh-5678').ok, true);
  assert.equal(validateStreamKey('').ok, false);
  assert.equal(validateStreamKey('abc').ok, false);
  assert.equal(validateStreamKey('bad key with spaces').ok, false);
  assert.equal(validateStreamKey('bad;key').ok, false);
});

test('validateCountdownInput supports English and Bengali text and enforces constraints', () => {
  const bengali = validateCountdownInput({
    title: 'নতুন বছরের লাইভ কাউন্টডাউন',
    details: 'আমাদের গ্র্যান্ড ইভেন্ট শুরু হতে আর মাত্র কিছু সময় বাকি',
    targetIso: '2027-01-01T00:00:00.000Z',
    themeId: 'midnight',
  });
  assert.equal(bengali.ok, true);
  assert.equal(containsBengaliScript('নতুন বছরের লাইভ কাউন্টডাউন'), true);
  assert.equal(containsBengaliScript('Grand Launch 2027'), false);

  const missingTitle = validateCountdownInput({
    title: '   ',
    targetIso: '2027-01-01T00:00:00.000Z',
  });
  assert.equal(missingTitle.ok, false);

  const badUrl = validateCountdownInput({
    title: 'Test Event',
    targetIso: '2027-01-01T00:00:00.000Z',
    youtubeWatchUrl: 'https://evil.example.com/watch?v=123',
  });
  assert.equal(badUrl.ok, false);
});

test('extractYouTubeVideoId parses standard, live, and short YouTube URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtube.com/live/dQw4w9WgXcQ?feature=share'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('formatUptime formats elapsed duration with days when >= 24h', () => {
  const start = Date.UTC(2026, 10, 20, 0, 0, 0);
  const startIso = new Date(start).toISOString();
  assert.equal(formatUptime(startIso, start + 3665_000), '01:01:05');
  assert.equal(formatUptime(startIso, start + 90061_000), '1d 01:01:01');
  assert.equal(formatUptime(null, start), '00:00:00');
});

test('normalizeYouTubeIngestUrl upgrades standard YouTube RTMP endpoints to port 443 RTMPS', () => {
  assert.equal(
    normalizeYouTubeIngestUrl('rtmp://a.rtmp.youtube.com/live2'),
    'rtmps://a.rtmps.youtube.com:443/live2',
  );
  assert.equal(
    normalizeYouTubeIngestUrl('rtmps://a.rtmp.youtube.com:443/live2'),
    'rtmps://a.rtmps.youtube.com:443/live2',
  );
  assert.equal(
    normalizeYouTubeIngestUrl('rtmp://b.rtmp.youtube.com/live2?backup=1'),
    'rtmps://b.rtmps.youtube.com:443/live2?backup=1',
  );
  assert.equal(
    normalizeYouTubeIngestUrl('rtmp://custom.stream.example.com/live'),
    'rtmp://custom.stream.example.com/live',
  );
});

test('parseFfmpegFrameCount extracts latest frame counter from FFmpeg progress output', () => {
  assert.equal(parseFfmpegFrameCount('frame=   30 fps= 29 q=0.0'), 30);
  assert.equal(parseFfmpegFrameCount('frame=   30 fps=29\rframe=  120 fps=30'), 120);
  assert.equal(parseFfmpegFrameCount('non-progress log line'), null);
});

test('isStreamStalled detects silent encoder freezes beyond threshold', () => {
  const base = 1_700_000_000_000;
  assert.equal(isStreamStalled(base, base + 10_000, 25_000), false);
  assert.equal(isStreamStalled(base, base + 26_000, 25_000), true);
  assert.equal(isStreamStalled(0, base, 25_000), false);
});

test('shouldAutoResumeFromEnv enables boot stream only with key and flag', () => {
  assert.equal(shouldAutoResumeFromEnv({ streamKey: 'abcd-1234', autoStart: 'true' }), true);
  assert.equal(shouldAutoResumeFromEnv({ streamKey: 'abcd-1234', autoStart: 'false' }), false);
  assert.equal(shouldAutoResumeFromEnv({ streamKey: '', autoStart: 'true' }), false);
});

test('normalizeMusicVolume clamps volume safely between 0 and 100', () => {
  assert.equal(normalizeMusicVolume(42.6), 43);
  assert.equal(normalizeMusicVolume(-10), 0);
  assert.equal(normalizeMusicVolume(250), 100);
  assert.equal(normalizeMusicVolume('invalid'), 35);
});

test('validateAudioUploadMeta validates supported extensions, MIME, and size limits', () => {
  const validMp3 = validateAudioUploadMeta('lofi-chill.mp3', 'audio/mpeg', 1024 * 512);
  assert.equal(validMp3.ok, true);
  if (validMp3.ok) {
    assert.equal(validMp3.ext, '.mp3');
    assert.equal(validMp3.cleanName, 'lofi-chill.mp3');
  }

  assert.equal(validateAudioUploadMeta('track.exe', 'application/octet-stream', 2048).ok, false);
  assert.equal(validateAudioUploadMeta('script.mp3', 'text/html', 2048).ok, false);
  assert.equal(validateAudioUploadMeta('tiny.wav', 'audio/wav', 20).ok, false);
  assert.equal(validateAudioUploadMeta('huge.mp3', 'audio/mpeg', 30 * 1024 * 1024).ok, false);
});

test('validateCountdownInput normalizes musicMode and musicVolume cleanly', () => {
  const res = validateCountdownInput({
    title: 'Music Countdown',
    targetIso: '2027-01-01T00:00:00.000Z',
    musicMode: 'preset-ambient',
    musicVolume: 75,
    customMusicName: 'track.mp3',
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.musicMode, 'preset-ambient');
    assert.equal(res.value.musicVolume, 75);
    assert.equal(res.value.customMusicName, 'track.mp3');
  }
});

