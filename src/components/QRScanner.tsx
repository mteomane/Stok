import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, AlertCircle, Keyboard } from "lucide-react";

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  title?: string;
  subtitle?: string;
}

export function QRScanner({ onScanSuccess, title, subtitle }: QRScannerProps) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedTextRef = useRef<string>("");
  const elementId = "qr-reader-container";

  useEffect(() => {
    let isMounted = true;
    const html5Qrcode = new Html5Qrcode(elementId);
    scannerRef.current = html5Qrcode;

    const startScanner = async () => {
      try {
        const container = document.getElementById(elementId);
        if (!container || !isMounted) return;

        await html5Qrcode.start(
          { facingMode: "environment" },
          {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const width = Math.max(80, Math.floor((viewfinderWidth || 300) * 0.85));
              const height = Math.max(60, Math.floor((viewfinderHeight || 250) * 0.6));
              return { width, height };
            },
          },
          (decodedText) => {
            if (isMounted) {
              const now = Date.now();
              // Throttle duplicate scan events to avoid spamming UI state updates
              if (now - lastScanTimeRef.current < 1500 && lastScannedTextRef.current === decodedText) {
                return;
              }
              lastScanTimeRef.current = now;
              lastScannedTextRef.current = decodedText;
              onScanSuccess(decodedText);
            }
          },
          () => {
            // Quiet fail for scan failure logs to avoid spam
          }
        );
      } catch (err: any) {
        if (isMounted) {
          console.warn("Camera start failed, probably permissions or iframe constraint:", err);
          setCameraError(
            "Kameraya erişilemedi. Lütfen izin verdiğinizden veya uygulamayı yeni bir sekmede açtığınızdan emin olun."
          );
        }
      }
    };

    // Delay start slightly to allow element to render fully
    const timer = setTimeout(() => {
      if (isMounted) {
        startScanner();
      }
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current
              .stop()
              .then(() => {
                try {
                  scannerRef.current?.clear();
                } catch {
                  // ignore
                }
              })
              .catch((err) => console.warn("Scanner stop error:", err));
          } else {
            try {
              scannerRef.current.clear();
            } catch {
              // ignore
            }
          }
        } catch (e) {
          console.warn("Scanner cleanup error:", e);
        }
      }
    };
  }, [onScanSuccess]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onScanSuccess(manualCode.trim());
      setManualCode("");
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="relative overflow-hidden rounded-xl bg-slate-950 aspect-square shadow-xl border border-slate-800">
        <div id={elementId} className="w-full h-full overflow-hidden" />
        
        {/* Overlay scanning graphic */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
          <div className="flex justify-between">
            <div className="w-6 h-6 border-t-4 border-l-4 border-indigo-500 rounded-tl-md" />
            <div className="w-6 h-6 border-t-4 border-r-4 border-indigo-500 rounded-tr-md" />
          </div>
          <div className="self-center flex flex-col items-center">
            <div className="w-48 h-[2px] bg-red-500 animate-bounce shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
            <span className="text-white text-xs mt-4 bg-slate-900/80 px-3 py-1.5 rounded-full backdrop-blur-sm border border-slate-800 font-medium tracking-wide">
              Kodu Kutunun İçine Hizalayın
            </span>
          </div>
          <div className="flex justify-between">
            <div className="w-6 h-6 border-b-4 border-l-4 border-indigo-500 rounded-bl-md" />
            <div className="w-6 h-6 border-b-4 border-r-4 border-indigo-500 rounded-br-md" />
          </div>
        </div>

        {cameraError && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center text-white">
            <AlertCircle className="w-12 h-12 text-amber-500 mb-3" />
            <p className="text-sm font-medium mb-4 text-slate-200">{cameraError}</p>
            <div className="text-xs bg-slate-800 border border-slate-700 px-4 py-3 rounded-lg text-slate-400 max-w-xs">
              <span className="font-semibold text-slate-300 block mb-1">Öneri:</span>
              Kamerayla tarama yapmak için sağ üstteki <span className="text-indigo-400">Yeni Sekmede Aç</span> butonuna basıp telefonunuzdan deneyin.
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
        <form onSubmit={handleManualSubmit} className="space-y-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Keyboard className="w-4 h-4 text-indigo-500" />
            <span>Veya Elle Kod/SKU Girin</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Örn: PROD_P1"
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-slate-50"
            />
            <button
              type="submit"
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
            >
              Uygula
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
