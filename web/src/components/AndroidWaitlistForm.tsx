import { FormEvent, useMemo, useState } from "react";

type Status = "idle" | "submitting" | "success" | "error";

function isValidEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value);
}

export function AndroidWaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const endpoint = useMemo(() => {
    const raw = import.meta.env.VITE_ANDROID_WAITLIST_URL;
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim();
    }
    return "/api/waitlist";
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();

    if (!isValidEmail(trimmed)) {
      setStatus("error");
      setMessage("Enter a valid email address.");
      return;
    }

    try {
      setStatus("submitting");
      setMessage(null);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed })
      });

      if (!response.ok) {
        let detail = "Could not submit your request. Please try again shortly.";
        try {
          const payload = await response.json();
          if (payload?.error) {
            detail = String(payload.error);
          }
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      setStatus("success");
      setMessage("Thanks! You're on the list—we'll reach out soon.");
      setEmail("");
    } catch (error) {
      setStatus("error");
      setMessage((error as Error).message || "Something went wrong. Please try again.");
    }
  };

  return (
    <form className="download-button waitlist-form" onSubmit={handleSubmit} noValidate>
      <div className="waitlist-header">
        <img src="/assets/TuneTrixIcon-32.png" alt="TuneTrix icon" />
        <div>
          <span className="download-label">Join Android beta</span>
          <span className="download-destination">Request Play Store invite</span>
        </div>
      </div>
      <div className="waitlist-input-row">
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === "submitting"}
          aria-label="Email address"
          required
        />
        <button type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending..." : "Request invite"}
        </button>
      </div>
      {message && (
        <p className={`waitlist-message ${status === "error" ? "waitlist-error" : "waitlist-success"}`}>
          {message}
        </p>
      )}
    </form>
  );
}
