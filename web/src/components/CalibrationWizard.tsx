import { useEffect, useState } from "react";
import { useAppStore } from "@state/useAppStore";

type CalibrationStage = "idle" | "collecting" | "complete";

export function CalibrationWizard() {
  const calibrationActive = useAppStore((state) => state.calibrationActive);
  const setCalibrationActive = useAppStore((state) => state.setCalibrationActive);
  const setConfidence = useAppStore((state) => state.setConfidence);

  const [stage, setStage] = useState<CalibrationStage>("idle");
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    let timer = 0;
    if (stage === "collecting") {
      timer = window.setInterval(() => {
        setCountdown((value) => {
          if (value <= 1) {
            window.clearInterval(timer);
            setStage("complete");
            setCalibrationActive(false);
            setConfidence(0.75); // placeholder telemetry
            return 0;
          }
          return value - 1;
        });
      }, 1000);
    }
    return () => window.clearInterval(timer);
  }, [stage, setCalibrationActive, setConfidence]);

  const handleStart = () => {
    setStage("collecting");
    setCountdown(10);
    setCalibrationActive(true);
  };

  const handleReset = () => {
    setStage("idle");
    setCountdown(10);
    setConfidence(0);
    setCalibrationActive(false);
  };

  return (
    <div className="calibration-card">
      {stage === "idle" && (
        <>
          <p>Run a 10 second vocal warm-up to set noise floor and peak detection.</p>
          <button type="button" onClick={handleStart} disabled={calibrationActive}>
            Start Calibration
          </button>
        </>
      )}
      {stage === "collecting" && (
        <>
          <p>Sing clearly into the mic. Collecting data…</p>
          <div className="countdown">{countdown}s</div>
        </>
      )}
      {stage === "complete" && (
        <>
          <p>Calibration complete. Confidence model updated.</p>
          <button type="button" onClick={handleReset}>
            Reset
          </button>
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
        button:disabled {
          opacity: 0.5;
        }
        .countdown {
          font-size: 2.5rem;
          font-weight: 600;
          color: #6bff6b;
        }
      `}</style>
    </div>
  );
}
