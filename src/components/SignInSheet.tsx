import { useState, type FormEvent } from "react";
import { ghostPillStyle, panelStyle, primaryPillStyle, statsTheme } from "./statsTheme";

type Props = {
  /** Games sitting on this device that will be pulled into the account. */
  localGameCount: number;
  onSignInWithGoogle: () => Promise<{ error: string | null }>;
  onSignInWithApple: () => Promise<{ error: string | null }>;
  onSignInWithEmail: (email: string) => Promise<{ error: string | null }>;
  onSkip: () => void;
};

export default function SignInSheet({ localGameCount, onSignInWithGoogle, onSignInWithApple, onSignInWithEmail, onSkip }: Props) {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setError(null);
    setStatus("working");
    const { error: signInError } = await onSignInWithGoogle();
    if (signInError) {
      setError(signInError);
      setStatus("idle");
    }
  }

  async function handleApple() {
    setError(null);
    setStatus("working");
    const { error: signInError } = await onSignInWithApple();
    if (signInError) {
      setError(signInError);
      setStatus("idle");
    }
  }

  async function handleEmail(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus("working");
    const { error: signInError } = await onSignInWithEmail(email.trim());
    if (signInError) {
      setError(signInError);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  return (
    <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 26, paddingBottom: 30 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: statsTheme.fill,
            border: `1px solid ${statsTheme.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
          }}
        >
          <span style={{ transform: "scaleX(-1)" }} aria-hidden>🐐</span>
        </div>
        <h1 style={{ margin: 0, fontFamily: statsTheme.serif, fontSize: 30, fontWeight: 700, letterSpacing: "-0.01em" }}>
          Guarda tus estadísticas
        </h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: statsTheme.muted }}>
          Crea una cuenta gratis para conservar tus juegos y tus estadísticas en todos tus dispositivos.
        </p>
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
        <Benefit text="Tus estadísticas, en todos tus dispositivos" />
        <Benefit text="Tu porcentaje de aciertos letra a letra" />
        <Benefit text="Acceso al archivo de juegos anteriores" />
      </ul>

      {status === "sent" ? (
        <div
          style={{
            padding: 16,
            borderRadius: 20,
            background: statsTheme.fill,
            border: `1px solid ${statsTheme.hairline}`,
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          Te hemos enviado un enlace a <strong>{email}</strong>. Ábrelo en este dispositivo para iniciar sesión.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={status === "working"}
            style={{ ...primaryPillStyle, opacity: status === "working" ? 0.7 : 1 }}
          >
            Iniciar sesión con Google
          </button>

          <button
            type="button"
            onClick={handleApple}
            disabled={status === "working"}
            style={{ ...primaryPillStyle, opacity: status === "working" ? 0.7 : 1, background: "#000", color: "#fff" }}
          >
            Iniciar sesión con Apple
          </button>

          {showEmail ? (
            <form onSubmit={handleEmail} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label htmlFor="signin-email" style={{ fontSize: 12, color: statsTheme.muted }}>
                Correo electrónico
              </label>
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                style={{
                  minHeight: 48,
                  borderRadius: 9999,
                  border: `1px solid ${statsTheme.hairline}`,
                  background: statsTheme.fill,
                  color: statsTheme.text,
                  padding: "0 14px",
                  fontSize: 16,
                }}
              />
              <button
                type="submit"
                disabled={status === "working"}
                style={ghostPillStyle}
              >
                {status === "working" ? "Enviando…" : "Enviar enlace"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              style={ghostPillStyle}
            >
              Continuar con el correo
            </button>
          )}
        </div>
      )}

      {error ? (
        <div style={{ fontSize: 13, color: "#ffb3b3", textAlign: "center" }} role="alert">
          {error}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {localGameCount > 0 ? (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, textAlign: "center", color: statsTheme.muted }}>
            {localGameCount === 1 ? (
              <>Al iniciar sesión se añadirá el <strong style={{ color: statsTheme.text }}>juego</strong> guardado en este dispositivo.</>
            ) : (
              <>Al iniciar sesión se añadirán los <strong style={{ color: statsTheme.text }}>{localGameCount} juegos</strong> guardados en este dispositivo.</>
            )}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onSkip}
          style={{
            background: "transparent",
            border: "none",
            color: statsTheme.muted,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "underline",
            cursor: "pointer",
            padding: 10,
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 15, lineHeight: 1.45 }}>
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 9999, background: "#ffffff", marginTop: 8, flexShrink: 0 }}
      />
      <span>{text}</span>
    </li>
  );
}
