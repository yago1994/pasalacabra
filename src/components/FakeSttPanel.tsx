import {
  fakeBlip,
  fakeKillMic,
  fakeOutage,
  fakeRestore,
  fakeSay,
} from "../speech/fakeRecognizer";

/**
 * Dev-only buttons for `?fakestt`: answer for the player and break speech on
 * purpose. Tappable in the iOS simulator, where there's no console to call into.
 */
export default function FakeSttPanel({ answer }: { answer: string }) {
  // A narrow column on the right edge, over the letter ring, so it never hides
  // the game's own buttons (Empezar, Seguir, Reintentar).
  const btn = (icon: string, title: string, onClick: () => void) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{ width: 40, height: 40, fontSize: 18, borderRadius: 10, padding: 0 }}
    >
      {icon}
    </button>
  );
  return (
    <div
      style={{
        position: "fixed",
        right: 4,
        top: "22%",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 4,
        borderRadius: 12,
        background: "rgba(0,0,0,0.55)",
      }}
    >
      {btn("✔", "respuesta correcta", () => fakeSay(answer))}
      {btn("✘", "respuesta incorrecta", () => fakeSay("cebolla"))}
      {btn("🐐", "pasalacabra", () => fakeSay("pasalacabra"))}
      {btn("⚡", "corte breve", fakeBlip)}
      {btn("✂", "voz caída", fakeOutage)}
      {btn("🎤", "mic muerto", fakeKillMic)}
      {btn("↺", "todo bien", fakeRestore)}
    </div>
  );
}
