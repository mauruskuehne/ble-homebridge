#!/usr/bin/env node

/**
 * Standalone BLE Lamp Test Script
 * 
 * This script tests BLE communication with the Schneider lamp
 * without the complexity of the Homebridge plugin.
 * 
 * Usage: node test-ble.cjs
 */

const noble = require('@abandonware/noble');

class BLELampTester {
  constructor() {
    this.peripheral = null;
    this.isConnected = false;
    this.targetServiceUuid = 'b35d95c06a68437eabe70ebffd8e0661';
    this.targetCharUuid = 'b35d95c66a68437eabe70ebffd8e0661';
  }

  log(message, ...args) {
    console.log(`[${new Date().toISOString()}] ${message}`, ...args);
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.log('Initializing BLE...');
      
      const onStateChange = (state) => {
        this.log(`BLE state: ${state}`);
        if (state === 'poweredOn') {
          noble.removeListener('stateChange', onStateChange);
          resolve();
        } else {
          noble.removeListener('stateChange', onStateChange);
          reject(new Error(`BLE not powered on: ${state}`));
        }
      };

      noble.on('stateChange', onStateChange);
      
      if (noble.state === 'poweredOn') {
        resolve();
      }
    });
  }

  async scanForDevices(duration = 10) {
    return new Promise((resolve, reject) => {
      this.log(`Scanning for devices for ${duration} seconds...`);
      
      const devices = [];
      
      const onDiscover = (peripheral) => {
        const name = peripheral.advertisement?.localName || 'Unknown';
        const address = peripheral.address || peripheral.id || peripheral.uuid || 'unknown';
        
        this.log(`Found device: ${name} (${address})`);
        
        // Store address if missing
        if (!peripheral.address && (peripheral.id || peripheral.uuid)) {
          peripheral.address = peripheral.id || peripheral.uuid;
        }
        
        devices.push(peripheral);
      };

      noble.on('discover', onDiscover);
      
      const timeout = setTimeout(() => {
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        this.log(`Scan complete. Found ${devices.length} devices.`);
        resolve(devices);
      }, duration * 1000);

      noble.startScanning([], false);
    });
  }

  async connectToDevice(peripheral) {
    return new Promise((resolve, reject) => {
      this.log(`Connecting to: ${peripheral.advertisement?.localName} (${peripheral.address})`);
      
      const onConnect = () => {
        this.isConnected = true;
        this.peripheral = peripheral;
        this.log('Connected successfully!');
        peripheral.removeListener('connect', onConnect);
        resolve();
      };

      const onDisconnect = () => {
        this.isConnected = false;
        this.peripheral = null;
        this.log('Disconnected from device');
      };

      peripheral.on('connect', onConnect);
      peripheral.on('disconnect', onDisconnect);

      peripheral.connect((error) => {
        if (error) {
          this.log('Connection failed:', error.message);
          reject(error);
        }
      });
    });
  }

  async discoverServices() {
    return new Promise((resolve, reject) => {
      this.log('Discovering services...');
      
      this.peripheral.discoverServices([], (error, services) => {
        if (error) {
          reject(error);
          return;
        }

        this.log(`Found ${services.length} services:`);
        services.forEach((service, index) => {
          this.log(`  Service ${index}: ${service.uuid}`);
        });

        resolve(services);
      });
    });
  }

  async discoverCharacteristics(service) {
    return new Promise((resolve, reject) => {
      this.log(`Discovering characteristics for service: ${service.uuid}`);
      
      service.discoverCharacteristics([], (error, characteristics) => {
        if (error) {
          reject(error);
          return;
        }

        this.log(`Found ${characteristics.length} characteristics:`);
        characteristics.forEach((char, index) => {
          this.log(`  Char ${index}: ${char.uuid} [${char.properties.join(', ')}]`);
        });

        resolve(characteristics);
      });
    });
  }

  async writeToCharacteristic(characteristic, data) {
    return new Promise((resolve, reject) => {
      this.log(`Writing to characteristic ${characteristic.uuid}: ${data.toString('hex')}`);
      
      const useResponse = characteristic.properties.includes('write');
      
      characteristic.write(data, useResponse, (error) => {
        this.log('response', error);
        if (error) {
          this.log('Write failed:', error.message);
          reject(error);
        } else {
          this.log(`Write successful (with response: ${useResponse})`);
          
          resolve();
        }
      });
    });
  }

  async testLampControl() {
    try {
      // Initialize BLE
      await this.init();
      
      // Scan for devices
      const devices = await this.scanForDevices();
      
      if (devices.length === 0) {
        this.log('No devices found!');
        return;
      }

      // Find Schneider lamp (or let user choose)
      let lampDevice = devices.find(d => 
        d.advertisement?.localName?.toLowerCase().includes('masterbad') ||
        d.advertisement?.localName?.toLowerCase().includes('schneider'),
      );

      if (!lampDevice) {
        this.log('Available devices:');
        devices.forEach((device, index) => {
          const name = device.advertisement?.localName || 'Unknown';
          this.log(`  ${index}: ${name} (${device.address})`);
        });
        
        // For now, just use the first device
        lampDevice = devices.find(x => x.advertisement.localName === 'Masterbad');
        this.log(`Using device: ${lampDevice.advertisement?.localName} (${lampDevice.address})`);
      }

      // Connect to device
      await this.connectToDevice(lampDevice);

      // Discover services
      const services = await this.discoverServices();

      // Find target service or use first service
      let targetService = services.find(s => s.uuid === this.targetServiceUuid);
      if (!targetService) {
        this.log(`Target service ${this.targetServiceUuid} not found, using first service`);
        targetService = services[0];
      }

      // Discover characteristics
      const characteristics = await this.discoverCharacteristics(targetService);

      // Find target characteristic or use first writable one
      let targetChar = characteristics.find(c => c.uuid === this.targetCharUuid);
      if (!targetChar) {
        this.log(`Target characteristic ${this.targetCharUuid} not found, looking for writable characteristic`);
        targetChar = characteristics.find(c => 
          c.properties.includes('write') || c.properties.includes('writeWithoutResponse'),
        );
      }

      if (!targetChar) {
        this.log('No writable characteristics found!');
        return;
      }

      this.log(`Using characteristic: ${targetChar.uuid} [${targetChar.properties.join(', ')}]`);

      // Test lamp commands
      this.log('\n=== Testing Lamp Commands ===');
      
      // Turn ON
      this.log('Turning lamp ON...');
      await this.writeToCharacteristic(targetChar, Buffer.from([0x01]));
      await this.sleep(5000);

      // Turn OFF
      this.log('Turning lamp OFF...');
      await this.writeToCharacteristic(targetChar, Buffer.from([0x00]));
      await this.sleep(5000);

      // Turn ON again
      this.log('Turning lamp ON again...');
      await this.writeToCharacteristic(targetChar, Buffer.from([0x01]));

      this.log('\n=== Test Complete ===');

    } catch (error) {
      this.log('Test failed:', error.message);
    } finally {
      if (this.peripheral && this.isConnected) {
        this.peripheral.disconnect();
      }
      process.exit(0);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
const tester = new BLELampTester();
tester.testLampControl().catch(console.error);