import type { WeatherPoint } from '../types/route';

type WeatherTimelineProps = {
  weather: WeatherPoint[];
};

// Map Visual Crossing icons to emoji
const iconToEmoji: Record<string, string> = {
  'clear-day': '☀️',
  'clear-night': '🌙',
  'partly-cloudy-day': '⛅',
  'partly-cloudy-night': '☁️',
  cloudy: '☁️',
  rain: '🌧️',
  'showers-day': '🌦️',
  'showers-night': '🌧️',
  snow: '❄️',
  'snow-showers-day': '🌨️',
  'snow-showers-night': '🌨️',
  fog: '🌫️',
  wind: '💨',
  thunder: '⛈️',
  'thunder-rain': '⛈️',
  'thunder-showers-day': '⛈️',
  'thunder-showers-night': '⛈️',
  hail: '🌨️',
  sleet: '🌨️',
};

function getWeatherEmoji(icon: string): string {
  return iconToEmoji[icon] || '🌡️';
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  } else {
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }
}

function getWindDirection(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

function getTempColor(temp: number): string {
  if (temp <= 32) return '#60a5fa'; // blue-400
  if (temp <= 50) return '#93c5fd'; // blue-300
  if (temp <= 65) return '#86efac'; // green-300
  if (temp <= 80) return '#fcd34d'; // amber-300
  if (temp <= 90) return '#fb923c'; // orange-400
  return '#f87171'; // red-400
}

export function WeatherTimeline({ weather }: WeatherTimelineProps) {
  if (!weather || weather.length === 0) {
    return null;
  }

  return (
    <div className="weather-timeline">
      <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#9ca3af' }}>
        Weather Along Route
      </h4>
      <div
        style={{
          display: 'flex',
          overflowX: 'auto',
          gap: '8px',
          paddingBottom: '8px',
        }}
      >
        {weather.map((point, idx) => (
          <div
            key={idx}
            style={{
              minWidth: '100px',
              padding: '8px',
              backgroundColor: 'rgba(31, 41, 55, 0.8)',
              borderRadius: '8px',
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: '10px',
                color: '#9ca3af',
                marginBottom: '4px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={point.location_name}
            >
              {point.location_name || `Mile ${Math.round(point.distance_along_route_miles)}`}
            </div>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>
              {getWeatherEmoji(point.icon)}
            </div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: getTempColor(point.temperature_f),
              }}
            >
              {Math.round(point.temperature_f)}°F
            </div>
            <div style={{ fontSize: '10px', color: '#d1d5db', marginTop: '2px' }}>
              {point.condition}
            </div>
            {point.precip_prob > 20 && (
              <div style={{ fontSize: '10px', color: '#60a5fa', marginTop: '2px' }}>
                💧 {Math.round(point.precip_prob)}%
              </div>
            )}
            {point.wind_speed_mph > 15 && (
              <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>
                💨 {Math.round(point.wind_speed_mph)} {getWindDirection(point.wind_direction)}
              </div>
            )}
            <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '4px' }}>
              {formatDate(point.estimated_arrival_iso)} {formatTime(point.estimated_arrival_iso)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Compact weather display for station cards
export function WeatherBadge({ weather }: { weather: WeatherPoint | undefined }) {
  if (!weather) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 6px',
        backgroundColor: 'rgba(31, 41, 55, 0.6)',
        borderRadius: '4px',
        fontSize: '11px',
      }}
      title={`${weather.condition}, Feels like ${Math.round(weather.feels_like_f)}°F`}
    >
      <span>{getWeatherEmoji(weather.icon)}</span>
      <span style={{ color: getTempColor(weather.temperature_f) }}>
        {Math.round(weather.temperature_f)}°
      </span>
      {weather.precip_prob > 30 && (
        <span style={{ color: '#60a5fa' }}>💧{Math.round(weather.precip_prob)}%</span>
      )}
    </span>
  );
}
