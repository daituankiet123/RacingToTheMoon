import React from 'react';
import { Flag, Globe2, Users, Volume2, VolumeX } from 'lucide-react';
import { CityTheme, RacerPreset, WeatherSetting, WeatherType } from '../game/types';
import { WEATHER_LABELS } from '../game/cities';
import { PWAInstallButton } from './PWAInstallButton';
import { WeatherIcon } from './WeatherIcon';

interface TitleOverlayProps {
  city: CityTheme;
  racer: RacerPreset;
  activeWeather: WeatherType;
  weatherSetting: WeatherSetting;
  muted: boolean;
  onStartSolo: () => void;
  onOpenMultiplayer: () => void;
  onOpenGarage: () => void;
  onCycleWeather: () => void;
  onToggleMute: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  city,
  racer,
  activeWeather,
  weatherSetting,
  muted,
  onStartSolo,
  onOpenMultiplayer,
  onOpenGarage,
  onCycleWeather,
  onToggleMute,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-5 sm:p-8">
      {/* Subtle left-side scrim over negative space so title emblem & CTAs stay razor-sharp without touching the right-side 3D kart showcase */}
      <div
        className="pointer-events-none fixed inset-y-0 left-0 w-full max-w-xl"
        style={{
          background:
            'linear-gradient(90deg, rgba(8, 13, 28, 0.84) 0%, rgba(8, 13, 28, 0.56) 62%, rgba(8, 13, 28, 0) 100%)',
        }}
      />

      {/* Top Bar: Minimal City Spec + Weather & Top-Right PWA + Weather Cycle + Audio */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold tracking-wider text-slate-300 uppercase">
          <span
            className="inline-block h-2.5 w-2.5 rounded-xs"
            style={{ backgroundColor: city.accentHex }}
          />
          <span>
            {city.name}, {city.country}
          </span>
          <span className="text-slate-500">/</span>
          <span className="inline-flex items-center gap-1.5 text-slate-200">
            <WeatherIcon weather={activeWeather} className="h-3.5 w-3.5" />
            {WEATHER_LABELS[activeWeather]}
            {weatherSetting === 'dynamic' ? ' (Động)' : ''}
          </span>
          <span className="hidden text-slate-500 sm:inline">/</span>
          <span className="hidden text-slate-200 sm:inline">{racer.kartName}</span>
        </div>

        <div className="flex items-center gap-2">
          <PWAInstallButton />
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleWeather();
            }}
            aria-label={`Đổi thời tiết (hiện tại: ${WEATHER_LABELS[activeWeather]})`}
            title={`Thời tiết: ${WEATHER_LABELS[activeWeather]} — Nhấn để đổi`}
            className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-lg border border-slate-600/70 bg-[#0f172a]/90 px-2.5 text-xs font-semibold text-slate-200 transition hover:border-sky-400 hover:text-white cursor-pointer"
          >
            <WeatherIcon weather={activeWeather} className="h-4 w-4" />
            <span className="hidden sm:inline">{WEATHER_LABELS[activeWeather]}</span>
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            title={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-slate-600/70 bg-[#0f172a]/90 text-slate-200 transition hover:border-sky-400 hover:text-white cursor-pointer"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Left-Third Asymmetric Title Emblem & Core Actions */}
      <div className="relative z-10 my-auto max-w-md space-y-6">
        {/* Bespoke Inline SVG Title Lockup */}
        <svg
          viewBox="0 0 460 150"
          className="h-auto w-full max-w-[420px] drop-shadow-[0_6px_18px_rgba(2,6,23,0.85)]"
          role="img"
          aria-label="Nitro Drift World"
        >
          <defs>
            <linearGradient id="ndwFlame" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
            <linearGradient id="ndwCyan" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>

          {/* Racing Wing Speed Bars */}
          <polygon points="8,24 94,24 82,34 0,34" fill="url(#ndwCyan)" />
          <polygon points="18,40 72,40 64,48 10,48" fill="url(#ndwFlame)" />

          {/* Main Lockup: NITRO DRIFT */}
          <text
            x="16"
            y="84"
            fontFamily="'Chakra Petch', sans-serif"
            fontWeight="700"
            fontStyle="italic"
            fontSize="60"
            letterSpacing="2"
            fill="#f8fafc"
            stroke="#020617"
            strokeWidth="6"
            paintOrder="stroke fill"
          >
            NITRO DRIFT
          </text>

          {/* Sub Lockup Plate: WORLD TOUR */}
          <polygon points="18,98 258,98 246,132 6,132" fill="url(#ndwFlame)" />
          <polygon points="266,98 440,98 428,132 254,132" fill="#0f172a" stroke="#38bdf8" strokeWidth="2.5" />
          <text
            x="130"
            y="122"
            textAnchor="middle"
            fontFamily="'Chakra Petch', sans-serif"
            fontWeight="700"
            fontStyle="italic"
            fontSize="22"
            letterSpacing="4"
            fill="#020617"
          >
            WORLD TOUR
          </text>
          <text
            x="346"
            y="121"
            textAnchor="middle"
            fontFamily="'Chakra Petch', sans-serif"
            fontWeight="700"
            fontSize="16"
            letterSpacing="2"
            fill="#38bdf8"
          >
            10 CITIES · MP
          </text>
        </svg>

        {/* Primary Action Stack (<= 3 menu actions) */}
        <div className="pointer-events-auto flex flex-col gap-3 sm:max-w-[330px]">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStartSolo();
            }}
            className="skew-panel flex items-center justify-center gap-3 rounded-md bg-orange-500 px-6 py-3.5 text-slate-950 shadow-[0_6px_0_#9a3412] transition hover:bg-orange-400 active:translate-y-0.5 cursor-pointer"
          >
            <span className="unskew flex items-center gap-2.5 font-racing text-lg font-bold tracking-wider uppercase">
              <Flag className="h-5 w-5" />
              Đua Ngay
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenMultiplayer}
            className="skew-panel flex items-center justify-center gap-3 rounded-md border-2 border-sky-400/80 bg-[#0f172a]/92 px-6 py-3 text-sky-200 transition hover:bg-sky-500/20 hover:text-white cursor-pointer"
          >
            <span className="unskew flex items-center gap-2.5 font-racing text-base font-bold tracking-wider uppercase">
              <Users className="h-4 w-4 text-sky-400" />
              Đua Nhiều Người (Online)
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenGarage}
            className="skew-panel flex items-center justify-center gap-3 rounded-md border border-slate-500/80 bg-[#0f172a]/88 px-6 py-3 text-slate-200 transition hover:border-slate-300 hover:text-white cursor-pointer"
          >
            <span className="unskew flex items-center gap-2.5 font-racing text-sm font-bold tracking-wider uppercase">
              <Globe2 className="h-4 w-4 text-amber-400" />
              10 Thành Phố & Garage Xe
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Safe-Margin Single Flat Control Hint Line */}
      <div className="relative z-10 flex items-center justify-between text-xs font-medium tracking-wide text-slate-300/90">
        <p className="hud-stroke">
          WASD / Mũi Tên Lái · Shift Drift · Space Nitro N2O · C Góc Nhìn · P Tạm Dừng · Enter Bắt Đầu
        </p>
      </div>
    </div>
  );
};
