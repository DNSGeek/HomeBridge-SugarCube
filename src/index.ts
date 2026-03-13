import { API } from "homebridge";
import { PLATFORM_NAME } from "./settings";
import { SugarCubePlatform } from "./platform";

/**
 * This is the entry point HomeBridge calls when loading the plugin.
 * It registers the platform constructor under the platform name declared
 * in config.schema.json.
 */
export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, SugarCubePlatform);
};
