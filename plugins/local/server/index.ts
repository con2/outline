import Router from "koa-router";
import Logger from "@server/logging/Logger";
import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import { createLocalRouter } from "./auth/local";

const enabled = !!process.env.INSECURE_LOCAL_AUTH_ENABLED;

if (enabled) {
  const router = new Router();
  createLocalRouter(router);

  PluginManager.add([
    {
      ...config,
      type: Hook.AuthProvider,
      value: { router, id: config.id },
    },
  ]);
  Logger.info("plugins", "Local (insecure) plugin registered");
}
