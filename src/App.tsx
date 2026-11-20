import { useCallback, useEffect, useRef, useState } from 'react';
import { getCityById, getNextCityId } from './game/cities';
import { BatchModelLoadResult, CustomModelState, NitroDriftEngine } from './game/engine';
import type { ModelSlotKind } from './game/modelUtils';
import { getRacerPreset } from './game/racers';
import {
  CityId,
  GamePhase,
  MultiplayerRoom,
  PublicRoomSummary,
  RaceFinishSummary,
  RaceHudSnapshot,
  TrackData,
  WeatherSetting,
} from './game/types';
import { ConnectionMode, MultiplayerClient } from './net/multiplayer';
import { TitleOverlay } from './components/TitleOverlay';
import { RacingHUD } from './components/RacingHUD';
import { GarageModal } from './components/GarageModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { StatusModal } from './components/StatusModal';
import { OfflineIndicator } from './components/OfflineIndicator';

const INITIAL_HUD: RaceHudSnapshot = {
  phase: 'title',
  countdown: -1,
  speedKmh: 0,
  rank: 1,
  totalRacers: 6,
  lap: 1,
  totalLaps: 3,
  raceTimeMs: 0,
  nitroGauge: 35,
  nitroCharges: 0,
  nitroActive: false,
  cwwActive: false,
  miniBoostReady: false,
  miniBoostActive: false,
  driftTier: 0,
  wrongWay: false,
  bannerText: null,
  cityName: 'Tokyo',
  trackName: 'Cao Tốc Shibuya Neon',
  weather: 'rain',
  weatherSetting: 'city',
  minimapRacers: [],
  standings: [],
};

