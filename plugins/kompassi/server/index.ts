import Logger from "@server/logging/Logger";
import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./auth/kompassi";
import env from "./env";

const enabled = !!(env.KOMPASSI_CLIENT_ID && env.KOMPASSI_CLIENT_SECRET);

if (enabled) {
  PluginManager.add([
    {
      ...config,
      type: Hook.AuthProvider,
      value: { router, id: config.id },
    },
  ]);
  Logger.info("plugins", "Kompassi plugin registered");
}
