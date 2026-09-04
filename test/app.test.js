import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.OPENWEATHER_API_KEY = 'test-key';
const { app } = await import('../app.js');

const originalFetch = global.fetch;

test.beforeEach(() => {
  global.fetch = async (url) => {
    const target = url.toString();

    if (target.includes('/geo/1.0/direct')) {
      return new Response(
        JSON.stringify([{ name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (target.includes('/data/2.5/air_pollution')) {
      return new Response(
        JSON.stringify({ list: [{ main: { aqi: 1 }, components: { pm2_5: 8, pm10: 14, co: 210, no2: 12, so2: 2, o3: 88, nh3: 1 } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (target.includes('/data/2.5/weather')) {
      return new Response(
        JSON.stringify({ main: { temp: 21.5, feels_like: 20.4, humidity: 53 }, weather: [{ description: 'clear sky' }], wind: { speed: 12, deg: 180 }, visibility: 10000, sys: { sunrise: 1788411600, sunset: 1788462000 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (target.includes('/data/2.5/forecast')) {
      return new Response(JSON.stringify({ list: [
        { dt_txt: '2026-09-03 12:00:00', main: { temp: 21, temp_max: 22, temp_min: 15 }, weather: [{ description: 'clear sky' }], pop: 0 },
        { dt_txt: '2026-09-03 15:00:00', main: { temp: 22, temp_max: 23, temp_min: 16 }, weather: [{ description: 'clear sky' }], pop: 0.1 },
        { dt_txt: '2026-09-04 12:00:00', main: { temp: 24, temp_max: 24, temp_min: 17 }, weather: [{ description: 'few clouds' }], pop: 0.2 },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    throw new Error(`Unexpected fetch URL: ${target}`);
  };
});

test.afterEach(() => {
  global.fetch = originalFetch;
});

test('GET /api/health returns server status', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('GET /api/weather returns current weather for a city', async () => {
  const response = await request(app).get('/api/weather').query({ city: 'Paris' });

  assert.equal(response.status, 200);
  assert.equal(response.body.location.name, 'Paris');
  assert.equal(response.body.location.country, 'FR');
  assert.equal(response.body.current.temperature, 21.5);
  assert.equal(response.body.current.condition, 'Clear Sky');
});

test('GET /api/forecast returns daily forecast data', async () => {
  const response = await request(app).get('/api/forecast').query({ city: 'Paris' });

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(response.body.forecast), true);
  assert.equal(response.body.forecast.length, 2);
  assert.equal(response.body.forecast[0].condition, 'Clear Sky');
});

test('GET /api/geo/direct matches the frontend city search contract', async () => {
  const response = await request(app).get('/api/geo/direct').query({ city: 'Paris' });

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(response.body), true);
  assert.equal(response.body[0].name, 'Paris');
  assert.equal(response.body[0].latitude, 48.8566);
});

test('GET /api/weather/current matches the frontend coordinate contract', async () => {
  const response = await request(app).get('/api/weather/current').query({ lat: 48.8566, lon: 2.3522 });

  assert.equal(response.status, 200);
  assert.equal(response.body.current.temperature, 21.5);
  assert.equal(response.body.current.feelsLike, 20.4);
  assert.equal(response.body.current.condition, 'Clear Sky');
});

test('GET /api/weather/air matches the frontend air-quality contract', async () => {
  const response = await request(app).get('/api/weather/air').query({ lat: 48.8566, lon: 2.3522 });

  assert.equal(response.status, 200);
  assert.equal(response.body.list[0].main.aqi, 1);
  assert.equal(response.body.list[0].components.pm2_5, 8);
});

test('GET /api/news returns an empty feed when no news provider is configured', async () => {
  const response = await request(app).get('/api/news').query({ country: 'us', category: 'all' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { articles: [] });
});
