import { ChangeEvent } from "react";
import { useAppStore } from "@state/useAppStore";

export function MicMonitorControl() {
  const micMonitorGainDb = useAppStore((state) => state.micMonitorGainDb);
  const setMicMonitorGainDb = useAppStore((state) => state.setMicMonitorGainDb);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) {
      setMicMonitorGainDb(next);
    }
  };

  return (
    <div className="mic-monitor-control">
      <label className="tuning-slider">
        <div className="tuning-slider__label">
          <span>Mic Monitor</span>
          <strong>{micMonitorGainDb.toFixed(1)} dB</strong>
        </div>
        <input
          type="range"
          min={-60}
          max={6}
          step={0.5}
          value={micMonitorGainDb}
          onChange={handleChange}
          aria-label="Mic monitor gain"
        />
      </label>
    </div>
  );
}
