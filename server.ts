import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { StreamManager } from './src/server/streamManager.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const streamManager = new StreamManager(process.cwd());
  streamManager.init();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, serverTimeIso: new Date().toISOString() });
  });

  app.get('/api/stream/state', (_req, res) => {
    res.json(streamManager.getPublicState());
  });

  app.put('/api/stream/config', (req, res) => {
    const result = streamManager.updateConfig(req.body ?? {});
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.state);
  });

  app.put('/api/stream/youtube', (req, res) => {
    const result = streamManager.updateYouTubeSettings(req.body ?? {});
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.state);
  });

  app.post('/api/stream/start', (req, res) => {
    const requestedMode = req.body?.mode;
    const result = streamManager.startStream(requestedMode);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.state);
  });

  app.post('/api/stream/stop', (_req, res) => {
    const result = streamManager.stopStream();
    res.json(result.state);
  });

  app.get('/api/stream/snapshot.jpg', async (_req, res) => {
    try {
      const jpgBuffer = await streamManager.renderSnapshotJpeg();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.send(jpgBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to render frame';
      res.status(500).json({ error: msg });
    }
  });

  app.post(
    '/api/stream/music/upload',
    express.raw({ limit: '26mb', type: ['audio/*', 'application/octet-stream'] }),
    async (req, res) => {
      try {
        const rawHeaderName = typeof req.headers['x-file-name'] === 'string' ? req.headers['x-file-name'] : '';
        let decodedName = 'track.mp3';
        try {
          decodedName = rawHeaderName ? decodeURIComponent(rawHeaderName) : 'track.mp3';
        } catch {
          decodedName = rawHeaderName || 'track.mp3';
        }
        const mimeType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '';
        const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

        const result = await streamManager.saveCustomAudioUpload(decodedName, mimeType, bodyBuf);
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        res.json(result.state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to upload background music.';
        res.status(500).json({ error: msg });
      }
    },
  );

  app.delete('/api/stream/music', (_req, res) => {
    const result = streamManager.removeCustomAudio();
    res.json(result.state);
  });

  app.get('/api/stream/music/file', (_req, res) => {
    const info = streamManager.getMusicAudioInfo();
    if (!info) {
      res.status(404).json({ error: 'No active background music selected.' });
      return;
    }
    res.setHeader('Content-Type', info.contentType);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.sendFile(info.filePath);
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChronoCast server listening on http://localhost:${PORT}`);
  });

  const handleSignal = () => {
    streamManager.shutdown();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  process.on('uncaughtException', (err) => {
    console.error('Uncaught server exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled server rejection:', reason);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start ChronoCast server:', err);
  process.exit(1);
});
