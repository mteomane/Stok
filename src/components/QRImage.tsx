import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QRImageProps {
  value: string;
  size?: number;
}

const qrCache = new Map<string, string>();

export function QRImage({ value, size = 256 }: QRImageProps) {
  const cacheKey = `${value}_${size}`;
  const [src, setSrc] = useState<string>(() => qrCache.get(cacheKey) || "");

  useEffect(() => {
    if (qrCache.has(cacheKey)) {
      setSrc(qrCache.get(cacheKey)!);
      return;
    }

    let isMounted = true;
    QRCode.toDataURL(value, { width: size, margin: 2 })
      .then((url) => {
        qrCache.set(cacheKey, url);
        if (isMounted) setSrc(url);
      })
      .catch((err) => console.error("QR Code generation error:", err));

    return () => {
      isMounted = false;
    };
  }, [value, size, cacheKey]);

  return src ? (
    <img
      src={src}
      alt={`QR Code: ${value}`}
      className="max-w-full h-auto object-contain mx-auto rounded-lg border border-gray-100 p-2 bg-white shadow-sm"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="animate-pulse bg-gray-100 rounded-lg flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="text-xs text-gray-400">QR Kod Üretiliyor...</span>
    </div>
  );
}
