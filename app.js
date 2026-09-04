import express from 'express';
import cors from 'cors';
import 'dotenv/config';

export const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true }));
app.use(express.json());

const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 10000;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream request failed with ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function openWeatherUrl(path, params = {}) {
  if (!OPENWEATHER_API_KEY) throw new Error('OPENWEATHER_API_KEY is not configured');

  const url = new URL(`https://api.openweathermap.org${path}`);
  Object.entries({ ...params, appid: OPENWEATHER_API_KEY }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url;
}

async function geocodeCity(city) {
  const data = await fetchJson(openWeatherUrl('/geo/1.0/direct', { q: city, limit: 1 }));
  const result = data[0];

  if (!result) {
    throw new Error('City not found');
  }

  return {
    name: result.name,
    country: result.country,
    latitude: result.lat,
    longitude: result.lon,
    timezone: null,
  };
}

async function reverseGeocodeCoordinates(latitude, longitude) {
  const data = await fetchJson(openWeatherUrl('/geo/1.0/reverse', {
    lat: latitude,
    lon: longitude,
    limit: 1,
  }));
  const result = data[0];

  return {
    city: result?.name || 'Your location',
    country: result?.country || null,
    lat: latitude,
    lon: longitude,
  };
}

async function getWeatherForCoordinates(latitude, longitude) {
  return fetchJson(openWeatherUrl('/data/2.5/weather', {
    lat: latitude,
    lon: longitude,
    units: 'metric',
  }));
}

async function getAirQualityForCoordinates(latitude, longitude) {
  return fetchJson(openWeatherUrl('/data/2.5/air_pollution', { lat: latitude, lon: longitude }));
}

async function getForecastForCoordinates(latitude, longitude) {
  return fetchJson(openWeatherUrl('/data/2.5/forecast', {
    lat: latitude,
    lon: longitude,
    units: 'metric',
    cnt: 40,
  }));
}

function currentWeatherResponse(weatherData) {
  return {
    temperature: weatherData.main?.temp,
    feelsLike: weatherData.main?.feels_like,
    humidity: weatherData.main?.humidity,
    precipitation: weatherData.rain?.['1h'] || weatherData.snow?.['1h'] || 0,
    windSpeed: weatherData.wind?.speed == null ? null : weatherData.wind.speed * 3.6,
    windDirection: weatherData.wind?.deg,
    visibility: weatherData.visibility ? weatherData.visibility / 1000 : null,
    condition: formatCondition(weatherData.weather?.[0]?.description),
    sunrise: weatherData.sys?.sunrise ? new Date(weatherData.sys.sunrise * 1000).toISOString() : null,
    sunset: weatherData.sys?.sunset ? new Date(weatherData.sys.sunset * 1000).toISOString() : null,
  };
}

function formatCondition(condition) {
  return condition ? condition.replace(/\b\w/g, letter => letter.toUpperCase()) : 'Unknown';
}

function forecastResponse(forecastData) {
  const byDate = new Map();

  for (const item of forecastData.list || []) {
    const date = item.dt_txt.split(' ')[0];
    const day = byDate.get(date) || {
      date,
      condition: formatCondition(item.weather?.[0]?.description),
      maxTemp: item.main?.temp_max,
      minTemp: item.main?.temp_min,
      sunrise: null,
      sunset: null,
    };
    day.maxTemp = Math.max(day.maxTemp, item.main?.temp_max);
    day.minTemp = Math.min(day.minTemp, item.main?.temp_min);
    byDate.set(date, day);
  }

  return {
    daily: [...byDate.values()].slice(0, 5),
    hourly: (forecastData.list || []).slice(0, 8).map(item => ({
      time: item.dt_txt,
      temperature: item.main?.temp,
      condition: formatCondition(item.weather?.[0]?.description),
      precipitationProbability: Math.round((item.pop || 0) * 100),
    })),
  };
}

function requireCoordinates(req, res) {
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({ error: 'Valid lat and lon are required' });
    return null;
  }

  return { latitude, longitude };
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/geo/direct', async (req, res) => {
  const city = (req.query.city || '').toString().trim();

  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  try {
    return res.json([await geocodeCity(city)]);
  } catch (error) {
    return res.status(404).json({ error: error.message || 'City not found' });
  }
});

app.get('/api/geo/reverse', (req, res) => {
  const coordinates = requireCoordinates(req, res);
  if (!coordinates) return;

  reverseGeocodeCoordinates(coordinates.latitude, coordinates.longitude)
    .then(location => res.json(location))
    .catch(error => res.status(502).json({ error: error.message || 'Location service unavailable' }));
});

app.get('/api/weather/current', async (req, res) => {
  const coordinates = requireCoordinates(req, res);
  if (!coordinates) return;

  try {
    const weatherData = await getWeatherForCoordinates(coordinates.latitude, coordinates.longitude);
    res.json({ current: currentWeatherResponse(weatherData) });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Weather service unavailable' });
  }
});

app.get('/api/weather/forecast', async (req, res) => {
  const coordinates = requireCoordinates(req, res);
  if (!coordinates) return;

  try {
    const forecastData = await getForecastForCoordinates(coordinates.latitude, coordinates.longitude);
    const forecast = forecastResponse(forecastData);
    res.json({ forecast: forecast.daily, hourly: forecast.hourly });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Forecast service unavailable' });
  }
});

app.get('/api/weather/air', async (req, res) => {
  const coordinates = requireCoordinates(req, res);
  if (!coordinates) return;

  try {
    const airData = await getAirQualityForCoordinates(coordinates.latitude, coordinates.longitude);
    const current = airData.list?.[0] || {};

    res.json({
      list: [{
        main: { aqi: current.main?.aqi ?? null },
        components: {
          pm2_5: current.components?.pm2_5,
          pm10: current.components?.pm10,
          co: current.components?.co,
          no2: current.components?.no2,
          so2: current.components?.so2,
          o3: current.components?.o3,
          nh3: current.components?.nh3,
        },
      }],
    });
  } catch (error) {
    res.json({
      list: [],
      available: false,
      message: error.message || 'Air quality service unavailable',
    });
  }
});

app.get('/api/news', (_req, res) => {
  res.json({ articles: [] });
});

app.get('/api/weather', async (req, res) => {
  const city = (req.query.city || '').toString().trim();

  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  try {
    const location = await geocodeCity(city);
    const weatherData = await getWeatherForCoordinates(location.latitude, location.longitude);

    res.json({
      location,
      current: currentWeatherResponse(weatherData),
    });
  } catch (error) {
    res.status(404).json({ error: error.message || 'Weather not found' });
  }
});

app.get('/api/forecast', async (req, res) => {
  const city = (req.query.city || '').toString().trim();

  if (!city) {
    return res.status(400).json({ error: 'City is required' });
  }

  try {
    const location = await geocodeCity(city);
    const forecastData = await getForecastForCoordinates(location.latitude, location.longitude);

    res.json({
      location: {
        name: location.name,
        country: location.country,
      },
      forecast: forecastResponse(forecastData).daily,
    });
  } catch (error) {
    res.status(404).json({ error: error.message || 'Forecast not found' });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
