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
  private targetPeripheral: any = null; // Store the target peripheral for reconnection
  private reconnectionAttempts = 0;
  private maxReconnectionAttempts = 10;
  private reconnectionDelay = 1000; // Start with 1 second
  private maxReconnectionDelay = 30000; // Max 30 seconds
  private connectionMonitorInterval: NodeJS.Timeout | null = null;
  private connectionMonitorIntervalMs = 10000; // Default 10 seconds
  private isReconnecting = false;
  private autoReconnectEnabled = true;

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
          this.log.debug(
            `BLE is not powered on yet, current state: ${noble.state}`,
          );
        }
      } catch (error) {
        this.log.error(
          `Error setting up BLE event listeners: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
        if (error instanceof Error && error.stack) {
          this.log.error(`Error stack: ${error.stack}`);
        }
        reject(error);
      }
    });
  }

  /**
   * Scan for BLE devices
   * @param duration - Scan duration in seconds (default: 10)
   * @param deviceFilter - Optional filter to stop scanning when matching device is found
   * @returns Promise resolving to array of discovered peripherals
   */
  public async scanDevices(
    duration: number = 10,
    deviceFilter?: string,
  ): Promise<any[]> {
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
        let isResolved = false;
        let scanTimeout: NodeJS.Timeout;

        const onScanStop = () => {
          this.log.debug('BLE scan stopped');
        };

        const onScanStart = () => {
          this.log.info('Starting BLE device scan...');
        };

        let onDiscover: undefined | ((result: any[]) => void) = undefined;

        const cleanup = () => {
          if (scanTimeout) {
            clearTimeout(scanTimeout);
          }
          if (onDiscover) {
            noble.removeListener('discover', onDiscover);
          }
          noble.removeListener('scanStart', onScanStart);
          noble.removeListener('scanStop', onScanStop);
          if (noble.scanning) {
            noble.stopScanning();
          }
        };

        const resolveOnce = (result: any[]) => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve(result);
          }
        };

        onDiscover = (peripheral: any) => {
          // Use id, uuid, or address - whichever is available
          const deviceId =
            peripheral.address || peripheral.id || peripheral.uuid || 'unknown';
          this.log.debug(
            `Discovered device: ${deviceId} - ${
              peripheral.advertisement?.localName || 'Unknown'
            }`,
          );
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

          // Check if this device matches the filter and stop scanning if it does
          if (deviceFilter && peripheral.advertisement?.localName) {
            const name = peripheral.advertisement.localName;
            if (name.toLowerCase().includes(deviceFilter.toLowerCase())) {
              this.log.info(
                `Found matching device: ${name} - stopping scan early`,
              );
              resolveOnce(devices);
              return;
            }
          }
        };

        // Set up timeout to stop scanning after duration
        scanTimeout = setTimeout(() => {
          this.log.info(`Scan duration of ${duration} seconds completed`);
          resolveOnce(devices);
        }, duration * 1000);

        this.log.debug('Setting up event listeners...');
        noble.on('discover', onDiscover);
        noble.on('scanStart', onScanStart);
        noble.on('scanStop', onScanStop);

        // Set up timeout to stop scanning after duration
        scanTimeout = setTimeout(() => {
          this.log.info(`Scan duration of ${duration} seconds completed`);
          resolveOnce(devices);
        }, duration * 1000);

        this.log.debug('Starting scan...');
        noble.startScanning([], false);
      } catch (error) {
        this.log.error(
          `Error in scanDevices: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
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
      this.log.info(
        `Connecting to device: ${peripheral.address} - ${
          peripheral.advertisement?.localName || 'Unknown'
        }`,
      );

      // Store the target peripheral for reconnection
      this.targetPeripheral = peripheral;
      this.reconnectionAttempts = 0;

      const onConnect = async () => {
        this.isConnected = true;
        this.peripheral = peripheral;
        this.isReconnecting = false;
        this.reconnectionAttempts = 0;
        this.reconnectionDelay = 1000; // Reset delay
        this.log.info(`Connected to device: ${peripheral.address}`);
        peripheral.removeListener('connect', onConnect);

        try {
          // Discover services and characteristics after connection
          await this.discoverServicesAndCharacteristics(peripheral);
          
          // Start connection monitoring
          this.startConnectionMonitoring();
          
          resolve();
        } catch (error) {
          this.log.error(
            `Failed to discover services: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
          reject(error);
        }
      };

      const onDisconnect = () => {
        this.isConnected = false;
        this.peripheral = null;
        this.log.warn(`Disconnected from device: ${peripheral.address}`);
        peripheral.removeListener('disconnect', onDisconnect);
        
        // Stop connection monitoring
        this.stopConnectionMonitoring();
        
        // Attempt automatic reconnection if enabled
        if (this.autoReconnectEnabled && !this.isReconnecting) {
          this.log.info('Attempting automatic reconnection...');
          this.attemptReconnection();
        }
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
  private async discoverServicesAndCharacteristics(
    peripheral: any,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log.debug('Discovering services and characteristics...');

      peripheral.discoverServices(
        [],
        (error: Error | null, services: any[]) => {
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
            this.log.debug(
              `Service ${index}: UUID=${service.uuid}, Name=${
                service.name || 'Unknown'
              }`,
            );
          });

          // Discover characteristics for each service
          let pendingDiscoveries = services.length;
          if (pendingDiscoveries === 0) {
            resolve();
            return;
          }

          services.forEach((service) => {
            service.discoverCharacteristics(
              [],
              (charError: Error | null, characteristics: any[]) => {
                if (charError) {
                  this.log.error(
                    `Error discovering characteristics for service ${service.uuid}: ${charError.message}`,
                  );
                } else {
                  this.log.info(
                    `Service ${service.uuid} has ${characteristics.length} characteristics`,
                  );
                  characteristics.forEach((char, charIndex) => {
                    this.log.debug(
                      `  Characteristic ${charIndex}: UUID=${
                        char.uuid
                      }, Properties=[${char.properties.join(', ')}]`,
                    );

                    // Store characteristic by handle or UUID for later use
                    const key =
                      char.handle !== undefined
                        ? char.handle
                        : `uuid_${char.uuid}`;
                    this.characteristics.set(key, char);

                    // Check if this is the lamp control characteristic we're looking for
                    if (char.uuid === 'b35d95c66a68437eabe70ebffd8e0661') {
                      this.log.info(
                        `*** FOUND LAMP CONTROL CHARACTERISTIC: ${char.uuid} ***`,
                      );
                      this.log.info(
                        `    Handle: ${
                          char.handle
                        }, Properties: [${char.properties.join(', ')}]`,
                      );
                      // Automatically select this characteristic for lamp control
                      this.selectedCharacteristic = char;
                      this.log.info(
                        'Automatically selected lamp control characteristic',
                      );
                    }
                  });
                }

                pendingDiscoveries--;
                if (pendingDiscoveries === 0) {
                  this.log.info(
                    `Discovery completed. Found ${this.characteristics.size} characteristics total.`,
                  );
                  if (this.selectedCharacteristic) {
                    this.log.info(
                      `Lamp control characteristic selected: ${this.selectedCharacteristic.uuid}`,
                    );
                  } else {
                    this.log.warn(
                      'Lamp control characteristic not found automatically',
                    );
                  }
                  resolve();
                }
              },
            );
          });
        },
      );
    });
  }

  /**
   * Disconnect from the current peripheral
   */
  public async disconnect(): Promise<void> {
    // Disable auto-reconnection when manually disconnecting
    this.autoReconnectEnabled = false;
    this.stopConnectionMonitoring();
    
    if (this.peripheral && this.isConnected) {
      return new Promise((resolve) => {
        this.peripheral!.once('disconnect', () => {
          this.isConnected = false;
          this.peripheral = null;
          this.targetPeripheral = null;
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
   * Start connection monitoring to detect connection issues
   */
  private startConnectionMonitoring(): void {
    this.stopConnectionMonitoring(); // Clear any existing monitor
    
    this.connectionMonitorInterval = setInterval(() => {
      this.checkConnectionHealth();
    }, this.connectionMonitorIntervalMs);
    
    this.log.debug(`Started connection monitoring (interval: ${this.connectionMonitorIntervalMs}ms)`);
  }

  /**
   * Stop connection monitoring
   */
  private stopConnectionMonitoring(): void {
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
      this.connectionMonitorInterval = null;
      this.log.debug('Stopped connection monitoring');
    }
  }

  /**
   * Check connection health and attempt reconnection if needed
   */
  private async checkConnectionHealth(): Promise<void> {
    if (!this.isConnected || !this.peripheral) {
      this.log.debug('Connection health check: Not connected');
      if (this.autoReconnectEnabled && !this.isReconnecting) {
        this.log.info('Connection lost detected, attempting reconnection...');
        this.attemptReconnection();
      }
      return;
    }

    // Check if peripheral is still valid
    if (this.peripheral.state !== 'connected') {
      this.log.warn(`Connection health check failed: peripheral state is ${this.peripheral.state}`);
      this.isConnected = false;
      if (this.autoReconnectEnabled && !this.isReconnecting) {
        this.log.info('Connection state mismatch detected, attempting reconnection...');
        this.attemptReconnection();
      }
    } else {
      this.log.debug('Connection health check: OK');
    }
  }

  /**
   * Attempt to reconnect to the target peripheral
   */
  private async attemptReconnection(): Promise<void> {
    if (this.isReconnecting || !this.targetPeripheral || !this.autoReconnectEnabled) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectionAttempts++;

    if (this.reconnectionAttempts > this.maxReconnectionAttempts) {
      this.log.error(`Max reconnection attempts (${this.maxReconnectionAttempts}) reached. Giving up.`);
      this.isReconnecting = false;
      return;
    }

    this.log.info(`Reconnection attempt ${this.reconnectionAttempts}/${this.maxReconnectionAttempts} in ${this.reconnectionDelay}ms...`);

    // Wait before attempting reconnection
    await new Promise(resolve => setTimeout(resolve, this.reconnectionDelay));

    try {
      // Try to reconnect to the target peripheral
      await this.connect(this.targetPeripheral);
      this.log.info('Reconnection successful!');
    } catch (error) {
      this.log.error(`Reconnection attempt ${this.reconnectionAttempts} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Exponential backoff with jitter
      this.reconnectionDelay = Math.min(
        this.reconnectionDelay * 2 + Math.random() * 1000,
        this.maxReconnectionDelay,
      );
      
      this.isReconnecting = false;
      
      // Schedule next attempt
      setTimeout(() => {
        if (this.autoReconnectEnabled && !this.isConnected) {
          this.attemptReconnection();
        }
      }, 1000);
    }
  }

  /**
   * Enable or disable automatic reconnection
   */
  public setAutoReconnect(enabled: boolean): void {
    this.autoReconnectEnabled = enabled;
    this.log.info(`Auto-reconnection ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get current auto-reconnection status
   */
  public getAutoReconnectEnabled(): boolean {
    return this.autoReconnectEnabled;
  }

  /**
   * Set maximum reconnection attempts
   */
  public setMaxReconnectionAttempts(attempts: number): void {
    this.maxReconnectionAttempts = Math.max(1, attempts);
    this.log.info(`Max reconnection attempts set to: ${this.maxReconnectionAttempts}`);
  }

  /**
   * Set connection monitor interval
   */
  public setConnectionMonitorInterval(intervalSeconds: number): void {
    this.connectionMonitorIntervalMs = Math.max(5, intervalSeconds) * 1000;
    
    // If monitoring is active, restart it with new interval
    if (this.connectionMonitorInterval) {
      this.stopConnectionMonitoring();
      this.startConnectionMonitoring();
      this.log.info(`Connection monitor interval updated to: ${intervalSeconds} seconds`);
    } else {
      this.log.info(`Connection monitor interval set to: ${intervalSeconds} seconds (will apply on next connection)`);
    }
  }

  /**
   * Set initial reconnection delay
   */
  public setInitialReconnectionDelay(delayMs: number): void {
    this.reconnectionDelay = Math.max(500, delayMs);
    this.log.info(`Initial reconnection delay set to: ${this.reconnectionDelay}ms`);
  }

  /**
   * Write data to the selected characteristic with retry logic
   * @param data - The data to write
   * @param operation - Description of the operation for logging
   * @param retryCount - Current retry attempt (internal use)
   * @returns Promise resolving when write is complete
   */
  private async writeToSelectedCharacteristic(
    data: Buffer,
    operation: string,
    retryCount = 0,
  ): Promise<boolean> {
    const maxRetries = 3;
    
    // Check connection status first
    if (!this.isConnected || !this.peripheral) {
      this.log.warn(`${operation} - Not connected to device, attempting reconnection...`);
      
      if (this.autoReconnectEnabled && this.targetPeripheral && retryCount < maxRetries) {
        try {
          await this.attemptReconnection();
          // Wait a bit for connection to stabilize
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Retry the write operation
          return this.writeToSelectedCharacteristic(data, operation, retryCount + 1);
        } catch (error) {
          this.log.error(`Failed to reconnect for ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return false;
        }
      } else {
        this.log.error(`${operation} - Cannot write to characteristic: not connected and no reconnection possible`);
        return false;
      }
    }

    if (!this.selectedCharacteristic) {
      this.log.error(`${operation} - No characteristic selected for lamp control`);
      return false;
    }

    return new Promise((resolve) => {
      const char = this.selectedCharacteristic;
      this.log.info(`${operation} - Writing to selected characteristic...`);
      this.log.info(
        `Writing to characteristic ${char.uuid}: ${data.toString('hex')}`,
      );

      if (!char.write) {
        this.log.error(
          `Characteristic ${char.uuid} does not have write method`,
        );
        resolve(false);
        return;
      }

      // Use writeWithoutResponse (false) as per the working script
      char.write(data, false, async (error: Error | null) => {
        if (error) {
          this.log.error(
            `Error writing to characteristic ${char.uuid}: ${error.message}`,
          );
          
          // If write failed and we haven't exceeded retry limit, try to reconnect and retry
          if (retryCount < maxRetries && this.autoReconnectEnabled && this.targetPeripheral) {
            this.log.info(`${operation} - Retrying write operation (attempt ${retryCount + 1}/${maxRetries})...`);
            
            // Mark as disconnected to trigger reconnection
            this.isConnected = false;
            
            try {
              await this.attemptReconnection();
              // Wait a bit for connection to stabilize
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Retry the write operation
              const retryResult = await this.writeToSelectedCharacteristic(data, operation, retryCount + 1);
              resolve(retryResult);
            } catch (reconnectError) {
              this.log.error(`Failed to reconnect for retry: ${reconnectError instanceof Error ? reconnectError.message : 'Unknown error'}`);
              resolve(false);
            }
          } else {
            resolve(false);
          }
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
      return await this.writeToSelectedCharacteristic(
        Buffer.from([0x01]),
        'Turn lamp ON',
      );
    } catch (error) {
      this.log.error(
        `Failed to turn lamp ON: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
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
      return await this.writeToSelectedCharacteristic(
        Buffer.from([0x00]),
        'Turn lamp OFF',
      );
    } catch (error) {
      this.log.error(
        `Failed to turn lamp OFF: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
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

  /**
   * Read the current state of the lamp from the characteristic
   * @returns Promise resolving to the lamp state (true for on, false for off, null if error)
   */
  public async readLampState(): Promise<boolean | null> {
    this.log.info('Reading lamp state...');
    
    // Check connection status first
    if (!this.isConnected || !this.peripheral) {
      this.log.warn('Read lamp state - Not connected to device');
      return null;
    }

    if (!this.selectedCharacteristic) {
      this.log.error('Read lamp state - No characteristic selected for lamp control');
      return null;
    }

    return new Promise((resolve) => {
      const char = this.selectedCharacteristic;
      this.log.info(`Reading from characteristic ${char.uuid}...`);

      if (!char.read) {
        this.log.error(`Characteristic ${char.uuid} does not have read method`);
        resolve(null);
        return;
      }

      char.read((error: Error | null, data: Buffer) => {
        if (error) {
          this.log.error(`Error reading from characteristic ${char.uuid}: ${error.message}`);
          resolve(null);
        } else {
          this.log.info(`Successfully read from characteristic ${char.uuid}: ${data.toString('hex')}`);
          
          // Parse the data - assuming 0x01 means ON, 0x00 means OFF
          if (data.length > 0) {
            const isOn = data[0] === 0x01;
            this.log.info(`Lamp state: ${isOn ? 'ON' : 'OFF'}`);
            resolve(isOn);
          } else {
            this.log.error('Received empty data from characteristic');
            resolve(null);
          }
        }
      });
    });
  }
}
