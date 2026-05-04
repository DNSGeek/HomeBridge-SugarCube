/**
 * SugarCubeClient
 * ================
 * Thin TypeScript HTTP client for the SweetVinyl SugarCube REST API.
 * Mirrors the Python sugarcube_client.py implementation.
 */
import { Logger } from "homebridge";
export interface AudioStatus {
    audio_route: string;
    audio: string;
    i2srouting: number;
    sensitivity: number;
    sensitivity_min: number;
    sensitivity_max: number;
    last_dnlevel: number;
    dnstop: number;
    dnout: string;
    headphone_volume: number;
    headphone_mute: boolean;
    gain_input: number;
    gain_output: number;
    recording_state: string;
    xmosdata: number;
    model: number;
    last_dneq?: string;
}
export interface ClippingStatus {
    html: string;
}
/**
 * Returns true if the AudioStatus response looks like a real device response
 * rather than an empty object, error page, or partial data from a wedged API.
 */
export declare function isValidAudioStatus(s: unknown): s is AudioStatus;
export declare class SugarCubeClient {
    private readonly log;
    private readonly baseUrl;
    private readonly timeoutMs;
    private cookie;
    constructor(url: string, log: Logger, timeoutSeconds?: number);
    getCookie(): string | null;
    setCookie(value: string): void;
    private url;
    private headers;
    private request;
    private get;
    private post;
    pair(pin: string): Promise<boolean>;
    tryAutoPair(): Promise<boolean>;
    getAudioStatus(): Promise<AudioStatus>;
    getClipping(): Promise<ClippingStatus>;
    setRepairEnabled(enabled: boolean): Promise<void>;
    setRepairSensitivity(level: number): Promise<void>;
    setDenoiseEnabled(enabled: boolean): Promise<void>;
    setDenoiseLevel(level: number): Promise<void>;
    startRecording(): Promise<void>;
    stopRecording(): Promise<void>;
    clearClipping(): Promise<void>;
    /**
     * Trigger a device reboot via the settings-update endpoint.
     * The device will be unreachable for ~30–60 seconds after this call.
     */
    reboot(): Promise<void>;
}
