#!/usr/bin/env node

/**
 * Bluetooth Low Energy (BLE) Lamp Controller
 * 
 * This script scans for available BLE devices, lets the user select one,
 * and then allows the user to send lamp control commands to the selected device.
 * 
 * JavaScript version using Noble library
 */

const noble = require('@abandonware/noble');
const readline = require('readline');

// Set up readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

class BLELampController {
  /**
     * Initialize the BLE Lamp Controller.
     */
  constructor() {
    this.device = null;
    this.peripheral = null;
    this.isConnected = false;
    this.discoveredDevices = [];
    this.characteristics = new Map();
    this.selectedCharacteristic = null;
        
    // Lamp control handles from the analysis
    this.HANDLE_ON_1 = 21;  // First handle for turning lamp ON
    this.HANDLE_ON_2 = 23;  // Second handle for turning lamp ON
    this.HANDLE_OFF = 26;   // Handle for turning lamp OFF
    this.HANDLE_EXTRA = 38; // Additional control handle
        
    // Setup Noble event handlers
    this.setupNobleEvents();
  }
    
  /**
     * Setup Noble event handlers
     */
  setupNobleEvents() {
    noble.on('stateChange', (state) => {
      console.log(`[INFO] Bluetooth state changed to: ${state}`);
      if (state === 'poweredOn') {
        console.log('[INFO] Bluetooth is powered on and ready');
      } else {
        console.log(`[WARN] Bluetooth is not powered on: ${state}`);
        if (state === 'poweredOff') {
          console.log('[ERROR] Please turn on Bluetooth and restart the application');
        }
      }
    });
        
    noble.on('discover', (peripheral) => {
      this.discoveredDevices.push(peripheral);
      const name = peripheral.advertisement.localName || 'Unknown';
      console.log(`[INFO] Found device: ${name} - ${peripheral.address}`);
    });
        
    noble.on('scanStart', () => {
      console.log('[INFO] Started scanning for BLE devices...');
    });
        
    noble.on('scanStop', () => {
      console.log('[INFO] Stopped scanning for BLE devices');
    });
  }
    
  /**
     * Scan for BLE devices.
     * 
     * @param {number} duration - How long to scan in seconds.
     * @returns {Promise<Array>} List of discovered BLE devices.
     */
  async scanForDevices(duration = 5.0) {
    return new Promise((resolve, reject) => {
      console.log('[INFO] Scanning for BLE devices...');
      this.discoveredDevices = [];
            
      if (noble.state !== 'poweredOn') {
        reject(new Error('Bluetooth is not powered on'));
        return;
      }
            
      // Start scanning
      noble.startScanning([], true);
            
      // Stop scanning after duration
      setTimeout(() => {
        noble.stopScanning();
                
        if (this.discoveredDevices.length === 0) {
          console.log('[WARN] No devices found during scan');
        } else {
          console.log(`[INFO] Found ${this.discoveredDevices.length} devices:`);
          this.discoveredDevices.forEach((device, index) => {
            const name = device.advertisement.localName || 'Unknown';
            console.log(`[INFO] ${index + 1}. ${name} - ${device.address}`);
          });
        }
                
        resolve(this.discoveredDevices);
      }, duration * 1000);
    });
  }
    
  /**
     * Display a menu of discovered devices and let the user select one.
     * 
     * @param {Array} devices - List of discovered BLE devices.
     * @returns {Promise<Object|null>} The selected BLE device or null if no valid selection.
     */
  async displayDeviceMenu(devices) {
    if (!devices || devices.length === 0) {
      console.log('[ERROR] No devices to display');
      return null;
    }
        
    console.log('\nAvailable Bluetooth Devices:');
    console.log('-'.repeat(40));
    devices.forEach((device, index) => {
      const name = device.advertisement.localName || 'Unknown';
      console.log(`${index + 1}. ${name} - ${device.address}`);
    });
        
    return new Promise((resolve) => {
      const askForChoice = () => {
        rl.question('\nEnter the number of the device to connect to (or \'q\' to quit): ', (choice) => {
          if (choice.toLowerCase() === 'q') {
            resolve(null);
            return;
          }
                    
          const index = parseInt(choice) - 1;
          if (isNaN(index) || index < 0 || index >= devices.length) {
            console.log(`Invalid selection. Please enter a number between 1 and ${devices.length}.`);
            askForChoice();
          } else {
            const selectedDevice = devices[index];
            const name = selectedDevice.advertisement.localName || 'Unknown';
            console.log(`[INFO] Selected device: ${name} - ${selectedDevice.address}`);
            resolve(selectedDevice);
          }
        });
      };
      askForChoice();
    });
  }
    
