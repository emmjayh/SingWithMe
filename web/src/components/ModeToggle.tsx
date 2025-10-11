import { useAppStore, ManualMode } from "@state/useAppStore";

const modes: { label: string; value: ManualMode }[] = [
  { label: "Auto", value: "auto" },
  { label: "Always On", value: "always_on" },
  { label: "Always Off", value: "always_off" }
];

export function ModeToggle() {
  const manualMode = useAppStore((state) => state.manualMode);
  const setManualMode = useAppStore((state) => state.setManualMode);

  return (
    <div className="mode-toggle">
      {modes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={manualMode === mode.value ? "active" : ""}
          onClick={() => setManualMode(mode.value)}
        >
          {mode.label}
        </button>
      ))}
      <style jsx>{`
        .mode-toggle {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.5rem;
        }
        button {
          border: none;
          border-radius: 999px;
          padding: 0.75rem 1rem;
          background: #1f1f1f;
          color: #e5e7eb;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.75rem;
        }
        button.active {
          background: linear-gradient(90deg, #6bff6b, #56d364);
          color: #111827;
          font-weight: 600;
        }
        button:hover {
          cursor: pointer;
          filter: brightness(1.1);
        }
      `}</style>
    </div>
  );
}
