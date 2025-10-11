import { useEffect } from "react";
import { useAppStore } from "@state/useAppStore";

export function LatencyBadge() {
  const latencyMs = useAppStore((state) => state.latencyMs);
  const setLatency = useAppStore((state) => state.setLatency);

  useEffect(() => {
    const controller = new AbortController();
    const fetchLatency = async () => {
      try {
        const response = await fetch("/healthz", { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        if (typeof payload.latencyTargetMs === "number") {
          setLatency(payload.latencyTargetMs);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          // swallow errors for now
        }
      }
    };

    fetchLatency();
    return () => controller.abort();
  }, [setLatency]);

  return (
    <div className="latency-badge">
      <span>Latency Target</span>
      <strong>{latencyMs.toFixed(1)} ms</strong>
      <style jsx>{`
        .latency-badge {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          background: rgba(107, 255, 107, 0.12);
          border-radius: 999px;
          padding: 0.5rem 1rem;
          font-size: 0.85rem;
          letter-spacing: 0.08em;
          color: #d1fae5;
        }
        strong {
          font-size: 1rem;
          color: #6bff6b;
        }
      `}</style>
    </div>
  );
}
