import { app } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Weather server running on http://${HOST}:${PORT}`);

  const BACKEND_URL = process.env.RENDER_EXTERNAL_URL;

  if (BACKEND_URL) {
    setInterval(async () => {
      try {
        await fetch(`${BACKEND_URL}/api/health`);
        console.log('Keep-alive ping sent');
      } catch (err) {
        console.warn('Keep-alive ping failed:', err.message);
      }
    }, 14 * 60 * 1000);
  }
});
