/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Logging } from 'homebridge';
import noble from '@abandonware/noble';

/**
 * BLE Controller for Schneider BLE Lamps
 * This class handles the BLE communication with the lamp devices
 * Based on the working JavaScript implementation
 */
export class BLEController {
  private readonly log: Logging;
  private isConnected = false;
  private peripheral: any = null;
  private characteristics = new Map<string | number, any>();
  private selectedCharacteristic: any = null;
  
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
  public async scanDevices(): Promise<any[]> {
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

      const onConnect = async () => {
        this.isConnected = true;
        this.peripheral = peripheral;
        this.log.info(`Connected to device: ${peripheral.address}`);
        peripheral.removeListener('connect', onConnect);
        
        try {
          // Discover services and characteristics after connection
          await this.discoverServicesAndCharacteristics(peripheral);
          resolve();
        } catch (error) {
          this.log.error(`Failed to discover services: ${error instanceof Error ? error.message : 'Unknown error'}`);
          reject(error);
        }
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
   * Discover services and characteristics and store them for later use
   * @param peripheral - The connected peripheral
   */
  private async discoverServicesAndCharacteristics(peripheral: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log.debug('Discovering services and characteristics...');
      
      peripheral.discoverServices([], (error: Error | null, services: any[]) => {
        if (error) {
          this.log.error(`Error discovering services: ${error.message}`);
          reject(error);
          return;
        }

        this.log.info(`Discovered ${services.length} services`);
        
        // Clear previous characteristics
        this.characteristics.clear();
        
        // Log all discovered services
        services.forEach((service, index) => {
          this.log.debug(`Service ${index}: UUID=${service.uuid}, Name=${service.name || 'Unknown'}`);
        });

        // Discover characteristics for each service
        let pendingDiscoveries = services.length;
        if (pendingDiscoveries === 0) {
          resolve();
          return;
        }

        services.forEach((service) => {
          service.discoverCharacteristics([], (charError: Error | null, characteristics: any[]) => {
            if (charError) {
              this.log.error(`Error discovering characteristics for service ${service.uuid}: ${charError.message}`);
            } else {
              this.log.info(`Service ${service.uuid} has ${characteristics.length} characteristics`);
              characteristics.forEach((char, charIndex) => {
                this.log.debug(`  Characteristic ${charIndex}: UUID=${char.uuid}, Properties=[${char.properties.join(', ')}]`);
                
                // Store characteristic by handle or UUID for later use
                const key = char.handle !== undefined ? char.handle : `uuid_${char.uuid}`;
                this.characteristics.set(key, char);
                
                // Check if this is the lamp control characteristic we're looking for
                if (char.uuid === 'b35d95c66a68437eabe70ebffd8e0661') {
                  this.log.info(`*** FOUND LAMP CONTROL CHARACTERISTIC: ${char.uuid} ***`);
                  this.log.info(`    Handle: ${char.handle}, Properties: [${char.properties.join(', ')}]`);
                  // Automatically select this characteristic for lamp control
                  this.selectedCharacteristic = char;
                  this.log.info('Automatically selected lamp control characteristic');
                }
              });
            }
            
            pendingDiscoveries--;
            if (pendingDiscoveries === 0) {
              this.log.info(`Discovery completed. Found ${this.characteristics.size} characteristics total.`);
              if (this.selectedCharacteristic) {
                this.log.info(`Lamp control characteristic selected: ${this.selectedCharacteristic.uuid}`);
              } else {
                this.log.warn('Lamp control characteristic not found automatically');
              }
              resolve();
            }
          });
        });
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
          this.selectedCharacteristic = null;
          this.characteristics.clear();
          this.log.info('Disconnected from device');
          resolve();
        });

        this.peripheral!.disconnect();
      });
    }
  }

  /**
   * Write data to the selected characteristic
   * @param data - The data to write
   * @param operation - Description of the operation for logging
   * @returns Promise resolving when write is complete
   */
  private async writeToSelectedCharacteristic(data: Buffer, operation: string): Promise<boolean> {
    if (!this.peripheral || !this.isConnected) {
      this.log.error('Not connected to device, cannot write to characteristic');
      return false;
    }

    if (!this.selectedCharacteristic) {
      this.log.error('No characteristic selected for lamp control');
      return false;
    }

    return new Promise((resolve) => {
      const char = this.selectedCharacteristic;
      this.log.info(`${operation} - Writing to selected characteristic...`);
      this.log.info(`Writing to characteristic ${char.uuid}: ${data.toString('hex')}`);

      if (!char.write) {
        this.log.error(`Characteristic ${char.uuid} does not have write method`);
        resolve(false);
        return;
      }

      // Use writeWithoutResponse (false) as per the working script
      char.write(data, false, (error: Error | null) => {
        if (error) {
          this.log.error(`Error writing to characteristic ${char.uuid}: ${error.message}`);
          resolve(false);
        } else {
          this.log.info(`Successfully wrote to characteristic ${char.uuid}`);
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
      return await this.writeToSelectedCharacteristic(Buffer.from([0x01]), 'Turn lamp ON');
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
      return await this.writeToSelectedCharacteristic(Buffer.from([0x00]), 'Turn lamp OFF');
    } catch (error) {
      this.log.error(`Failed to turn lamp OFF: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Set the selected characteristic for lamp control
   * @param characteristicUuid - The UUID of the characteristic to use
   * @returns true if characteristic was found and selected, false otherwise
   */
  public setLampControlCharacteristic(characteristicUuid: string): boolean {
    for (const [, char] of this.characteristics) {
      if (char.uuid === characteristicUuid) {
        this.selectedCharacteristic = char;
        this.log.info(`Selected characteristic for lamp control: ${char.uuid}`);
        return true;
      }
    }
    this.log.error(`Characteristic with UUID ${characteristicUuid} not found`);
    return false;
  }

  /**
   * Get all discovered characteristics
   * @returns Map of characteristics
   */
  public getCharacteristics(): Map<string | number, any> {
    return this.characteristics;
  }

  /**
   * Get the currently selected characteristic
   * @returns The selected characteristic or null
   */
  public getSelectedCharacteristic(): any {
    return this.selectedCharacteristic;
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