  /**
     * Connect to the selected BLE device.
     * 
     * @returns {Promise<boolean>} True if connection was successful, false otherwise.
     */
  async connectToDevice() {
    if (!this.device) {
      console.log('[ERROR] No device selected for connection');
      return false;
    }
        
    return new Promise((resolve) => {
      console.log(`[INFO] Connecting to device: ${this.device.address}`);
            
      this.device.connect((error) => {
        if (error) {
          console.log(`[ERROR] Failed to connect to device: ${error}`);
          resolve(false);
          return;
        }
                
        console.log(`[INFO] Connected to ${this.device.address}`);
        this.peripheral = this.device;
        this.isConnected = true;
                
        // Setup disconnect handler
        this.device.on('disconnect', () => {
          console.log('[INFO] Device disconnected');
          this.isConnected = false;
        });
                
        resolve(true);
      });
    });
  }
    
  /**
     * Write data to a specific handle using Noble's low-level interface.
     *
     * @param {number} handle - The handle to write to.
     * @param {Buffer} data - The data to write.
     * @returns {Promise<boolean>} True if write was successful, false otherwise.
     */
  async writeToHandle(handle, data) {
    if (!this.peripheral || !this.isConnected) {
      console.log('[ERROR] Not connected to device, cannot write to handle');
      return false;
    }
        
    return new Promise((resolve) => {
      console.log(`[INFO] Writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${data.toString('hex')}`);
            
      // Use Noble's low-level writeHandle method
      if (this.peripheral._noble && this.peripheral._noble.writeHandle) {
        this.peripheral._noble.writeHandle(
          this.peripheral.uuid,
          handle,
          data,
          true, // withoutResponse
          (error) => {
            if (error) {
              console.log(`[ERROR] Error writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${error}`);
              resolve(false);
            } else {
              console.log(`[INFO] Successfully wrote to handle 0x${handle.toString(16).padStart(4, '0')}`);
              resolve(true);
            }
          },
        );
      } else {
        // Fallback: try to find characteristic by handle and use it
        const characteristic = this.characteristics.get(handle);
        if (!characteristic) {
          console.log(`[ERROR] Characteristic with handle ${handle} not found and low-level write not available`);
          console.log('[INFO] Available characteristics:');
          for (const [h, char] of this.characteristics) {
            console.log(`[INFO]   Handle ${h}: ${char.uuid}`);
          }
          resolve(false);
          return;
        }
                
        characteristic.write(data, false, (error) => {
          if (error) {
            console.log(`[ERROR] Error writing to handle 0x${handle.toString(16).padStart(4, '0')}: ${error}`);
            resolve(false);
          } else {
            console.log(`[INFO] Successfully wrote to handle 0x${handle.toString(16).padStart(4, '0')}`);
            resolve(true);
          }
        });
      }
    });
  }
    
