import "./devLog";
import "./platform/audioSession";
import ReactDOM from "react-dom/client";
import App from "./App";
import AccountProvider from "./account/AccountProvider";
import VoiceLab from "./components/VoiceLab";
import { isStagingMode } from "./env/getSpeechTokenUrl";
import "./index.css";
import "./App.css";

// Staging/dev only: ?voicelab opens the voice-tuning page instead of the game.
const voiceLab = (import.meta.env.DEV || isStagingMode()) && new URLSearchParams(location.search).has("voicelab");

ReactDOM.createRoot(document.getElementById("root")!).render(
  voiceLab ? (
    <VoiceLab />
  ) : (
    <AccountProvider>
      <App />
    </AccountProvider>
  )
);
