//! Service-mode entry point — renders the ServiceApp within BrowserRouter and StrictMode.

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ServiceApp } from "./ServiceApp";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ServiceApp />
    </BrowserRouter>
  </React.StrictMode>,
);
