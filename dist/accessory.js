"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SugarCubeAccessory = void 0;
const client_1 = require("./client");
// Map 0–100 (HomeKit brightness %) ↔ 1–10 (SugarCube level)
function brightnessToLevel(brightness) {
    if (typeof brightness !== "number" || isNaN(brightness)) {
        return 0;
    }
    return Math.round(Math.max(0, Math.min(brightness, 100)) / 10);
}
function levelToBrightness(level) {
    if (typeof level !== "number" || isNaN(level)) {
        return 0;
    }
    return Math.round(Math.max(0, Math.min(level, 10)) * 10);
}
// How many consecutive poll failures before we attempt a reboot
const REBOOT_THRESHOLD = 5;
// How long to wait after a reboot before resuming normal polls (ms)
const REBOOT_GRACE_PERIOD_MS = 120000;
class SugarCubeAccessory {
    constructor(log, config, accessory, api, savedCookie, onCookieSaved) {
        this.log = log;
        this.config = config;
        this.accessory = accessory;
        this.api = api;
        this.onCookieSaved = onCookieSaved;
        // Cached state
        this.state = {
            repairOn: false,
            repairSens: 5,
            denoiseOn: false,
            denoiseLevel: 5,
            recording: false,
            clipping: false,
        };
        this.pollTimer = null;
        // Failure tracking for auto-reboot
        this.consecutiveFailures = 0;
        this.rebootInProgress = false;
        this.pollInterval = (config.pollInterval ?? 10) * 1000;
        this.client = new client_1.SugarCubeClient(config.url, log, config.timeout ?? 10);
        if (savedCookie) {
            this.client.setCookie(savedCookie);
        }
        this.setupServices();
        this.authenticate().then(() => {
            this.startPolling();
        });
    }
    // ------------------------------------------------------------------
    // Service setup
    // ------------------------------------------------------------------
    setupServices() {
        const { Service: Svc, Characteristic: Char } = this.api.hap;
        const name = this.config.name;
        // ── Accessory Information ──────────────────────────────────────
        this.accessory
            .getService(Svc.AccessoryInformation)
            .setCharacteristic(Char.Manufacturer, "SweetVinyl")
            .setCharacteristic(Char.Model, "SugarCube")
            .setCharacteristic(Char.SerialNumber, this.config.url);
        // ── Click Repair Switch ────────────────────────────────────────
        this.repairSwitch = this.getOrAddService(Svc.Switch, `${name} Click Repair`, "repair-switch");
        this.repairSwitch
            .getCharacteristic(Char.On)
            .onGet(() => this.state.repairOn)
            .onSet(async (value) => {
            await this.withErrorLogging("setRepairEnabled", () => this.client.setRepairEnabled(value));
            this.state.repairOn = value;
            // Keep the level bulb's On state in sync
            this.repairLevel.updateCharacteristic(Char.On, value);
        });
        // ── Repair Sensitivity Lightbulb ───────────────────────────────
        this.repairLevel = this.getOrAddService(Svc.Lightbulb, `${name} Repair Sensitivity`, "repair-level");
        this.repairLevel
            .getCharacteristic(Char.On)
            .onGet(() => this.state.repairOn)
            .onSet(async (value) => {
            // Toggling the bulb also toggles repair
            await this.withErrorLogging("setRepairEnabled (from level bulb)", () => this.client.setRepairEnabled(value));
            this.state.repairOn = value;
            this.repairSwitch.updateCharacteristic(Char.On, value);
        });
        this.repairLevel
            .getCharacteristic(Char.Brightness)
            .setProps({ minValue: 0, maxValue: 100, minStep: 11 }) // ~11% steps = 1–10 levels
            .onGet(() => levelToBrightness(this.state.repairSens))
            .onSet(async (value) => {
            const level = brightnessToLevel(value);
            await this.withErrorLogging("setRepairSensitivity", () => this.client.setRepairSensitivity(level));
            this.state.repairSens = level;
        });
        // ── Noise Reduction Switch ─────────────────────────────────────
        this.denoiseSwitch = this.getOrAddService(Svc.Switch, `${name} Noise Reduction`, "denoise-switch");
        this.denoiseSwitch
            .getCharacteristic(Char.On)
            .onGet(() => this.state.denoiseOn)
            .onSet(async (value) => {
            await this.withErrorLogging("setDenoiseEnabled", () => this.client.setDenoiseEnabled(value));
            this.state.denoiseOn = value;
            this.denoiseLevel.updateCharacteristic(Char.On, value);
        });
        // ── Denoise Level Lightbulb ────────────────────────────────────
        this.denoiseLevel = this.getOrAddService(Svc.Lightbulb, `${name} Denoise Level`, "denoise-level");
        this.denoiseLevel
            .getCharacteristic(Char.On)
            .onGet(() => this.state.denoiseOn)
            .onSet(async (value) => {
            await this.withErrorLogging("setDenoiseEnabled (from level bulb)", () => this.client.setDenoiseEnabled(value));
            this.state.denoiseOn = value;
            this.denoiseSwitch.updateCharacteristic(Char.On, value);
        });
        this.denoiseLevel
            .getCharacteristic(Char.Brightness)
            .setProps({ minValue: 0, maxValue: 100, minStep: 11 })
            .onGet(() => levelToBrightness(this.state.denoiseLevel))
            .onSet(async (value) => {
            const level = brightnessToLevel(value);
            await this.withErrorLogging("setDenoiseLevel", () => this.client.setDenoiseLevel(level));
            this.state.denoiseLevel = level;
        });
        // ── Recording Switch ───────────────────────────────────────────
        this.recordingSwitch = this.getOrAddService(Svc.Switch, `${name} Recording`, "recording-switch");
        this.recordingSwitch
            .getCharacteristic(Char.On)
            .onGet(() => this.state.recording)
            .onSet(async (value) => {
            if (value) {
                await this.withErrorLogging("startRecording", () => this.client.startRecording());
            }
            else {
                await this.withErrorLogging("stopRecording", () => this.client.stopRecording());
            }
            this.state.recording = value;
        });
        // ── Clipping Motion Sensor ─────────────────────────────────────
        this.clippingSensor = this.getOrAddService(Svc.MotionSensor, `${name} Clipping`, "clipping-sensor");
        this.clippingSensor
            .getCharacteristic(Char.MotionDetected)
            .onGet(() => this.state.clipping);
    }
    /**
     * Get a service by type and subtype, or add it if not present.
     * Using subtypes allows multiple services of the same type on one accessory.
     */
    getOrAddService(serviceType, displayName, subtype) {
        return (this.accessory.getServiceById(serviceType, subtype) ??
            this.accessory.addService(serviceType, displayName, subtype));
    }
    // ------------------------------------------------------------------
    // Authentication
    // ------------------------------------------------------------------
    async authenticate() {
        // Already have a cookie — try using it (will fail gracefully on next poll if stale)
        if (this.client.getCookie()) {
            this.log.debug(`[${this.config.name}] Using saved session cookie.`);
            return;
        }
        // Auto-pair first
        if (await this.client.tryAutoPair()) {
            this.log.info(`[${this.config.name}] Auto-paired successfully.`);
            this.saveCookieIfPresent();
            return;
        }
        // PIN pairing
        if (this.config.pin) {
            const ok = await this.client.pair(this.config.pin);
            if (ok) {
                this.log.info(`[${this.config.name}] Paired with PIN successfully.`);
                this.saveCookieIfPresent();
            }
            else {
                this.log.error(`[${this.config.name}] Pairing failed — check your PIN.`);
            }
            return;
        }
        this.log.warn(`[${this.config.name}] No cookie and no PIN configured. ` +
            `Add a "pin" to the device config in HomeBridge.`);
    }
    saveCookieIfPresent() {
        const cookie = this.client.getCookie();
        if (cookie && this.onCookieSaved) {
            this.onCookieSaved(cookie);
        }
    }
    // ------------------------------------------------------------------
    // Polling
    // ------------------------------------------------------------------
    startPolling() {
        // Immediate first poll
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
    }
    stopPolling() {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    async poll() {
        // Skip polls while a reboot is in progress; the grace period timer
        // will clear this flag once the device should be back up.
        if (this.rebootInProgress) {
            this.log.debug(`[${this.config.name}] Poll skipped — reboot in progress.`);
            return;
        }
        try {
            await this.updateFromAudioStatus();
            await this.updateFromClipping();
            // Successful poll — reset the failure counter
            if (this.consecutiveFailures > 0) {
                this.log.info(`[${this.config.name}] Device recovered after ${this.consecutiveFailures} failed poll(s).`);
                this.consecutiveFailures = 0;
            }
        }
        catch (err) {
            this.consecutiveFailures++;
            this.log.warn(`[${this.config.name}] Poll failed (${this.consecutiveFailures}/${REBOOT_THRESHOLD}):`, err);
            if (this.consecutiveFailures >= REBOOT_THRESHOLD) {
                await this.attemptReboot();
            }
        }
    }
    async attemptReboot() {
        this.log.warn(`[${this.config.name}] Device unresponsive for ${this.consecutiveFailures} consecutive polls — attempting reboot.`);
        this.rebootInProgress = true;
        this.consecutiveFailures = 0;
        try {
            await this.client.reboot();
            this.log.info(`[${this.config.name}] Reboot command sent. Pausing polls for ${REBOOT_GRACE_PERIOD_MS / 1000}s.`);
        }
        catch (err) {
            // The device may already be too wedged to respond — not unusual.
            this.log.warn(`[${this.config.name}] Reboot command failed (device may already be restarting):`, err);
        }
        // Resume polling after the grace period regardless of whether the
        // reboot command succeeded — the device may have self-recovered.
        setTimeout(() => {
            this.log.info(`[${this.config.name}] Grace period over — resuming polls.`);
            this.rebootInProgress = false;
        }, REBOOT_GRACE_PERIOD_MS);
    }
    async updateFromAudioStatus() {
        const { Characteristic: Char } = this.api.hap;
        let raw;
        try {
            raw = await this.client.getAudioStatus();
        }
        catch (err) {
            // Session may have expired — try re-authenticating once
            this.log.debug(`[${this.config.name}] getAudioStatus failed, re-authenticating:`, err);
            this.client.setCookie("");
            await this.authenticate();
            raw = await this.client.getAudioStatus();
        }
        // Validate the response before trusting any of its values.
        // If the SugarCube API is in a funky state it may return an empty
        // object, partial data, or non-numeric values — all of which would
        // corrupt our state. We keep serving the last-known-good cache instead.
        if (!(0, client_1.isValidAudioStatus)(raw)) {
            this.log.warn(`[${this.config.name}] getAudioStatus returned invalid data — ` +
                `retaining last-known-good state. Raw: ${JSON.stringify(raw)}`);
            throw new Error("Invalid AudioStatus response");
        }
        const status = raw;
        const repairOn = status.audio === "SOUND_OUT";
        const denoiseOn = status.dnout === "SOUND_OUT";
        const recording = status.recording_state === "recording";
        const repairSens = Math.round(status.sensitivity);
        const dnLevel = Math.round(status.last_dnlevel);
        // Only push updates when values have actually changed
        if (repairOn !== this.state.repairOn) {
            this.state.repairOn = repairOn;
            this.repairSwitch.updateCharacteristic(Char.On, repairOn);
            this.repairLevel.updateCharacteristic(Char.On, repairOn);
        }
        if (repairSens !== this.state.repairSens) {
            this.state.repairSens = repairSens;
            this.repairLevel.updateCharacteristic(Char.Brightness, levelToBrightness(repairSens));
        }
        if (denoiseOn !== this.state.denoiseOn) {
            this.state.denoiseOn = denoiseOn;
            this.denoiseSwitch.updateCharacteristic(Char.On, denoiseOn);
            this.denoiseLevel.updateCharacteristic(Char.On, denoiseOn);
        }
        if (dnLevel !== this.state.denoiseLevel) {
            this.state.denoiseLevel = dnLevel;
            this.denoiseLevel.updateCharacteristic(Char.Brightness, levelToBrightness(dnLevel));
        }
        if (recording !== this.state.recording) {
            this.state.recording = recording;
            this.recordingSwitch.updateCharacteristic(Char.On, recording);
        }
    }
    async updateFromClipping() {
        const { Characteristic: Char } = this.api.hap;
        const clip = await this.client.getClipping();
        // Guard against a non-object response from a wedged API
        if (!clip || typeof clip !== "object") {
            this.log.warn(`[${this.config.name}] getClipping returned invalid data — retaining last-known-good state.`);
            throw new Error("Invalid ClippingStatus response");
        }
        const clipping = !!clip.html;
        if (clipping !== this.state.clipping) {
            this.state.clipping = clipping;
            this.clippingSensor.updateCharacteristic(Char.MotionDetected, clipping);
            if (clipping) {
                this.log.warn(`[${this.config.name}] Clipping detected!`);
            }
        }
    }
    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    async withErrorLogging(label, fn) {
        try {
            await fn();
        }
        catch (err) {
            this.log.error(`[${this.config.name}] ${label} failed:`, err);
            throw err;
        }
    }
}
exports.SugarCubeAccessory = SugarCubeAccessory;
