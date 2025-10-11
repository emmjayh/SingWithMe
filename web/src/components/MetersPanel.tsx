import { useAppStore } from "@state/useAppStore";

const toPercent = (value: number) => `${Math.min(Math.max(value, 0), 1) * 100}%`;

export function MetersPanel() {
  const inputLevel = useAppStore((state) => state.inputLevel);
  const outputLevel = useAppStore((state) => state.outputLevel);

  return (
    <div className="meters">
      <Meter label="Input" value={inputLevel} />
      <Meter label="Guide" value={outputLevel} />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <div className="meter-bar">
        <div className="meter-fill" style={{ height: toPercent(value) }} />
      </div>
      <span className="meter-label">{label}</span>
      <style jsx>{`
        .meter {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        .meter-bar {
          width: 42px;
          height: 220px;
          background: linear-gradient(180deg, rgba(107, 255, 107, 0.15), rgba(18, 18, 18, 0.9));
          border-radius: 999px;
          padding: 6px;
          display: flex;
          align-items: flex-end;
        }
        .meter-fill {
          width: 100%;
          border-radius: 999px;
          background: linear-gradient(180deg, #6bff6b, #1f9d52);
          transition: height 90ms ease-out;
        }
        .meter-label {
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-size: 0.7rem;
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
}
