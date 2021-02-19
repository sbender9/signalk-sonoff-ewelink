# signalk-sonoff-ewelink
Signal K Plugin For Sonoff/eWeLink devices

Support for eWeLink switches running the factory formware.

### Tested Hardware

- [Sonoff 4chpro r3](https://sonoff.tech/product/wifi-diy-smart-switches/4chr3-4chpror3)

### How it works

It should work with other Sonoff/eWeLink switches, but no others have been tested.

The plugin can use only the eWeLink cloud to communicate with the device, or it can use local LAN mode

The plugin must log in to the eWeLink cloud at least once to use local LAN mode (or if new devices are added).

Once it gets to the cloud once, local LAN mode will work without an internet connection.
