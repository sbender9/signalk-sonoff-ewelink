/*
 * Copyright 2021 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const camelCase = require('camelcase')
const ewelink = require('ewelink-api-sbender9')
const Zeroconf = require('ewelink-api-sbender9/src/classes/Zeroconf')
const { decryptionData } = require('ewelink-api-sbender9/src/helpers/ewelink')
const path = require('path')
const dnssd = require('dnssd2')

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaPaths: any = {}
  let connection: any
  let idToPath: any
  let socket: any
  let pollInterval: any
  let putsRegistred: any = []
  let devicesCache: any
  let arpTable: any = []
  let props: any
  let browser: any

  const plugin: Plugin = {
    start: function (properties: any) {
      props = properties
      if (
        !props.userName ||
        props.userName.length === 0 ||
        !props.password ||
        props.password.length === 0
      ) {
        app.setPluginError('please configure username and password')
        return
      }

      openConnection()
    },

    stop: function () {
      if (socket) {
        socket.close()
        socket = undefined
      }
      if ( browser ) {
        browser.stop()
        browser = undefined
      }
      putsRegistred = []
      devicesCache = undefined
    },

    id: 'signalk-sonoff-ewelink',
    name: 'Sonoff/eWeLink',
    description: 'Signal K Plugin For Sonoff/eWeLink devices',
    schema: {
      type: 'object',
      properties: {
        userName: {
          type: 'string',
          title: 'User Name',
          description: 'eWeLink User Name'
        },
        password: {
          type: 'string',
          title: 'Password',
          description: 'eWeLink Password'
        },
        region: {
          type: 'string',
          title: 'Region',
          description: 'eWeLink Region',
          default: 'us'
        },
        lanMode: {
          type: 'boolean',
          title: 'Use LAN Mode',
          default: true
        }
      }
    }
  }

  async function openConnection () {
    idToPath = {}

    if (props.lanMode) {
      connection = new ewelink({
        email: props.userName,
        password: props.password,
        region: props.region
      })

      try {
        const deviceCachePath = path.join(
          app.getDataDirPath(),
          'devices-cache.json'
        )

        debug('saving device cache...')
        try {
          await connection.saveDevicesCache(deviceCachePath)
        } catch (err) {
          error(err)
        }
        devicesCache = await Zeroconf.loadCachedDevices(deviceCachePath)
        if (devicesCache.error) {
          error(devicesCache.error)
          app.setPluginError(devicesCache.error)
          return
        }

        /*
        const arpTablePath = path.join(app.getDataDirPath(), 'arp-table.json')
        debug('saving arp table...')
        await Zeroconf.saveArpTable({
          file: arpTablePath,
          ip: '192.168.3.1>'
        });
        const arpTable = await Zeroconf.loadArpTable(arpTablePath);
        */

        connection = new ewelink({ devicesCache, arpTable })
        //connection.deviceIPs = {}
        getDevices(devicesCache)

        debug('starting dnsd browser...')
        browser = dnssd
          .Browser(dnssd.tcp('ewelink'))
          .on('serviceUp', dnsdUp)
          .on('serviceChanged', dnsdChanged)
          .start()
      } catch (err) {
        error(err)
        app.setPluginError(err.message)
      }
    } else {
      connection = new ewelink({
        email: props.userName,
        password: props.password,
        region: props.region
      })

      connection
        .getCredentials()
        .then(() => {
          app.setPluginStatus('Connected to Cloud')

          connection
            .getDevices()
            .then((devices: any) => {
              getDevices(devices)
            })
            .catch((err: any) => {
              error(err)
              app.setPluginError(err.message)
            })

          connection
            .openWebSocket((dataString: any) => {
              app.debug(dataString)
              if (dataString === 'pong') {
                return
              }

              const data = JSON.parse(dataString)
              if (data.action) {
                if (data.action === 'update') {
                  if (data.params) {
                    sendDeltas(data.deviceid, data.params)
                  }
                }
              }
            })
            .then((sock: any) => {
              socket = sock

              socket.onclose = (err: any) => {
                error('web socket closed: ' + err)
              }
            })
            .catch((err: any) => {
              error(err)
              app.setPluginError(err.message)
            })
        })
        .catch((err: any) => {
          error(err)
          app.setPluginError(err.message)
          app.setPluginStatus('retrying...')
          setTimeout(() => {
            openConnection()
          }, 5000)
        })
    }
  }

  function getDevicesState () {
    Object.keys(idToPath).forEach((deviceid: any) => {
      connection
        .getWSDevicePowerState(deviceid, { allChannels: true })
        .then((status: any) => {
          sendDeltasFromState(deviceid, status)
        })
        .catch((err: any) => {
          error(err)
          app.setPluginError(err.message)
        })
    })
  }

  function getDevices (devices: any) {
    devices.forEach((device: any) => {
      if (device.params && (device.params.switches || device.params.switch)) {
        const devicePath = `electrical.switches.${camelCase(device.name)}`

        idToPath[device.deviceid] = devicePath

        if (device.params.switches) {
          device.params.switches.forEach((channel: any) => {
            const switchPath = `${devicePath}.${channel.outlet}.state`
            if (putsRegistred.indexOf(switchPath) === -1) {
              app.registerPutHandler(
                'vessels.self',
                switchPath,
                (context: string, path: string, value: any, cb: any) => {
                  return bankHandler(
                    context,
                    path,
                    value,
                    device.deviceid,
                    channel.outlet,
                    cb
                  )
                }
              )
              putsRegistred.push(switchPath)
            }
          })
        } else {
          const switchPath = `${devicePath}.state`
          if (putsRegistred.indexOf(switchPath) === -1) {
            app.registerPutHandler(
              'vessels.self',
              switchPath,
              (context: string, path: string, value: any, cb: any) => {
                return switchHandler(context, path, value, device.deviceid, cb)
              }
            )
          }
        }
        sendDeltas(device.deviceid, device.params)
      }
    })
  }

  function setBankPowerState (deviceid: any, state: boolean, outlet: any) {
    const stateStr = state ? 'on' : 'off'
    if (props.lanMode) {
      return connection.setDevicePowerState(deviceid, stateStr, outlet + 1)
    } else {
      return connection.setWSDevicePowerState(deviceid, stateStr, {
        channel: outlet + 1
      })
    }
  }

  function bankHandler (
    context: string,
    path: string,
    value: any,
    deviceid: any,
    outlet: any,
    cb: any
  ) {
    const state = value === 1 || value === 'on' || value === 'true'
    setBankPowerState(deviceid, state, outlet)
      .then((status: any) => {
        debug('set status outlet %d %j: ', outlet, status)
        cb({
          state: 'COMPLETED',
          statusCode: status.status === 'ok' ? 200 : 400
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  function setPowerState (deviceid: any, state: boolean) {
    const stateStr = state ? 'on' : 'off'
    if (props.lanMode) {
      return connection.setDevicePowerState(deviceid, stateStr)
    } else {
      return connection.setWSDevicePowerState(deviceid, stateStr)
    }
  }

  function switchHandler (
    context: string,
    path: string,
    value: any,
    deviceid: any,
    cb: any
  ) {
    const state = value === 1 || value === 'on' || value === 'true'
    setPowerState(deviceid, state)
      .then((status: any) => {
        debug('set status: %j', status)
        cb({
          state: 'COMPLETED',
          statusCode: status.status === 'ok' ? 200 : 400
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  function sendDeltas (deviceid: string, params: any) {
    const devicePath = idToPath[deviceid]
    let values

    if (params.switches) {
      values = params.switches.map((channel: any) => {
        return {
          path: `${devicePath}.${channel.outlet}.state`,
          value: channel.switch === 'on' ? 1 : 0
        }
      })
    } else if (params.switch) {
      values = [
        {
          path: `${devicePath}.state`,
          value: params.switch === 'on' ? 1 : 0
        }
      ]
    }

    if (values) {
      app.handleMessage(plugin.id, {
        updates: [
          {
            values
          }
        ]
      })
    }
  }

  function sendDeltasFromState (deviceid: any, status: any) {
    const devicePath = idToPath[deviceid]
    let values

    if (typeof status.state !== 'string') {
      values = status.state.map((sw: any) => {
        return {
          path: `${devicePath}.${sw.channel - 1}.state`,
          value: sw.state === 'on' ? 1 : 0
        }
      })
    } else if (status.state) {
      values = [
        {
          path: `${devicePath}.state`,
          value: status.state === 'on' ? 1 : 0
        }
      ]
    }

    if (values) {
      app.handleMessage(plugin.id, {
        updates: [
          {
            values
          }
        ]
      })
    }
  }

  function getCachedDevice (deviceid: string) {
    return devicesCache.find((device: any) => device.deviceid == deviceid)
  }

  function findArpTableEntry (mac: string) {
    return arpTable.find((entry: any) => entry.mac == mac)
  }

  function updateIPAddress(deviceid:string, service:any) {
    if (service.addresses && service.addresses.length > 0) {
      //connection.deviceIPs[deviceid] = service.addresses[0]
      const device = getCachedDevice(deviceid)
      if ( device ) {
        const mac = device.extra.extra.staMac.toLowerCase()
        const arp = findArpTableEntry(mac)
        if ( arp ) {
          arp.ip = service.addresses[0]
        } else {
          arpTable.push({ ip: service.addresses[0], mac})
        }
      }
    }
  }
  
  function dnsdUp (service: any) {
    const deviceid = service.txt.id
    debug('found device %s (%s)', service.name, deviceid)
    updateIPAddress(deviceid, service)
  }

  function dnsdChanged (service: any) {
    const deviceid = service.txt.id
    const iv = service.txt.iv

    debug('got dnsd change for device %s', deviceid)

    const device = getCachedDevice(deviceid)
    if (!device) {
      const msg = 'new device found, please restart the plugin'
      error(msg)
      app.setPluginError(msg)
    }
    updateIPAddress(deviceid, service)
    try {
      const info = decryptMessage(service.txt, device.devicekey, iv)
      sendDeltas(deviceid, info)
    } catch (err) {
      error(err)
      app.setPluginError('unable to decrypt mdns data')
    }
  }

  function decryptMessage (msg: any, deviceKey: string, iv: any) {
    let encoded = ''
    for (let i = 1; i < 6; i++) {
      let part = msg[`data${i}`]
      if (part) {
        encoded = encoded + part
      }
    }

    return JSON.parse(decryptionData(encoded, deviceKey, iv))
  }

  return plugin
}

interface Plugin {
  start: (app: any) => void
  stop: () => void
  id: string
  name: string
  description: string
  schema: any
}
