import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Send,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { CITIES, getCityById } from '../game/cities';
import { getRacerPreset } from '../game/racers';
import { CityId, MultiplayerRoom, PublicRoomSummary } from '../game/types';
import { ConnectionMode } from '../net/multiplayer';

interface MultiplayerModalProps {
  connectionMode: ConnectionMode;
  playerId: string;
  playerName: string;
  selectedCityId: CityId;
  selectedRacerId: string;
  room: MultiplayerRoom | null;
  publicRooms: PublicRoomSummary[];
  error: string | null;
  onChangePlayerName: (name: string) => void;
  onCreateRoom: (cityId: CityId, laps: number) => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  onRefreshRooms: () => void;
  onToggleReady: () => void;
  onUpdateConfig: (cityId: CityId, laps: number) => void;
  onSendChat: (text: string) => void;
  onStartRace: () => void;
  onClose: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  connectionMode,
  playerId,
  playerName,
  selectedCityId,
  room,
  publicRooms,
  error,
  onChangePlayerName,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onRefreshRooms,
  onToggleReady,
  onUpdateConfig,
  onSendChat,
  onStartRace,
  onClose,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [copied, setCopied] = useState(false);

  const me = room?.players.find((p) => p.id === playerId);
  const isHost = room?.hostId === playerId;

