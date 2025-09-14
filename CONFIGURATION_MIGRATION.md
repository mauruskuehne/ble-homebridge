# Configuration Migration Guide

## Overview

The plugin has been updated to use configured device addresses instead of scanning for devices. This provides better reliability and faster startup times.

## Old Configuration (Scanning-based)

```json
{
  "name": "Schneider BLE Lamps",
  "platform": "SchneiderBLELamps",
  "scanDuration": 10,
  "deviceFilter": "Schneider",
  "autoReconnect": true,
  "debug": false
}
```

## New Configuration (Address-based)

```json
{
  "name": "Schneider BLE Lamps",
  "platform": "SchneiderBLELamps",
  "devices": [
    {
      "name": "Living Room Lamp",
      "address": "AA:BB:CC:DD:EE:FF"
    },
    {
      "name": "Bedroom Lamp", 
      "address": "11:22:33:44:55:66"
    }
  ],
  "autoReconnect": true,
  "maxReconnectionAttempts": 10,
  "connectionMonitorInterval": 10,
  "initialReconnectionDelay": 1000,
  "debug": false
}
```

## Configuration Parameters

### Required Parameters

- **name**: Platform name (string)
- **platform**: Must be "SchneiderBLELamps" (string)
- **devices**: Array of device configurations (array)
  - **name**: Display name for the device in HomeKit (string)
  - **address**: BLE MAC address in format AA:BB:CC:DD:EE:FF (string)

### Optional Parameters

- **autoReconnect**: Enable automatic reconnection (boolean, default: true)
- **maxReconnectionAttempts**: Maximum reconnection attempts (number, default: 10)
- **connectionMonitorInterval**: Connection health check interval in seconds (number, default: 10)
- **initialReconnectionDelay**: Initial delay before reconnection in milliseconds (number, default: 1000)
- **debug**: Enable debug logging (boolean, default: false)

## How to Find Device Addresses

You can find BLE device addresses using various methods:

1. **Using the old plugin version**: Enable debug logging and check the logs for discovered device addresses
2. **Using system tools**:
   - **macOS**: Use `system_profiler SPBluetoothDataType` or Bluetooth Explorer
   - **Linux**: Use `hcitool lescan` or `bluetoothctl`
   - **Windows**: Use Device Manager or PowerShell commands

## Migration Steps

1. Note down the BLE addresses of your devices (from logs or system tools)
2. Update your Homebridge configuration to use the new format
3. Restart Homebridge
4. Your devices should now connect directly without scanning

## Benefits of the New Approach

- **Faster startup**: No need to wait for device scanning
- **More reliable**: Direct connection to known devices
- **Better control**: Explicit device management
- **Reduced interference**: No continuous scanning affecting other BLE devices