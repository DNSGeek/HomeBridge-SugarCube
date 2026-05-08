/**
 * SugarCubeClient
 * ================
 * Thin TypeScript HTTP client for the SweetVinyl SugarCube REST API.
 * Mirrors the Python sugarcube_client.py implementation.
 */

import { Logger } from "homebridge";

// node-fetch v3 is ESM-only; we use a dynamic import wrapped in a helper.
// This keeps the rest of the file in CommonJS-compatible sync style.
let _fetch: typeof fetch;
async function getFetch() {
  if (!_fetch) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (Function(
      'return import("node-fetch")',
    )() as Promise<any>);
    _fetch = mod.default;
  }
  return _fetch;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown for any non-2xx HTTP response. Exposes the status code so callers
 * can distinguish auth failures (401/403) from other errors and trigger a
 * re-pair instead of a reboot.
 */
export class HTTPError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} ${statusText} — ${url}`);
    this.name = "HTTPError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioStatus {
  audio_route: string; // "processed" | "bypass" | "bridging"
  audio: string; // "SOUND_OUT" | "SOUND_IN" | "NOISE"
  i2srouting: number; // 6=SugarCubeOnly, 3=RepairRecord, 4=RepairPlayback, 0=ExternalOnly
  sensitivity: number; // click repair sensitivity (1–10)
  sensitivity_min: number;
  sensitivity_max: number;
  last_dnlevel: number; // denoise level (1–10)
  dnstop: number; // 1 if denoise output is active
  dnout: string; // "SOUND_OUT" | "SOUND_IN"
  headphone_volume: number;
  headphone_mute: boolean;
  gain_input: number;
  gain_output: number;
  recording_state: string; // "idle" | "recording" | "playback"
  xmosdata: number; // encodes sample rate and bit depth
  model: number;
  last_dneq?: string; // EQ preset
}

export interface ClippingStatus {
  html: string; // non-empty string when clipping is active
}

/**
 * Returns true if the AudioStatus response looks like a real device response
 * rather than an empty object, error page, or partial data from a wedged API.
 */
export function isValidAudioStatus(s: unknown): s is AudioStatus {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj["audio"] === "string" &&
    obj["audio"].length > 0 &&
    typeof obj["dnout"] === "string" &&
    obj["dnout"].length > 0 &&
    typeof obj["sensitivity"] === "number" &&
    !isNaN(obj["sensitivity"] as number) &&
    typeof obj["last_dnlevel"] === "number" &&
    !isNaN(obj["last_dnlevel"] as number) &&
    typeof obj["recording_state"] === "string"
  );
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SugarCubeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private cookie: string | null = null;

  constructor(
    url: string,
    private readonly log: Logger,
    timeoutSeconds = 10,
  ) {
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

  getCookie(): string | null {
    return this.cookie;
  }

  setCookie(value: string): void {
    this.cookie = value;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\//, "")}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": "HomeBridgeSugarCube/1.0",
    };
    if (this.cookie) {
      h["Cookie"] = `scauth=${this.cookie}`;
    }
    return h;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: Record<string, string>,
  ): Promise<T> {
    const fetch = await getFetch();
    let fullUrl = this.url(path);

    if (params && method === "GET") {
      const qs = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)]) as [
          string,
          string,
        ][],
      );
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
        throw new HTTPError(res.status, res.statusText, fullUrl);
      }

      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return {} as T;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(
    path: string,
    params?: Record<string, string | number | boolean>,
  ): Promise<T> {
    return this.request<T>("GET", path, params);
  }

  private async post<T>(
    path: string,
    body?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>("POST", path, undefined, body);
  }

  // ------------------------------------------------------------------
  // Authentication
  // ------------------------------------------------------------------

  async pair(pin: string): Promise<boolean> {
    try {
      const data = await this.post<{ scauth?: string }>("/api/v1/pair", {
        code: pin,
        desc: "HomeBridgeSugarCube",
      });
      if (data.scauth) {
        this.cookie = data.scauth;
      }
      return true;
    } catch (err) {
      this.log.debug("pair() failed:", err);
      return false;
    }
  }

  async tryAutoPair(): Promise<boolean> {
    try {
      const data = await this.post<{ scauth?: string }>("/api/v1/pair", {
        code: "auto",
        desc: "HomeBridgeSugarCube",
      });
      if (data.scauth) {
        this.cookie = data.scauth;
      }
      return true;
    } catch (err) {
      this.log.debug("tryAutoPair() failed:", err);
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Status queries
  // ------------------------------------------------------------------

  async getAudioStatus(): Promise<AudioStatus> {
    return this.get<AudioStatus>("/api/v1/audiosystemstatus", {
      format: "html",
    });
  }

  async getClipping(): Promise<ClippingStatus> {
    return this.get<ClippingStatus>("/api/v1/clipping", { format: "html" });
  }

  // ------------------------------------------------------------------
  // Click repair
  // ------------------------------------------------------------------

  async setRepairEnabled(enabled: boolean): Promise<void> {
    await this.get("/api/v1/audiosystemchange", {
      audio: enabled ? "SOUND_OUT" : "SOUND_IN",
    });
  }

  async setRepairSensitivity(level: number): Promise<void> {
    await this.get("/api/v1/audiosystemchange", { sensitivity: level });
  }

  // ------------------------------------------------------------------
  // Noise reduction
  // ------------------------------------------------------------------

  async setDenoiseEnabled(enabled: boolean): Promise<void> {
    await this.get("/api/v1/audiosystemchange", {
      dnout: enabled ? "SOUND_OUT" : "SOUND_IN",
    });
  }

  async setDenoiseLevel(level: number): Promise<void> {
    await this.get("/api/v1/audiosystemchange", { dnlevel: level });
  }

  // ------------------------------------------------------------------
  // Recording
  // ------------------------------------------------------------------

  async startRecording(): Promise<void> {
    await this.get("/api/v1/recordingchange", {
      record: "true",
      hide: "false",
    });
  }

  async stopRecording(): Promise<void> {
    await this.get("/api/v1/recordingchange", {
      record: "false",
      hide: "true",
    });
  }

  // ------------------------------------------------------------------
  // Clipping
  // ------------------------------------------------------------------

  async clearClipping(): Promise<void> {
    await this.post("/api/v1/clippingchange", { action: "clear" });
  }

  // ------------------------------------------------------------------
  // Device management
  // ------------------------------------------------------------------

  /**
   * Trigger a device reboot via the settings-update endpoint.
   * The device will be unreachable for ~30–60 seconds after this call.
   */
  async reboot(): Promise<void> {
    await this.request<unknown>("POST", "/api/v1/settings-update", undefined, {
      reboot: "true",
    });
  }
}
