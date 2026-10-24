export interface AdapterNativeConfig {
    /** Read title, channel and picture of the playing video over oEmbed (another request to YouTube per video) */
    lookUpTitles: boolean;
    /** How long the search waits for devices, in seconds */
    discoveryTimeout: number;
}

/** A paired YouTube app */
export interface StoredDevice {
    /** Object ID below the instance, derived from the screen ID */
    id: string;
    name: string;
    screenId: string;
    loungeToken: string;
    /** UDN of the DIAL device it was found as, to hide it from the found devices */
    udn?: string;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace ioBroker {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface AdapterConfig extends AdapterNativeConfig {}
    }
}
