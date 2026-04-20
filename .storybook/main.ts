import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/stories/**/*.stories.@(ts|tsx)"],
  staticDirs: ["../public"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: (viteConfig) => {
    viteConfig.server ??= {};
    viteConfig.server.watch ??= {};
    viteConfig.server.watch.ignored = [
      "**/target/**",
      "**/node_modules/**",
      "**/.git/**",
    ];
    return viteConfig;
  },
};

export default config;
