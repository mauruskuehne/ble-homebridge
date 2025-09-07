import type { Logging } from 'homebridge';
import noble from '@abandonware/noble';

/**
 * BLE Controller for Schneider BLE Lamps
 * This class handles the BLE communication with the lamp devices
 */
export class BLEController {
  private readonly log: Logging;
  private isConnected = false;
  private peripheral: any = null;
  
  // Lamp control handles from the Python script analysis
  private readonly HANDLE_ON = 21;  // Handle for turning lamp ON
  private readonly HANDLE_OFF = 26; // Handle for turning lamp OFF

  constructor(log: Logging) {
    this.log = log;
  }

  /**
   * Initialize the BLE controller
   */
  public async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onStateChange = (state: string) => {
        this.log.debug(`BLE state changed to: ${state}`);
        
        if (state === 'poweredOn') {
          this.log.info('BLE is powered on');
          noble.removeListener('stateChange', onStateChange);
          resolve();
        } else {
          this.log.warn('BLE is not powered on');
          noble.removeListener('stateChange', onStateChange);
          reject(new Error('BLE not powered on'));
        }
      };

      noble.on('stateChange', onStateChange);
      
      // Check the current state in case it's already powered on
      if (noble.state === 'poweredOn') {
        this.log.info('BLE is already powered on');
        noble.removeListener('stateChange', onStateChange);
        resolve();
      }
    });
  }

  /**
   * Scan for BLE devices
   * @param duration - Scan duration in seconds
   * @returns Promise resolving to array of discovered peripherals
   */
  public async scanDevices(duration: number = 5): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const devices: any[] = [];
      let scanTimeout: NodeJS.Timeout;

      const onDiscover = (peripheral: any) => {
        this.log.debug(`Discovered device: ${peripheral.address} - ${peripheral.advertisement?.localName || 'Unknown'}`);
        devices.push(peripheral);
      };

      const onScanStart = () => {
        this.log.info('Starting BLE device scan...');
        scanTimeout = setTimeout(() => {
          noble.stopScanning();
          noble.removeListener('discover', onDiscover);
          noble.removeListener('scanStart', onScanStart);
          noble.removeListener('scanStop', onScanStop);
          this.log.info(`Scan completed. Found ${devices.length} devices.`);
          resolve(devices);
        }, duration * 1000);
      };

      const onScanStop = () => {
        this.log.debug('BLE scan stopped');
      };

      noble.on('discover', onDiscover);
      noble.on('scanStart', onScanStart);
      noble.on('scanStop', onScanStop);

      noble.startScanning([], false);
    });
  }

  /**
   * Connect to a specific BLE peripheral
   * @param peripheral - The peripheral to connect to
   * @returns Promise resolving when connected
   */
  public async connect(peripheral: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log.info(`Connecting to device: ${peripheral.address} - ${peripheral.advertisement?.localName || 'Unknown'}`);

      const onConnect = () => {
        this.isConnected = true;
        this.peripheral = peripheral;
        this.log.info(`Connected to device: ${peripheral.address}`);
        peripheral.removeListener('connect', onConnect);
        resolve();
      };

      const onDisconnect = () => {
        this.isConnected = false;
        this.peripheral = null;
        this.log.info(`Disconnected from device: ${peripheral.address}`);
        peripheral.removeListener('disconnect', onDisconnect);
      };

      peripheral.on('connect', onConnect);
      peripheral.on('disconnect', onDisconnect);

      peripheral.connect((error: Error | null) => {
        if (error) {
          this.log.error(`Failed to connect to device: ${error.message}`);
          reject(error);
        }
      });
    });
  }

  /**
   * Disconnect from the current peripheral
   */
  public async disconnect(): Promise<void> {
    if (this.peripheral && this.isConnected) {
      return new Promise((resolve) => {
        this.peripheral!.once('disconnect', () => {
          this.isConnected = false;
          this.peripheral = null;
          this.log.info('Disconnected from device');
          resolve();
        });

        this.peripheral!.disconnect();
      });
    }
  }

  /**
   * Write data to a specific handle
   * @param handle - The handle to write to
   * @param data - The data to write
   * @returns Promise resolving when write is complete
   */
  private async writeToHandle(handle: number, data: Buffer): Promise<boolean> {
    if (!this.peripheral || !this.isConnected) {
      this.log.error('Not connected to device, cannot write to handle');
      return false;
    }

    return new Promise((resolve, reject) => {
      this.log.debug(`Writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${data.toString('hex')}`);

      this.peripheral!.writeHandle(handle, data, false, (error: Error | null) => {
        if (error) {
          this.log.error(`Error writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${error.message}`);
          reject(error);
        } else {
          this.log.debug(`Successfully wrote to handle 0x${handle.toString(16).padStart(4, '0')}`);
          resolve(true);
        }
      });
    });
  }

  /**
   * Turn the lamp ON
   * @returns Promise resolving to true if successful
   */
  public async turnLampOn(): Promise<boolean> {
    this.log.info('Turning lamp ON...');
    try {
      await this.writeToHandle(this.HANDLE_ON, Buffer.from([0x01]));
      return true;
    } catch (error) {
      this.log.error(`Failed to turn lamp ON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Turn the lamp OFF
   * @returns Promise resolving to true if successful
   */
  public async turnLampOff(): Promise<boolean> {
    this.log.info('Turning lamp OFF...');
    try {
      await this.writeToHandle(this.HANDLE_OFF, Buffer.from([0x00]));
      return true;
    } catch (error) {
      this.log.error(`Failed to turn lamp OFF: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Check if currently connected to a device
   */
  public getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get the currently connected peripheral
   */
  public getPeripheral(): any {
    return this.peripheral;
  }
}