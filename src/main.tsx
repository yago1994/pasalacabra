import ReactDOM from "react-dom/client";
import App from "./App";
import AccountProvider from "./account/AccountProvider";
import "./index.css";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AccountProvider>
    <App />
  </AccountProvider>
);
