# signalk-sonoff-ewelink
Signal K Plugin For Sonoff/eWeLink devices

Support for eWeLink switches running the factory firmware.

Devices must first be added using the eWeLink app.

### Authentication Setup
To configure authentication, go to [http://ewelink.scottbender.net:8000/login] and enter your ewelink login information. 

The resulting page should look something like:

```
{
  "accessToken": "xxxx",
  "atExpiredTime": 1752868504748,
  "refreshToken": "xxxxx",
  "rtExpiredTime": 1755460504807,
  "region": "us"
}
```

Copy and paste this into the plugin configuration.

Note that you can only have one accessToken per ewelink account, so If you multiple sk servers running this, make sure you use the same auth info.


### Tested Hardware

- [Sonoff 4CH Pro R3](https://sonoff.tech/product/wifi-diy-smart-switches/4chr3-4chpror3)
- Sonoff 4CH Pro R2
- [Sonoff L1 Lite LED Strip](https://sonoff.tech/product/wifi-smart-lighting/l1-lite) (Cloud only)
- BASICR2

It should work with other Sonoff/eWeLink switches, but no others have been tested.

### How it works

The plugin can use the eWeLink cloud to communicate with the device, or it can use local LAN mode

The plugin must log in to the eWeLink cloud at least once to use local LAN mode (or if new devices are added).

Once it gets to the cloud once, local LAN mode will work without an internet connection.