  /**
     * Display a menu of discovered characteristics and let the user select one.
     *
     * @returns {Promise<Object|null>} The selected characteristic or null if no valid selection.
     */
  async displayCharacteristicMenu() {
    if (!this.characteristics || this.characteristics.size === 0) {
      console.log('[ERROR] No characteristics to display');
      return null;
    }
        
    console.log('\nAvailable Characteristics:');
    console.log('-'.repeat(60));
        
    const charArray = Array.from(this.characteristics.entries());
        
    // Sort characteristics by handle (numeric handles first, then string handles)
    charArray.sort(([handleA], [handleB]) => {
      // If both are numbers, sort numerically
      if (typeof handleA === 'number' && typeof handleB === 'number') {
        return handleA - handleB;
      }
      // If one is number and one is string, number comes first
      if (typeof handleA === 'number' && typeof handleB === 'string') {
        return -1;
      }
      if (typeof handleA === 'string' && typeof handleB === 'number') {
        return 1;
      }
      // If both are strings, sort alphabetically
      return handleA.localeCompare(handleB);
    });
        
    charArray.forEach(([handle, characteristic], index) => {
      const handleStr = (typeof handle === 'number') ? handle.toString(16).padStart(4, '0') : handle;
      const uuid = characteristic.uuid || 'unknown';
      const properties = characteristic.properties ? characteristic.properties.join(', ') : 'unknown';
      console.log(`${index + 1}. Handle: 0x${handleStr} | UUID: ${uuid} | Properties: ${properties}`);
    });
        
    return new Promise((resolve) => {
      const askForChoice = () => {
        rl.question('\nEnter the number of the characteristic to use for lamp control (or \'q\' to quit): ', (choice) => {
          if (choice.toLowerCase() === 'q') {
            resolve(null);
            return;
          }
                    
          const index = parseInt(choice) - 1;
          if (isNaN(index) || index < 0 || index >= charArray.length) {
            console.log(`Invalid selection. Please enter a number between 1 and ${charArray.length}.`);
            askForChoice();
          } else {
            const [handle, characteristic] = charArray[index];
            const handleStr = (typeof handle === 'number') ? handle.toString(16).padStart(4, '0') : handle;
            const uuid = characteristic.uuid || 'unknown';
            console.log(`[INFO] Selected characteristic: Handle 0x${handleStr}, UUID: ${uuid}`);
            resolve({ handle, characteristic });
          }
        });
      };
      askForChoice();
    });
  }

  /**
     * Write data to the selected characteristic.
     *
     * @param {Buffer} data - The data to write.
     * @param {string} operation - Description of the operation for logging.
     * @returns {Promise<boolean>} True if write was successful, false otherwise.
     */
  async writeToSelectedCharacteristic(data, operation) {
    if (!this.peripheral || !this.isConnected) {
      console.log('[ERROR] Not connected to device, cannot write to characteristic');
      return false;
    }
        
    if (!this.selectedCharacteristic) {
      console.log('[ERROR] No characteristic selected for lamp control');
      return false;
    }
        
    const { handle, characteristic } = this.selectedCharacteristic;
    const handleStr = (typeof handle === 'number') ? handle.toString(16).padStart(4, '0') : handle;
    const uuid = characteristic.uuid || 'unknown';
        
    console.log(`[INFO] ${operation} - Writing to selected characteristic...`);
    console.log(`[INFO] Writing to handle 0x${handleStr} (${uuid}): ${data.toString('hex')}`);
        
    return new Promise((resolve) => {
      if (!characteristic.write) {
        console.log(`[ERROR] Characteristic at handle 0x${handleStr} does not have write method`);
        resolve(false);
        return;
      }
            
      characteristic.write(data, false, (error) => {
        if (error) {
          console.log(`[ERROR] Error writing to handle 0x${handleStr}: ${error}`);
          resolve(false);
        } else {
          console.log(`[INFO] Successfully wrote to handle 0x${handleStr}`);
          resolve(true);
        }
      });
    });
  }
    
  /**
     * Turn the lamp ON by writing to the selected characteristic.
     *
     * @returns {Promise<boolean>} True if write was successful, false otherwise.
     */
  async turnLampOn() {
    console.log('[INFO] Turning lamp ON...');
    return await this.writeToSelectedCharacteristic(Buffer.from([0x01]), 'Turn lamp ON');
  }
    
  /**
     * Turn the lamp OFF by writing to the selected characteristic.
     *
     * @returns {Promise<boolean>} True if write was successful, false otherwise.
     */
  async turnLampOff() {
    console.log('[INFO] Turning lamp OFF...');
    return await this.writeToSelectedCharacteristic(Buffer.from([0x00]), 'Turn lamp OFF');
  }
    
  /**
     * Send additional control command by writing to the selected characteristic.
     *
     * @returns {Promise<boolean>} True if write was successful, false otherwise.
     */
  async sendExtraCommand() {
    console.log('[INFO] Sending additional control command...');
    return await this.writeToSelectedCharacteristic(Buffer.from([0x01]), 'Send extra command');
  }
    
