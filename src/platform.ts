import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { SchneiderBLELampsAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { BLEController } from './bleController.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SchneiderBLELampsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  
  // BLE controller for handling device communication
  public readonly bleController: BLEController;
  
  // Map to store peripherals by address to avoid circular references
  private readonly peripheralsByAddress: Map<string, unknown> = new Map();

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    // Initialize BLE controller
    this.bleController = new BLEController(this.log);

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      
      try {
        // Initialize BLE controller
        await this.bleController.init();
        this.log.info('BLE controller initialized successfully');
        
        // run the method to discover / register your devices as accessories
        await this.discoverDevices();
      } catch (error) {
        this.log.error(`Failed to initialize BLE controller: ${error instanceof Error ? error.message : 'Unknown error'}`);
        this.log.error('Please make sure Bluetooth is enabled and you have the necessary permissions.');
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    try {
      // Get configuration options
      const scanDuration = (this.config.scanDuration as number) || 10;
      const deviceFilter = (this.config.deviceFilter as string) || 'Schneider';
      const debug = (this.config.debug as boolean) || false;
      
      // Clear the peripherals map before scanning
      this.peripheralsByAddress.clear();
      
      if (debug) {
        this.log.debug('Configuration:', {
          scanDuration,
          deviceFilter,
          autoReconnect: this.config.autoReconnect,
          debug,
        });
      }

      // Scan for BLE devices
      this.log.info(`Scanning for BLE devices for ${scanDuration} seconds...`);
      const devices = await this.bleController.scanDevices(scanDuration);
      
      if (devices.length === 0) {
        this.log.warn('No BLE devices found during scan');
        return;
      }

      this.log.info(`Found ${devices.length} BLE devices`);

      // Filter for Schneider BLE lamps based on configuration
      const lampDevices = devices.filter(device => {
        const name = device.advertisement?.localName;
        if (!name) {
          return false;
        }
        
        // Use the device filter from configuration (case-insensitive)
        return name.toLowerCase().includes(deviceFilter.toLowerCase());
      });

      // Store peripherals by address for later use
      for (const device of lampDevices) {
        this.peripheralsByAddress.set(device.address, device);
      }

      if (lampDevices.length === 0) {
        this.log.warn('No Schneider BLE lamps found during scan');
        return;
      }

      this.log.info(`Found ${lampDevices.length} Schneider BLE lamps`);

      // loop over the discovered devices and register each one if it has not already been registered
      for (const device of lampDevices) {
        this.log.debug('Processing discovered device:', {
          address: device.address,
          localName: device.advertisement?.localName,
          rssi: device.rssi,
        });

        // generate a unique id for the accessory using the device address
        const uuid = this.api.hap.uuid.generate(device.address);
        this.log.debug(`Generated UUID for device ${device.address}: ${uuid}`);
        
        // create a device object with the necessary information
        const deviceInfo = {
          uniqueId: device.address,
          displayName: device.advertisement?.localName || `Schneider Lamp ${device.address.substring(device.address.length - 4)}`,
          // Store the device address in context for later use
          address: device.address,
          // Also store a copy directly in the context for easier access
          deviceAddress: device.address,
        };

        this.log.debug('Created device info:', deviceInfo);

        // Debug: Log all cached accessories
        this.log.debug(`Total cached accessories: ${this.accessories.size}`);
        for (const [cachedUuid, cachedAccessory] of this.accessories) {
          this.log.debug(`Cached accessory: UUID=${cachedUuid}, Name=${cachedAccessory.displayName}, Context=${JSON.stringify(cachedAccessory.context)}`);
        }

        // see if an accessory with the same uuid has already been registered and restored from
        // the cached devices we stored in the `configureAccessory` method above
        const existingAccessory = this.accessories.get(uuid);
        this.log.debug(`Looking for existing accessory with UUID ${uuid}: ${existingAccessory ? 'FOUND' : 'NOT FOUND'}`);

        if (existingAccessory) {
          // the accessory already exists
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
          this.log.debug('Existing accessory context before update:', JSON.stringify(existingAccessory.context, null, 2));

          // update the accessory context with the current peripheral
          // Make sure to preserve the device address from the discovered device
          existingAccessory.context.device = {
            ...existingAccessory.context.device,
            ...deviceInfo,
            // Ensure the address is properly set from the discovered device
            address: device.address,
            deviceAddress: device.address,
          };
          
          this.log.debug('Existing accessory context after update:', JSON.stringify(existingAccessory.context, null, 2));
          this.api.updatePlatformAccessories([existingAccessory]);

          // create the accessory handler for the restored accessory
          new SchneiderBLELampsAccessory(this, existingAccessory);
        } else {
          // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new accessory:', deviceInfo.displayName);
          this.log.debug('Creating new accessory with device info:', deviceInfo);

          // create a new accessory
          const accessory = new this.api.platformAccessory(deviceInfo.displayName, uuid);

          // store a copy of the device object in the `accessory.context`
          // the `context` property can be used to store any data about the accessory you may need
          accessory.context.device = deviceInfo;
          
          this.log.debug('New accessory context:', JSON.stringify(accessory.context, null, 2));

          // create the accessory handler for the newly create accessory
          new SchneiderBLELampsAccessory(this, accessory);

          // link the accessory to your platform
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          
          // Add to our accessories map
          this.accessories.set(uuid, accessory);
        }

        // push into discoveredCacheUUIDs
        this.discoveredCacheUUIDs.push(uuid);
        this.log.debug(`Added UUID ${uuid} to discoveredCacheUUIDs. Total discovered: ${this.discoveredCacheUUIDs.length}`);
      }

      // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
      // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
      // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
      for (const [uuid, accessory] of this.accessories) {
        if (!this.discoveredCacheUUIDs.includes(uuid)) {
          this.log.info('Removing existing accessory from cache:', accessory.displayName);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (error) {
      this.log.error(`Error discovering devices: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (error instanceof Error && error.stack) {
        this.log.error(`Error stack: ${error.stack}`);
      }
      this.log.error('This error might be related to BLE initialization or device scanning.');
    }
  }

  /**
   * Get a peripheral by its address
   * @param address - The BLE address of the peripheral
   * @returns The peripheral object or undefined if not found
   */
  public getPeripheralByAddress(address: string): unknown {
    return this.peripheralsByAddress.get(address);
  }
}
