declare module '@abandonware/noble' {
  export interface Advertisement {
    localName?: string;
    manufacturerData?: Buffer;
    serviceData?: Array<{
      uuid: string;
      data: Buffer;
    }>;
    serviceUuids?: string[];
    txPowerLevel?: number;
  }

  export interface Peripheral {
    id: string;
    address: string;
    advertisement: Advertisement;
    rssi: number;
    connect(callback?: (error: Error) => void): void;
    disconnect(): void;
    updateRssi(callback?: (error: Error, rssi: number) => void): void;
    discoverServices(serviceUuids?: string[], callback?: (error: Error, services: Service[]) => void): void;
    discoverSomeServicesAndCharacteristics(
      serviceUuids: string[],
      characteristicUuids: string[],
      callback?: (error: Error) => void
    ): void;
    discoverAllServicesAndCharacteristics(callback?: (error: Error) => void): void;
    readHandle(handle: number, callback?: (error: Error, data: Buffer) => void): void;
    writeHandle(handle: number, data: Buffer, withoutResponse: boolean, callback?: (error: Error) => void): void;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
  }

  export interface Service {
    uuid: string;
    name?: string;
    type: string;
    includedServiceUuids: string[];
    characteristics: Characteristic[];
    discoverIncludedServices(serviceUuids?: string[], callback?: (error: Error, includedServiceUuids: string[]) => void): void;
    discoverCharacteristics(characteristicUuids?: string[], callback?: (error: Error, characteristics: Characteristic[]) => void): void;
  }

  export interface Characteristic {
    uuid: string;
    name?: string;
    type: string;
    properties: string[];
    value?: Buffer;
    subscribe(callback?: (error: Error) => void): void;
    unsubscribe(callback?: (error: Error) => void): void;
    read(callback?: (error: Error, data: Buffer) => void): void;
    write(data: Buffer, withoutResponse: boolean, callback?: (error: Error) => void): void;
    broadcast(callback?: (error: Error) => void): void;
    notify(dataCallback: (data: Buffer) => void, errorCallback?: (error: Error) => void): void;
    discoverDescriptors(callback?: (error: Error, descriptors: Descriptor[]) => void): void;
    readValue(callback?: (error: Error, data: Buffer) => void): void;
    writeValue(data: Buffer, callback?: (error: Error) => void): void;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
  }

  export interface Descriptor {
    uuid: string;
    name?: string;
    type: string;
    value?: Buffer;
    readValue(callback?: (error: Error, data: Buffer) => void): void;
    writeValue(data: Buffer, callback?: (error: Error) => void): void;
  }

  export const state: string;
  export const scanning: boolean;

  export function on(event: string, listener: (...args: any[]) => void): void;
  export function once(event: string, listener: (...args: any[]) => void): void;
  export function removeListener(event: string, listener: (...args: any[]) => void): void;
  export function removeAllListeners(event?: string): void;
  export function startScanning(serviceUuids?: string[], allowDuplicates?: boolean, callback?: (error: Error) => void): void;
  export function stopScanning(): void;
}