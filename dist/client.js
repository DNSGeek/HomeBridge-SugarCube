"use strict";
/**
 * SugarCubeClient
 * ================
 * Thin TypeScript HTTP client for the SweetVinyl SugarCube REST API.
 * Mirrors the Python sugarcube_client.py implementation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SugarCubeClient = void 0;
exports.isValidAudioStatus = isValidAudioStatus;
// node-fetch v3 is ESM-only; we use a dynamic import wrapped in a helper.
// This keeps the rest of the file in CommonJS-compatible sync style.
let _fetch;
async function getFetch() {
    if (!_fetch) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await Function('return import("node-fetch")')();
        _fetch = mod.default;
    }
    return _fetch;
}
/**
 * Returns true if the AudioStatus response looks like a real device response
 * rather than an empty object, error page, or partial data from a wedged API.
 */
function isValidAudioStatus(s) {
    if (!s || typeof s !== "object")
        return false;
    const obj = s;
    return (typeof obj["audio"] === "string" &&
        obj["audio"].length > 0 &&
        typeof obj["dnout"] === "string" &&
        obj["dnout"].length > 0 &&
        typeof obj["sensitivity"] === "number" &&
        !isNaN(obj["sensitivity"]) &&
        typeof obj["last_dnlevel"] === "number" &&
        !isNaN(obj["last_dnlevel"]) &&
        typeof obj["recording_state"] === "string");
}
// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
class SugarCubeClient {
    constructor(url, log, timeoutSeconds = 10) {
        this.log = log;
        this.cookie = null;
        // Inject default port 5123 if none specified
        const parsed = new URL(url.startsWith("http") ? url : `http://${url}`);
        if (!parsed.port) {
            parsed.port = "5123";
        }
        this.baseUrl = parsed.toString().replace(/\/$/, "");
        this.timeoutMs = timeoutSeconds * 1000;
    }
    // ------------------------------------------------------------------
    // Cookie persistence (the HomeBridge platform stores and restores this)
    // ------------------------------------------------------------------
    getCookie() {
        return this.cookie;
    }
    setCookie(value) {
        this.cookie = value;
    }
    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------
    url(path) {
        return `${this.baseUrl}/${path.replace(/^\//, "")}`;
    }
    headers() {
        const h = {
            "User-Agent": "HomeBridgeSugarCube/1.0",
        };
        if (this.cookie) {
            h["Cookie"] = `scauth=${this.cookie}`;
        }
        return h;
    }
    async request(method, path, params, body) {
        const fetch = await getFetch();
        let fullUrl = this.url(path);
        if (params && method === "GET") {
            const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
            fullUrl += `?${qs.toString()}`;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(fullUrl, {
                method,
                headers: {
                    ...this.headers(),
                    ...(method === "POST"
                        ? { "Content-Type": "application/x-www-form-urlencoded" }
                        : {}),
                },
                body: body ? new URLSearchParams(body).toString() : undefined,
                signal: controller.signal,
            });
            // Save any Set-Cookie header returned by the device
            const setCookie = res.headers.get("set-cookie");
            if (setCookie) {
                const match = setCookie.match(/scauth=([^;]+)/);
                if (match) {
                    this.cookie = match[1];
                }
            }
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText} — ${fullUrl}`);
            }
            const text = await res.text();
            try {
                return JSON.parse(text);
            }
            catch {
                return {};
            }
        }
        finally {
            clearTimeout(timer);
        }
    }
    async get(path, params) {
        return this.request("GET", path, params);
    }
    async post(path, body) {
        return this.request("POST", path, undefined, body);
    }
    // ------------------------------------------------------------------
    // Authentication
    // ------------------------------------------------------------------
    async pair(pin) {
        try {
            const data = await this.post("/api/v1/pair", {
                code: pin,
                desc: "HomeBridgeSugarCube",
            });
            if (data.scauth) {
                this.cookie = data.scauth;
            }
            return true;
        }
        catch (err) {
            this.log.debug("pair() failed:", err);
            return false;
        }
    }
    async tryAutoPair() {
        try {
            const data = await this.post("/api/v1/pair", {
                code: "auto",
                desc: "HomeBridgeSugarCube",
            });
            if (data.scauth) {
                this.cookie = data.scauth;
            }
            return true;
        }
        catch (err) {
            this.log.debug("tryAutoPair() failed:", err);
            return false;
        }
    }
    // ------------------------------------------------------------------
    // Status queries
    // ------------------------------------------------------------------
    async getAudioStatus() {
        return this.get("/api/v1/audiosystemstatus", {
            format: "html",
        });
    }
    async getClipping() {
        return this.get("/api/v1/clipping", { format: "html" });
    }
    // ------------------------------------------------------------------
    // Click repair
    // ------------------------------------------------------------------
    async setRepairEnabled(enabled) {
        await this.get("/api/v1/audiosystemchange", {
            audio: enabled ? "SOUND_OUT" : "SOUND_IN",
        });
    }
    async setRepairSensitivity(level) {
        await this.get("/api/v1/audiosystemchange", { sensitivity: level });
    }
    // ------------------------------------------------------------------
    // Noise reduction
    // ------------------------------------------------------------------
    async setDenoiseEnabled(enabled) {
        await this.get("/api/v1/audiosystemchange", {
            dnout: enabled ? "SOUND_OUT" : "SOUND_IN",
        });
    }
    async setDenoiseLevel(level) {
        await this.get("/api/v1/audiosystemchange", { dnlevel: level });
    }
    // ------------------------------------------------------------------
    // Recording
    // ------------------------------------------------------------------
    async startRecording() {
        await this.get("/api/v1/recordingchange", {
            record: "true",
            hide: "false",
        });
    }
    async stopRecording() {
        await this.get("/api/v1/recordingchange", {
            record: "false",
            hide: "true",
        });
    }
    // ------------------------------------------------------------------
    // Clipping
    // ------------------------------------------------------------------
    async clearClipping() {
        await this.post("/api/v1/clippingchange", { action: "clear" });
    }
    // ------------------------------------------------------------------
    // Device management
    // ------------------------------------------------------------------
    /**
     * Trigger a device reboot via the settings-update endpoint.
     * The device will be unreachable for ~30–60 seconds after this call.
     */
    async reboot() {
        await this.request("POST", "/api/v1/settings-update", undefined, {
            reboot: "true",
        });
    }
}
exports.SugarCubeClient = SugarCubeClient;
