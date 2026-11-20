import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface RoomPlayer {
  id: string;
  name: string;
  racerId: string;
  ready: boolean;
  isHost: boolean;
  gridSlot: number;
  finished: boolean;
  finishTimeMs: number | null;
  ws: WebSocket;
}

interface ChatEntry {
  id: string;
  sender: string;
  text: string;
  ts: number;
}

interface RoomState {
  code: string;
  hostId: string;
  cityId: string;
  laps: number;
  weatherSetting: string;
  status: 'lobby' | 'racing';
  startTimestamp: number;
  players: Map<string, RoomPlayer>;
  chat: ChatEntry[];
  createdAt: number;
}

const rooms = new Map<string, RoomState>();
const socketMeta = new Map<WebSocket, { playerId: string; roomCode: string | null }>();

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? genCode() : code;
}

function genId(): string {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function serializeRoom(room: RoomState) {
  return {
    code: room.code,
    hostId: room.hostId,
    cityId: room.cityId,
    laps: room.laps,
    weatherSetting: room.weatherSetting,
    status: room.status,
    startTimestamp: room.startTimestamp,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      racerId: p.racerId,
      ready: p.ready,
      isHost: p.isHost,
      gridSlot: p.gridSlot,
      finished: p.finished,
      finishTimeMs: p.finishTimeMs,
    })),
    chat: room.chat.slice(-25),
  };
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(room: RoomState, payload: unknown, excludeId?: string) {
  const raw = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (excludeId && player.id === excludeId) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(raw);
    }
  }
}

function getPublicRoomSummaries() {
  const list: Array<{
    code: string;
    cityId: string;
    laps: number;
    playerCount: number;
    maxPlayers: number;
    hostName: string;
    status: 'lobby' | 'racing';
  }> = [];
  for (const room of rooms.values()) {
    const host = room.players.get(room.hostId);
    list.push({
      code: room.code,
      cityId: room.cityId,
      laps: room.laps,
      playerCount: room.players.size,
      maxPlayers: 6,
      hostName: host?.name ?? 'Tay Đua',
      status: room.status,
    });
  }
  return list.sort((a, b) => b.playerCount - a.playerCount);
}

