//! Service app root — defines top-level routes.

import { Route, Routes, useParams } from "react-router-dom";
import { PortalPage } from "./PortalPage";
import { ProjectPage } from "./ProjectPage";

// ============================================================================
// Component
// ============================================================================

/** Wrapper that forces a full remount when the project ID changes. */
function ProjectPageWrapper() {
  const { id } = useParams<{ id: string }>();
  return <ProjectPage key={id} />;
}

export function ServiceApp() {
  return (
    <Routes>
      <Route path="/" element={<PortalPage />} />
      <Route path="/project/:id" element={<ProjectPageWrapper />} />
    </Routes>
  );
}