  /**
     * Discover all services and characteristics of the connected device.
     * 
     * @returns {Promise<boolean>} True if discovery was successful, false otherwise.
     */
  async discoverServices() {
    if (!this.peripheral || !this.isConnected) {
      console.log('[ERROR] Not connected to device, cannot discover services');
      return false;
    }
        
    return new Promise((resolve) => {
      console.log('[INFO] Discovering services and characteristics...');
            
      this.peripheral.discoverServices([], (error, services) => {
        if (error) {
          console.log(`[ERROR] Error discovering services: ${error}`);
          resolve(false);
          return;
        }
                
        console.log('\nDiscovered Services and Characteristics:');
        console.log('-'.repeat(50));
                
        // Track which handles we've found
        const foundHandles = {
          'HANDLE_OFF': null,
          'HANDLE_ON_1': null,
          'HANDLE_ON_2': null,
          'HANDLE_EXTRA': null,
        };
                
        let pendingServices = services.length;
                
        if (pendingServices === 0) {
          this.printHandleSummary(foundHandles);
          resolve(true);
          return;
        }
                
        services.forEach((service) => {
          console.log(`Service: ${service.uuid}`);
                    
          service.discoverCharacteristics([], (error, characteristics) => {
            if (error) {
              console.log(`[ERROR] Error discovering characteristics: ${error}`);
              pendingServices--;
              if (pendingServices === 0) {
                this.printHandleSummary(foundHandles);
                resolve(false);
              }
              return;
            }
                        
            characteristics.forEach((char) => {
              const handle = char.handle || 'N/A';
              console.log(`  Characteristic: ${char.uuid} (Handle: ${handle})`);
              console.log(`    Properties: ${char.properties.join(', ')}`);
                            
              // Store characteristic by handle for later use
              // Use a generated key if handle is not available
              const key = char.handle !== undefined ? char.handle : `uuid_${char.uuid}`;
              this.characteristics.set(key, char);
                            
              // Check if this characteristic matches any of our known handles
              if (char.handle === this.HANDLE_OFF) {
                foundHandles.HANDLE_OFF = [service.uuid, char.uuid];
                console.log('    *** MATCH: This is HANDLE_OFF (26) ***');
              } else if (char.handle === this.HANDLE_ON_1) {
                foundHandles.HANDLE_ON_1 = [service.uuid, char.uuid];
                console.log('    *** MATCH: This is HANDLE_ON_1 (21) ***');
              } else if (char.handle === this.HANDLE_ON_2) {
                foundHandles.HANDLE_ON_2 = [service.uuid, char.uuid];
                console.log('    *** MATCH: This is HANDLE_ON_2 (23) ***');
              } else if (char.handle === this.HANDLE_EXTRA) {
                foundHandles.HANDLE_EXTRA = [service.uuid, char.uuid];
                console.log('    *** MATCH: This is HANDLE_EXTRA (38) ***');
              }
            });
                        
            pendingServices--;
            if (pendingServices === 0) {
              this.printHandleSummary(foundHandles);
              resolve(true);
            }
          });
        });
      });
    });
  }
    
  /**
     * Print a summary of found handles
     * 
     * @param {Object} foundHandles - Object containing found handle mappings
     */
  printHandleSummary(foundHandles) {
    console.log('-'.repeat(50));
    console.log('\nHandle Mapping Summary:');
    console.log('-'.repeat(50));
        
    Object.entries(foundHandles).forEach(([handleName, mapping]) => {
      const handleNum = this[handleName];
      if (mapping) {
        const [serviceUuid, charUuid] = mapping;
        console.log(`${handleName} (${handleNum}) -> Service: ${serviceUuid}, Characteristic: ${charUuid}`);
        console.log(`[INFO] ${handleName} (${handleNum}) maps to Service: ${serviceUuid}, Characteristic: ${charUuid}`);
      } else {
        console.log(`${handleName} (${handleNum}) -> NOT FOUND`);
        console.log(`[WARN] ${handleName} (${handleNum}) not found in discovered services/characteristics`);
      }
    });
        
    console.log('-'.repeat(50));
    console.log('[INFO] Service discovery completed');
  }
    
  /**
     * Display a menu of lamp control commands and let the user select one.
     *
     * @returns {Promise<string|null>} The selected command or null if no valid selection.
     */
  async displayCommandMenu() {
    console.log('\nLamp Control Commands:');
    console.log('-'.repeat(40));
    console.log('1. Turn Lamp ON');
    console.log('2. Turn Lamp OFF');
    console.log('3. Send Additional Control Command');
    console.log('4. Discover Services and Characteristics');
    console.log('5. Select Characteristic for Lamp Control');
    console.log('6. Disconnect and Exit');
        
    return new Promise((resolve) => {
      const askForChoice = () => {
        rl.question('\nEnter the number of the command to execute (or \'q\' to quit): ', (choice) => {
          if (choice.toLowerCase() === 'q') {
            resolve(null);
            return;
          }
                    
          if (['1', '2', '3', '4', '5', '6'].includes(choice)) {
            resolve(choice);
          } else {
            console.log('Invalid selection. Please enter a number between 1 and 6.');
            askForChoice();
          }
        });
      };
      askForChoice();
    });
  }
    