function leaveCurrentRoom(ws: WebSocket) {
  const meta = socketMeta.get(ws);
  if (!meta || !meta.roomCode) return;
  const room = rooms.get(meta.roomCode);
  meta.roomCode = null;
  if (!room) return;

  room.players.delete(meta.playerId);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === meta.playerId) {
    const nextHost = room.players.values().next().value;
    if (nextHost) {
      room.hostId = nextHost.id;
      nextHost.isHost = true;
      nextHost.ready = true;
    }
  }

  let slot = 0;
  for (const p of room.players.values()) {
    p.gridSlot = slot++;
  }

  broadcastRoom(room, { type: 'room:update', room: serializeRoom(room) });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, timestamp: Date.now() });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getPublicRoomSummaries() });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws) => {
    const playerId = genId();
    socketMeta.set(ws, { playerId, roomCode: null });
    sendJson(ws, { type: 'welcome', playerId, rooms: getPublicRoomSummaries() });

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      const meta = socketMeta.get(ws);
      if (!meta) return;

      const type = String(msg.type || '');

      if (type === 'room:list') {
        sendJson(ws, { type: 'room:list', rooms: getPublicRoomSummaries() });
        return;
      }

      if (type === 'room:create') {
        leaveCurrentRoom(ws);
        const code = genCode();
        const name = String(msg.name || 'Tay Đua').trim().slice(0, 18) || 'Tay Đua';
        const racerId = String(msg.racerId || 'blaze');
        const cityId = String(msg.cityId || 'tokyo');
        const laps = Math.max(1, Math.min(5, Number(msg.laps || 3)));
        const weatherSetting = String(msg.weatherSetting || 'city');

        const player: RoomPlayer = {
          id: meta.playerId,
          name,
          racerId,
          ready: true,
          isHost: true,
          gridSlot: 0,
          finished: false,
          finishTimeMs: null,
          ws,
        };

        const room: RoomState = {
          code,
          hostId: meta.playerId,
          cityId,
          laps,
          weatherSetting,
          status: 'lobby',
          startTimestamp: 0,
          players: new Map([[meta.playerId, player]]),
          chat: [
            {
              id: genId(),
              sender: 'Hệ thống',
              text: `${name} đã tạo phòng ${code}. Chia sẻ mã để bạn bè cùng đua!`,
              ts: Date.now(),
            },
          ],
          createdAt: Date.now(),
        };

        rooms.set(code, room);
        meta.roomCode = code;
        sendJson(ws, { type: 'room:joined', room: serializeRoom(room) });
        return;
      }

      if (type === 'room:join') {
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: `Không tìm thấy phòng "${code}".` });
          return;
        }
        if (room.players.has(meta.playerId)) {
          sendJson(ws, { type: 'room:joined', room: serializeRoom(room) });
          return;
        }
        if (room.status !== 'lobby') {
          sendJson(ws, { type: 'room:error', message: 'Phòng này đang trong trận đua.' });
          return;
        }
        if (room.players.size >= 6) {
          sendJson(ws, { type: 'room:error', message: 'Phòng đã đủ 6 tay đua.' });
          return;
        }

        leaveCurrentRoom(ws);
        const name = String(msg.name || 'Tay Đua').trim().slice(0, 18) || 'Tay Đua';
        const racerId = String(msg.racerId || 'volt');

        const player: RoomPlayer = {
          id: meta.playerId,
          name,
          racerId,
          ready: false,
          isHost: false,
          gridSlot: room.players.size,
          finished: false,
          finishTimeMs: null,
          ws,
        };

        room.players.set(meta.playerId, player);
        meta.roomCode = room.code;
        room.chat.push({
          id: genId(),
          sender: 'Hệ thống',
          text: `${name} đã tham gia phòng đua.`,
          ts: Date.now(),
        });

        sendJson(ws, { type: 'room:joined', room: serializeRoom(room) });
        broadcastRoom(room, { type: 'room:update', room: serializeRoom(room) }, meta.playerId);
        return;
      }

      if (type === 'room:leave') {
        leaveCurrentRoom(ws);
        sendJson(ws, { type: 'room:left', rooms: getPublicRoomSummaries() });
        return;
      }

      const room = meta.roomCode ? rooms.get(meta.roomCode) : undefined;
      if (!room) return;
      const player = room.players.get(meta.playerId);
      if (!player) return;

      if (type === 'room:ready') {
        if (typeof msg.ready === 'boolean') player.ready = msg.ready;
        if (typeof msg.racerId === 'string') player.racerId = msg.racerId;
        if (typeof msg.name === 'string' && msg.name.trim()) {
          player.name = msg.name.trim().slice(0, 18);
        }
        broadcastRoom(room, { type: 'room:update', room: serializeRoom(room) });
        return;
      }

      if (type === 'room:config') {
        if (room.hostId !== meta.playerId || room.status !== 'lobby') return;
        if (typeof msg.cityId === 'string') room.cityId = msg.cityId;
        if (typeof msg.laps === 'number') room.laps = Math.max(1, Math.min(5, msg.laps));
        if (typeof msg.weatherSetting === 'string') room.weatherSetting = msg.weatherSetting;
        broadcastRoom(room, { type: 'room:update', room: serializeRoom(room) });
        return;
      }

      if (type === 'room:chat') {
        const text = String(msg.text || '').trim().slice(0, 120);
        if (!text) return;
        const entry: ChatEntry = {
          id: genId(),
          sender: player.name,
          text,
          ts: Date.now(),
        };
        room.chat.push(entry);
        if (room.chat.length > 40) room.chat.shift();
        broadcastRoom(room, { type: 'room:chat', entry });
        return;
      }

      if (type === 'race:start') {
        if (room.hostId !== meta.playerId) return;
        room.status = 'racing';
        room.startTimestamp = Date.now() + 3000;
        let slot = 0;
        for (const p of room.players.values()) {
          p.gridSlot = slot++;
          p.finished = false;
          p.finishTimeMs = null;
        }
        broadcastRoom(room, {
          type: 'race:started',
          room: serializeRoom(room),
          serverNow: Date.now(),
        });
        return;
      }

      if (type === 'race:rematch') {
        if (room.hostId !== meta.playerId) return;
        room.status = 'lobby';
        for (const p of room.players.values()) {
          p.finished = false;
          p.finishTimeMs = null;
          p.ready = p.isHost;
        }
        broadcastRoom(room, { type: 'room:update', room: serializeRoom(room) });
        return;
      }

      if (type === 'player:state') {
        if (room.status !== 'racing') return;
        broadcastRoom(
          room,
          {
            type: 'player:state',
            id: meta.playerId,
            x: Number(msg.x) || 0,
            y: Number(msg.y) || 0,
            z: Number(msg.z) || 0,
            yaw: Number(msg.yaw) || 0,
            speed: Number(msg.speed) || 0,
            steer: Number(msg.steer) || 0,
            drifting: Boolean(msg.drifting),
            driftDir: Number(msg.driftDir) || 0,
            nitroActive: Boolean(msg.nitroActive),
            lap: Number(msg.lap) || 1,
            progress: Number(msg.progress) || 0,
          },
          meta.playerId
        );
        return;
      }

      if (type === 'player:finish') {
        if (player.finished) return;
        player.finished = true;
        player.finishTimeMs = Math.max(0, Number(msg.finishTimeMs) || 0);
        broadcastRoom(room, {
          type: 'player:finished',
          id: player.id,
          finishTimeMs: player.finishTimeMs,
          room: serializeRoom(room),
        });
        const allFinished = Array.from(room.players.values()).every((p) => p.finished);
        if (allFinished) {
          room.status = 'lobby';
        }
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(ws);
      socketMeta.delete(ws);
    });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    decline: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay extends HTMLElement {}
`);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server, path: '/vite-hmr' },
        ws: hmrDisabled ? false : { server, path: '/vite-hmr' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Nitro Drift World server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
