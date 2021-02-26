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
const fs = require('fs')

let mdns: any

try {
  mdns = require('mdns')
} catch (err) {}

const APP_ID = 'oeVkj2lYFGnJu5XUtWisfW4utiN4u9Mq'
const APP_SECRET = '6Nz4n0xA8s8qdxQf2GqurZj2Fs55FUvM'

//const APP_ID_WS = 'YzfeftUVcZ6twZw1OoVKPRFYTrGEg01Q'
//const APP_SECRET_WS = '4G91qSoboqYO4Y0XJ0LPPKIsq8reHdfa'

const APP_ID_WS = APP_ID
const APP_SECRET_WS = APP_SECRET

const pingTime = 120000
//const pingTime = 10000

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaDevices: any = {}
  let lanConnection: any
  let cloudConnection: any
  let anyCloudOnlyDevices: boolean
  let cloudOnlyByDevice: any = {}
  let socket: any
  let pollInterval: any
  let putsRegistred: any = {}
  let devicesCache: any
  let arpTable: any = []
  let arpTablePath: string
  let props: any
  let browser: any
  let wsTimer: any
  let wsPingInterval: any

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
      if ( wsTimer ) {
        clearTimeout(wsTimer)
        wsTimer = undefined
      }
      if ( wsPingInterval ) {
        clearInterval(wsPingInterval)
        wsPingInterval = undefined
      }
      putsRegistred = {}
      sentMetaDevices = {}
      devicesCache = undefined
      cloudOnlyByDevice = {}
    },

    id: 'signalk-sonoff-ewelink',
    name: 'Sonoff/eWeLink',
    description: 'Signal K Plugin For Sonoff/eWeLink devices',

    schema: () => {
      const schema: any = {
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
          },
          useMdns: {
            type: 'boolean',
            title: 'Use MDNS Package If available',
            default: false
          }
        }
      }

      if (devicesCache) {
        devicesCache.forEach((device: any) => {
          if (device.params.switches) {
            const devSchema: any = {
              type: 'object',
              properties: {
                deviceName: {
                  type: 'string',
                  title: 'Name',
                  default: device.name,
                  readOnly: true
                },
                enabled: {
                  type: 'boolean',
                  title: 'Enabled',
                  default: true
                },
                bankPath: {
                  type: 'string',
                  title: 'Bank Path',
                  default: camelCase(device.name),
                  description:
                    'Used to generate the path name, ie. electrical.switches.${bankPath}.0.state'
                },
                forceCloudMode: {
                  type: 'boolean',
                  title: 'Force Cloud Mode',
                  default: false,
                  description:
                    'Use the cloud for this device even if LAN mode is on'
                }
              }
            }
            schema.properties[`Device ID ${device.deviceid}`] = devSchema

            device.params.switches.forEach((sw: any) => {
              const name = device.tags?.ck_channel_name
                ? device.tags.ck_channel_name[sw.outlet.toString()]
                : sw.outlet.toString()

              devSchema.properties[`Channel ${sw.outlet}`] = {
                type: 'object',
                title: `Channel ${sw.outlet + 1}`,
                properties: {
                  displayName: {
                    type: 'string',
                    title: 'Display Name (meta)',
                    default: name
                  },
                  abbrev: {
                    type: 'string',
                    title: 'Abbreviated Name (meta)'
                  },
                  enabled: {
                    type: 'boolean',
                    title: 'Enabled',
                    default: true
                  },
                  switchPath: {
                    type: 'string',
                    title: 'Switch Path',
                    default: camelCase(name),
                    description:
                      'Used to generate the path name, ie. electrical.switches.bank.${switchPath}.state'
                  }
                }
              }
            })
          } else {
            schema.properties[`Device ID ${device.deviceid}`] = {
              type: 'object',
              properties: {
                deviceName: {
                  type: 'string',
                  title: 'Name',
                  default: device.name,
                  readOnly: true
                },
                enabled: {
                  type: 'boolean',
                  title: 'Enabled',
                  default: true
                },
                displayName: {
                  type: 'string',
                  title: 'Display Name (meta)',
                  default: device.name
                },
                abbrev: {
                  type: 'string',
                  title: 'Abbreviated Name (meta)'
                },
                switchPath: {
                  type: 'string',
                  title: 'Switch Path',
                  default: camelCase(device.name),
                  description:
                    'Used to generate the path name, ie electrical.switches.${switchPath}.state'
                },
                forceCloudMode: {
                  type: 'boolean',
                  title: 'Force Cloud Mode',
                  default: false,
                  description:
                    'Use the cloud for this device even if LAN mode is on'
                }
              }
            }
            if (device.uiid == l1Light) {
              schema.properties[
                `Device ID ${device.deviceid}`
              ].properties.presets = {
                title: 'Presets',
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      title: 'Name'
                    },
                    colorR: {
                      type: 'number',
                      title: 'Red',
                      default: 255
                    },
                    colorG: {
                      type: 'number',
                      title: 'Green',
                      default: 255
                    },
                    colorB: {
                      type: 'number',
                      title: 'Blue',
                      default: 255
                    },
                    bright: {
                      type: 'number',
                      title: 'Brightness',
                      description:
                        'Number between 1-100. Set to 0 to preserve current brightness',
                      default: 100
                    }
                  }
                }
              }
            }
          }
        })
      }
      return schema
    },

    uiSchema: () => {
      const uiSchema: any = {
        password: {
          'ui:widget': 'password'
        }
      }
      if (devicesCache) {
        devicesCache.forEach((device: any) => {
          uiSchema[`Device ID ${device.deviceid}`] = {
            'ui:field': 'collapsible',
            collapse: {
              field: 'ObjectField',
              wrapClassName: 'panel-group'
            }
          }
        })
      }
      return uiSchema
    }
  }

  async function startLanMode () {
    try {
      const deviceCachePath = path.join(
        app.getDataDirPath(),
        'devices-cache.json'
      )
      arpTablePath = path.join(
        app.getDataDirPath(),
        'arp-table.json'
      )

      debug('saving device cache...')
      try {
        await cloudConnection.saveDevicesCache(deviceCachePath)
      } catch (err) {
        error(err)
      }

      if (!devicesCache) {
        devicesCache = await Zeroconf.loadCachedDevices(deviceCachePath)
        if (devicesCache.error) {
          error(devicesCache.error)
          app.setPluginError(devicesCache.error)
          return
        }
      }

      readArpTabel()

      lanConnection = new ewelink({
        devicesCache,
        arpTable,
        APP_ID,
        APP_SECRET
      })

      getDevices(devicesCache, false)

      debug('starting dnsd browser...')
      if (mdns && props.useMdns) {
        browser = mdns.createBrowser(mdns.tcp('ewelink'))
      } else {
        browser = dnssd.Browser(dnssd.tcp('ewelink'))
      }
      browser
        .on('serviceUp', dnsdChanged)
        .on('serviceChanged', dnsdChanged)
        .start()
    } catch (err) {
      error(err)
      app.setPluginError(err.message)
    }
  }

  async function openConnection () {
    cloudConnection = new ewelink({
      email: props.userName,
      password: props.password,
      region: props.region,
      APP_ID,
      APP_SECRET
    })

    try {
      await cloudConnection.getCredentials()

      let devices: any = await cloudConnection.getDevices()
      debug('found devices: %j', devices)
      devicesCache = devices
      getDevices(devices, true)
    } catch (err) {
      error(err)
    }

    if (props.lanMode) {
      await startLanMode()
    }

    if (devicesCache) {
      devicesCache.forEach((device: any) => {
        const switchProps = getDeviceProps(device)
        let cloudOnly: boolean =
          (!switchProps ||
            typeof switchProps.enabled === 'undefined' ||
            switchProps.enabled) &&
          (cloudOnlyHardware.indexOf(device.uiid) !== -1 ||
            switchProps?.forceCloudMode === true)
        cloudOnlyByDevice[device.deviceid] = cloudOnly
      })
      anyCloudOnlyDevices = devicesCache.find(
        (device: any) => cloudOnlyByDevice[device.deviceid] === true
      )

      if (props.lanMode && !anyCloudOnlyDevices) {
        app.setPluginStatus('Using LAN mode only')
      }

      if (!props.lanMode || anyCloudOnlyDevices) {
        try {
          openWebSocket()
        } catch ( err ) {
          error(err)
        }
      }
    }
  }

  async function openWebSocket() {
    cloudConnection = new ewelink({
      email: props.userName,
      password: props.password,
      region: props.region,
      APP_ID_WS,
      APP_SECRET_WS
    })

    debug('opening cloud web socket...')

    try {
      await cloudConnection.getCredentials()

      app.setPluginStatus('Connected to Cloud')

      socket = await cloudConnection
        .openWebSocket((data: any) => {
          if (typeof data === 'string') {
            debug('ws recv: ' +data)
            return
          } else {
            debug('ws recv: %j', data)
          }

          if (data.params && data.deviceid) {
            const device = getCachedDevice(data.deviceid)
            if (device) {
              const deviceProps = getDeviceProps(device)
              if (
                !deviceProps ||
                  typeof deviceProps === 'undefined' ||
                  deviceProps.enabled
              ) {
                sendDeltas(device, data.params)
              }
            } else {
              error(`unknown device: ${data.deviceid}`)
            }
          }
        })
      
      socket.onClose.addListener((err: any) => {
        error('web socket closed: ' + err.reason)
        wsTimer = setTimeout(() => {
          wsTimer = undefined
          clearInterval(wsPingInterval)
          wsPingInterval = undefined
          openWebSocket()
        }, 5000)
      })

      if ( wsPingInterval ) {
        clearInterval(wsPingInterval)
      }
      
      wsPingInterval = setInterval(async () => {
        try {
          debug('sending ping...')
          await socket.send('ping')
        } catch ( err ) {
          error(err)
        }
      }, pingTime)
    } catch (err) {
      error(err)
      app.setPluginError(err.message)
      wsTimer = setTimeout(() => {
        wsTimer = undefined
        openWebSocket()
      }, 5000)
    }
  }  

  function propHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    prop: string,
    cb: any,
    converter: any = null
  ) {
    let params: any = converter ? converter(value) : { [prop]: value }
    cloudConnection
      .setWSDeviceParams(device.deviceid, params)
      .then((status: any) => {
        cloudConnection.getWSDeviceStatus(device.deviceid)
        debug('got status: %j', status)
        cb({
          state: 'COMPLETED',
          statusCode: status.status === 'ok' ? 200 : 400,
          message: status.message
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  function registerPutProp (device: any, prop: string, converter: any = null) {
    const propPath = getSwitchPath(device, prop)

    app.registerPutHandler(
      'vessels.self',
      propPath,
      (context: string, path: string, value: any, cb: any) => {
        return propHandler(context, path, value, device, prop, cb, converter)
      }
    )
  }

  function presetHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    cb: any
  ) {
    const switchProps = getSwitchProps(device)
    const preset = switchProps.presets.find(
      (preset: any) => preset.name == value
    )
    if (value === 'Unknown' || !preset) {
      return {
        state: 'COMPLETED',
        statusCode: 400,
        message: `invalid value ${value}`
      }
    } else {
      const params: any = {
        colorR: preset.colorR,
        colorG: preset.colorG,
        colorB: preset.colorB,
        switch: 'on'
      }
      if (preset.bright !== 0) {
        params.bright = preset.bright
      }
      cloudConnection
        .setWSDeviceParams(device.deviceid, params)
        .then((status: any) => {
          cloudConnection.getWSDeviceStatus(device.deviceid)
          
          debug('got status: %j', status)
          cb({
            state: 'COMPLETED',
            statusCode: status.status === 'ok' ? 200 : 400,
            message: status.message
          })
        })
        .catch((err: any) => {
          error(err)
          app.setPluginError(err.message)
          cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
        })
      return { state: 'PENDING' }
    }
  }

  function filterEnabledDevices (devices: any) {
    return devices.filter((device: any) => {
      const deviceProps = getDeviceProps(device)
      return (
        !deviceProps ||
        typeof deviceProps.enabled === 'undefined' ||
        deviceProps.enabled
      )
    })
  }
  function getDevices (devices: any, doSendDeltas: boolean) {
    filterEnabledDevices(devices).forEach((device: any) => {
      if (device.params && (device.params.switches || device.params.switch)) {
        if (device.params.switches) {
          device.params.switches.forEach((channel: any) => {
            const switchProps = getSwitchProps(device, channel.outlet)
            if (switchProps?.enabled) {
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
                      device,
                      channel.outlet,
                      cb
                    )
                  }
                )
                putsRegistred[switchPath] = true
              }
            }
          })
        } else {
          const switchProps = getSwitchProps(device)
          if (switchProps?.enabled) {
            const switchPath = getSwitchPath(device)
            if (!putsRegistred[switchPath]) {
              app.registerPutHandler(
                'vessels.self',
                switchPath,
                (context: string, path: string, value: any, cb: any) => {
                  return switchHandler(context, path, value, device, cb)
                }
              )

              if (device.uiid === l1Light) {
                registerPutProp(device, 'mode', (value: any) => {
                  return { mode: Object.values(l1ModeMap).indexOf(value) + 1 }
                })
                registerPutProp(device, 'colorR')
                registerPutProp(device, 'colorG')
                registerPutProp(device, 'colorB')
                registerPutProp(device, 'dimmingLevel', (value: number) => {
                  return { bright: Number((value * 100).toFixed(0)) }
                })
                registerPutProp(device, 'speed')
                registerPutProp(device, 'sensitive')
                registerPutProp(device, 'light_type')

                const switchProps = getSwitchProps(device)

                if (switchProps.presets) {
                  app.registerPutHandler(
                    'vessels.self',
                    getSwitchPath(device, 'preset'),
                    (context: string, path: string, value: any, cb: any) => {
                      return presetHandler(context, path, value, device, cb)
                    }
                  )
                }

                putsRegistred[switchPath] = true
              }
            }
          }
        }
        if (doSendDeltas) {
          sendDeltas(device, device.params)
        }
      }
    })
  }

  async function setBankPowerState (device: any, state: boolean, outlet: any) {
    const stateStr = state ? 'on' : 'off'
    if (props.lanMode && !cloudOnlyByDevice[device.deviceid]) {
      return lanConnection.setDevicePowerState(
        device.deviceid,
        stateStr,
        outlet + 1
      )
    } else {
      let res =  await cloudConnection.setWSDevicePowerState(device.deviceid, stateStr, {
        channel: outlet + 1
      })
      cloudConnection.getWSDeviceStatus(device.deviceid)
      return res
    }
  }

  function bankHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    outlet: any,
    cb: any
  ) {
    const state = value === 1 || value === 'on' || value === 'true'
    setBankPowerState(device, state, outlet)
      .then((status: any) => {
        debug('got status outlet %d %j: ', outlet, status)
        cb({
          state: 'COMPLETED',
          statusCode: status.status === 'ok' ? 200 : 400,
          message: status.message
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  async function setPowerState (device: any, state: boolean) {
    const stateStr = state ? 'on' : 'off'
    if (props.lanMode && !cloudOnlyByDevice[device.deviceid]) {
      return lanConnection.setDevicePowerState(device.deviceid, stateStr)
    } else {
      let res = await cloudConnection.setWSDevicePowerState(device.deviceid, stateStr)
      cloudConnection.getWSDeviceStatus(device.deviceid)
      return res
    }
  }

  function switchHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    cb: any
  ) {
    const state = value === 1 || value === 'on' || value === 'true'
    setPowerState(device, state)
      .then((status: any) => {
        debug('set status: %j', status)
        cb({
          state: 'COMPLETED',
          statusCode: status.status === 'ok' ? 200 : 400,
          message: status.message
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  function sendMeta (device: any) {
    let meta: any = []

    if (device.params.switches) {
      device.params.switches.forEach((channel: any) => {
        const switchProps = getSwitchProps(device, channel.outlet)
        if (
          !switchProps ||
          typeof switchProps.enabled === 'undefined' ||
          switchProps.enabled
        ) {
          meta.push({
            path: getBankSwitchPath(device, channel.outlet),
            value: {
              displayName: switchProps?.displayName || device.name,
              abbrev: switchProps?.abbrev,
              units: 'bool',
              order: channel.outlet
            }
          })
          meta.push({
            path: getBankSwitchPath(device, channel.outlet, null),
            value: {
              displayName: switchProps?.displayName || device.name,
              abbrev: switchProps?.abbrev,
              order: channel.outlet
            }
          })
        }
      })
    } else if (device.params.switch) {
      const switchProps = getSwitchProps(device)
      if (
        !switchProps ||
        typeof switchProps.enabled === 'undefined' ||
        switchProps.enabled
      ) {
        let extras = {}

        if (device.uiid === l1Light) {
          extras = {
            type: 'dimmer',
            canDimWhenOff: true
          }
          meta.push({
            path: getSwitchPath(device, 'mode'),
            value: {
              enum: Object.values(l1ModeMap),
              possibleValues: Object.values(l1ModeMap).map((mode: any) => {
                return {
                  title: mode,
                  value: mode
                }
              })
            }
          })
          if (switchProps.presets) {
            meta.push({
              path: getSwitchPath(device, 'preset'),
              value: {
                displayName: switchProps?.displayName || device.name,
                possibleValues: [
                  ...switchProps.presets.map((preset: any) => {
                    return {
                      title: preset.name,
                      value: preset.name
                    }
                  }),
                  {
                    title: 'Unknown',
                    value: 'Unknown',
                    enabled: false
                  }
                ],
                enum: [
                  ...switchProps.presets.map((preset: any) => preset.name),
                  'Unknown'
                ]
              }
            })
          }
        }

        meta.push({
          path: getSwitchPath(device),
          value: {
            ...extras,
            displayName: switchProps?.displayName || device.name,
            abbrev: switchProps?.abbrev,
            units: 'bool'
          }
        })
        meta.push({
          path: getSwitchPath(device, null),
          value: {
            ...extras,
            displayName: switchProps?.displayName || device.name,
            abbrev: switchProps?.abbrev
          }
        })
      }
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

    if (!sentMetaDevices[device.deviceid]) {
      sendMeta(device)
      sentMetaDevices[device.deviceid] = true
    }

    device.params = { ...device.params, ...params }

    if (params.switches) {
      values = params.switches
        .map((channel: any) => {
          const switchProps = getSwitchProps(device, channel.outlet)
          if (
            !switchProps ||
            typeof switchProps.enabled === 'undefined' ||
            switchProps.enabled
          ) {
            return [
              {
                path: getBankSwitchPath(device, channel.outlet),
                value: channel.switch === 'on' ? 1 : 0
              },
              {
                path: getBankSwitchPath(device, channel.outlet, 'order'),
                value: channel.outlet
              }
            ]
          } else {
            return null
          }
        })
        .filter((kp: any) => kp != null)
      values = [].concat.apply([], values)
    } else {
      const switchProps = getSwitchProps(device)
      if (
        !switchProps ||
        typeof switchProps.enabled === 'undefined' ||
        switchProps.enabled
      ) {
        values = []
        if (params.switch) {
          values.push({
            path: getSwitchPath(device),
            value: params.switch === 'on' ? 1 : 0
          })
        }

        let addValue: any = (key: string, v: any) => {
          const val = typeof v !== 'undefined' ? v : params[key]
          if (typeof val !== 'undefined') {
            values.push({
              path: getSwitchPath(device, key),
              value: val
            })
          }
        }

        if (device.uiid === l1Light) {
          addValue('mode', l1ModeMap[params.mode])
          addValue('colorR')
          addValue('colorG')
          addValue('colorB')
          if (typeof params.bright !== 'undefined') {
            addValue('dimmingLevel', params.bright / 100.0)
          }
          addValue('speed')
          addValue('sensitive')
          addValue('light_type')

          if (switchProps.presets) {
            const preset = switchProps.presets.find((preset: any) => {
              return (
                device.params.colorR == preset.colorR &&
                device.params.colorG == preset.colorG &&
                device.params.colorB == preset.colorB &&
                (preset.bright === 0 || device.params.bright == preset.bright)
              )
            })
            values.push({
              path: getSwitchPath(device, 'preset'),
              value: preset?.name || 'Unknown'
            })
          }
        }
      }
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
        saveArpTable()
      }
    }
  }

  function readArpTabel() {
    try {
      const content = fs.readFileSync(arpTablePath)
      arpTable = JSON.parse(content)
    } catch( err ) {
      error(err)
    }
  }

  function saveArpTable() {
    try {
      fs.writeFileSync(arpTablePath, JSON.stringify(arpTable, null, 2))
    } catch ( err ) {
      error(err)
    }
  }
  
  function dnsdChanged (service: any) {
    const txt = service.txt || service.txtRecord
    if (!txt || !txt.id || !txt.iv) {
      error('invalid mdns record')
      error(JSON.stringify(service, null, 2))
    }
    const deviceid = txt.id
    const iv = txt.iv

    debug('got dnsd for device %s (id:%s)', service.name, deviceid)

    const device = getCachedDevice(deviceid)
    if (!device) {
      const msg = 'new device found, please restart the plugin'
      error(msg)
      app.setPluginError(msg)
      return
    }
    updateIPAddress(deviceid, service)
    try {
      const info = decryptMessage(txt, device.devicekey, iv)
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

  function getDeviceProps (device: any) {
    return props[`Device ID ${device.deviceid}`] || {}
  }

  function getSwitchProps (device: any, channel: any = undefined) {
    if (device.params.switches) {
      const bankConfig = props[`Device ID ${device.deviceid}`] || {}
      return bankConfig[`Channel ${channel}`]
    } else {
      return props[`Device ID ${device.deviceid}`] || {}
    }
  }

  function getSwitchPath (device: any, key: any = 'state') {
    const config = props[`Device ID ${device.deviceid}`] || {}
    return `electrical.switches.${config.switchPath || camelCase(device.name)}${
      key ? '.' + key : '' 
    }`
  }

  function getBankSwitchPath (
    device: any,
    channel: number,
    key: any = 'state'
  ) {
    const bankConfig = props[`Device ID ${device.deviceid}`] || {}
    let path = bankConfig[`Channel ${channel}`]?.switchPath
    let cloud = device.tags?.ck_channel_name
      ? device.tags?.ck_channel_name[channel.toString()]
      : undefined
    if (!path && cloud) {
      path = camelCase(cloud)
    }
    return `electrical.switches.${bankConfig.bankPath ||
      camelCase(device.name)}.${path || channel}${key ? '.' + key : ''}`
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
  uiSchema: any
}

const l1Light = 59

const cloudOnlyHardware = [l1Light]

const l1ModeMap: any = {
  1: 'Colorful',
  2: 'Colorful Gradient',
  3: 'Colorful Breath',
  4: 'DIY Gradient',
  5: 'DIY Pulse',
  6: 'DIY Breath',
  7: 'DIY Strobe',
  8: 'RGB Gradient',
  9: 'RGB Pulse',
  10: 'RGB Breath',
  11: 'RBG Strobe',
  12: 'Sync to music'
}
