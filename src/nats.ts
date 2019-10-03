import * as nats from 'ts-nats'
import * as stan from 'node-nats-streaming'
// import { Client as NATSClient } from 'nats'
// import { Stan as NATSStreamingClient } from 'node-nats-streaming'

import { default as Config } from './env'

// export type NATSClient = nats.Client
// export type NATSStreamingClient = stan.Stan
export type NATSMessage = stan.Message

const uuidv4 = require('uuid/v4')

class NatsUtil {

  private config: Config
  private clusterId: string
  private servers: string[]
  private token?: string
  private bearerToken?: string

  constructor(clusterId: string, servers?: string[], bearerToken?: string, token?: string) {
    this.bearerToken = bearerToken
    this.config = Config.fromEnv()
    this.clusterId = clusterId ? clusterId : this.config.natsClusterId
    this.servers = servers ? servers : this.config.natsServers.split(',')
    this.token = token ? token : this.config.natsToken
  }

  getNatsConnectionOpts(clientId: string): nats.NatsConnectionOptions {
    return {
      encoding: this.config.natsEncoding,
      json: this.config.natsJson,
      name: clientId,
      reconnect: true,
      maxPingOut: this.config.natsMaxPingOut,
      maxReconnectAttempts: -1, // reconnect dammit! (see reconnectTimeWait when it's time to make this a bit more intelligent)
      noEcho: this.config.natsNoEcho,
      noRandomize: false,
      pingInterval: this.config.natsPingInterval,
      servers: this.servers,
      token: this.token, 
      tls: this.config.natsTlsOptions,
      userJWT: this.bearerToken,
      pedantic: this.config.natsPedantic,
      verbose: this.config.natsVerbose,
    } as nats.NatsConnectionOptions
  }

  async getNatsConnection(): Promise<nats.Client> {
    let client: nats.Client
    const clientId = `${this.config.natsClientPrefix}-${uuidv4()}`
    try {
      var opts = this.getNatsConnectionOpts(clientId) as stan.StanOptions
      // TODO: merge StanOptions into opts
      client = await nats.connect(opts) as nats.Client
      client.on('connect', function() {

        client.on('close', function(err: any) {
          console.log(`NATS connection ${clientId} closed; ${err}"`)
        })

        client.on('error', function(err: any) {
          console.log(`Error on NATS connection: ${clientId}; ${err}"`)
        })
      })
      return client
    } catch (err) {
      console.log(`Error establishing NATS connection: ${clientId}; ${err}"`)
    }
    throw 'failed to get NATS connection'
  }

  async getNatsStreamingConnection(): Promise<stan.Stan> {
    var client: stan.Stan | undefined
    const clientId = `${this.config.natsClientPrefix}-${uuidv4()}-${this.clusterId}-${uuidv4()}`
    try {
      const opts = this.getNatsConnectionOpts(clientId)
      client = await stan.connect(this.clusterId, clientId, opts)
      return client
    } catch (err) {
      console.log(`Error establishing NATS streaming connection: ${clientId}; ${err}"`)
    }
    throw 'failed to get NATS streaming connection'
  }

  async attemptNack(conn: stan.Stan, msg: NATSMessage, timeout: number) {
    if (this.shouldDeadletter(msg, timeout)) {
      this.nack(conn, msg)
    }
  }

  async nack(conn: stan.Stan, msg: NATSMessage) {
    try {
      conn.publish(this.config.natsDeadLetterSubject, msg.getRawData())
    } catch (err) {
      console.log(`Error Nacking NATS message on subject: ${msg.getSubject}; ${err}"`)
    }
  }
  
  shouldDeadletter(msg: NATSMessage, deadletterTimeout: number): boolean {
    return msg.isRedelivered() && ((new Date().getTime()) / 1000) - (msg.getTimestamp().getTime() / 1000) >= deadletterTimeout
  }
}

export default NatsUtil
