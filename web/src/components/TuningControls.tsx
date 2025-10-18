import { ChangeEvent } from "react";
import { useAppStore } from "@state/useAppStore";

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  format?: (value: number) => string;
}

function SliderRow({ label, min, max, step, value, onChange, suffix, format }: SliderProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    onChange(Number.isFinite(next) ? next : value);
  };

  const display = format ? format(value) : value.toFixed(step < 1 ? 2 : 0);

  return (
    <label className="tuning-slider">
      <div className="tuning-slider__label">
        <span>{label}</span>
        <strong>
          {display}
          {suffix}
        </strong>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={handleChange} />
    </label>
  );
}

export function TuningControls() {
  const noiseFloor = useAppStore((state) => state.noiseFloor);
  const micMonitorGainDb = useAppStore((state) => state.micMonitorGainDb);
  const crowdCancelStrength = useAppStore((state) => state.crowdCancelStrength);
  const reverbStrength = useAppStore((state) => state.reverbStrength);
  const timbreStrength = useAppStore((state) => state.timbreStrength);
  const phraseSmoothness = useAppStore((state) => state.phraseSmoothness);

  const setNoiseFloor = useAppStore((state) => state.setNoiseFloor);
  const setMicMonitorGainDb = useAppStore((state) => state.setMicMonitorGainDb);
  const setCrowdCancelStrength = useAppStore((state) => state.setCrowdCancelStrength);
  const setReverbStrength = useAppStore((state) => state.setReverbStrength);
  const setTimbreStrength = useAppStore((state) => state.setTimbreStrength);
  const setPhraseSmoothness = useAppStore((state) => state.setPhraseSmoothness);

  return (
    <div className="tuning-controls">
      <SliderRow
        label="Noise Floor"
        min={0}
        max={0.6}
        step={0.005}
        value={noiseFloor}
        onChange={setNoiseFloor}
        suffix=""
        format={(value) => value.toFixed(3)}
      />
      <SliderRow
        label="Mic Monitor"
        min={-60}
        max={6}
        step={0.5}
        value={micMonitorGainDb}
        onChange={setMicMonitorGainDb}
        suffix=" dB"
        format={(value) => value.toFixed(1)}
      />
      <SliderRow
        label="Crowd Cancel"
        min={0}
        max={1}
        step={0.01}
        value={crowdCancelStrength}
        onChange={setCrowdCancelStrength}
        suffix=""
        format={(value) => `${Math.round(value * 100)}%`}
      />
      <SliderRow
        label="Reverb Tail"
        min={0}
        max={1}
        step={0.01}
        value={reverbStrength}
        onChange={setReverbStrength}
        suffix=""
        format={(value) => `${Math.round(value * 100)}%`}
      />
      <SliderRow
        label="Timbre Match"
        min={0}
        max={1}
        step={0.01}
        value={timbreStrength}
        onChange={setTimbreStrength}
        suffix=""
        format={(value) => `${Math.round(value * 100)}%`}
      />
      <SliderRow
        label="Phrase Smoothness"
        min={0}
        max={1}
        step={0.01}
        value={phraseSmoothness}
        onChange={setPhraseSmoothness}
        suffix=""
        format={(value) => `${Math.round(value * 100)}%`}
      />
    </div>
  );
}
