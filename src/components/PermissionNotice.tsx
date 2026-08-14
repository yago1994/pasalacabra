import { isAndroidInAppBrowser } from "../platform/androidPermissions";

export type PermissionNoticeMode = "explain" | "blocked";

type Props = {
  mode: PermissionNoticeMode;
  /** Underlying getUserMedia error name, shown small for support/debugging. */
  errorName?: string;
  onContinue: () => void;
  onCancel: () => void;
};

/**
 * Android-only permission coaching.
 *
 * The browser's own permission dialog text cannot be customised, so we explain
 * *before* it appears ("explain"), and give real recovery steps once Chrome has
 * latched a denial ("blocked").
 */
export default function PermissionNotice({ mode, errorName, onContinue, onCancel }: Props) {
  const inAppBrowser = isAndroidInAppBrowser();

  return (
    <div
      className="permissionNotice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permissionNoticeTitle"
    >
      <div className="permissionCard">
        {mode === "explain" ? (
          <>
            <div className="permissionEmoji" aria-hidden="true">
              🎤
            </div>
            <h2 id="permissionNoticeTitle" className="permissionTitle">
              Necesitamos tu micrófono
            </h2>
            <p className="permissionBody">
              Pasalacabra se juega hablando: escuchamos tus respuestas para saber si aciertas, así
              que <strong>sin micrófono no se puede jugar</strong>.
            </p>
            <p className="permissionBody">
              También usamos la cámara para hacerte una foto con tu resultado al final. Puedes decir
              que no a la cámara y seguir jugando igual.
            </p>
            <p className="permissionBody permissionWarn">
              Cuando tu navegador te lo pida, pulsa <strong>Permitir</strong>. Si lo rechazas,
              Android lo recuerda y dejará de preguntártelo: tendrías que volver a activarlo a mano
              en los ajustes del navegador.
            </p>
            <div className="permissionActions">
              <button className="btnPrimary" onClick={onContinue}>
                Entendido, pedir permiso
              </button>
              <button className="btnGhost" onClick={onCancel}>
                Ahora no
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="permissionEmoji" aria-hidden="true">
              🔇
            </div>
            <h2 id="permissionNoticeTitle" className="permissionTitle">
              El micrófono está bloqueado
            </h2>
            <p className="permissionBody">
              Tu navegador tiene el micrófono bloqueado para pasalacabra.com y el juego necesita oír
              tus respuestas. <strong>Recargar la página no lo desbloquea.</strong>
            </p>
            {inAppBrowser ? (
              <p className="permissionBody">
                Estás jugando dentro de otra app (Instagram, Facebook…) y esos navegadores
                integrados suelen bloquear el micrófono. Abre el menú <strong>⋮</strong> y elige{" "}
                <strong>“Abrir en Chrome”</strong>, o copia la dirección y pégala en Chrome.
              </p>
            ) : (
              <ol className="permissionSteps">
                <li>
                  Pulsa el icono de <strong>ajustes</strong> (o el candado) a la izquierda de la
                  dirección web.
                </li>
                <li>
                  Entra en <strong>Permisos</strong>.
                </li>
                <li>
                  Pon el <strong>Micrófono</strong> en <strong>Permitir</strong>.
                </li>
                <li>
                  Vuelve aquí y pulsa <strong>Volver a intentarlo</strong>.
                </li>
              </ol>
            )}
            <div className="permissionActions">
              <button className="btnPrimary" onClick={onContinue}>
                Volver a intentarlo
              </button>
              <button className="btnGhost" onClick={onCancel}>
                Cerrar
              </button>
            </div>
            {errorName ? <p className="permissionDebug">({errorName})</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
