import { createContext } from "react";

// Context to suppress shadows on nested Panels
export const PanelContainerContext = createContext<{ inContainer: boolean }>({
  inContainer: false,
});
