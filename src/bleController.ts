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
  private readonly HANDLE_ON = 26;  // Handle for turning lamp ON
  private readonly HANDLE_OFF = 26; // Handle for turning lamp OFF

  constructor(log: Logging) {
    this.log = log;
  }

  /**
   * Initialize the BLE controller
   */
  public async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.log.debug('Starting BLE controller initialization');
        
        // Check if noble is available
        if (typeof noble === 'undefined') {
          this.log.error('Noble BLE library is not available');
          reject(new Error('Noble BLE library is not available'));
          return;
        }

        this.log.debug('Noble library is available');
        this.log.debug(`Noble type: ${typeof noble}`);
        this.log.debug(`Noble state: ${noble.state}`);
        this.log.debug(`Noble scanning: ${noble.scanning}`);

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

        this.log.debug('Setting up state change event listener...');
        noble.on('stateChange', onStateChange);
        
        // Check the current state in case it's already powered on
        if (noble.state === 'poweredOn') {
          this.log.info('BLE is already powered on');
          noble.removeListener('stateChange', onStateChange);
          resolve();
        } else {
          this.log.debug(`BLE is not powered on yet, current state: ${noble.state}`);
        }
      } catch (error) {
        this.log.error(`Error setting up BLE event listeners: ${error instanceof Error ? error.message : 'Unknown error'}`);
        if (error instanceof Error && error.stack) {
          this.log.error(`Error stack: ${error.stack}`);
        }
        reject(error);
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
      try {
        this.log.debug('Starting scanDevices method');
        
        if (typeof noble === 'undefined') {
          this.log.error('Noble BLE library is not available');
          reject(new Error('Noble BLE library is not available'));
          return;
        }

        this.log.debug('Noble library is available, checking state...');
        this.log.debug(`Noble state: ${noble.state}`);
        this.log.debug(`Noble scanning: ${noble.scanning}`);

        const devices: any[] = [];
        let scanTimeout: NodeJS.Timeout;

        const onScanStop = () => {
          this.log.debug('BLE scan stopped');
        };

        const onDiscover = (peripheral: any) => {
          // Use id, uuid, or address - whichever is available
          const deviceId = peripheral.address || peripheral.id || peripheral.uuid || 'unknown';
          this.log.debug(`Discovered device: ${deviceId} - ${peripheral.advertisement?.localName || 'Unknown'}`);
          this.log.debug('Full peripheral object:', {
            id: peripheral.id,
            uuid: peripheral.uuid,
            address: peripheral.address,
            addressType: peripheral.addressType,
            connectable: peripheral.connectable,
            advertisement: peripheral.advertisement,
            rssi: peripheral.rssi,
            state: peripheral.state,
          });
          
          // Ensure the peripheral has a consistent address property
          if (!peripheral.address && (peripheral.id || peripheral.uuid)) {
            peripheral.address = peripheral.id || peripheral.uuid;
            this.log.debug(`Set peripheral address to: ${peripheral.address}`);
          }
          
          devices.push(peripheral);
        };

        const onScanStart = () => {
          this.log.info('Starting BLE device scan...');
          scanTimeout = setTimeout(() => {
            try {
              noble.stopScanning();
              noble.removeListener('discover', onDiscover);
              noble.removeListener('scanStart', onScanStart);
              noble.removeListener('scanStop', onScanStop);
              this.log.info(`Scan completed. Found ${devices.length} devices.`);
              resolve(devices);
            } catch (error) {
              this.log.error(`Error stopping scan: ${error instanceof Error ? error.message : 'Unknown error'}`);
              if (error instanceof Error && error.stack) {
                this.log.error(`Error stack: ${error.stack}`);
              }
              resolve(devices); // Return what we have so far
            }
          }, duration * 1000);
        };

        this.log.debug('Setting up event listeners...');
        noble.on('discover', onDiscover);
        noble.on('scanStart', onScanStart);
        noble.on('scanStop', onScanStop);

        this.log.debug('Starting scan...');
        noble.startScanning([], false);
      } catch (error) {
        this.log.error(`Error in scanDevices: ${error instanceof Error ? error.message : 'Unknown error'}`);
        if (error instanceof Error && error.stack) {
          this.log.error(`Error stack: ${error.stack}`);
        }
        reject(error);
      }
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

      // Add a timeout to prevent hanging
      const timeout = setTimeout(() => {
        this.log.error(`Timeout writing to handle 0x${handle.toString(16).padStart(4, '0')} after 5 seconds`);
        reject(new Error('Write operation timed out'));
      }, 5000);

      try {
        this.peripheral!.writeHandle(handle, data, false, (error: Error | null) => {
          clearTimeout(timeout);
          
          if (error) {
            this.log.error(`Error writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${error.message}`);
            this.log.error('Error details:', error);
            reject(error);
          } else {
            this.log.info(`Successfully wrote to handle 0x${handle.toString(16).padStart(4, '0')}`);
            resolve(true);
          }
        });
      } catch (syncError) {
        clearTimeout(timeout);
        this.log.error(`Synchronous error writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${syncError instanceof Error ? syncError.message : 'Unknown error'}`);
        reject(syncError);
      }
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