import Logger from "@server/logging/Logger";
import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./auth/kompassi";
import { KompassiGroupSyncProvider } from "./groupSync";
import env from "./env";

const enabled = !!(env.KOMPASSI_CLIENT_ID && env.KOMPASSI_CLIENT_SECRET);

if (enabled) {
  PluginManager.add([
    {
      ...config,
      type: Hook.AuthProvider,
      value: { router, id: config.id },
    },
    {
      type: Hook.GroupSyncProvider,
      value: { id: config.id, provider: new KompassiGroupSyncProvider() },
    },
  ]);
  Logger.info("plugins", "Kompassi plugin registered");
}