const INITIAL_CUSTOM_MODELS: CustomModelState = {
  kartName: null,
  kartYawSteps: 0,
  kartScale: 1,
  activeKartId: null,
  karts: [],
  driverName: null,
  driverYawSteps: 0,
  driverScale: 1,
  driverSeatOffsetY: 0,
  driverVisible: true,
  activeDriverId: null,
  drivers: [],
  applyLibraryToAiRivals: false,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<NitroDriftEngine | null>(null);
  const mpRef = useRef<MultiplayerClient | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [cityId, setCityId] = useState<CityId>('tokyo');
  const [weatherSetting, setWeatherSetting] = useState<WeatherSetting>('city');
  const [racerId, setRacerId] = useState<string>('blaze');
  const [playerName, setPlayerName] = useState<string>('Tay Đua Pro');
  const [customModelState, setCustomModelState] = useState<CustomModelState>(INITIAL_CUSTOM_MODELS);
  const [muted, setMuted] = useState(false);

  const [hud, setHud] = useState<RaceHudSnapshot>(INITIAL_HUD);
  const [trackData, setTrackData] = useState<TrackData | null>(null);
  const [finishSummary, setFinishSummary] = useState<RaceFinishSummary | null>(null);

  const [showGarage, setShowGarage] = useState(false);
  const [garageInitialTab, setGarageInitialTab] = useState<'cities' | 'racers'>('cities');
  const [showMultiplayer, setShowMultiplayer] = useState(false);

  // Multiplayer state
  const [mpMode, setMpMode] = useState<ConnectionMode>('connecting');
  const [mpPlayerId, setMpPlayerId] = useState<string>('');
  const [mpRoom, setMpRoom] = useState<MultiplayerRoom | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [mpError, setMpError] = useState<string | null>(null);

  // Keep latest state accessible in event listeners without remounting WebGL
  const stateRef = useRef({
    phase,
    cityId,
    racerId,
    playerName,
    showGarage,
    showMultiplayer,
    mpRoom,
    mpPlayerId,
  });
  stateRef.current = {
    phase,
    cityId,
    racerId,
    playerName,
    showGarage,
    showMultiplayer,
    mpRoom,
    mpPlayerId,
  };

  // Mount Three.js engine & Multiplayer client ONCE
  useEffect(() => {
    document.body.dataset.state = 'title';
    const container = canvasMountRef.current;
    if (!container) return;

    const mp = new MultiplayerClient();
    mpRef.current = mp;

    const engine = new NitroDriftEngine(container, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onFinish: (summary) => {
        setFinishSummary(summary);
      },
      onPhaseChange: (nextPhase) => {
        setPhase(nextPhase);
      },
      onTelemetrySend: (telemetry) => {
        if (stateRef.current.mpRoom) {
          mp.sendPlayerState(telemetry);
        }
      },
      onLocalFinished: (finishTimeMs) => {
        if (stateRef.current.mpRoom) {
          mp.sendFinish(finishTimeMs);
        }
      },
    });
    engineRef.current = engine;
    setTrackData(engine.getTrackData());

    mp.setCallbacks({
      onConnectionChange: (mode, pid) => {
        setMpMode(mode);
        setMpPlayerId(pid);
      },
      onRoomList: (rooms) => setPublicRooms(rooms),
      onRoomJoined: (room) => {
        setMpError(null);
        setMpRoom(room);
        setCityId(room.cityId);
        engine.setCity(room.cityId);
        setTrackData(engine.getTrackData());
      },
      onRoomUpdate: (room) => {
        setMpRoom(room);
        setCityId(room.cityId);
        engine.setCity(room.cityId);
        setTrackData(engine.getTrackData());
      },
      onRoomLeft: () => {
        setMpRoom(null);
      },
      onRoomError: (message) => {
        setMpError(message);
      },
      onChat: (entry) => {
        setMpRoom((prev) => (prev ? { ...prev, chat: [...prev.chat, entry].slice(-30) } : prev));
      },
      onRaceStarted: (room) => {
        setMpRoom(room);
        setShowMultiplayer(false);
        setShowGarage(false);
        setFinishSummary(null);
        setCityId(room.cityId);
        engine.startMultiplayerRace(room.cityId, room.laps, room.players, mp.getPlayerId());
        setTrackData(engine.getTrackData());
      },
      onRemoteState: (telemetry) => {
        engine.receiveRemoteTelemetry(telemetry);
      },
      onPlayerFinished: (id, finishTimeMs, room) => {
        setMpRoom(room);
        engine.markRemoteFinished(id, finishTimeMs);
      },
    });
    mp.connect();

    // Support ?autostart=1&city=...&weather=... to jump straight into active racing
    const params = new URLSearchParams(window.location.search);
    const requestedWeather = params.get('weather') as WeatherSetting | null;
    if (
      requestedWeather &&
      ['city', 'dynamic', 'clear', 'rain', 'snow', 'fog', 'sunset'].includes(requestedWeather)
    ) {
      setWeatherSetting(requestedWeather);
      engine.setWeatherSetting(requestedWeather);
    }
    if (params.get('autostart') === '1') {
      const requestedCity = params.get('city') as CityId | null;
      const validCity = requestedCity ? getCityById(requestedCity).id : 'tokyo';
      setCityId(validCity);
      engine.startSoloRace(validCity, 3, 0.5);
      setTrackData(engine.getTrackData());
    }

    return () => {
      mp.dispose();
      engine.dispose();
      mpRef.current = null;
      engineRef.current = null;
    };
  }, []);

  const startSolo = useCallback((targetCity?: CityId) => {
    const engine = engineRef.current;
    if (!engine) return;
    const activeCity = targetCity ?? stateRef.current.cityId;
    setShowGarage(false);
    setShowMultiplayer(false);
    setFinishSummary(null);
    setCityId(activeCity);
    engine.setPlayerProfile(stateRef.current.playerName, stateRef.current.racerId);
    engine.startSoloRace(activeCity, 3);
    setTrackData(engine.getTrackData());
  }, []);

  // Global keyboard shortcuts (Title Enter/Space, Pause Esc/P, Mute M, Restart R)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.repeat) return;

      const s = stateRef.current;

      if (s.phase === 'title' && !s.showGarage && !s.showMultiplayer) {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          startSolo();
        }
      } else if (s.phase === 'playing') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          engineRef.current?.pause();
        } else if (e.code === 'KeyR') {
          e.preventDefault();
          startSolo();
        }
      } else if (s.phase === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          if (s.showGarage) {
            setShowGarage(false);
          } else {
            engineRef.current?.resume();
          }
        }
      }

      if (e.code === 'KeyM') {
        const nextMuted = engineRef.current?.toggleMute() ?? false;
        setMuted(nextMuted);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startSolo]);

  const handleSelectCity = (nextCity: CityId) => {
    setCityId(nextCity);
    engineRef.current?.setCity(nextCity);
    if (engineRef.current) {
      setTrackData(engineRef.current.getTrackData());
    }
  };

  const handleSelectRacer = (nextRacer: string) => {
    setRacerId(nextRacer);
    engineRef.current?.setPlayerProfile(playerName, nextRacer);
    if (mpRoom) {
      const me = mpRoom.players.find((p) => p.id === mpPlayerId);
      mpRef.current?.setReady(me?.ready ?? false, nextRacer, playerName);
    }
  };

  const handleChangePlayerName = (nextName: string) => {
    setPlayerName(nextName);
    engineRef.current?.setPlayerProfile(nextName, racerId);
  };

  const handleUploadCustomBatch = async (
    files: FileList | File[],
    explicitKind?: ModelSlotKind
  ): Promise<BatchModelLoadResult> => {
    if (!engineRef.current) {
      return { loadedKarts: [], loadedDrivers: [], errors: ['Engine chưa sẵn sàng.'] };
    }
    const res = await engineRef.current.addCustomModelsFromFiles(files, explicitKind);
    setCustomModelState(engineRef.current.getCustomModelState());
    return res;
  };

  const handleSelectCustomKart = (id: string | null) => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.selectCustomKart(id));
  };

  const handleRemoveCustomKart = (id: string) => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.removeCustomKart(id));
  };

  const handleClearAllCustomKarts = () => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.clearAllCustomKarts());
  };

  const handleUpdateCustomKartTransform = (yawSteps: number, scale: number) => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.setCustomKartTransform(yawSteps, scale));
  };

  const handleSelectCustomDriver = (id: string | null) => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.selectCustomDriver(id));
  };

  const handleRemoveCustomDriver = (id: string) => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.removeCustomDriver(id));
  };

  const handleClearAllCustomDrivers = () => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.clearAllCustomDrivers());
  };

  const handleUpdateCustomDriverTransform = (
    yawSteps: number,
    scale: number,
    seatOffsetY?: number,
    visible?: boolean
  ) => {
    if (!engineRef.current) return;
    setCustomModelState(
      engineRef.current.setCustomDriverTransform(yawSteps, scale, seatOffsetY, visible)
    );
  };

  const handleToggleApplyLibraryToAi = (enabled: boolean) => {
    if (!engineRef.current) return;
    setCustomModelState(engineRef.current.setApplyLibraryToAiRivals(enabled));
  };

  const handleSelectWeather = (nextWeather: WeatherSetting) => {
    setWeatherSetting(nextWeather);
    engineRef.current?.setWeatherSetting(nextWeather);
  };

  const handleCycleWeather = () => {
    const order: WeatherSetting[] = ['city', 'dynamic', 'rain', 'snow', 'fog', 'sunset', 'clear'];
    const next = order[(order.indexOf(weatherSetting) + 1) % order.length];
    handleSelectWeather(next);
  };

  const handleToggleMute = () => {
    const next = engineRef.current?.toggleMute() ?? false;
    setMuted(next);
  };

  const activeCity = getCityById(cityId);
  const activeRacer = getRacerPreset(racerId);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b1120]">
      {/* Isolated WebGL Canvas Container — never re-rendered by HUD state */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas"
        className="fixed inset-0 h-full w-full"
      />

      <OfflineIndicator />

      {/* Title Screen */}
      {phase === 'title' && (
        <TitleOverlay
          city={activeCity}
          racer={activeRacer}
          activeWeather={hud.weather}
          weatherSetting={weatherSetting}
          muted={muted}
          onStartSolo={() => startSolo()}
          onOpenMultiplayer={() => {
            setMpError(null);
            mpRef.current?.requestRoomList();
            setShowMultiplayer(true);
          }}
          onOpenGarage={() => {
            setGarageInitialTab('cities');
            setShowGarage(true);
          }}
          onCycleWeather={handleCycleWeather}
          onToggleMute={handleToggleMute}
        />
      )}

      {/* Active Gameplay HUD */}
      {phase === 'playing' && trackData && (
        <RacingHUD
          hud={hud}
          track={trackData}
          muted={muted}
          onPause={() => engineRef.current?.pause()}
          onRestart={() => startSolo()}
          onToggleMute={handleToggleMute}
          onCycleWeather={handleCycleWeather}
          onToggleCamera={() => {
            engineRef.current?.toggleCameraMode();
          }}
          onTouchControl={(control, pressed) => {
            engineRef.current?.setTouchControl(control, pressed);
          }}
          onTouchNitro={() => {
            engineRef.current?.triggerTouchNitro();
          }}
        />
      )}

      {/* Pause & Podium Results Modal */}
      {(phase === 'paused' || phase === 'gameover') && !showGarage && (
        <StatusModal
          phase={phase}
          finishSummary={finishSummary}
          onResume={() => engineRef.current?.resume()}
          onOpenGarage={() => {
            setGarageInitialTab('racers');
            setShowGarage(true);
          }}
          onRestart={() => startSolo()}
          onNextCity={() => {
            const next = getNextCityId(cityId);
            startSolo(next);
          }}
          onReturnTitle={() => {
            setFinishSummary(null);
            engineRef.current?.returnToTitle();
          }}
        />
      )}

      {/* 10 World Cities & Garage Modal */}
      {showGarage && (
        <GarageModal
          initialTab={garageInitialTab}
          isPausedRace={phase === 'paused'}
          selectedCityId={cityId}
          selectedRacerId={racerId}
          weatherSetting={weatherSetting}
          playerName={playerName}
          customModelState={customModelState}
          onSelectCity={handleSelectCity}
          onSelectWeather={handleSelectWeather}
          onSelectRacer={handleSelectRacer}
          onChangePlayerName={handleChangePlayerName}
          onUploadCustomBatch={handleUploadCustomBatch}
          onSelectCustomKart={handleSelectCustomKart}
          onRemoveCustomKart={handleRemoveCustomKart}
          onClearAllCustomKarts={handleClearAllCustomKarts}
          onUpdateCustomKartTransform={handleUpdateCustomKartTransform}
          onSelectCustomDriver={handleSelectCustomDriver}
          onRemoveCustomDriver={handleRemoveCustomDriver}
          onClearAllCustomDrivers={handleClearAllCustomDrivers}
          onUpdateCustomDriverTransform={handleUpdateCustomDriverTransform}
          onToggleApplyToAi={handleToggleApplyLibraryToAi}
          onClose={() => setShowGarage(false)}
          onStartRace={() => {
            if (phase === 'paused') {
              engineRef.current?.resume();
            } else {
              startSolo();
            }
          }}
        />
      )}

      {/* Real-Time Multiplayer Lobby Modal */}
      {showMultiplayer && (
        <MultiplayerModal
          connectionMode={mpMode}
          playerId={mpPlayerId}
          playerName={playerName}
          selectedCityId={cityId}
          selectedRacerId={racerId}
          room={mpRoom}
          publicRooms={publicRooms}
          error={mpError}
          onChangePlayerName={handleChangePlayerName}
          onCreateRoom={(cId, laps) => mpRef.current?.createRoom(playerName, racerId, cId, laps)}
          onJoinRoom={(code) => mpRef.current?.joinRoom(code, playerName, racerId)}
          onLeaveRoom={() => mpRef.current?.leaveRoom()}
          onRefreshRooms={() => mpRef.current?.requestRoomList()}
          onToggleReady={() => {
            const me = mpRoom?.players.find((p) => p.id === mpPlayerId);
            mpRef.current?.setReady(!(me?.ready ?? false), racerId, playerName);
          }}
          onUpdateConfig={(cId, laps) => mpRef.current?.updateConfig(cId, laps)}
          onSendChat={(text) => mpRef.current?.sendChat(text)}
          onStartRace={() => mpRef.current?.startRace()}
          onClose={() => setShowMultiplayer(false)}
        />
      )}
    </main>
  );
}
