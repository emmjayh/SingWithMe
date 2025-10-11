import { useEffect } from "react";
import { ConfidenceMeter } from "@components/ConfidenceMeter";
import { LatencyBadge } from "@components/LatencyBadge";
import { ModeToggle } from "@components/ModeToggle";
import { CalibrationWizard } from "@components/CalibrationWizard";
import { MetersPanel } from "@components/MetersPanel";
import { AudioEngine } from "@audio/index";
import "./Home.css";

export default function Home() {
  useEffect(() => {
    const engine = new AudioEngine();
    engine
      .initialise()
      .catch(() => {
        // to-do: surface error to toast
      });

    return () => engine.dispose();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">SingWithMe</div>
        <LatencyBadge />
      </header>
      <main className="app-main">
        <section className="panel meters">
          <h2>Signal</h2>
          <MetersPanel />
        </section>
        <section className="panel confidence">
          <h2>Confidence</h2>
          <ConfidenceMeter />
          <ModeToggle />
        </section>
        <section className="panel calibration">
          <h2>Calibration</h2>
          <CalibrationWizard />
        </section>
      </main>
    </div>
  );
}
