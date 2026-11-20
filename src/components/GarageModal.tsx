import React, { useEffect, useRef, useState } from 'react';
import {
  CarFront,
  Check,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FolderPlus,
  Globe2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Sparkles,
  Star,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import { CITIES, WEATHER_LABELS } from '../game/cities';
import type { BatchModelLoadResult, CustomModelState } from '../game/engine';
import { exportKartToBlenderGLB } from '../game/models';
import {
  clampModelScale,
  clampSeatOffsetY,
  ModelSlotKind,
  normalizeQuarterTurns,
} from '../game/modelUtils';
import { RACER_PRESETS } from '../game/racers';
import { CityId, WeatherSetting } from '../game/types';
import { WEATHER_SETTINGS, WeatherIcon } from './WeatherIcon';

interface GarageModalProps {
  initialTab?: 'cities' | 'racers';
  isPausedRace?: boolean;
  selectedCityId: CityId;
  selectedRacerId: string;
  weatherSetting: WeatherSetting;
  playerName: string;
  customModelState: CustomModelState;
  onSelectCity: (cityId: CityId) => void;
  onSelectWeather: (setting: WeatherSetting) => void;
  onSelectRacer: (racerId: string) => void;
  onChangePlayerName: (name: string) => void;
  onUploadCustomBatch: (
    files: FileList | File[],
    explicitKind?: ModelSlotKind
  ) => Promise<BatchModelLoadResult>;
  onSelectCustomKart: (id: string | null) => void;
  onRemoveCustomKart: (id: string) => void;
  onClearAllCustomKarts: () => void;
  onUpdateCustomKartTransform: (yawSteps: number, scale: number) => void;
  onSelectCustomDriver: (id: string | null) => void;
  onRemoveCustomDriver: (id: string) => void;
  onClearAllCustomDrivers: () => void;
  onUpdateCustomDriverTransform: (
    yawSteps: number,
    scale: number,
    seatOffsetY?: number,
    visible?: boolean
  ) => void;
  onToggleApplyToAi: (enabled: boolean) => void;
  onClose: () => void;
  onStartRace: () => void;
}

export const GarageModal: React.FC<GarageModalProps> = ({
  initialTab = 'cities',
  isPausedRace = false,
  selectedCityId,
  selectedRacerId,
  weatherSetting,
  playerName,
  customModelState,
  onSelectCity,
  onSelectWeather,
  onSelectRacer,
  onChangePlayerName,
  onUploadCustomBatch,
  onSelectCustomKart,
  onRemoveCustomKart,
  onClearAllCustomKarts,
  onUpdateCustomKartTransform,
  onSelectCustomDriver,
  onRemoveCustomDriver,
  onClearAllCustomDrivers,
  onUpdateCustomDriverTransform,
  onToggleApplyToAi,
  onClose,
  onStartRace,
}) => {
  const [tab, setTab] = useState<'cities' | 'racers'>(initialTab);
  const [peek3D, setPeek3D] = useState(false);

  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [kartUploadError, setKartUploadError] = useState<string | null>(null);
  const [driverUploadError, setDriverUploadError] = useState<string | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<'batch' | 'kart' | 'driver' | null>(null);
  const [exportingPart, setExportingPart] = useState<'full' | 'kart' | 'driver' | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<'batch' | 'kart' | 'driver' | null>(null);

  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const kartInputRef = useRef<HTMLInputElement | null>(null);
  const driverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const activePreset = RACER_PRESETS.find((r) => r.id === selectedRacerId) ?? RACER_PRESETS[0];

  const processBatchUpload = async (files: FileList | File[], explicitKind?: ModelSlotKind) => {
    if (!files || files.length === 0) return;
    setBatchMessage(null);
    setKartUploadError(null);
    setDriverUploadError(null);
    setUploadingSlot(explicitKind ?? 'batch');

    try {
      const res = await onUploadCustomBatch(files, explicitKind);
      const parts: string[] = [];
      if (res.loadedKarts.length > 0) parts.push(`${res.loadedKarts.length} Xe Kart`);
      if (res.loadedDrivers.length > 0) parts.push(`${res.loadedDrivers.length} Nhân Vật`);

      if (parts.length > 0) {
        setBatchMessage(`Đã nạp ${parts.join(' & ')} — áp dụng ngay lập tức!`);
      }
      if (res.errors.length > 0) {
        const msg = res.errors.slice(0, 2).join(' | ');
        if (explicitKind === 'kart') setKartUploadError(msg);
        else if (explicitKind === 'driver') setDriverUploadError(msg);
        else if (parts.length === 0) setKartUploadError(msg);
        else setBatchMessage(`Đã nạp ${parts.join(' & ')} (Lỗi: ${msg})`);
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Không thể nạp file 3D. Vui lòng kiểm tra định dạng .glb / .gltf.';
      if (explicitKind === 'driver') setDriverUploadError(msg);
      else setKartUploadError(msg);
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleBatchInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    explicitKind?: ModelSlotKind
  ) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    await processBatchUpload(files, explicitKind);
  };

  const handleExportGlb = async (part: 'full' | 'kart' | 'driver') => {
    setExportingPart(part);
    try {
      const blob = await exportKartToBlenderGLB(activePreset, part);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = part === 'kart' ? 'kart-only' : part === 'driver' ? 'driver-only' : 'full-rig';
      a.download = `${activePreset.id}-${suffix}.glb`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      if (part === 'driver') setDriverUploadError('Không thể xuất file nhân vật .GLB.');
      else setKartUploadError('Không thể xuất file xe .GLB.');
    } finally {
      setExportingPart(null);
    }
  };

  const cycleLoadedKart = () => {
    if (customModelState.karts.length === 0) return;
    const idx = customModelState.karts.findIndex((k) => k.id === customModelState.activeKartId);
    const next = customModelState.karts[(idx + 1) % customModelState.karts.length];
    onSelectCustomKart(next.id);
  };

  const cycleLoadedDriver = () => {
    if (customModelState.drivers.length === 0) return;
    const idx = customModelState.drivers.findIndex((d) => d.id === customModelState.activeDriverId);
    const next = customModelState.drivers[(idx + 1) % customModelState.drivers.length];
    onSelectCustomDriver(next.id);
  };

  // Compact live 3D peek bar so users can inspect, rotate, and cycle multiple loaded models directly on stage
  if (peek3D) {
    const activeKartIdx = customModelState.karts.findIndex(
      (k) => k.id === customModelState.activeKartId
    );
    const activeDriverIdx = customModelState.drivers.findIndex(
      (d) => d.id === customModelState.activeDriverId
    );

    return (
      <div
        className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-3"
        role="region"
        aria-label="Thanh xem trực tiếp model 3D trên sân khấu"
      >
        <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-sky-500/60 bg-[#0d1426]/95 px-4 py-2.5 shadow-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-racing font-bold text-emerald-400 uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              Đang xem trực tiếp 3D
            </span>
            {customModelState.karts.length > 1 && (
              <button
                type="button"
                onClick={cycleLoadedKart}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/22 hover:text-white cursor-pointer"
              >
                <span>
                  Đổi Xe ({activeKartIdx >= 0 ? activeKartIdx + 1 : 0}/{customModelState.karts.length})
                </span>
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
            {customModelState.kartName && (
              <button
                type="button"
                onClick={() =>
                  onUpdateCustomKartTransform(
                    normalizeQuarterTurns(customModelState.kartYawSteps + 1),
                    customModelState.kartScale
                  )
                }
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#131d36] px-2.5 py-1 text-xs font-semibold text-sky-300 hover:border-sky-400 hover:text-white cursor-pointer"
              >
                <RotateCw className="h-3 w-3" />
                Xoay Xe ({customModelState.kartYawSteps * 90}°)
              </button>
            )}
            {customModelState.drivers.length > 1 && (
              <button
                type="button"
                onClick={cycleLoadedDriver}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/12 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/22 hover:text-white cursor-pointer"
              >
                <span>
                  Đổi NV ({activeDriverIdx >= 0 ? activeDriverIdx + 1 : 0}/{customModelState.drivers.length})
                </span>
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
            {customModelState.driverName && (
              <button
                type="button"
                onClick={() =>
                  onUpdateCustomDriverTransform(
                    normalizeQuarterTurns(customModelState.driverYawSteps + 1),
                    customModelState.driverScale,
                    customModelState.driverSeatOffsetY,
                    customModelState.driverVisible
                  )
                }
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#131d36] px-2.5 py-1 text-xs font-semibold text-amber-300 hover:border-amber-400 hover:text-white cursor-pointer"
              >
                <RotateCw className="h-3 w-3" />
                Xoay Nhân Vật ({customModelState.driverYawSteps * 90}°)
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPeek3D(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-[#131d36] px-3 py-1.5 text-xs font-semibold text-white hover:border-sky-400 cursor-pointer"
            >
              Mở Lại Garage
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartRace();
              }}
              className="rounded-lg bg-orange-500 px-4 py-1.5 font-racing text-xs font-bold tracking-wider text-slate-950 uppercase hover:bg-orange-400 cursor-pointer"
            >
              {isPausedRace ? 'Tiếp Tục Đua' : 'Vào Đường Đua'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-slate-950/78 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Chọn 10 thành phố thế giới và Garage xe"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0d1426] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <h2 className="font-racing text-lg font-bold tracking-wider text-white uppercase sm:text-xl">
              TRƯỜNG ĐUA THẾ GIỚI & GARAGE 3D BLENDER
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPeek3D(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/12 px-2.5 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/22 hover:text-white cursor-pointer"
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Xem Sân Khấu 3D</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng Garage"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-[#090e1c] px-5 pt-2">
          <button
            type="button"
            onClick={() => setTab('cities')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 font-racing text-sm font-bold tracking-wider uppercase transition cursor-pointer ${
              tab === 'cities'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe2 className="h-4 w-4" />
            10 Thành Phố & Thời Tiết
          </button>
          <button
            type="button"
            onClick={() => setTab('racers')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 font-racing text-sm font-bold tracking-wider uppercase transition cursor-pointer ${
              tab === 'racers'
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="h-4 w-4" />
            Nạp Model Kart & Nhân Vật (.GLB)
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'cities' ? (
            <div className="space-y-4">
              {/* Dynamic Weather Selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#111a30] px-3.5 py-2.5">
                <span className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                  Chế độ thời tiết:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {WEATHER_SETTINGS.map((opt) => {
                    const active = weatherSetting === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectWeather(opt.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                          active
                            ? 'border-sky-400 bg-sky-500/20 text-white'
                            : 'border-slate-700 bg-[#090e1c] text-slate-300 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        {opt.icon}
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2">
                {CITIES.map((city, idx) => {
                  const active = city.id === selectedCityId;
                  return (
                    <button
                      key={city.id}
                      type="button"
                      onClick={() => onSelectCity(city.id)}
                      className={`group flex flex-col rounded-xl border p-3.5 text-left transition cursor-pointer ${
                        active
                          ? 'border-orange-400 bg-orange-500/12 shadow-[0_0_0_1px_rgba(251,146,60,0.4)]'
                          : 'border-slate-800 bg-[#111a30] hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-racing text-xs font-bold text-slate-950"
                            style={{ backgroundColor: city.accentHex }}
                          >
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-racing text-base font-bold text-white">
                                {city.name}
                              </span>
                              <span className="text-xs text-slate-400">· {city.country}</span>
                            </div>
                            <div className="text-xs font-semibold text-sky-300">
                              {city.trackName}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-0.5 text-amber-400" aria-label={`Độ khó ${city.difficulty}/5`}>
                            {Array.from({ length: 5 }).map((_, sIdx) => (
                              <Star
                                key={sIdx}
                                className={`h-3 w-3 ${sIdx < city.difficulty ? 'fill-amber-400' : 'text-slate-700'}`}
                              />
                            ))}
                          </div>
                          <span className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-[#090e1c] px-1.5 py-0.5 text-[10px] font-semibold text-slate-200">
                            <WeatherIcon weather={city.defaultWeather} className="h-3 w-3" />
                            {WEATHER_LABELS[city.defaultWeather]}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-300">
                        {city.tagline}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Nickname + Batch Multi-Model Uploader */}
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-[#111a30] p-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <label
                    htmlFor="garage-player-name"
                    className="block text-xs font-semibold tracking-wider text-slate-400 uppercase"
                  >
                    Tên Tay Đua
                  </label>
                  <input
                    id="garage-player-name"
                    type="text"
                    maxLength={18}
                    value={playerName}
                    onChange={(e) => onChangePlayerName(e.target.value)}
                    placeholder="Nhập tên của bạn..."
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#090e1c] px-3 py-2 text-sm font-medium text-white outline-none focus:border-sky-400"
                  />
                </div>

                {/* Shared Multi-File Batch Dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverSlot('batch');
                  }}
                  onDragLeave={() => setDragOverSlot(null)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragOverSlot(null);
                    if (e.dataTransfer.files?.length) {
                      await processBatchUpload(e.dataTransfer.files);
                    }
                  }}
                  className={`flex flex-col justify-between rounded-lg border border-dashed p-3 transition md:col-span-8 ${
                    dragOverSlot === 'batch'
                      ? 'border-emerald-400 bg-emerald-500/15'
                      : 'border-slate-700 bg-[#090e1c]'
                  }`}
                >
                  <input
                    ref={batchInputRef}
                    data-testid="custom-batch-input"
                    type="file"
                    multiple
                    accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2"
                    onChange={(e) => handleBatchInputChange(e)}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-emerald-300 uppercase">
                        <FolderPlus className="h-3.5 w-3.5" />
                        Nạp Cùng Lúc Nhiều Model (.GLB / .GLTF)
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Chọn hoặc kéo-thả nhiều file Xe & Nhân Vật cùng lúc — tự phân loại & áp dụng liền.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => batchInputRef.current?.click()}
                        disabled={uploadingSlot !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {uploadingSlot === 'batch' ? 'Đang nạp hàng loạt...' : 'Chọn Nhiều File'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportGlb('full')}
                        disabled={exportingPart !== null}
                        title="Xuất bộ xe & nhân vật hiện tại ra .GLB"
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {exportingPart === 'full' ? 'Đang xuất...' : 'Xuất Bộ .GLB'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/90 pt-2">
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid="apply-library-ai-toggle"
                        checked={customModelState.applyLibraryToAiRivals}
                        onChange={(e) => onToggleApplyToAi(e.target.checked)}
                        className="h-3.5 w-3.5 accent-sky-400"
                      />
                      <Users className="h-3.5 w-3.5 text-sky-400" />
                      <span>Phân bổ các model đã nạp cho dàn đối thủ AI trên đường đua</span>
                    </label>
                    {batchMessage && (
                      <span
                        data-testid="batch-upload-feedback"
                        className="text-[11px] font-semibold text-emerald-300"
                      >
                        {batchMessage}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Dual Instant Custom 3D Loader Cards: KART + DRIVER (with Multi-Select & Library List) */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* 1. Custom KART 3D Model Library */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverSlot('kart');
                  }}
                  onDragLeave={() => setDragOverSlot(null)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragOverSlot(null);
                    if (e.dataTransfer.files?.length) {
                      await processBatchUpload(e.dataTransfer.files, 'kart');
                    }
                  }}
                  className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                    dragOverSlot === 'kart'
                      ? 'border-sky-400 bg-sky-500/15'
                      : customModelState.kartName
                      ? 'border-emerald-500/60 bg-[#0f1d2e]'
                      : 'border-slate-800 bg-[#111a30]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CarFront className="h-4 w-4 text-sky-400" />
                        <span className="font-racing text-sm font-bold tracking-wider text-white uppercase">
                          Kho Model Xe Kart ({customModelState.karts.length})
                        </span>
                      </div>
                      <span
                        data-testid="custom-kart-status"
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          customModelState.kartName
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {customModelState.kartName ? 'Áp dụng liền' : 'Mặc định'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Chọn hoặc kéo-thả 1 hoặc nhiều file <span className="text-slate-200">.glb / .gltf</span> làm xe Kart.
                    </p>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    <input
                      ref={kartInputRef}
                      data-testid="custom-kart-input"
                      type="file"
                      multiple
                      accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2"
                      onChange={(e) => handleBatchInputChange(e, 'kart')}
                      className="hidden"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => kartInputRef.current?.click()}
                        disabled={uploadingSlot !== null}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-500/60 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25 hover:text-white cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {uploadingSlot === 'kart'
                          ? 'Đang nạp xe...'
                          : 'Nạp Nhiều Model Xe (.glb)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportGlb('kart')}
                        disabled={exportingPart !== null}
                        title="Xuất khung xe Kart hiện tại ra .GLB"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#090e1c] px-2.5 py-2 text-xs font-semibold text-slate-300 hover:border-amber-400 hover:text-amber-300 cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Mẫu Xe
                      </button>
                    </div>

                    {/* Loaded Karts Switcher List */}
                    {customModelState.karts.length > 0 && (
                      <div className="space-y-1.5 rounded-lg border border-slate-800 bg-[#090e1c] p-2">
                        <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          <span>Chọn nhanh xe (đổi tức thì)</span>
                          <button
                            type="button"
                            onClick={onClearAllCustomKarts}
                            className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            Xoá hết
                          </button>
                        </div>
                        <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                          <button
                            type="button"
                            onClick={() => onSelectCustomKart(null)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition cursor-pointer ${
                              customModelState.activeKartId === null
                                ? 'bg-sky-500/20 font-semibold text-sky-200'
                                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                            }`}
                          >
                            <span>Xe Mặc Định (Preset)</span>
                            {customModelState.activeKartId === null && <Check className="h-3.5 w-3.5" />}
                          </button>
                          {customModelState.karts.map((item) => {
                            const isActive = item.id === customModelState.activeKartId;
                            return (
                              <div
                                key={item.id}
                                className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-xs ${
                                  isActive
                                    ? 'bg-emerald-500/20 font-semibold text-emerald-200'
                                    : 'text-slate-300 hover:bg-slate-800/80'
                                }`}
                              >
                                <button
                                  type="button"
                                  data-testid={`kart-item-${item.name}`}
                                  onClick={() => onSelectCustomKart(item.id)}
                                  className="flex flex-1 items-center gap-1.5 truncate text-left cursor-pointer"
                                >
                                  {isActive && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
                                  <span className="truncate">{item.name}</span>
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Xoá ${item.name}`}
                                  onClick={() => onRemoveCustomKart(item.id)}
                                  className="rounded p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {customModelState.kartName && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090e1c] px-2.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateCustomKartTransform(
                                normalizeQuarterTurns(customModelState.kartYawSteps + 1),
                                customModelState.kartScale
                              )
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:border-sky-400 hover:text-white cursor-pointer"
                          >
                            <RotateCw className="h-3 w-3" />
                            Xoay {customModelState.kartYawSteps * 90}°
                          </button>
                          <div className="inline-flex items-center rounded border border-slate-700">
                            <button
                              type="button"
                              aria-label="Thu nhỏ xe"
                              onClick={() =>
                                onUpdateCustomKartTransform(
                                  customModelState.kartYawSteps,
                                  clampModelScale(customModelState.kartScale - 0.1)
                                )
                              }
                              className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="px-1.5 text-[11px] font-bold text-slate-200">
                              {customModelState.kartScale.toFixed(1)}x
                            </span>
                            <button
                              type="button"
                              aria-label="Phóng to xe"
                              onClick={() =>
                                onUpdateCustomKartTransform(
                                  customModelState.kartYawSteps,
                                  clampModelScale(customModelState.kartScale + 0.1)
                                )
                              }
                              className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectCustomKart(null)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Mặc định
                        </button>
                      </div>
                    )}

                    {kartUploadError && (
                      <p className="text-xs text-rose-400">{kartUploadError}</p>
                    )}
                  </div>
                </div>

                {/* 2. Custom DRIVER / CHARACTER 3D Model Library */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverSlot('driver');
                  }}
                  onDragLeave={() => setDragOverSlot(null)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragOverSlot(null);
                    if (e.dataTransfer.files?.length) {
                      await processBatchUpload(e.dataTransfer.files, 'driver');
                    }
                  }}
                  className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                    dragOverSlot === 'driver'
                      ? 'border-amber-400 bg-amber-500/15'
                      : customModelState.driverName
                      ? 'border-emerald-500/60 bg-[#0f1d2e]'
                      : 'border-slate-800 bg-[#111a30]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-amber-400" />
                        <span className="font-racing text-sm font-bold tracking-wider text-white uppercase">
                          Kho Model Nhân Vật ({customModelState.drivers.length})
                        </span>
                      </div>
                      <span
                        data-testid="custom-driver-status"
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          customModelState.driverName
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {customModelState.driverName ? 'Áp dụng liền' : 'Mặc định'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Chọn hoặc kéo-thả 1 hoặc nhiều file <span className="text-slate-200">.glb / .gltf</span> (Blender / Mixamo).
                    </p>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    <input
                      ref={driverInputRef}
                      data-testid="custom-driver-input"
                      type="file"
                      multiple
                      accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2"
                      onChange={(e) => handleBatchInputChange(e, 'driver')}
                      className="hidden"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => driverInputRef.current?.click()}
                        disabled={uploadingSlot !== null}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 hover:text-white cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {uploadingSlot === 'driver'
                          ? 'Đang nạp nhân vật...'
                          : 'Nạp Nhiều Nhân Vật (.glb)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportGlb('driver')}
                        disabled={exportingPart !== null}
                        title="Xuất nhân vật hiện tại ra .GLB"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#090e1c] px-2.5 py-2 text-xs font-semibold text-slate-300 hover:border-amber-400 hover:text-amber-300 cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Mẫu NV
                      </button>
                    </div>

                    {/* Loaded Drivers Switcher List */}
                    {customModelState.drivers.length > 0 && (
                      <div className="space-y-1.5 rounded-lg border border-slate-800 bg-[#090e1c] p-2">
                        <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          <span>Chọn nhanh nhân vật (đổi tức thì)</span>
                          <button
                            type="button"
                            onClick={onClearAllCustomDrivers}
                            className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            Xoá hết
                          </button>
                        </div>
                        <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                          <button
                            type="button"
                            onClick={() => onSelectCustomDriver(null)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition cursor-pointer ${
                              customModelState.activeDriverId === null
                                ? 'bg-amber-500/20 font-semibold text-amber-200'
                                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                            }`}
                          >
                            <span>Nhân Vật Mặc Định (Preset)</span>
                            {customModelState.activeDriverId === null && (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {customModelState.drivers.map((item) => {
                            const isActive = item.id === customModelState.activeDriverId;
                            return (
                              <div
                                key={item.id}
                                className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-xs ${
                                  isActive
                                    ? 'bg-emerald-500/20 font-semibold text-emerald-200'
                                    : 'text-slate-300 hover:bg-slate-800/80'
                                }`}
                              >
                                <button
                                  type="button"
                                  data-testid={`driver-item-${item.name}`}
                                  onClick={() => onSelectCustomDriver(item.id)}
                                  className="flex flex-1 items-center gap-1.5 truncate text-left cursor-pointer"
                                >
                                  {isActive && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
                                  <span className="truncate">{item.name}</span>
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Xoá ${item.name}`}
                                  onClick={() => onRemoveCustomDriver(item.id)}
                                  className="rounded p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090e1c] px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateCustomDriverTransform(
                              customModelState.driverYawSteps,
                              customModelState.driverScale,
                              customModelState.driverSeatOffsetY,
                              !customModelState.driverVisible
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-sky-400 hover:text-white cursor-pointer"
                        >
                          {customModelState.driverVisible ? (
                            <Eye className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <EyeOff className="h-3 w-3 text-slate-500" />
                          )}
                          {customModelState.driverVisible ? 'Đang hiện' : 'Đang ẩn'}
                        </button>
                        {customModelState.driverName && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateCustomDriverTransform(
                                  normalizeQuarterTurns(customModelState.driverYawSteps + 1),
                                  customModelState.driverScale,
                                  customModelState.driverSeatOffsetY,
                                  customModelState.driverVisible
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] font-semibold text-amber-300 hover:border-amber-400 hover:text-white cursor-pointer"
                            >
                              <RotateCw className="h-3 w-3" />
                              Xoay {customModelState.driverYawSteps * 90}°
                            </button>
                            <div className="inline-flex items-center rounded border border-slate-700">
                              <button
                                type="button"
                                aria-label="Thu nhỏ nhân vật"
                                onClick={() =>
                                  onUpdateCustomDriverTransform(
                                    customModelState.driverYawSteps,
                                    clampModelScale(customModelState.driverScale - 0.1),
                                    customModelState.driverSeatOffsetY,
                                    customModelState.driverVisible
                                  )
                                }
                                className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="px-1.5 text-[11px] font-bold text-slate-200">
                                {customModelState.driverScale.toFixed(1)}x
                              </span>
                              <button
                                type="button"
                                aria-label="Phóng to nhân vật"
                                onClick={() =>
                                  onUpdateCustomDriverTransform(
                                    customModelState.driverYawSteps,
                                    clampModelScale(customModelState.driverScale + 0.1),
                                    customModelState.driverSeatOffsetY,
                                    customModelState.driverVisible
                                  )
                                }
                                className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </>
                        )}
                        <div className="inline-flex items-center rounded border border-slate-700" title="Chỉnh độ cao ghế ngồi">
                          <button
                            type="button"
                            aria-label="Hạ ghế nhân vật"
                            onClick={() =>
                              onUpdateCustomDriverTransform(
                                customModelState.driverYawSteps,
                                customModelState.driverScale,
                                clampSeatOffsetY(customModelState.driverSeatOffsetY - 0.1),
                                customModelState.driverVisible
                              )
                            }
                            className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="px-1.5 text-[11px] font-semibold text-slate-300">
                            Ghế {customModelState.driverSeatOffsetY >= 0 ? '+' : ''}
                            {customModelState.driverSeatOffsetY.toFixed(1)}m
                          </span>
                          <button
                            type="button"
                            aria-label="Nâng ghế nhân vật"
                            onClick={() =>
                              onUpdateCustomDriverTransform(
                                customModelState.driverYawSteps,
                                customModelState.driverScale,
                                clampSeatOffsetY(customModelState.driverSeatOffsetY + 0.1),
                                customModelState.driverVisible
                              )
                            }
                            className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {customModelState.driverName && (
                        <button
                          type="button"
                          onClick={() => onSelectCustomDriver(null)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Mặc định
                        </button>
                      )}
                    </div>

                    {driverUploadError && (
                      <p className="text-xs text-rose-400">{driverUploadError}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 6 Stylized S-Class Racers & Karts */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {RACER_PRESETS.map((r) => {
                  const active = r.id === selectedRacerId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelectRacer(r.id)}
                      className={`flex flex-col rounded-xl border p-3.5 text-left transition cursor-pointer ${
                        active
                          ? 'border-sky-400 bg-sky-500/12'
                          : 'border-slate-800 bg-[#111a30] hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/50"
                            style={{ backgroundColor: r.bodyColor }}
                          />
                          <span className="font-racing text-sm font-bold text-white">
                            {r.name}
                          </span>
                        </div>
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-racing text-[10px] font-bold text-amber-300">
                          HẠNG {r.kartClass}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-medium text-sky-300">{r.kartName}</div>
                      <div className="text-[11px] text-slate-400">{r.title}</div>

                      <div className="mt-3 space-y-1.5 text-[11px]">
                        {[
                          ['Tốc độ', r.stats.topSpeed, '#f97316'],
                          ['Tăng tốc', r.stats.acceleration, '#38bdf8'],
                          ['Drift', r.stats.drift, '#a855f7'],
                          ['Nitro', r.stats.nitro, '#22d3ee'],
                        ].map(([label, val, col]) => (
                          <div key={String(label)} className="flex items-center gap-2">
                            <span className="w-14 text-slate-400">{label}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${val}%`, backgroundColor: String(col) }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {active && (
                        <div className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-sky-300">
                          <Check className="h-3.5 w-3.5" /> Đang chọn
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#090e1c] px-5 py-3.5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Hỗ trợ chọn & kéo-thả nhiều model cùng lúc — đổi qua lại tức thì</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartRace();
              }}
              className="rounded-lg bg-orange-500 px-5 py-2 font-racing text-xs font-bold tracking-wider text-slate-950 uppercase transition hover:bg-orange-400 cursor-pointer"
            >
              {isPausedRace ? 'Tiếp Tục Đua Ngay' : 'Vào Đường Đua Ngay'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
