import React from 'react';
import { ArrowRight, Home, Play, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { GamePhase, RaceFinishSummary } from '../game/types';
import { formatRaceTime } from './RacingHUD';
import { getCityById, getNextCityId } from '../game/cities';

interface StatusModalProps {
  phase: GamePhase;
  finishSummary: RaceFinishSummary | null;
  onResume: () => void;
  onOpenGarage: () => void;
  onRestart: () => void;
  onNextCity: () => void;
  onReturnTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  phase,
  finishSummary,
  onResume,
  onOpenGarage,
  onRestart,
  onNextCity,
  onReturnTitle,
}) => {
  if (phase === 'paused') {
    return (
      <div
        className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Trò chơi đang tạm dừng"
      >
        <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-[#0d1426] p-6 text-center shadow-2xl">
          <h2 className="font-racing text-2xl font-bold tracking-wider text-white uppercase">
            TẠM DỪNG
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Nhấn P hoặc Esc để quay lại đường đua bất cứ lúc nào.
          </p>

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 py-3 font-racing text-sm font-bold tracking-wider text-slate-950 uppercase transition hover:bg-orange-400 cursor-pointer"
            >
              <Play className="h-4 w-4" />
              Tiếp Tục Đua
            </button>
            <button
              type="button"
              onClick={onOpenGarage}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-500/60 bg-sky-500/12 py-2.5 font-racing text-sm font-bold tracking-wider text-sky-300 uppercase transition hover:bg-sky-500/22 hover:text-white cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              Nạp Model Xe & Nhân Vật 3D
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-[#131d36] py-2.5 font-racing text-sm font-bold tracking-wider text-slate-200 uppercase transition hover:border-sky-400 hover:text-white cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Chơi Lại Chặng Này
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-800 py-2.5 font-racing text-sm font-bold tracking-wider text-slate-400 uppercase transition hover:text-white cursor-pointer"
            >
              <Home className="h-4 w-4" />
              Về Màn Hình Chính
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'gameover' && finishSummary) {
    const isPodium = finishSummary.rank <= 3;
    const nextCity = getCityById(getNextCityId(finishSummary.cityId));

    return (
      <div
        className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Kết quả chặng đua"
      >
        <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-[#0d1426] p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold tracking-widest text-sky-400 uppercase">
                {finishSummary.cityName} · HOÀN THÀNH
              </div>
              <h2 className="mt-0.5 font-racing text-3xl font-bold tracking-wider text-white uppercase">
                {finishSummary.rank === 1
                  ? 'QUÁN QUÂN CHẶNG ĐUA!'
                  : isPodium
                  ? `HẠNG ${finishSummary.rank} PODIUM!`
                  : `VỀ ĐÍCH HẠNG ${finishSummary.rank}`}
              </h2>
            </div>
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-xl border ${
                finishSummary.rank === 1
                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-sky-400/50 bg-sky-500/15 text-sky-300'
              }`}
            >
              <Trophy className="h-7 w-7" />
            </div>
          </div>

          {/* 3 Tabular Mastery Metrics */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-slate-800 bg-[#111a30] p-3 text-center">
              <div className="font-racing text-xl font-bold text-orange-400">
                #{finishSummary.rank}/{finishSummary.totalRacers}
              </div>
              <div className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                XẾP HẠNG
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111a30] p-3 text-center">
              <div className="font-racing text-xl font-bold text-white">
                {formatRaceTime(finishSummary.totalTimeMs)}
              </div>
              <div className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                TỔNG THỜI GIAN
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111a30] p-3 text-center">
              <div className="font-racing text-xl font-bold text-cyan-300">
                {formatRaceTime(finishSummary.bestLapMs)}
              </div>
              <div className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                VÒNG NHANH NHẤT
              </div>
            </div>
          </div>

          {/* Standings Table */}
          <div className="mt-4 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-[#090e1c] p-2">
            {finishSummary.standings.map((row) => (
              <div
                key={row.id}
                className={`flex items-center justify-between rounded px-2.5 py-1.5 text-xs ${
                  row.isPlayer
                    ? 'bg-orange-500/20 font-bold text-orange-200'
                    : 'text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-racing w-5 font-bold text-slate-400">#{row.rank}</span>
                  <span>{row.name}</span>
                </div>
                <span className="font-racing text-slate-400">
                  {row.finishTimeMs !== null ? formatRaceTime(row.finishTimeMs) : `Vòng ${row.lap}`}
                </span>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              data-start="true"
              onClick={onNextCity}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 font-racing text-sm font-bold tracking-wider text-slate-950 uppercase transition hover:bg-orange-400 cursor-pointer"
            >
              <span>Chặng Kế: {nextCity.name}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-[#131d36] px-4 py-3 font-racing text-sm font-bold text-white uppercase transition hover:border-sky-400 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Đua Lại
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-800 px-3.5 py-3 font-racing text-sm font-bold text-slate-400 uppercase transition hover:text-white cursor-pointer"
              aria-label="Về màn hình chính"
            >
              <Home className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
