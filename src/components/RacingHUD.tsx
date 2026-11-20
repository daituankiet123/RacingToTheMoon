import React, { useMemo } from 'react';
import { Camera, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { RaceHudSnapshot, TrackData } from '../game/types';
import { WEATHER_LABELS } from '../game/cities';
import { WeatherIcon } from './WeatherIcon';

interface RacingHUDProps {
  hud: RaceHudSnapshot;
  track: TrackData;
  muted: boolean;
  onPause: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onCycleWeather: () => void;
  onToggleCamera: () => void;
  onTouchControl: (control: 'left' | 'right' | 'forward' | 'backward' | 'drift', pressed: boolean) => void;
  onTouchNitro: () => void;
}

export function formatRaceTime(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export const RacingHUD: React.FC<RacingHUDProps> = ({
  hud,
  track,
  muted,
  onPause,
  onRestart,
  onToggleMute,
  onCycleWeather,
  onToggleCamera,
  onTouchControl,
  onTouchNitro,
}) => {
  // Precompute normalized SVG path for the corner minimap from real spline samples
  const minimapGeometry = useMemo(() => {
    const pad = 16;
    const spanX = Math.max(1, track.maxX - track.minX);
    const spanZ = Math.max(1, track.maxZ - track.minZ);
    const scale = Math.min((120 - pad * 2) / spanX, (120 - pad * 2) / spanZ);
    const offsetX = (120 - spanX * scale) * 0.5;
    const offsetZ = (120 - spanZ * scale) * 0.5;

    const project = (x: number, z: number) => ({
      px: offsetX + (x - track.minX) * scale,
      py: offsetZ + (z - track.minZ) * scale,
    });

    const pts: string[] = [];
    for (let i = 0; i < track.samples.length; i += 3) {
      const s = track.samples[i];
      const { px, py } = project(s.point.x, s.point.z);
      pts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`);
    }
    pts.push('Z');
    return { pathD: pts.join(' '), project };
  }, [track]);

  const driftLabel =
    hud.driftTier === 3
      ? 'DRIFT TÍM · MAX'
      : hud.driftTier === 2
      ? 'DRIFT CAM'
      : hud.driftTier === 1
      ? 'DRIFT XANH'
      : null;

  const driftColor =
    hud.driftTier === 3
      ? '#c084fc'
      : hud.driftTier === 2
      ? '#fb923c'
      : '#38bdf8';

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3.5 sm:p-5">
      {/* Top Perimeter Row: Left Rank/Lap Cluster & Right Utility Buttons */}
      <div className="flex items-start justify-between gap-2">
        {/* Top-Left World-Matched Rank & Lap Cluster */}
        <div className="flex items-stretch gap-1.5 sm:gap-2.5">
          <div className="skew-panel border-l-4 border-orange-500 bg-[#0b1120]/86 px-2.5 py-1.5 shadow-lg sm:px-3.5 sm:py-2">
            <div className="unskew flex items-baseline gap-0.5 sm:gap-1">
              <span className="font-racing text-2xl leading-none font-bold text-orange-400 sm:text-4xl">
                {hud.rank}
              </span>
              <span className="font-racing text-xs font-semibold text-slate-400 sm:text-sm">
                /{hud.totalRacers}
              </span>
            </div>
            <div className="unskew mt-0.5 text-[9px] font-bold tracking-widest text-slate-400 uppercase sm:text-[10px]">
              HẠNG
            </div>
          </div>

          <div className="skew-panel border-l-2 border-sky-400/70 bg-[#0b1120]/82 px-2.5 py-1.5 shadow-lg sm:px-3.5 sm:py-2">
            <div className="unskew flex items-baseline gap-2 sm:gap-3">
              <div>
                <div className="font-racing text-lg leading-none font-bold text-white sm:text-2xl">
                  {hud.lap}
                  <span className="text-xs text-slate-400 sm:text-sm">/{hud.totalLaps}</span>
                </div>
                <div className="mt-0.5 text-[9px] font-bold tracking-widest text-sky-400 uppercase sm:text-[10px]">
                  VÒNG
                </div>
              </div>
              <div className="border-l border-slate-700 pl-2 sm:pl-3">
                <div className="font-racing text-sm leading-none font-bold text-slate-100 sm:text-xl">
                  {formatRaceTime(hud.raceTimeMs)}
                </div>
                <div
                  className="mt-0.5 flex max-w-[96px] items-center gap-1 text-[9px] font-semibold tracking-wider text-slate-300 uppercase sm:max-w-[150px] sm:text-[10px]"
                  title={WEATHER_LABELS[hud.weather]}
                >
                  <WeatherIcon weather={hud.weather} className="h-3 w-3 shrink-0" />
                  <span className="truncate">{hud.cityName}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top-Right Compact Utility Icons */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleWeather();
            }}
            aria-label={`Đổi thời tiết (hiện tại: ${WEATHER_LABELS[hud.weather]})`}
            title={`Đổi thời tiết: ${WEATHER_LABELS[hud.weather]}`}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-700 bg-[#0b1120]/86 px-2 text-xs font-semibold text-slate-200 transition hover:border-sky-400 hover:text-white cursor-pointer sm:h-9 sm:px-2.5"
          >
            <WeatherIcon weather={hud.weather} className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{WEATHER_LABELS[hud.weather]}</span>
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Bật âm thanh [M]' : 'Tắt âm thanh [M]'}
            title="Âm thanh [M]"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-[#0b1120]/86 text-slate-200 transition hover:border-sky-400 hover:text-white cursor-pointer sm:h-9 sm:w-9"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleCamera();
            }}
            aria-label="Đổi góc nhìn camera [C]"
            title="Góc nhìn [C]"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-[#0b1120]/86 text-slate-200 transition hover:border-sky-400 hover:text-white cursor-pointer sm:h-9 sm:w-9"
          >
            <Camera className="h-4 w-4" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onRestart();
            }}
            aria-label="Đua lại từ đầu [R]"
            title="Đua lại [R]"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-[#0b1120]/86 text-slate-200 transition hover:border-amber-400 hover:text-white cursor-pointer sm:h-9 sm:w-9"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Tạm dừng [P]"
            title="Tạm dừng [P]"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-[#0b1120]/86 text-slate-200 transition hover:border-orange-400 hover:text-white cursor-pointer sm:h-9 sm:w-9"
          >
            <Pause className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Ephemeral Center-Top Countdown / Event Banner (zero persistent center chrome) */}
      <div className="flex flex-col items-center justify-center gap-2">
        {hud.countdown >= 0 && (
          <div className="font-racing hud-stroke text-6xl font-bold italic tracking-wider text-amber-300 sm:text-7xl">
            {hud.countdown === 0 ? 'GO!' : hud.countdown}
          </div>
        )}
        {hud.wrongWay && (
          <div className="skew-panel border-2 border-red-500 bg-red-950/90 px-4 py-1.5 font-racing text-sm font-bold tracking-widest text-red-200 uppercase">
            <span className="unskew block">ĐI NGƯỢC CHIỀU!</span>
          </div>
        )}
        {hud.bannerText && hud.countdown < 0 && !hud.wrongWay && (
          <div className="font-racing hud-stroke text-2xl font-bold italic tracking-wider text-sky-300 uppercase sm:text-3xl">
            {hud.bannerText}
          </div>
        )}
        {driftLabel && (
          <div
            className="font-racing hud-stroke text-sm font-bold tracking-widest uppercase"
            style={{ color: driftColor }}
          >
            {driftLabel}
          </div>
        )}
      </div>

      {/* Bottom Perimeter Row: Left Minimap + Touch Steering | Right Speedometer & Nitro N2O */}
      <div className="flex items-end justify-between gap-3">
        {/* Bottom-Left Minimap (hidden on tiny screens when touch controls overlap, shown sm+) */}
        <div className="flex flex-col gap-2">
          <div className="hidden rounded-lg border border-slate-700/80 bg-[#0b1120]/82 p-1.5 shadow-lg sm:block">
            <svg viewBox="0 0 120 120" className="h-28 w-28" aria-label="Bản đồ đường đua">
              <path
                d={minimapGeometry.pathD}
                fill="none"
                stroke="#334155"
                strokeWidth="7"
                strokeLinejoin="round"
              />
              <path
                d={minimapGeometry.pathD}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {hud.minimapRacers.map((r) => {
                const { px, py } = minimapGeometry.project(r.x, r.z);
                return (
                  <circle
                    key={r.id}
                    cx={px}
                    cy={py}
                    r={r.isPlayer ? 4.8 : 3.2}
                    fill={r.isPlayer ? '#f97316' : r.color}
                    stroke="#020617"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>
          </div>

          {/* Mobile / Touch Left-Right Steering Pad */}
          <div className="pointer-events-auto flex items-center gap-2 sm:hidden">
            <button
              type="button"
              aria-label="Rẽ trái"
              onPointerDown={() => {
                onTouchControl('forward', true);
                onTouchControl('left', true);
              }}
              onPointerUp={() => onTouchControl('left', false)}
              onPointerLeave={() => onTouchControl('left', false)}
              className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-600 bg-[#0b1120]/85 font-racing text-xl font-bold text-white active:bg-sky-500/40"
            >
              ◀
            </button>
            <button
              type="button"
              aria-label="Rẽ phải"
              onPointerDown={() => {
                onTouchControl('forward', true);
                onTouchControl('right', true);
              }}
              onPointerUp={() => onTouchControl('right', false)}
              onPointerLeave={() => onTouchControl('right', false)}
              className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-600 bg-[#0b1120]/85 font-racing text-xl font-bold text-white active:bg-sky-500/40"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Bottom-Right Zing Speed Tachometer, Drift Bar & N2O Canisters */}
        <div className="flex flex-col items-end gap-2">
          {/* Mobile / Touch Drift + Nitro + Gas Buttons */}
          <div className="pointer-events-auto flex items-center gap-2 sm:hidden">
            <button
              type="button"
              aria-label="Drift"
              onPointerDown={() => {
                onTouchControl('forward', true);
                onTouchControl('drift', true);
              }}
              onPointerUp={() => onTouchControl('drift', false)}
              onPointerLeave={() => onTouchControl('drift', false)}
              className="flex h-12 items-center justify-center rounded-xl border border-amber-400/70 bg-amber-950/85 px-3.5 font-racing text-xs font-bold tracking-wider text-amber-200 active:bg-amber-500/40"
            >
              DRIFT
            </button>
            <button
              type="button"
              aria-label="Kích hoạt Nitro N2O"
              onPointerDown={onTouchNitro}
              disabled={hud.nitroCharges === 0}
              className={`flex h-12 items-center justify-center rounded-xl border px-4 font-racing text-xs font-bold tracking-wider ${
                hud.nitroCharges > 0
                  ? 'border-cyan-300 bg-cyan-500/90 text-slate-950'
                  : 'border-slate-700 bg-slate-900/80 text-slate-500'
              }`}
            >
              N2O ({hud.nitroCharges})
            </button>
            <button
              type="button"
              aria-label="Tăng ga"
              onPointerDown={() => onTouchControl('forward', true)}
              onPointerUp={() => onTouchControl('forward', false)}
              onPointerLeave={() => onTouchControl('forward', false)}
              className="flex h-14 w-14 items-center justify-center rounded-xl border border-orange-400/80 bg-orange-600/85 font-racing text-xs font-bold text-white active:bg-orange-400"
            >
              GA
            </button>
          </div>

          <div className="flex items-end gap-2.5">
            {/* N2O Canister Slots (2 Discrete Sockets) */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1.5">
                {[0, 1].map((slotIdx) => {
                  const filled = hud.nitroCharges > slotIdx;
                  return (
                    <div
                      key={slotIdx}
                      className={`skew-panel flex h-8 w-14 items-center justify-center border px-1.5 font-racing text-xs font-bold tracking-wider transition ${
                        filled
                          ? 'border-cyan-300 bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.65)]'
                          : 'border-slate-700 bg-[#0b1120]/82 text-slate-500'
                      }`}
                    >
                      <span className="unskew">N2O</span>
                    </div>
                  );
                })}
              </div>

              {/* Nitro Gauge Fill Bar */}
              <div className="skew-panel w-32 overflow-hidden border border-slate-700 bg-[#0b1120]/86 p-0.5 sm:w-40">
                <div className="h-2.5 w-full bg-slate-800">
                  <div
                    className="h-full transition-[width] duration-75"
                    style={{
                      width: `${Math.min(100, Math.max(0, hud.nitroGauge))}%`,
                      backgroundColor: hud.cwwActive
                        ? '#c084fc'
                        : hud.nitroActive
                        ? '#22d3ee'
                        : '#38bdf8',
                    }}
                  />
                </div>
              </div>
              <div className="hidden text-[10px] font-bold tracking-wider text-slate-300 uppercase hud-stroke sm:block">
                {hud.nitroCharges > 0 ? '[SPACE] PHUN NITRO' : '[SHIFT] DRIFT NẠP N2O'}
              </div>
            </div>

            {/* Digital Speedometer */}
            <div className="skew-panel border-r-4 border-sky-400 bg-[#0b1120]/88 px-4 py-2 text-right shadow-lg">
              <div
                className={`unskew font-racing text-4xl leading-none font-bold sm:text-5xl ${
                  hud.cwwActive
                    ? 'text-purple-300'
                    : hud.nitroActive || hud.miniBoostActive
                    ? 'text-cyan-300'
                    : 'text-white'
                }`}
              >
                {hud.speedKmh}
              </div>
              <div className="unskew mt-0.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                KM/H
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
