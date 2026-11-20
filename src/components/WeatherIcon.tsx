import React from 'react';
import { CloudFog, CloudRain, Snowflake, Sparkles, Sun, Sunset } from 'lucide-react';
import { WeatherSetting, WeatherType } from '../game/types';
import { WEATHER_LABELS } from '../game/cities';

export const WeatherIcon: React.FC<{ weather: WeatherType; className?: string }> = ({
  weather,
  className = 'h-3.5 w-3.5',
}) => {
  switch (weather) {
    case 'rain':
      return <CloudRain className={`${className} text-sky-300`} />;
    case 'snow':
      return <Snowflake className={`${className} text-slate-100`} />;
    case 'fog':
      return <CloudFog className={`${className} text-teal-200`} />;
    case 'sunset':
      return <Sunset className={`${className} text-amber-400`} />;
    default:
      return <Sun className={`${className} text-yellow-300`} />;
  }
};

export const WEATHER_SETTINGS: Array<{
  id: WeatherSetting;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'city', label: 'Theo Map', icon: <Sun className="h-3.5 w-3.5 text-slate-300" /> },
  { id: 'dynamic', label: 'Động', icon: <Sparkles className="h-3.5 w-3.5 text-cyan-300" /> },
  { id: 'rain', label: WEATHER_LABELS.rain, icon: <CloudRain className="h-3.5 w-3.5 text-sky-300" /> },
  { id: 'snow', label: WEATHER_LABELS.snow, icon: <Snowflake className="h-3.5 w-3.5 text-slate-100" /> },
  { id: 'fog', label: WEATHER_LABELS.fog, icon: <CloudFog className="h-3.5 w-3.5 text-teal-200" /> },
  { id: 'sunset', label: WEATHER_LABELS.sunset, icon: <Sunset className="h-3.5 w-3.5 text-amber-400" /> },
  { id: 'clear', label: WEATHER_LABELS.clear, icon: <Sun className="h-3.5 w-3.5 text-yellow-300" /> },
];

