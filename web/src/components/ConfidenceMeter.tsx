import { useMemo } from "react";
import { useAppStore } from "@state/useAppStore";

const ACTIVE_COLOR = "#6BFF6B";
const IDLE_COLOR = "#FFC857";

export function ConfidenceMeter() {
  const confidence = useAppStore((state) => state.confidence);

  const meterColor = useMemo(() => {
    if (confidence >= 0.7) return ACTIVE_COLOR;
    if (confidence >= 0.4) return "rgba(255, 200, 87, 0.8)";
    return IDLE_COLOR;
  }, [confidence]);

  return (
    <div className="confidence-meter">
      <div className="confidence-bar" style={{ width: `${confidence * 100}%`, background: meterColor }} />
      <div className="confidence-scale">
        <span>0</span>
        <span>0.5</span>
        <span>1.0</span>
      </div>
      <style jsx>{`
        .confidence-meter {
          background: #191919;
          border-radius: 12px;
          padding: 12px;
          overflow: hidden;
        }
        .confidence-bar {
          height: 18px;
          border-radius: 10px;
          transition: width 120ms ease-out, background 120ms ease-out;
        }
        .confidence-scale {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          margin-top: 0.5rem;
          color: #6b7280;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}