  /**
     * Execute the selected lamp control command.
     *
     * @param {string} command - The command to execute.
     * @returns {Promise<boolean>} True if command was executed successfully, false otherwise.
     */
  async executeCommand(command) {
    switch (command) {
    case '1':
      return await this.turnLampOn();
    case '2':
      return await this.turnLampOff();
    case '3':
      return await this.sendExtraCommand();
    case '4':
      return await this.discoverServices();
    case '5':
      // Select characteristic for lamp control
      const selection = await this.displayCharacteristicMenu();
      if (selection) {
        this.selectedCharacteristic = selection;
        console.log('[INFO] Characteristic selected for lamp control');
        return true;
      } else {
        console.log('[INFO] No characteristic selected');
        return false;
      }
    case '6':
      return true; // Will be handled by the caller
    default:
      console.log(`[ERROR] Unknown command: ${command}`);
      return false;
    }
  }
    
  /**
     * Disconnect from the device.
     */
  async disconnect() {
    if (this.peripheral && this.isConnected) {
      return new Promise((resolve) => {
        this.peripheral.disconnect((error) => {
          if (error) {
            console.log(`[ERROR] Error disconnecting: ${error}`);
          } else {
            console.log('[INFO] Disconnected from device');
          }
          this.isConnected = false;
          resolve();
        });
      });
    }
  }
    
  /**
     * Wait for a specified amount of time
     * 
     * @param {number} ms - Milliseconds to wait
     */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
    
  /**
     * Main run loop for the BLE Lamp Controller.
     */
  async run() {
    try {
      // Wait for Noble to be ready
      if (noble.state !== 'poweredOn') {
        console.log('[INFO] Waiting for Bluetooth to be powered on...');
        await new Promise((resolve) => {
          noble.once('stateChange', (state) => {
            if (state === 'poweredOn') {
              resolve();
            }
          });
        });
      }
            
      // Step 1: Scan for devices
      const devices = await this.scanForDevices();
            
      if (!devices || devices.length === 0) {
        console.log('[ERROR] No devices found, cannot proceed');
        return;
      }
            
      // Step 2: Let user select a device
      this.device = await this.displayDeviceMenu(devices);
      if (!this.device) {
        console.log('[INFO] No device selected, exiting');
        return;
      }
            
      // Step 3: Connect to the selected device
      if (!(await this.connectToDevice())) {
        console.log('[ERROR] Failed to connect to device, exiting');
        return;
      }
            
      // Step 4: Automatically discover services and characteristics
      console.log('[INFO] Automatically discovering services and characteristics...');
      await this.discoverServices();
            
      // Step 5: Command loop
      while (this.isConnected) {
        const command = await this.displayCommandMenu();
        if (!command) {
          break;
        }
                
        if (command === '6') { // Disconnect and exit
          break;
        }
                
        const success = await this.executeCommand(command);
        if (success) {
          console.log('[INFO] Command executed successfully');
        } else {
          console.log('[ERROR] Failed to execute command');
        }
                
        // Small delay between commands
        await this.sleep(500);
      }
            
    } catch (error) {
      if (error.message.includes('interrupted')) {
        console.log('[INFO] Interrupted by user');
      } else {
        console.log(`[ERROR] Error in main: ${error}`);
      }
    } finally {
      await this.disconnect();
      rl.close();
      process.exit(0);
    }
  }
}

/**
 * Main function to run the BLE Lamp Controller.
 */
async function main() {
  const controller = new BLELampController();
    
  // Handle Ctrl+C gracefully
  process.on('SIGINT', async () => {
    console.log('\n[INFO] Received interrupt signal, cleaning up...');
    await controller.disconnect();
    rl.close();
    process.exit(0);
  });
    
  try {
    await controller.run();
  } catch (error) {
    console.log(`[ERROR] Error in main: ${error}`);
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = BLELampController;