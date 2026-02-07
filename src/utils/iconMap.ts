/**
 * Shared lucide-react icon mapping utility.
 * Maps icon names (from config) to lucide-react components.
 */

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CircleCheckBig,
  Eye,
  FileText,
  FlaskConical,
  GitBranch,
  Hammer,
  Layers,
  ListTree,
  PencilRuler,
  Rocket,
  ShieldCheck,
  Zap,
} from "lucide-react";

/**
 * Map of icon names to lucide-react components.
 * Includes icons for stages and flows.
 */
export const ICON_MAP: Record<string, LucideIcon> = {
  // Stage icons
  "pencil-ruler": PencilRuler,
  "list-tree": ListTree,
  hammer: Hammer,
  "shield-check": ShieldCheck,
  "circle-check-big": CircleCheckBig,
  eye: Eye,
  "book-open": BookOpen,

  // Flow icons
  zap: Zap,
  rocket: Rocket,
  layers: Layers,
  "file-text": FileText,
  "git-branch": GitBranch,
  flask: FlaskConical,
};

/**
 * Resolve an icon name to a lucide-react component.
 * Returns undefined if the icon is not recognized.
 */
export function resolveIcon(name: string | undefined): LucideIcon | undefined {
  if (!name) return undefined;
  return ICON_MAP[name];
}
