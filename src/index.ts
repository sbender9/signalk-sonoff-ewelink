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
const eWeLink = require('ewelink-api-next').default
const path = require('path')
const dnssd = require('dnssd2')
const fs = require('fs')
const crypto = require('crypto')

const nonce = (size: Number = 8): string =>
  Math.random()
    .toString(36)
    .slice(-size)

const fetch = require('node-fetch')

//the registered one
const APP_ID = 'SsgewdgY5EHXEFIx6wAsmqf7dBE71c8i'
const APP_SECRET = 'oqqaAV5qMu2AWRqkl6Df2GltfkDxuKse'

//const APP_ID = 'unD0YlKmlbBtUGkaOQt0OywX7sGmzHat'
//const APP_SECRET = 'NGMMshHMBCkWfy0Hwkiskw7iP07UHLGm'

const pingTime = 25000
//const pingTime = 120000
//const pingTime = 10000

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaDevices: any = {}
  let lanInfo: any
  let lanClient: any
  let client: any
  let wsClient: any
  let ws: any
  let lanConnection: any
  let cloudConnection: any
  let anyCloudOnlyDevices: boolean
  let cloudOnlyByDevice: any = {}
  let putsRegistred: any = {}
  let devicesCache: any
  let families: any
  let lanInfoPath: string
  let deviceCachePath: string
  let props: any
  let wsTimer: any
  let wsPingInterval: any
  let pending: any = {}
  let browser: any

  const plugin: Plugin = {
    start: function (properties: any) {
      props = properties
      openConnection()
    },

    stop: function () {
      wsClient = undefined
      client = undefined
      if (ws) {
        ws.close()
        ws = undefined
      }
      if (wsTimer) {
        clearTimeout(wsTimer)
        wsTimer = undefined
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
        required: ['authInfo'],
        properties: {
          authInfo: {
            type: 'string',
            lines: 10,
            title: 'Authentication Info',
            description: 'See plugin README'
          },
          lanMode: {
            type: 'boolean',
            title: 'Use LAN Mode',
            default: true
          }
        }
      }

      if (families) {
        schema.properties['family'] = {
          type: 'string',
          title: 'Family',
          enum: families.map((fam: any) => fam.id),
          enumNames: families.map((fam: any) => fam.name),
          default: families[0].id
        }
      }

      if (devicesCache) {
        devicesCache.forEach((device: any) => {
          if (device.params && device.params.switches) {
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
            if (device.extra.uiid == l1Light) {
              schema.properties[
                `Device ID ${device.deviceid}`
              ].properties.includeDYIModes = {
                title: 'Include DYI Modes in Presets',
                type: 'boolean',
                default: false
              }

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
        authInfo: {
          'ui:widget': 'textarea'
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

  async function openConnection () {
    /*    
    let token = '552c07ac410dccf046bf23c18248a3b34ca6763a'
    const resp = await fetch(`https://us-apia.coolkit.cc/v2/family`, {
      headers: {
        "X-CK-Appid": APP_ID,
        Authorization: "Bearer " + token,
        'Content-Type': 'application/json'
      }
      })

    console.log(JSON.stringify(resp, null, 2))
    const data = await resp.json();
    console.log(JSON.stringify(data, null, 2))
*/

    deviceCachePath = path.join(app.getDataDirPath(), 'devices-cache-v2.json')

    lanInfoPath = path.join(app.getDataDirPath(), 'lan-info.json')

    if (props.authInfo === undefined) {
      app.setPluginError(
        'Please enter your authentication info, See the Plugin README'
      )
      return
    }

    const tokenInfo = JSON.parse(props.authInfo)

    const logging = {
      info: (msg: any) => {
        app.debug(msg)
      },
      error: (msg: any) => {
        app.error(msg)
      }
    }

    const config = {
      region: tokenInfo.region,
      appId: APP_ID,
      secert: APP_SECRET,
      appSecert: APP_SECRET,
      logObj: logging
    }

    readDeviceCache()

    client = new eWeLink.WebAPI(config)

    client.at = tokenInfo.accessToken
    client.setUrl(tokenInfo.region)
    client.appSecret = APP_SECRET

    const currentTime = new Date().getTime()

    if (tokenInfo.atExpiredTime <= currentTime)
    {
      debug('token has expired, refreshing...')
      const resp = await client.user.refreshToken({rt: tokenInfo.refreshToken})
      if ( resp.error !== 0 ) {
        app.error(`error refreshing token: ${resp.msg}`)
      } else {
        debug('updating token info')
        
        tokenInfo.accessToken = resp.data.at
        tokenInfo.refreshToken = resp.data.rt
        client.at = resp.data.at

        if (resp.data.atExpiredTime) {
          tokenInfo.atExpiredTime = resp.data.atExpiredTime;
        } else {
          tokenInfo.atExpiredTime = currentTime + (24*60*60*1000*29);
        }
        if (resp.data.rtExpiredTime) {
          tokenInfo.rtExpiredTime = resp.data.rtExpiredTime;
        } else {
          tokenInfo.rtExpiredTime = currentTime + (24*60*60*1000*59);
        }
        
        props.authInfo = JSON.stringify(tokenInfo, null, 2)
        app.savePluginOptions(props, (err:any) => {
          if ( err ) {
            app.error(err)
          }
        })
      }
    }
    
    let fam

    let connectionFailed = false
    try {
      fam = await client.home.getFamily({})

      if (fam.error !== 0) {
        error(fam.msg)
        app.setPluginError(fam.msg)
      } else if (fam.data.familyList) {
        families = fam.data.familyList
      }

      debug('families: %s', JSON.stringify(fam, null, 2))

      let thingList = await client.device.getAllThingsAllPages({
        familyId: props.family
      })
      debug('things: %s', JSON.stringify(thingList, null, 2))

      if (thingList?.error === 0) {
        devicesCache = thingList.data.thingList.map((x: any) => x.itemData)
        saveDeviceCache()
      } else {
        error(thingList.msg)
        app.setPluginError(thingList.msg)
      }
    } catch (err:any) {
      error(err)
      app.setPluginError(err.message)
      connectionFailed = true
    }

    if (devicesCache) {
      getDevices(devicesCache, true)

      devicesCache.forEach((device: any) => {
        const switchProps = getDeviceProps(device)
        let cloudOnly: boolean =
          (!switchProps ||
            typeof switchProps.enabled === 'undefined' ||
            switchProps.enabled) &&
          (cloudOnlyHardware.indexOf(device.extra.uiid) !== -1 ||
            switchProps?.forceCloudMode === true)
        cloudOnlyByDevice[device.deviceid] = cloudOnly
      })
      anyCloudOnlyDevices = devicesCache.find(
        (device: any) => cloudOnlyByDevice[device.deviceid] === true
      )
    }

    let userApiKey
    if (devicesCache.length > 0) {
      userApiKey = devicesCache[0].apikey
    }

    if (!connectionFailed) {
      wsClient = new eWeLink.Ws({
        ...config
        //logObj: console
      })

      wsClient.userApiKey = userApiKey
      wsClient.at = tokenInfo.accessToken
      wsClient.region = tokenInfo.region

      openWebSocket()
    }

    if (props.lanMode) {
      readLanInfo()
      if (!lanInfo) {
        lanInfo = {}
      }
      lanClient = new eWeLink.Lan({
        selfApikey: userApiKey,
        logObj: logging
      })

      lanClient.discovery((server: any) => {
        debug('mdns server:', server)
        lanInfo[server.txt.id] = {
          ip: server.addresses[0],
          iv: server.txt.iv,
          port: server.port
        }
        saveLanInfo()
        //console.log(JSON.stringify(lanInfo, null, 2))
      })

      debug('starting dnsd browser...')
      browser = dnssd.Browser(dnssd.tcp('ewelink'))
      browser
        .on('serviceChanged', dnsdChanged)
        .on('serviceUp', dnsdChanged)
        .start()
    }
  }

  async function openWebSocket () {
    debug('opening websocket...')
    ws = await wsClient.Connect.create(
      {
        appId: APP_ID,
        at: wsClient.at,
        region: wsClient.region,
        userApiKey: wsClient.userApiKey
      },
      (ws: any) => {
        debug('websocket opened')
      },
      () => {
        ws = undefined
        error('web socket closed')
        if (wsClient) {
          wsTimer = setTimeout(() => {
            wsTimer = undefined
            openWebSocket()
          }, 5000)
        }
      },
      (err: ErrorEvent) => {
        error(err)
      },
      onMessage
    )
  }

  function onMessage (ws: WebSocket, event: MessageEvent) {
    if (event.data === 'pong') {
      debug('got ws pong')
      return
    }

    let info = JSON.parse(event.data)

    debug('ws message from server: ' + JSON.stringify(info, null, 2))

    if (
      info.action === 'update' ||
      (info.error === 0 && info.deviceid && info.params)
    ) {
      let device = getCachedDevice(info.deviceid)
      if (device) {
        const deviceProps = getDeviceProps(device)
        if (
          !deviceProps ||
          typeof deviceProps === 'undefined' ||
          deviceProps.enabled
        ) {
          sendDeltas(device, info.params)
        }
      } else {
        error(`unknown device: ${info.deviceid}`)
      }
    } else if (info.error !== undefined && info.sequence !== undefined) {
      const req = pending[info.sequence]
      if (req) {
        delete pending[info.sequence]
        const command = req.command
        command.action = 'query'
        command.nonce = nonce()
        command.sequence = new Date().getTime().toString()
        command.params = Object.keys(command.params)

        ws.send(JSON.stringify(command))

        req.cb({
          state: 'COMPLETED',
          statusCode: info.error === 0 ? 200 : 400,
          message: info.reason
        })
      }
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
      return
    }

    try {
      const info = lanClient.decrypt(
        txt.data1,
        crypto
          .createHash('md5')
          .update(device.devicekey)
          .digest('hex'),
        iv
      )
      sendDeltas(device, info)
    } catch (err:any) {
      error(err)
      app.setPluginError('unable to decrypt mdns data')
    }
  }

  /*
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
    */

  function propHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    prop: string,
    cb: any,
    converter: any = null
  ) {
    try {
      let params: any = converter ? converter(value) : { [prop]: value }

      const update = wsClient.Connect.getUpdateState(device.deviceid, params)
      ws.send(update)
      const command = JSON.parse(update)

      pending[command.sequence] = {
        cb,
        command
      }
    } catch (err:any) {
      error(err)
      app.setPluginError(err.message)
      cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
    }
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
      try {
        const update = wsClient.Connect.getUpdateState(device.deviceid, params)
        ws.send(update)
        const command = JSON.parse(update)

        pending[command.sequence] = {
          cb,
          command
        }
      } catch (err:any) {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      }
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

              if (device.extra.uiid === l1Light) {
                registerPutProp(device, 'mode', (value: any) => {
                  return { mode: Object.values(l1ModeMap).indexOf(value) + 1 }
                })
                registerPutProp(device, 'colorR')
                registerPutProp(device, 'colorG')
                registerPutProp(device, 'colorB')
                registerPutProp(device, 'dimmingLevel', (value: number) => {
                  let val = Number((value * 100).toFixed(0))
                  if (val === 0) {
                    val = 1
                  }
                  return { bright: val }
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
    try {
      const stateStr = state ? 'on' : 'off'
      const stateMap = {
        switches: [
          {
            switch: stateStr,
            outlet
          }
        ]
      }
      if (props.lanMode && !cloudOnlyByDevice[device.deviceid]) {
        const res = await sendZeroConf(device, stateMap)

        return {
          status: res.error === 0 ? 'ok' : 'error',
          message: res.message
        }
      } else {
        const update = wsClient.Connect.getUpdateState(
          device.deviceid,
          stateMap
        )
        ws.send(update)

        return { status: 'pending', command: JSON.parse(update) }
      }
    } catch (err:any) {
      return { status: 'error', message: err.message }
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
    const state =
      value === 1 || value === 'on' || value === 'true' || value === true
    setBankPowerState(device, state, outlet)
      .then((status: any) => {
        debug('got status outlet %d %j: ', outlet, status)
        if (status.status !== 'pending') {
          cb({
            state: 'COMPLETED',
            statusCode: status.status === 'ok' ? 200 : 400,
            message: status.message
          })
        } else {
          pending[status.command.sequence] = {
            cb,
            command: status.command
          }
        }
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  async function sendZeroConf (device: any, data: any) {
    let info = getLanInfo(device.deviceid)
    if (!info) {
      return { error: 1, message: 'no lan info' }
    }

    debug('sending zero config to %s: %j', device.deviceid, data)

    const func = data.switches
      ? lanClient.zeroconf.switches
      : lanClient.zeroconf.switch

    return func({
      ip: info.ip,
      port: info.port,
      data,
      deviceId: device.deviceid,
      secretKey: crypto
        .createHash('md5')
        .update(device.devicekey)
        .digest('hex'),
      encrypt: true,
      iv: info.iv
    })
  }

  async function setPowerState (device: any, state: boolean) {
    const stateStr = state ? 'on' : 'off'
    try {
      if (props.lanMode && !cloudOnlyByDevice[device.deviceid]) {
        let info = getLanInfo(device.deviceid)
        if (!info) {
          return { status: 'error', message: 'no lan info' }
        }

        const res = await sendZeroConf(device, {
          switch: stateStr
        })

        return {
          status: res.error === 0 ? 'ok' : 'error',
          message: res.message
        }
      } else {
        const update = wsClient.Connect.getUpdateState(device.deviceid, {
          switch: stateStr
        })
        ws.send(update)
        const updateJ = JSON.parse(update)

        return { status: 'pending', command: updateJ }
      }
    } catch (err:any) {
      return { status: 'error', message: err.message }
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
        if (status.status !== 'pending') {
          cb({
            state: 'COMPLETED',
            statusCode: status.status === 'ok' ? 200 : 400,
            message: status.message
          })
        } else if (status.command) {
          pending[status.command.sequence] = {
            cb,
            command: status.command
          }
        }
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
              //units: 'bool',
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

        if (device.extra.uiid === l1Light) {
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
                  })
                ],
                enum: [...switchProps.presets.map((preset: any) => preset.name)]
              }
            })
          }
        }

        meta.push({
          path: getSwitchPath(device),
          value: {
            ...extras,
            displayName: switchProps?.displayName || device.name,
            abbrev: switchProps?.abbrev
            //units: 'bool'
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

        if (device.extra.uiid === l1Light) {
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

  function getLanInfo (deviceid: string) {
    return lanInfo[deviceid]
  }

  function readLanInfo () {
    try {
      const content = fs.readFileSync(lanInfoPath)
      lanInfo = JSON.parse(content)
    } catch (err:any) {
      error(err)
    }
  }

  function saveLanInfo () {
    try {
      fs.writeFileSync(lanInfoPath, JSON.stringify(lanInfo, null, 2))
    } catch (err:any) {
      error(err)
    }
  }

  function readDeviceCache () {
    try {
      const content = fs.readFileSync(deviceCachePath)
      devicesCache = JSON.parse(content)
    } catch (err) {
      debug(err)
    }
  }

  function saveDeviceCache () {
    try {
      fs.writeFileSync(deviceCachePath, JSON.stringify(devicesCache, null, 2))
    } catch (err) {
      error(err)
    }
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
