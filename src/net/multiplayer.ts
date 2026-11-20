import { CityId, MultiplayerRoom, PublicRoomSummary, RemoteTelemetry } from '../game/types';

export type ConnectionMode = 'connecting' | 'ws' | 'offline-local';

export interface MultiplayerCallbacks {
  onConnectionChange?: (mode: ConnectionMode, playerId: string) => void;
  onRoomList?: (rooms: PublicRoomSummary[]) => void;
  onRoomJoined?: (room: MultiplayerRoom) => void;
  onRoomUpdate?: (room: MultiplayerRoom) => void;
  onRoomLeft?: () => void;
  onRoomError?: (message: string) => void;
  onChat?: (entry: { id: string; sender: string; text: string; ts: number }) => void;
  onRaceStarted?: (room: MultiplayerRoom, serverNow: number) => void;
  onRemoteState?: (state: RemoteTelemetry) => void;
  onPlayerFinished?: (id: string, finishTimeMs: number, room: MultiplayerRoom) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private mode: ConnectionMode = 'connecting';
  private playerId = 'local_' + Math.random().toString(36).slice(2, 9);
  private callbacks: MultiplayerCallbacks = {};
  private reconnectTimer: number | null = null;
  private disposed = false;
  private lastStateSentAt = 0;

  // Local fallback room state for pure static/offline multi-tab play (e.g., Vercel without WS URL)
  private localRoom: MultiplayerRoom | null = null;

  public setCallbacks(cb: MultiplayerCallbacks): void {
    this.callbacks = cb;
  }

  public getPlayerId(): string {
    return this.playerId;
  }

  public getMode(): ConnectionMode {
    return this.mode;
  }

