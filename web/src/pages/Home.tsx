import { useEffect } from "react";
import { ConfidenceMeter } from "@components/ConfidenceMeter";
import { LatencyBadge } from "@components/LatencyBadge";
import { ModeToggle } from "@components/ModeToggle";
import { CalibrationWizard } from "@components/CalibrationWizard";
import { MetersPanel } from "@components/MetersPanel";
import { TrackUploader } from "@components/TrackUploader";
import { TuningControls } from "@components/TuningControls";
import { audioEngine } from "@audio/index";
import "./Home.css";

export default function Home() {
  useEffect(() => {
    audioEngine
      .initialise()
      .catch(() => {
        // TODO: surface error to user
      });

    return () => audioEngine.dispose();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">TuneTrix</div>
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
        <section className="panel tuning">
          <h2>Enhancements</h2>
          <TuningControls />
        </section>
        <section className="panel upload">
          <h2>Tracks</h2>
          <TrackUploader />
        </section>
        <section className="panel downloads">
          <h2>Get TuneTrix</h2>
          <div className="download-button-group">
            <a
              className="download-button"
              href="https://play.google.com/apps/test/com.tunetrix.mobile/2"
              target="_blank"
              rel="noreferrer"
            >
              <img src="/assets/TuneTrixIcon-32.png" alt="TuneTrix icon" />
              <div>
                <span className="download-label">Download on</span>
                <span className="download-destination">Google Play</span>
              </div>
            </a>
            <a
              className="download-button"
              href="https://buy.stripe.com/4gM28sfkj4YfafodWK"
              target="_blank"
              rel="noreferrer"
            >
              <img src="/assets/TuneTrixIcon-32.png" alt="TuneTrix icon" />
              <div>
                <span className="download-label">Purchase for</span>
                <span className="download-destination">Windows PC</span>
              </div>
            </a>
          </div>
        </section>
      </main>
      <footer className="app-footer">
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
      </footer>
    </div>
  );
}
