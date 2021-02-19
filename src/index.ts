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
  let sentMetaDevices: any = {}
  let connection: any
  let socket: any
  let pollInterval: any
  let putsRegistred: any = {}
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
      if (browser) {
        browser.stop()
        browser = undefined
      }
      putsRegistred = {}
      sentMetaDevices = {}
      devicesCache = undefined
    },

    id: 'signalk-sonoff-ewelink',
    name: 'Sonoff/eWeLink',
    description: 'Signal K Plugin For Sonoff/eWeLink devices',
    
    schema: () => {
      const schema:any = {
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
      
      if ( devicesCache ) {
        devicesCache.forEach((device:any) => {
          if ( device.params.switches ) {
            const devSchema:any = {
              type: 'object',
              properties: {
                deviceName: {
                  type: 'string',
                  title: 'Name',
                  default: device.name,
                  readOnly: true
                },
                bankPath: {
                  type: 'string',
                  title: 'Bank Path',
                  default: device.name,
                  description: 'Used to generate the path name, ie. electrical.switches.${bankPath}.0.state'
                }
              }
            }
            schema.properties[`Device ID ${device.deviceid}`] = devSchema

            device.params.switches.forEach((sw:any) => {
              devSchema.properties[`Channel ${sw.outlet}`] = {
                type: 'object',
                title: `Channel ${sw.outlet+1}`,
                properties: {
                  displayName: {
                    type: 'string',
                    title: 'Display Name (meta)',
                  },
                  switchPath: {
                    type: 'string',
                    title: 'Switch Path',
                    default: '' + sw.outlet,
                    description: 'Used to generate the path name, ie. electrical.switches.bank.${switchPath}.state'
                  }
                }
              }
            })
          } else {
            schema.properties[`${device.deviceid}`] = {
              type: 'object',
              properties: {
                deviceName: {
                  type: 'string',
                  title: 'Name',
                  default: device.name,
                  readOnly: true
                },
                displayName: {
                  type: 'string',
                  title: 'Display Name (meta)',
                },
                switchPath: {
                  type: 'string',
                  title: 'Switch Path',
                  default: device.name,
                  description: 'Used to generate the path name, ie electrical.switches.${switchPath}.state'
                }
              }
            }
          }
        })
      }
      return schema
    }
  }
  
  async function openConnection () {
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

        connection = new ewelink({ devicesCache, arpTable })

        getDevices(devicesCache, false)
        
        debug('starting dnsd browser...')
        browser = dnssd
          .Browser(dnssd.tcp('ewelink'))
          .on('serviceUp', dnsdChanged)
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
              devicesCache = devices
              getDevices(devices, true)
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
                    sendDeltas(data, data.params)
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

  function getDevices (devices: any, doSendDeltas:boolean) {
    devices.forEach((device: any) => {
      if (device.params && (device.params.switches || device.params.switch)) {
        const devicePath = `electrical.switches.${camelCase(device.name)}`

        if (device.params.switches) {
          device.params.switches.forEach((channel: any) => {
            const switchPath = getBankSwitchPath(device, channel.outlet)
            if (!putsRegistred[switchPath]) {
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
              putsRegistred[switchPath] = true
            }
          })
        } else {
          const switchPath = getSwitchPath(device)
          if (!putsRegistred[switchPath]) {
            app.registerPutHandler(
              'vessels.self',
              switchPath,
              (context: string, path: string, value: any, cb: any) => {
                return switchHandler(context, path, value, device.deviceid, cb)
              }
            )
            putsRegistred[switchPath] = true
          }
        }
        if ( doSendDeltas ) {
          sendDeltas(device, device.params)
        }
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

  function sendMeta(device:any) {
    let meta:any = []

    if (device.params.switches) {
      device.params.switches.forEach((channel: any) => {
        const bankConfig = props[`Device ID ${device.deviceid}`] || {}
        const config = bankConfig[`Channel ${channel.outlet}`] || {}
        meta.push({
          path: getBankSwitchPath(device, channel.outlet),
          value: { displayName: config.displayName, units: 'bool' }
        })
      })
    } else if (device.params.switch) {
      const config = props[`Device ID ${device.deviceid}`] || {}
      meta.push( {
        path: getSwitchPath(device),
        value: { displayName: config.displayName, units: 'bool' }
      })
    }

    if (meta.length) {
      debug('sending meta: %j', meta)
      app.handleMessage(plugin.id, {
        updates: [
          {
            meta
          }
        ]
      })
    }
  }

  function sendDeltas (device: any, params: any) {
    let values

    if ( !sentMetaDevices[device.deviceid] ) {
      sendMeta(device)
      sentMetaDevices[device.deviceid] = true
    }

    if (params.switches) {
      values = params.switches.map((channel: any) => {
        return {
          path: getBankSwitchPath(device, channel.outlet),
          value: channel.switch === 'on' ? 1 : 0
        }
      })
    } else if (params.switch) {
      values = [
        {
          path: getSwitchPath(device),
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

  function getCachedDevice (deviceid: string) {
    return devicesCache.find((device: any) => device.deviceid == deviceid)
  }

  function findArpTableEntry (mac: string) {
    return arpTable.find((entry: any) => entry.mac == mac)
  }

  function updateIPAddress (deviceid: string, service: any) {
    if (service.addresses && service.addresses.length > 0) {
      const device = getCachedDevice(deviceid)
      if (device) {
        const mac = device.extra.extra.staMac.toLowerCase()
        const arp = findArpTableEntry(mac)
        if (arp) {
          arp.ip = service.addresses[0]
        } else {
          arpTable.push({ ip: service.addresses[0], mac })
        }
      }
    }
  }

  function dnsdChanged (service: any) {
    const deviceid = service.txt.id
    const iv = service.txt.iv

    debug('got dnsd for device %s (id:%s)', service.name, deviceid)

    const device = getCachedDevice(deviceid)
    if (!device) {
      const msg = 'new device found, please restart the plugin'
      error(msg)
      app.setPluginError(msg)
    }
    updateIPAddress(deviceid, service)
    try {
      const info = decryptMessage(service.txt, device.devicekey, iv)
      sendDeltas(device, info)
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

  function getSwitchPath(device:any) {
    const config = props[`Device ID ${device.deviceid}`] || {}
    return `electrical.switches.${config.switchPath || device.name}.state`
  }

  function getBankSwitchPath(device:any, channel:number) {
    const bankConfig = props[`Device ID ${device.deviceid}`] || {}
    const config = bankConfig[`Channel ${channel}`] || {}
    return `electrical.switches.${bankConfig.bankPath || device.name}.${config.switchPath || channel}.state`
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
