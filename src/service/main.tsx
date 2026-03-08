import React from "react";
import ReactDOM from "react-dom/client";
import { ServiceApp } from "./ServiceApp";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ServiceApp />
  </React.StrictMode>,
);
