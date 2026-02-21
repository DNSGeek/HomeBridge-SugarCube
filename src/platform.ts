/**
 * SugarCubePlatform
 * ==================
 * HomeBridge dynamic platform. Reads devices from config.json, creates
 * one PlatformAccessory per device, and persists session cookies in the
 * accessory's persistent storage so re-pairing is never needed.
 */

import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { SugarCubeAccessory, DeviceConfig } from './accessory';

export class SugarCubePlatform implements DynamicPlatformPlugin {
  private readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly controllers: Map<string, SugarCubeAccessory> = new Map();

  constructor(
    private readonly log: Logger,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.log.debug('SugarCube platform initialising.');

    // HomeBridge calls configureAccessory() for each cached accessory before
    // the didFinishLaunching event fires. We collect them here then reconcile.
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  /**
   * Called by HomeBridge for each accessory restored from cache.
   * We store them so discoverDevices() can reuse them instead of
   * creating duplicates.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Restoring accessory from cache: ${accessory.displayName}`);
    this.accessories.set(accessory.UUID, accessory);
  }

  private discoverDevices(): void {
    const devices: DeviceConfig[] = this.config['devices'] ?? [];

    if (devices.length === 0) {
      this.log.warn('No devices configured. Add devices in the HomeBridge plugin settings.');
      return;
    }

    const seenUUIDs = new Set<string>();

    for (const device of devices) {
      if (!device.name || !device.url) {
        this.log.error('Device is missing required "name" or "url" field — skipping.');
        continue;
      }

      // Derive a stable UUID from the device URL so it survives restarts
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${device.url}`);
      seenUUIDs.add(uuid);

      let accessory = this.accessories.get(uuid);

      if (accessory) {
        this.log.info(`Reusing cached accessory for: ${device.name}`);
        // Update display name in case the user renamed the device
        accessory.displayName = device.name;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info(`Registering new accessory: ${device.name}`);
        accessory = new this.api.platformAccessory(device.name, uuid);
        this.accessories.set(uuid, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // Retrieve persisted cookie (if any) from accessory context
      const savedCookie: string | undefined = accessory.context?.cookie;

      const controller = new SugarCubeAccessory(
        this.log,
        device,
        accessory,
        this.api,
        savedCookie,
        (cookie: string) => {
          // Persist the session cookie back into accessory context so it
          // survives HomeBridge restarts without requiring re-pairing.
          accessory!.context.cookie = cookie;
          this.api.updatePlatformAccessories([accessory!]);
          this.log.debug(`[${device.name}] Session cookie saved.`);
        },
      );

      this.controllers.set(uuid, controller);
    }

    // Remove stale accessories (devices removed from config)
    for (const [uuid, accessory] of this.accessories) {
      if (!seenUUIDs.has(uuid)) {
        this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        const controller = this.controllers.get(uuid);
        if (controller) {
          controller.stopPolling();
          this.controllers.delete(uuid);
        }
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }
}
