export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog' | 'sunset';
export type WeatherSetting = 'city' | 'dynamic' | WeatherType;

export type CityId =
  | 'tokyo'
  | 'paris'
  | 'london'
  | 'newyork'
  | 'hanoi'
  | 'dubai'
  | 'sydney'
  | 'cairo'
  | 'rio'
  | 'rome';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CityTheme {
  id: CityId;
  name: string;
  country: string;
  trackName: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tagline: string;
  defaultWeather: WeatherType;
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  sunColor: string;
  sunIntensity: number;
  sunPos: Vec3;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  groundColor: string;
  waterColor?: string;
  roadColor: string;
  curbPrimary: string;
  curbSecondary: string;
  accentHex: string;
  neonMode?: boolean;
  roadWidth: number;
  /** Closed-loop control points in world meters */
  waypoints: Vec3[];
  /** Normalized spline t (0..1) where boost pads sit */
  boostPads: number[];
  /** Signature landmark identifier */
  landmarkType: CityId;
}

export interface RacerPreset {
  id: string;
  name: string;
  title: string;
  kartName: string;
  kartClass: 'S' | 'A';
  bodyColor: string;
  secondaryColor: string;
  accentColor: string;
  suitColor: string;
  helmetColor: string;
  visorColor: string;
  scarfColor: string;
  stats: {
    topSpeed: number; // 0-100
    acceleration: number; // 0-100
    drift: number; // 0-100
    nitro: number; // 0-100
  };
  /** Physics multipliers derived from stats */
  maxSpeed: number; // m/s
  accelRate: number; // m/s^2
  turnRate: number; // rad/s
  driftChargeMult: number;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  nitroJustPressed: boolean;
  miniBoostJustPressed: boolean;
}

export interface KartState {
  id: string;
  name: string;
  racerId: string;
  isPlayer: boolean;
  isRemote: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number; // m/s
  steerAngle: number;
  drifting: boolean;
  driftDir: -1 | 0 | 1;
  driftDuration: number;
  driftTier: 0 | 1 | 2 | 3; // 0 none, 1 blue, 2 orange, 3 purple
  driftSlipAngle: number;
  miniBoostWindow: number; // seconds available to trigger mini-boost
  miniBoostTimer: number; // active mini-boost remaining
  nitroGauge: number; // 0..100
  nitroCharges: number; // 0..2 canisters
  nitroTimer: number; // active nitro remaining
  cwwActive: boolean; // Mini-boost + Nitro combo
  padBoostTimer: number;
  hitWallTimer: number;
  /** Spline progress 0..1 */
  trackT: number;
  /** Lateral offset from track centerline */
  lateralOffset: number;
  /** Current lap 1..totalLaps */
  lap: number;
  /** Checkpoint index 0..3 passed on current lap */
  checkpoint: number;
  /** Monotonic race progress = (lap - 1) + trackT */
  totalProgress: number;
  finished: boolean;
  finishTimeMs: number | null;
  bestLapMs: number | null;
  lapStartMs: number;
  maxDriftCombo: number;
  /** AI specific target lane */
  aiLaneOffset: number;
  aiSkill: number;
}

export interface TrackSample {
  point: Vec3;
  tangent: Vec3;
  right: Vec3;
  t: number;
}

export interface TrackData {
  city: CityTheme;
  samples: TrackSample[];
  totalLength: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RaceHudSnapshot {
  phase: GamePhase;
  countdown: number; // 3, 2, 1, 0 (GO!), -1 hidden
  speedKmh: number;
  rank: number;
  totalRacers: number;
  lap: number;
  totalLaps: number;
  raceTimeMs: number;
  nitroGauge: number; // 0..100
  nitroCharges: number; // 0..2
  nitroActive: boolean;
  cwwActive: boolean;
  miniBoostReady: boolean;
  miniBoostActive: boolean;
  driftTier: 0 | 1 | 2 | 3;
  wrongWay: boolean;
  bannerText: string | null;
  cityName: string;
  trackName: string;
  weather: WeatherType;
  weatherSetting: WeatherSetting;
  minimapRacers: Array<{
    id: string;
    x: number;
    z: number;
    isPlayer: boolean;
    color: string;
  }>;
  standings: Array<{
    id: string;
    name: string;
    racerId: string;
    rank: number;
    lap: number;
    finished: boolean;
    finishTimeMs: number | null;
    isPlayer: boolean;
  }>;
}

export interface RaceFinishSummary {
  rank: number;
  totalRacers: number;
  totalTimeMs: number;
  bestLapMs: number;
  maxDriftCombo: number;
  cityId: CityId;
  cityName: string;
  standings: RaceHudSnapshot['standings'];
}

export interface MultiplayerPlayer {
  id: string;
  name: string;
  racerId: string;
  ready: boolean;
  isHost: boolean;
  gridSlot: number;
  finished: boolean;
  finishTimeMs: number | null;
}

export interface MultiplayerRoom {
  code: string;
  hostId: string;
  cityId: CityId;
  laps: number;
  weatherSetting?: WeatherSetting;
  status: 'lobby' | 'racing';
  startTimestamp: number;
  players: MultiplayerPlayer[];
  chat: Array<{ id: string; sender: string; text: string; ts: number }>;
}

export interface PublicRoomSummary {
  code: string;
  cityId: string;
  laps: number;
  playerCount: number;
  maxPlayers: number;
  hostName: string;
  status: 'lobby' | 'racing';
}

export interface RemoteTelemetry {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  drifting: boolean;
  driftDir: number;
  nitroActive: boolean;
  lap: number;
  progress: number;
}
