/**
 * SugarCubePlatform
 * ==================
 * HomeBridge dynamic platform. Reads devices from config.json, creates
 * one PlatformAccessory per device, and persists session cookies in the
 * accessory's persistent storage so re-pairing is never needed.
 */
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from "homebridge";
export declare class SugarCubePlatform implements DynamicPlatformPlugin {
    private readonly log;
    private readonly config;
    private readonly api;
    private readonly accessories;
    private readonly controllers;
    constructor(log: Logger, config: PlatformConfig, api: API);
    /**
     * Called by HomeBridge for each accessory restored from cache.
     * We store them so discoverDevices() can reuse them instead of
     * creating duplicates.
     */
    configureAccessory(accessory: PlatformAccessory): void;
    private discoverDevices;
}
