import { useEffect, useState } from "react";
import { audioEngine } from "@audio/index";
import { useAppStore } from "@state/useAppStore";

export function CalibrationWizard() {
  const calibrationStage = useAppStore((state) => state.calibrationStage);
  const calibrationResult = useAppStore((state) => state.calibrationResult);
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    let timer = 0;
    if (calibrationStage === "collecting") {
      timer = window.setInterval(() => {
        setCountdown((value) => {
          if (value <= 1) {
            window.clearInterval(timer);
            return 0;
          }
          return value - 1;
        });
      }, 1000);
    }
    return () => window.clearInterval(timer);
  }, [calibrationStage]);

  useEffect(() => {
    if (calibrationStage === "idle") {
      setCountdown(10);
    }
  }, [calibrationStage]);

  const handleStart = () => {
    audioEngine.beginCalibration();
    setCountdown(10);
  };

  const handleReset = () => {
    audioEngine.resetCalibration();
    setCountdown(10);
  };

  const handleDownload = () => {
    audioEngine.downloadTelemetry();
  };

  return (
    <div className="calibration-card">
      {calibrationStage === "idle" && (
        <>
          <p>Run a 10 second vocal warm-up to set noise floor and peak detection.</p>
          <button type="button" onClick={handleStart}>
            Start Calibration
          </button>
        </>
      )}
      {calibrationStage === "collecting" && (
        <>
          <p>Sing clearly into the mic. Collecting data</p>
          <div className="countdown">{countdown}s</div>
        </>
      )}
      {calibrationStage === "complete" && (
        <>
          <p>Calibration complete.</p>
          {calibrationResult && (
            <div className="calibration-summary">
              <div>
                <span>Noise floor</span>
                <strong>{calibrationResult.noiseFloorDb.toFixed(1)} dBFS</strong>
              </div>
              <div>
                <span>Vocal peak</span>
                <strong>{calibrationResult.vocalPeakDb.toFixed(1)} dBFS</strong>
              </div>
            </div>
          )}
          <div className="actions">
            <button type="button" onClick={handleReset}>
              Reset
            </button>
            <button type="button" className="ghost" onClick={handleDownload}>
              Download Telemetry
            </button>
          </div>
        </>
      )}
      <style jsx>{`
        .calibration-card {
          background: #181818;
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          color: #d1d5db;
        }
        p {
          margin: 0;
          line-height: 1.6;
        }
        button {
          align-self: flex-start;
          padding: 0.6rem 1.2rem;
          border: none;
          border-radius: 999px;
          background: #6bff6b;
          color: #111827;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 600;
        }
        button.ghost {
          background: transparent;
          color: #6bff6b;
          border: 1px solid rgba(107, 255, 107, 0.6);
        }
        .countdown {
          font-size: 2.5rem;
          font-weight: 600;
          color: #6bff6b;
        }
        .calibration-summary {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 10px;
          padding: 0.75rem 1rem;
        }
        .calibration-summary span {
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: #9ca3af;
        }
        .calibration-summary strong {
          font-size: 1.1rem;
        }
        .actions {
          display: flex;
          gap: 0.75rem;
        }
      `}</style>
    </div>
  );
}
