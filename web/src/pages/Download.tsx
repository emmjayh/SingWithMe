import { useEffect, useMemo, useState } from "react";
import "./Download.css";

type DownloadTicket = {
  downloadUrl: string;
  expiresInMs: number;
  session: {
    email: string | null;
    amountTotal: number | null;
    currency: string | null;
  };
};

type FetchState = "idle" | "loading" | "ready" | "error";

function formatAmount(amount: number | null, currency: string | null) {
  if (amount == null || currency == null) {
    return null;
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount / 100);
  } catch {
    return `${amount / 100} ${currency.toUpperCase()}`;
  }
}

export default function DownloadPage() {
  const sessionId = useMemo(() => {
    return new URLSearchParams(window.location.search).get("session_id");
  }, []);

  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<DownloadTicket | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setState("error");
      setError("Invalid or missing session link. Please check your confirmation email.");
      return;
    }

    const controller = new AbortController();
    async function requestTicket() {
      try {
        setState("loading");
        const response = await fetch(`/api/download-ticket?session_id=${encodeURIComponent(sessionId)}`, {
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Unable to verify your purchase.");
        }

        const payload = (await response.json()) as DownloadTicket;
        setTicket(payload);
        setState("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError((err as Error).message);
        setState("error");
      }
    }

    requestTicket();
    return () => controller.abort();
  }, [sessionId]);

  const amountText = formatAmount(ticket?.session.amountTotal ?? null, ticket?.session.currency ?? null);

  return (
    <div className="download-shell">
      <div className="download-card">
        <h1>Thank you!</h1>
        <p>
          Your purchase was successful. We&apos;ve verified your checkout session and prepared your download below.
        </p>

        <div className="download-summary">
          <span>
            <strong>Session ID:</strong> {sessionId ?? "N/A"}
          </span>
          {ticket?.session.email && (
            <span>
              <strong>Email:</strong> {ticket.session.email}
            </span>
          )}
          {amountText && (
            <span>
              <strong>Amount:</strong> {amountText}
            </span>
          )}
          {ticket && (
            <span>
              <strong>Link expires:</strong>{" "}
              {Math.round(ticket.expiresInMs / 1000)}
              s after loading this page
            </span>
          )}
        </div>

        <div className="download-actions">
          <button
            type="button"
            className="download-button-primary"
            onClick={() => ticket && (window.location.href = ticket.downloadUrl)}
            disabled={state !== "ready" || !ticket}
          >
            {state === "ready" ? "Download TuneTrix" : "Preparing download…"}
          </button>
          {state === "loading" && <div className="download-status">Verifying your checkout session…</div>}
          {state === "error" && <div className="download-status download-error">{error}</div>}
        </div>

        <div className="download-support">
          Need help? Email{" "}
          <a href="mailto:support@tunetrix.app">support@tunetrix.app</a> with your receipt and session ID.
        </div>
      </div>
    </div>
  );
}
