import { Plugin } from "@opencode/plugin";
import { AgyCLIOAuthPlugin, GoogleOAuthPlugin, setupAgyPlugin } from "./src/plugin";

export { AgyCLIOAuthPlugin, GoogleOAuthPlugin, setupAgyPlugin };

export default {
  ...Plugin.define({
    id: "@anthonyhaussman/opencode-agy-auth",
    setup: setupAgyPlugin,
  }),
  server: AgyCLIOAuthPlugin,
};

