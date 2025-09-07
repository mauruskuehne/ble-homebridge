import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SchneiderBLELampsPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SchneiderBLELampsAccessory {
  private service!: Service;
  private peripheral: unknown;
  private isConnected = false;

  /**
   * Track the state of the accessory
   */
  private states = {
    On: false,
    Brightness: 100,
  };

  constructor(
    private readonly platform: SchneiderBLELampsPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Schneider Electric')
      .setCharacteristic(this.platform.Characteristic.Model, 'BLE Lamp')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.uniqueId || 'SCH-BLE-LAMP');

    // Debug: Log the accessory context to verify device information
    this.platform.log.debug('Accessory context:', JSON.stringify(this.accessory.context, null, 2));
    
    // Verify that device information is properly stored
    if (!this.accessory.context.device) {
      this.platform.log.error('Device information not found in accessory context');
      return;
    }
    
    if (!this.accessory.context.device.address && !this.accessory.context.device.deviceAddress) {
      this.platform.log.error('Device address not found in accessory context');
      this.platform.log.debug('Available device context properties:', Object.keys(this.accessory.context.device));
    } else {
      this.platform.log.debug('Device address found in accessory context:',
        this.accessory.context.device.address || this.accessory.context.device.deviceAddress);
    }

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this)) // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below

    // register handlers for the Brightness Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this)); // SET - bind to the `setBrightness` method below

    // Note: We don't set up peripheral event handlers in the constructor anymore
    // Instead, we'll get the peripheral when we need to connect
  }

  /**
   * Set up peripheral event handlers
   */
  private setupPeripheralEventHandlers(peripheral: { address: string; on: (event: string, callback: () => void) => void }): void {
    if (!peripheral) {
      this.platform.log.error('Cannot set up event handlers: peripheral is undefined');
      return;
    }

    this.peripheral = peripheral;

    peripheral.on('connect', () => {
      this.isConnected = true;
      this.platform.log.info(`Connected to lamp: ${this.accessory.displayName}`);
    });

    peripheral.on('disconnect', () => {
      this.isConnected = false;
      this.peripheral = null;
      this.platform.log.info(`Disconnected from lamp: ${this.accessory.displayName}`);
    });
  }

  /**
   * Connect to the BLE device
   */
  private async connectToDevice(): Promise<void> {
    try {
      // Find the peripheral by address from the platform
      // Try both possible locations for the device address
      let deviceAddress = this.accessory.context.device?.address;
      if (!deviceAddress) {
        deviceAddress = this.accessory.context.device?.deviceAddress;
      }
      
      if (!deviceAddress) {
        throw new Error('Device address not found in accessory context');
      }

      this.platform.log.debug(`Retrieved device address: ${deviceAddress}`);

      // Get the peripheral from the platform's peripheral map
      const peripheral = this.platform.getPeripheralByAddress(deviceAddress) as { address: string; on: (event: string, callback: () => void) => void };
      if (!peripheral) {
        throw new Error(`Peripheral not found for address: ${deviceAddress}`);
      }

      // Set up event handlers for this peripheral
      this.setupPeripheralEventHandlers(peripheral);

      // Check if we're already connected to the right device
      if (!this.platform.bleController.getIsConnected() ||
          this.platform.bleController.getPeripheral()?.address !== deviceAddress) {
        
        // Enable auto-reconnection for this device
        this.platform.bleController.setAutoReconnect(true);
        
        // Connect to the peripheral
        await this.platform.bleController.connect(peripheral);
      }
    } catch (error) {
      this.platform.log.error(`Failed to connect to lamp: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Re-throw to allow retry logic in calling methods
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    const maxRetries = 3;
    let retryCount = 0;
    
    const attemptSetOn = async (): Promise<void> => {
      try {
        const isOn = value as boolean;
        
        // Ensure we're connected to the device
        // Try both possible locations for the device address
        let deviceAddress = this.accessory.context.device?.address;
        if (!deviceAddress) {
          deviceAddress = this.accessory.context.device?.deviceAddress;
        }
        
        if (!deviceAddress) {
          this.platform.log.error('Device address not found in accessory context');
          // Revert the state in HomeKit if there was an error
          setTimeout(() => {
            this.service.updateCharacteristic(this.platform.Characteristic.On, this.states.On);
          }, 100);
          return;
        }

        // Always try to ensure connection before sending commands
        if (!this.platform.bleController.getIsConnected() ||
            this.platform.bleController.getPeripheral()?.address !== deviceAddress) {
          this.platform.log.debug('Not connected or connected to different device, attempting connection...');
          await this.connectToDevice();
        }

        // Send the command to the device
        let success = false;
        if (isOn) {
          success = await this.platform.bleController.turnLampOn();
        } else {
          success = await this.platform.bleController.turnLampOff();
        }

        if (success) {
          this.states.On = isOn;
          this.platform.log.debug(`Set Characteristic On -> ${isOn} (successful)`);
        } else {
          throw new Error(`Failed to set lamp state to ${isOn}`);
        }
      } catch (error) {
        retryCount++;
        this.platform.log.error(`Error in setOn (attempt ${retryCount}/${maxRetries}): ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        if (retryCount < maxRetries) {
          this.platform.log.info(`Retrying setOn operation in 1 second... (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return attemptSetOn();
        } else {
          this.platform.log.error(`Failed to set lamp state after ${maxRetries} attempts`);
          // Revert the state in HomeKit if all attempts failed
          setTimeout(() => {
            this.service.updateCharacteristic(this.platform.Characteristic.On, this.states.On);
          }, 100);
        }
      }
    };

    await attemptSetOn();
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.
   * In this case, you may decide not to implement `onGet` handlers, which may speed up
   * the responsiveness of your device in the Home app.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    try {
      // Try to read the actual state from the device
      // First ensure we're connected to the device
      let deviceAddress = this.accessory.context.device?.address;
      if (!deviceAddress) {
        deviceAddress = this.accessory.context.device?.deviceAddress;
      }
      
      if (!deviceAddress) {
        this.platform.log.warn('Device address not found, returning cached state');
        return this.states.On;
      }

      // Check if we're connected to the right device
      if (!this.platform.bleController.getIsConnected() ||
          this.platform.bleController.getPeripheral()?.address !== deviceAddress) {
        this.platform.log.debug('Not connected to device, attempting connection for state read...');
        try {
          await this.connectToDevice();
        } catch (error) {
          this.platform.log.warn(`Failed to connect for state read: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return this.states.On;
        }
      }

      // Read the actual state from the characteristic
      const actualState = await this.platform.bleController.readLampState();
      
      if (actualState !== null) {
        // Update our cached state with the actual state
        this.states.On = actualState;
        this.platform.log.debug('Get Characteristic On -> (from device)', actualState);
        return actualState;
      } else {
        // Fall back to cached state if read failed
        this.platform.log.warn('Failed to read state from device, returning cached state');
        this.platform.log.debug('Get Characteristic On -> (cached)', this.states.On);
        return this.states.On;
      }
    } catch (error) {
      // Fall back to cached state on any error
      this.platform.log.error(`Error in getOn: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.platform.log.debug('Get Characteristic On -> (cached due to error)', this.states.On);
      return this.states.On;
    }

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    // Note: The Python script doesn't include brightness control functionality
    // This is a placeholder implementation that just stores the value
    this.states.Brightness = value as number;

    this.platform.log.debug('Set Characteristic Brightness -> ', value);
    this.platform.log.warn('Brightness control is not implemented for this device');
  }
}