  const handleCopyCode = () => {
    if (!room) return;
    navigator.clipboard?.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onJoinRoom(joinCode);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Phòng đua nhiều người chơi trực tuyến"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0d1426] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-sky-400" />
            <h2 className="font-racing text-xl font-bold tracking-wider text-white uppercase">
              ĐUA NHIỀU NGƯỜI CHƠI (MULTIPLAYER)
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#090e1c] px-2.5 py-1 text-[11px] font-semibold text-slate-300">
              <Wifi className={`h-3.5 w-3.5 ${connectionMode === 'ws' ? 'text-emerald-400' : 'text-amber-400'}`} />
              {connectionMode === 'ws'
                ? 'Server WebSocket Trực Tuyến'
                : connectionMode === 'connecting'
                ? 'Đang kết nối...'
                : 'Chế độ LAN / Multi-Tab'}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng cửa sổ nhiều người chơi"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-rose-500/50 bg-rose-950/60 px-3.5 py-2.5 text-xs font-medium text-rose-200"
            >
              {error}
            </div>
          )}

          {!room ? (
            <div className="space-y-5">
              {/* Player Nickname */}
              <div>
                <label
                  htmlFor="mp-nickname"
                  className="block text-xs font-semibold tracking-wider text-slate-400 uppercase"
                >
                  Tên hiển thị trong phòng đua
                </label>
                <input
                  id="mp-nickname"
                  type="text"
                  maxLength={18}
                  value={playerName}
                  onChange={(e) => onChangePlayerName(e.target.value)}
                  className="mt-1.5 w-full max-w-sm rounded-lg border border-slate-700 bg-[#090e1c] px-3.5 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="Nhập tên tay đua..."
                />
              </div>

              {/* Create & Join Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-[#111a30] p-4">
                  <h3 className="font-racing text-base font-bold text-white uppercase">
                    Tạo Phòng Đua Mới
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Tạo phòng riêng tối đa 6 tay đua và chia sẻ mã phòng cho bạn bè.
                  </p>
                  <button
                    type="button"
                    onClick={() => onCreateRoom(selectedCityId, 3)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 font-racing text-sm font-bold tracking-wider text-slate-950 uppercase transition hover:bg-orange-400 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    Tạo Phòng ({getCityById(selectedCityId).name})
                  </button>
                </div>

                <form
                  onSubmit={handleJoinSubmit}
                  className="rounded-xl border border-slate-800 bg-[#111a30] p-4"
                >
                  <h3 className="font-racing text-base font-bold text-white uppercase">
                    Vào Phòng Bằng Mã
                  </h3>
                  <label htmlFor="mp-room-code" className="mt-1 block text-xs text-slate-400">
                    Nhập mã phòng 6 ký tự từ chủ phòng:
                  </label>
                  <div className="mt-3 flex gap-2">
                    <input
                      id="mp-room-code"
                      type="text"
                      maxLength={6}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="VD: TOKYO8"
                      className="flex-1 rounded-lg border border-slate-700 bg-[#090e1c] px-3 py-2 font-racing text-sm font-bold tracking-widest text-white uppercase outline-none focus:border-sky-400"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-sky-500 px-4 py-2 font-racing text-sm font-bold text-slate-950 uppercase transition hover:bg-sky-400 cursor-pointer"
                    >
                      Vào
                    </button>
                  </div>
                </form>
              </div>

              {/* Public Rooms List */}
              <div className="rounded-xl border border-slate-800 bg-[#111a30] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-racing text-sm font-bold tracking-wider text-slate-200 uppercase">
                    Phòng Đang Mở ({publicRooms.length})
                  </h3>
                  <button
                    type="button"
                    onClick={onRefreshRooms}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-sky-400 hover:text-white cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Làm mới
                  </button>
                </div>

                {publicRooms.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">
                    Chưa có phòng công khai nào. Hãy tạo phòng mới và mời bạn bè cùng đua!
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {publicRooms.map((r) => (
                      <div
                        key={r.code}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#090e1c] px-3.5 py-2.5"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-racing text-sm font-bold tracking-widest text-amber-400">
                              {r.code}
                            </span>
                            <span className="text-xs font-semibold text-white">
                              {getCityById(r.cityId).name}
                            </span>
                            <span className="text-xs text-slate-400">· Chủ phòng: {r.hostName}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {r.playerCount}/{r.maxPlayers} tay đua · {r.laps} vòng ·{' '}
                            {r.status === 'lobby' ? 'Đang chờ' : 'Đang đua'}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={r.status !== 'lobby' || r.playerCount >= r.maxPlayers}
                          onClick={() => onJoinRoom(r.code)}
                          className="rounded-lg bg-sky-500 px-3.5 py-1.5 font-racing text-xs font-bold text-slate-950 uppercase transition hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-400 cursor-pointer"
                        >
                          Tham Gia
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              {/* Left 3 Cols: Room Info, Config & Player Roster */}
              <div className="space-y-4 lg:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#111a30] p-3.5">
                  <div>
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                      Mã Phòng Đua
                    </div>
                    <div className="font-racing text-2xl font-bold tracking-widest text-amber-400">
                      {room.code}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#090e1c] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-400 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? 'Đã sao chép!' : 'Sao chép mã'}
                    </button>
                    <button
                      type="button"
                      onClick={onLeaveRoom}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/50 cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Rời phòng
                    </button>
                  </div>
                </div>

                {/* Track & Laps Selector (Host editable) */}
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-[#111a30] p-3.5">
                  <div>
                    <label
                      htmlFor="mp-city-select"
                      className="block text-[11px] font-semibold tracking-wider text-slate-400 uppercase"
                    >
                      Thành Phố (10 Map)
                    </label>
                    <select
                      id="mp-city-select"
                      disabled={!isHost}
                      value={room.cityId}
                      onChange={(e) => onUpdateConfig(e.target.value as CityId, room.laps)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-[#090e1c] px-2.5 py-1.5 text-xs font-semibold text-white outline-none disabled:opacity-70"
                    >
                      {CITIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.trackName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="mp-laps-select"
                      className="block text-[11px] font-semibold tracking-wider text-slate-400 uppercase"
                    >
                      Số Vòng Đua
                    </label>
                    <select
                      id="mp-laps-select"
                      disabled={!isHost}
                      value={room.laps}
                      onChange={(e) => onUpdateConfig(room.cityId, Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-[#090e1c] px-2.5 py-1.5 text-xs font-semibold text-white outline-none disabled:opacity-70"
                    >
                      {[1, 2, 3, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} vòng
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Roster */}
                <div className="rounded-xl border border-slate-800 bg-[#111a30] p-3.5">
                  <div className="mb-2.5 flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span>Danh sách tay đua ({room.players.length}/6)</span>
                    <span className="text-[11px] text-slate-400">Slot trống sẽ có AI bổ sung</span>
                  </div>
                  <div className="space-y-2">
                    {room.players.map((p) => {
                      const preset = getRacerPreset(p.racerId);
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#090e1c] px-3 py-2"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: preset.bodyColor }}
                            />
                            <div>
                              <div className="text-xs font-bold text-white">
                                {p.name}{' '}
                                {p.id === playerId && (
                                  <span className="text-sky-400">(Bạn)</span>
                                )}
                                {p.isHost && (
                                  <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                                    CHỦ PHÒNG
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400">{preset.kartName}</div>
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              p.ready ? 'text-emerald-400' : 'text-slate-400'
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {p.ready ? 'Sẵn sàng' : 'Đang chuẩn bị'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right 2 Cols: Real-time Room Chat + Start CTA */}
              <div className="flex flex-col rounded-xl border border-slate-800 bg-[#111a30] p-3.5 lg:col-span-2">
                <div className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                  Trò chuyện phòng đua
                </div>
                <div className="mt-2 flex-1 space-y-2 overflow-y-auto rounded-lg bg-[#090e1c] p-2.5 text-xs min-h-[160px] max-h-[240px]">
                  {room.chat.map((c) => (
                    <div key={c.id} className="leading-relaxed">
                      <span className="font-bold text-sky-400">{c.sender}: </span>
                      <span className="text-slate-200">{c.text}</span>
                    </div>
                  ))}
                </div>
                <form onSubmit={handleChatSubmit} className="mt-2.5 flex gap-1.5">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Nhắn tin..."
                    aria-label="Nhập tin nhắn phòng đua"
                    className="flex-1 rounded-lg border border-slate-700 bg-[#090e1c] px-2.5 py-1.5 text-xs text-white outline-none focus:border-sky-400"
                  />
                  <button
                    type="submit"
                    aria-label="Gửi tin nhắn"
                    className="flex items-center justify-center rounded-lg bg-sky-500 px-3 text-slate-950 hover:bg-sky-400 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>

                <div className="mt-4">
                  {isHost ? (
                    <button
                      type="button"
                      onClick={onStartRace}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 py-3 font-racing text-sm font-bold tracking-wider text-slate-950 uppercase transition hover:bg-orange-400 cursor-pointer"
                    >
                      <Play className="h-4 w-4" />
                      Bắt Đầu Trận Đua
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onToggleReady}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 font-racing text-sm font-bold tracking-wider uppercase transition cursor-pointer ${
                        me?.ready
                          ? 'border border-emerald-400 bg-emerald-500/20 text-emerald-300'
                          : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {me?.ready ? 'Đã Sẵn Sàng (Hủy)' : 'Sẵn Sàng Đua'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
