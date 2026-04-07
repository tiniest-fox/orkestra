import type { Preview } from "@storybook/react";
import "../src/index.css";
import { storybookDecorator } from "../src/stories/storybook-helpers";

const preview: Preview = {
  decorators: [storybookDecorator],
};

export default preview;
