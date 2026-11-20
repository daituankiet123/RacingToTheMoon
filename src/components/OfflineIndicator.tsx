import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      className="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-950/95 px-3.5 py-1.5 text-xs font-semibold text-amber-200 shadow-lg"
      role="status"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-400" />
      <span>Chế độ Offline — Đua đơn & bộ đệm PWA sẵn sàng</span>
    </div>
  );
};
