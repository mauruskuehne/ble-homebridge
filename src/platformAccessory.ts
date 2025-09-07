import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SchneiderBLELampsPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SchneiderBLELampsAccessory {
  private service: Service;
  private peripheral: any;
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
    // Get the peripheral from the accessory context
    this.peripheral = this.accessory.context.device.peripheral;
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Schneider Electric')
      .setCharacteristic(this.platform.Characteristic.Model, 'BLE Lamp')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.uniqueId);

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

    // Set up peripheral event handlers
    this.setupPeripheralEventHandlers();
  }

  /**
   * Set up peripheral event handlers
   */
  private setupPeripheralEventHandlers(): void {
    this.peripheral.on('connect', () => {
      this.isConnected = true;
      this.platform.log.info(`Connected to lamp: ${this.accessory.displayName}`);
    });

    this.peripheral.on('disconnect', () => {
      this.isConnected = false;
      this.platform.log.info(`Disconnected from lamp: ${this.accessory.displayName}`);
    });

    // Connect to the peripheral
    this.connectToDevice();
  }

  /**
   * Connect to the BLE device
   */
  private async connectToDevice(): Promise<void> {
    try {
      if (!this.platform.bleController.getIsConnected() ||
          this.platform.bleController.getPeripheral()?.address !== this.peripheral.address) {
        await this.platform.bleController.connect(this.peripheral);
      }
    } catch (error) {
      this.platform.log.error(`Failed to connect to lamp: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    try {
      const isOn = value as boolean;
      
      // Ensure we're connected to the device
      if (!this.platform.bleController.getIsConnected() ||
          this.platform.bleController.getPeripheral()?.address !== this.peripheral.address) {
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
        this.platform.log.error(`Failed to set lamp state to ${isOn}`);
        // Revert the state in HomeKit if the command failed
        setTimeout(() => {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.states.On);
        }, 100);
      }
    } catch (error) {
      this.platform.log.error(`Error in setOn: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Revert the state in HomeKit if there was an error
      setTimeout(() => {
        this.service.updateCharacteristic(this.platform.Characteristic.On, this.states.On);
      }, 100);
    }
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
    // Return the cached state
    const isOn = this.states.On;

    this.platform.log.debug('Get Characteristic On ->', isOn);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return isOn;
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
