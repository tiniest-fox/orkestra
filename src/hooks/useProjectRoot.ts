import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

// Cache the project root since it won't change during the session
let cachedProjectRoot: string | null = null;

export function useProjectRoot() {
  const [projectRoot, setProjectRoot] = useState<string | null>(cachedProjectRoot);

  useEffect(() => {
    if (cachedProjectRoot !== null) {
      return;
    }

    const fetchProjectRoot = async () => {
      try {
        const root = await invoke<string>("get_project_root");
        cachedProjectRoot = root;
        setProjectRoot(root);
      } catch (err) {
        console.error("Failed to fetch project root:", err);
      }
    };

    fetchProjectRoot();
  }, []);

  return projectRoot;
}

/**
 * Convert an absolute path to a relative path if it starts with the project root
 */
export function toRelativePath(absolutePath: string, projectRoot: string | null): string {
  if (!projectRoot) {
    return absolutePath;
  }

  // Ensure project root ends with a slash for proper prefix matching
  const normalizedRoot = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;

  if (absolutePath.startsWith(normalizedRoot)) {
    return absolutePath.slice(normalizedRoot.length);
  }

  // Also check without trailing slash in case the path equals the root exactly
  if (absolutePath === projectRoot) {
    return ".";
  }

  return absolutePath;
}
