/**
 * SugarCubeAccessory
 * ===================
 * Represents one SugarCube device as a collection of HomeKit accessories:
 *
 *   • Switch      — Click Repair on/off
 *   • Lightbulb   — Repair Sensitivity (brightness = level 1–10)
 *   • Switch      — Noise Reduction on/off
 *   • Lightbulb   — Denoise Level (brightness = level 1–10)
 *   • Switch      — Recording on/off
 *   • MotionSensor — Clipping detection
 *
 * HomeKit doesn't have a generic 1–10 slider, so we use the Lightbulb
 * service's Brightness characteristic (0–100%), mapped to 1–10 on the
 * device. The bulb's On state mirrors the corresponding switch so the
 * two stay in sync.
 */
import { API, Logger, PlatformAccessory } from "homebridge";
export interface DeviceConfig {
    name: string;
    url: string;
    pin?: string;
    pollInterval?: number;
    timeout?: number;
}
export declare class SugarCubeAccessory {
    private readonly log;
    private readonly config;
    private readonly accessory;
    private readonly api;
    onCookieSaved?: ((cookie: string) => void) | undefined;
    private repairSwitch;
    private repairLevel;
    private denoiseSwitch;
    private denoiseLevel;
    private recordingSwitch;
    private clippingSensor;
    private state;
    private pollTimer;
    private readonly client;
    private readonly pollInterval;
    private consecutiveFailures;
    private rebootInProgress;
    private lastRepairAttempt;
    constructor(log: Logger, config: DeviceConfig, accessory: PlatformAccessory, api: API, savedCookie?: string, onCookieSaved?: ((cookie: string) => void) | undefined);
    private setupServices;
    /**
     * Get a service by type and subtype, or add it if not present.
     * Using subtypes allows multiple services of the same type on one accessory.
     */
    private getOrAddService;
    private authenticate;
    private saveCookieIfPresent;
    /**
     * Force a re-pair: clears the current cookie and runs the auth flow again.
     * Throttled to one attempt per REPAIR_THROTTLE_MS so a device that is
     * genuinely down doesn't get hammered with pair requests every poll.
     * Returns true if we now have a cookie (regardless of throttling).
     */
    private tryRepair;
    private startPolling;
    stopPolling(): void;
    private poll;
    private attemptReboot;
    private updateFromAudioStatus;
    private updateFromClipping;
    private withErrorLogging;
}
