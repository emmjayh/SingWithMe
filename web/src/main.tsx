import React from "react";
import ReactDOM from "react-dom/client";
import Home from "./pages/Home";
import DownloadPage from "./pages/Download";
import "./styles/global.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const isDownloadRoute = path === "/download";
const AppComponent = isDownloadRoute ? DownloadPage : Home;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppComponent />
  </React.StrictMode>
);