  public connect(): void {
    if (this.disposed) return;
    const customUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = customUrl || `${protocol}//${window.location.host}/ws`;

    this.mode = 'connecting';
    this.callbacks.onConnectionChange?.(this.mode, this.playerId);

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const connectTimeout = window.setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          this.enableLocalChannelFallback();
        }
      }, 10000);

      ws.onopen = () => {
        window.clearTimeout(connectTimeout);
        this.mode = 'ws';
        this.callbacks.onConnectionChange?.('ws', this.playerId);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          this.handleServerMessage(msg);
        } catch {
          // ignore malformed packet
        }
      };

      ws.onerror = () => {
        window.clearTimeout(connectTimeout);
      };

      ws.onclose = () => {
        window.clearTimeout(connectTimeout);
        this.ws = null;
        if (!this.disposed) {
          this.enableLocalChannelFallback();
          if (this.reconnectTimer === null) {
            this.reconnectTimer = window.setTimeout(() => {
              this.reconnectTimer = null;
              if (!this.disposed && this.mode !== 'ws') {
                this.connect();
              }
            }, 8000);
          }
        }
      };
    } catch {
      this.enableLocalChannelFallback();
    }
  }

  private enableLocalChannelFallback(): void {
    if (this.mode === 'ws') return;
    this.mode = 'offline-local';
    this.callbacks.onConnectionChange?.('offline-local', this.playerId);
    if (!this.bc && typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel('nitro-drift-world-lan');
      this.bc.onmessage = (ev) => {
        const msg = ev.data as Record<string, unknown>;
        if (!msg || msg.senderId === this.playerId) return;
        this.handleLocalBroadcast(msg);
      };
    }
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    const type = String(msg.type || '');
    switch (type) {
      case 'welcome':
        this.playerId = String(msg.playerId || this.playerId);
        this.callbacks.onConnectionChange?.('ws', this.playerId);
        if (Array.isArray(msg.rooms)) {
          this.callbacks.onRoomList?.(msg.rooms as PublicRoomSummary[]);
        }
        break;
      case 'room:list':
        if (Array.isArray(msg.rooms)) {
          this.callbacks.onRoomList?.(msg.rooms as PublicRoomSummary[]);
        }
        break;
      case 'room:joined':
        this.callbacks.onRoomJoined?.(msg.room as MultiplayerRoom);
        break;
      case 'room:update':
        this.callbacks.onRoomUpdate?.(msg.room as MultiplayerRoom);
        break;
      case 'room:left':
        this.callbacks.onRoomLeft?.();
        if (Array.isArray(msg.rooms)) {
          this.callbacks.onRoomList?.(msg.rooms as PublicRoomSummary[]);
        }
        break;
      case 'room:error':
        this.callbacks.onRoomError?.(String(msg.message || 'Lỗi kết nối phòng.'));
        break;
      case 'room:chat':
        this.callbacks.onChat?.(msg.entry as { id: string; sender: string; text: string; ts: number });
        break;
      case 'race:started':
        this.callbacks.onRaceStarted?.(msg.room as MultiplayerRoom, Number(msg.serverNow || Date.now()));
        break;
      case 'player:state':
        this.callbacks.onRemoteState?.({
          id: String(msg.id),
          x: Number(msg.x),
          y: Number(msg.y),
          z: Number(msg.z),
          yaw: Number(msg.yaw),
          speed: Number(msg.speed),
          steer: Number(msg.steer),
          drifting: Boolean(msg.drifting),
          driftDir: Number(msg.driftDir),
          nitroActive: Boolean(msg.nitroActive),
          lap: Number(msg.lap),
          progress: Number(msg.progress),
        });
        break;
      case 'player:finished':
        this.callbacks.onPlayerFinished?.(
          String(msg.id),
          Number(msg.finishTimeMs),
          msg.room as MultiplayerRoom
        );
        break;
    }
  }

  private handleLocalBroadcast(msg: Record<string, unknown>): void {
    const type = String(msg.type || '');
    if (type === 'player:state' && this.localRoom && msg.code === this.localRoom.code) {
      this.callbacks.onRemoteState?.(msg.payload as RemoteTelemetry);
    } else if (type === 'room:join_req' && this.localRoom && this.localRoom.hostId === this.playerId && msg.code === this.localRoom.code) {
      const p = msg.player as { id: string; name: string; racerId: string };
      if (!this.localRoom.players.some((x) => x.id === p.id) && this.localRoom.players.length < 6) {
        this.localRoom.players.push({
          id: p.id,
          name: p.name,
          racerId: p.racerId,
          ready: true,
          isHost: false,
          gridSlot: this.localRoom.players.length,
          finished: false,
          finishTimeMs: null,
        });
        this.callbacks.onRoomUpdate?.({ ...this.localRoom });
        this.bc?.postMessage({ type: 'room:sync', senderId: this.playerId, room: this.localRoom });
      }
    } else if (type === 'room:sync') {
      const r = msg.room as MultiplayerRoom;
      if (r.players.some((p) => p.id === this.playerId)) {
        this.localRoom = r;
        this.callbacks.onRoomJoined?.(r);
      }
    } else if (type === 'race:started' && this.localRoom && msg.code === this.localRoom.code) {
      this.localRoom = msg.room as MultiplayerRoom;
      this.callbacks.onRaceStarted?.(this.localRoom, Date.now());
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  public requestRoomList(): void {
    if (this.mode === 'ws') {
      this.send({ type: 'room:list' });
    }
  }

  public createRoom(name: string, racerId: string, cityId: CityId, laps = 3): void {
    if (this.mode === 'ws') {
      this.send({ type: 'room:create', name, racerId, cityId, laps });
      return;
    }
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.localRoom = {
      code,
      hostId: this.playerId,
      cityId,
      laps,
      status: 'lobby',
      startTimestamp: 0,
      players: [
        {
          id: this.playerId,
          name: name || 'Tay Đua',
          racerId,
          ready: true,
          isHost: true,
          gridSlot: 0,
          finished: false,
          finishTimeMs: null,
        },
      ],
      chat: [
        {
          id: 'sys_1',
          sender: 'Hệ thống',
          text: `Phòng nội bộ ${code} đã tạo. Mở thêm tab trình duyệt để đua nhiều người!`,
          ts: Date.now(),
        },
      ],
    };
    this.callbacks.onRoomJoined?.({ ...this.localRoom });
  }

  public joinRoom(code: string, name: string, racerId: string): void {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      this.callbacks.onRoomError?.('Vui lòng nhập mã phòng.');
      return;
    }
    if (this.mode === 'ws') {
      this.send({ type: 'room:join', code: normalized, name, racerId });
      return;
    }
    this.bc?.postMessage({
      type: 'room:join_req',
      senderId: this.playerId,
      code: normalized,
      player: { id: this.playerId, name: name || 'Tay Đua', racerId },
    });
  }

  public leaveRoom(): void {
    if (this.mode === 'ws') {
      this.send({ type: 'room:leave' });
    } else {
      this.localRoom = null;
      this.callbacks.onRoomLeft?.();
    }
  }

  public setReady(ready: boolean, racerId: string, name: string): void {
    if (this.mode === 'ws') {
      this.send({ type: 'room:ready', ready, racerId, name });
    } else if (this.localRoom) {
      const p = this.localRoom.players.find((x) => x.id === this.playerId);
      if (p) {
        p.ready = ready;
        p.racerId = racerId;
        p.name = name;
        this.callbacks.onRoomUpdate?.({ ...this.localRoom });
      }
    }
  }

  public updateConfig(cityId: CityId, laps: number): void {
    if (this.mode === 'ws') {
      this.send({ type: 'room:config', cityId, laps });
    } else if (this.localRoom) {
      this.localRoom.cityId = cityId;
      this.localRoom.laps = laps;
      this.callbacks.onRoomUpdate?.({ ...this.localRoom });
    }
  }

  public sendChat(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.mode === 'ws') {
      this.send({ type: 'room:chat', text: trimmed });
    } else if (this.localRoom) {
      const me = this.localRoom.players.find((x) => x.id === this.playerId);
      const entry = {
        id: 'c_' + Date.now(),
        sender: me?.name ?? 'Tay Đua',
        text: trimmed,
        ts: Date.now(),
      };
      this.localRoom.chat.push(entry);
      this.callbacks.onChat?.(entry);
    }
  }

  public startRace(): void {
    if (this.mode === 'ws') {
      this.send({ type: 'race:start' });
    } else if (this.localRoom) {
      this.localRoom.status = 'racing';
      this.localRoom.startTimestamp = Date.now() + 2600;
      this.bc?.postMessage({
        type: 'race:started',
        senderId: this.playerId,
        code: this.localRoom.code,
        room: this.localRoom,
      });
      this.callbacks.onRaceStarted?.({ ...this.localRoom }, Date.now());
    }
  }

  public sendPlayerState(state: Omit<RemoteTelemetry, 'id'>): void {
    const now = performance.now();
    if (now - this.lastStateSentAt < 50) return; // 20Hz throttle
    this.lastStateSentAt = now;

    if (this.mode === 'ws') {
      this.send({ type: 'player:state', ...state });
    } else if (this.localRoom && this.bc) {
      this.bc.postMessage({
        type: 'player:state',
        senderId: this.playerId,
        code: this.localRoom.code,
        payload: { id: this.playerId, ...state },
      });
    }
  }

  public sendFinish(finishTimeMs: number): void {
    if (this.mode === 'ws') {
      this.send({ type: 'player:finish', finishTimeMs });
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.bc?.close();
  }
}
