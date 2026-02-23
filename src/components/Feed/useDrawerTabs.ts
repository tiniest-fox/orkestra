//! Thin wrapper for tab state. Prev/next navigation (,/.) is handled by DrawerTabBar directly.

import { useState } from "react";

export function useDrawerTabs(initialTab: string) {
  return useState(initialTab);
}
