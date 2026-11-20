import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-sky-400/50 bg-[#0f172a]/90 px-3.5 py-2 text-xs font-semibold tracking-wide text-sky-300 shadow-lg transition hover:border-sky-300 hover:bg-sky-500/20 hover:text-white cursor-pointer"
        aria-label="Cài đặt ứng dụng PWA"
      >
        <Download className="h-3.5 w-3.5" />
        <span>Cài App PWA</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-slate-600/70 bg-[#0f172a]/85 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-sky-400/70 hover:text-white cursor-pointer"
        aria-label="Hướng dẫn cài đặt ứng dụng PWA"
      >
        <Smartphone className="h-3.5 w-3.5 text-sky-400" />
        <span>{isIOS ? 'Cài lên iPhone' : 'Cài App PWA'}</span>
      </button>

      {showGuide && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Hướng dẫn cài đặt Nitro Drift World PWA"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-[#0f172a] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-racing text-lg font-bold tracking-wide text-white">
                CÀI ĐẶT NITRO DRIFT PWA
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Đóng hướng dẫn cài đặt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {isIOS ? (
              <ol className="mt-3 space-y-2 text-sm text-slate-300">
                <li>1. Nhấn nút <strong className="text-white">Chia sẻ (Share)</strong> trên thanh công cụ Safari.</li>
                <li>2. Cuộn xuống và chọn <strong className="text-sky-400">Thêm vào MH chính (Add to Home Screen)</strong>.</li>
                <li>3. Mở ứng dụng toàn màn hình mượt mà, hỗ trợ chơi offline!</li>
              </ol>
            ) : (
              <ol className="mt-3 space-y-2 text-sm text-slate-300">
                <li>1. Mở menu trình duyệt (Chrome / Edge) và chọn <strong className="text-sky-400">Cài đặt ứng dụng (Install App)</strong>.</li>
                <li>2. Ứng dụng sẽ tự lưu bộ đệm offline để bạn đua ngay cả khi mất mạng.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-lg bg-sky-500 py-2.5 font-racing text-sm font-bold tracking-wider text-slate-950 transition hover:bg-sky-400 cursor-pointer"
            >
              ĐÃ HIỂU
            </button>
          </div>
        </div>
      )}
    </>
  );
};
