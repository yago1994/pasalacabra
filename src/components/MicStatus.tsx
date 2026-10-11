import type { ReactNode } from "react";
import { describeBrowser, type BrowserEnv, type MicFailure } from "../platform/micDiagnostics";

type Props = {
  failure: MicFailure;
  /** Try to start the microphone again without reloading. */
  onRetry: () => void;
  /** Android keeps its full-screen unblock guide (PermissionNotice). */
  onShowAndroidHelp: () => void;
  /** Defaults to the current browser; set for previews. */
  env?: BrowserEnv;
};

const BROWSER_LABEL: Record<BrowserEnv["browser"], string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  samsung: "Samsung Internet",
  other: "tu navegador",
};

/** How to unblock the site, per browser. */
function deniedSteps(env: BrowserEnv): ReactNode {
  if (env.os === "ios") {
    if (env.browser === "safari") {
      return (
        <>
          Recarga la página y pulsa <strong>Permitir</strong>. Si no te lo pregunta, toca{" "}
          <strong>aA</strong> en la barra de direcciones → Ajustes del sitio web → Micrófono →
          Permitir.
        </>
      );
    }
    const app = BROWSER_LABEL[env.browser];
    return (
      <>
        Abre <strong>Ajustes del iPhone → {app}</strong> y activa <strong>Micrófono</strong>. Luego
        vuelve aquí, recarga y pulsa <strong>Permitir</strong>.
      </>
    );
  }
  if (env.browser === "firefox") {
    return (
      <>
        Haz clic en el <strong>micrófono tachado</strong> de la barra de direcciones → Quitar
        bloqueo, y recarga la página.
      </>
    );
  }
  if (env.browser === "safari") {
    return (
      <>
        En el menú <strong>Safari → Ajustes para pasalacabra.com</strong> pon Micrófono en{" "}
        <strong>Permitir</strong>, y recarga la página.
      </>
    );
  }
  return (
    <>
      Haz clic en el icono <strong>⚙︎ / 🔒</strong> a la izquierda de la dirección → Micrófono →{" "}
      <strong>Permitir</strong>, y recarga la página.
    </>
  );
}

function systemSteps(env: BrowserEnv): ReactNode {
  const app = BROWSER_LABEL[env.browser];
  if (env.os === "mac") {
    return (
      <>
        Abre <strong>Ajustes del Sistema → Privacidad y seguridad → Micrófono</strong> y activa{" "}
        {app}. Después cierra {app} del todo y vuelve a abrirlo.
      </>
    );
  }
  if (env.os === "windows") {
    return (
      <>
        Abre <strong>Configuración → Privacidad → Micrófono</strong> y permite el acceso a las
        aplicaciones de escritorio. Después recarga la página.
      </>
    );
  }
  return <>Revisa en los ajustes de tu dispositivo que {app} tiene permiso para usar el micrófono.</>;
}

export default function MicStatus({ failure, onRetry, onShowAndroidHelp, env = describeBrowser() }: Props) {
  const reload = () => window.location.reload();

  let title: string;
  let body: ReactNode;
  let action: { label: string; onClick: () => void } | null = { label: "Reintentar", onClick: onRetry };

  switch (failure.reason) {
    case "waiting":
      title = "🎤 Esperando el permiso del micrófono…";
      body =
        env.os === "ios" || env.os === "android" ? (
          <>Pulsa <strong>Permitir</strong> en el aviso del navegador.</>
        ) : (
          <>
            Pulsa <strong>Permitir</strong> en el aviso del navegador. Si no lo ves, busca un icono
            de micrófono en la barra de direcciones.
          </>
        );
      action = null;
      break;
    case "denied":
      if (env.os === "android") {
        title = "⚠️ Tu navegador tiene el micrófono bloqueado";
        body = <>Necesitamos oír tus respuestas. Recargar la página no lo arregla en Android.</>;
        action = { label: "Ver cómo desbloquearlo", onClick: onShowAndroidHelp };
      } else {
        title = "⚠️ El micrófono está bloqueado";
        body = deniedSteps(env);
        action = { label: "Recargar", onClick: reload };
      }
      break;
    case "denied-system":
      title = `⚠️ Tu ${env.os === "mac" ? "Mac" : "dispositivo"} no deja a ${BROWSER_LABEL[env.browser]} usar el micrófono`;
      body = systemSteps(env);
      action = env.os === "mac" ? null : { label: "Recargar", onClick: reload };
      break;
    case "no-mic":
      title = "⚠️ No encontramos ningún micrófono";
      body = <>Conecta uno (unos auriculares con micro valen) y pulsa Reintentar.</>;
      break;
    case "busy":
      title = "⚠️ Otra aplicación está usando el micrófono";
      body = <>Cierra Zoom, Teams, una llamada o cualquier app que lo esté usando y pulsa Reintentar.</>;
      break;
    case "unsupported":
      title = env.inApp
        ? "⚠️ Este navegador integrado no deja usar el micrófono"
        : "⚠️ Tu navegador no permite usar el micrófono aquí";
      body = env.inApp ? (
        <>
          Abre <strong>pasalacabra.com</strong> en {env.os === "ios" ? "Safari" : "Chrome"} (menú ⋯ →
          Abrir en el navegador).
        </>
      ) : (
        <>Prueba con la última versión de Chrome o Safari.</>
      );
      action = null;
      break;
    case "network":
      title = "⚠️ No pudimos conectar con el reconocimiento de voz";
      body = <>Revisa tu conexión. Si usas un bloqueador de anuncios o una VPN, prueba a desactivarlo.</>;
      break;
    default:
      title = "⚠️ No pudimos activar el micrófono";
      body = <>Pulsa Reintentar o recarga la página.</>;
  }

  return (
    <div className="micStatus" role="status">
      <div className="micStatusTitle">{title}</div>
      <div className="micStatusBody">{body}</div>
      {action && (
        <button className="btnGhost micStatusAction" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {failure.reason !== "waiting" && (
        <div className="micStatusCode">Código: {failure.errorName}</div>
      )}
    </div>
  );
}
