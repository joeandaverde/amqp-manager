const Amqp = require('amqplib')
const Machina = require('machina')
const QueryString = require('querystring')
const Logger = require('./logger')
const _ = require('lodash')

const AmqpConnectionFsm = Machina.Fsm.extend({
   namespace: 'amqp-connection',
   initialState: 'uninitialized',
   initialize: function (config) {
      this.config = config
      this.memory = {}
   },
   states: {
      uninitialized: {
         '*': function () {
            this.deferAndTransition('idle')
         },
      },
      idle: {
         open: function () {
            this.transition('connect')
         },
      },
      connect: {
         _onEnter: function () {
            Logger.info('connect/enter')
            const connection = this.config.connection
            const amqpUrl = `${connection.protocol}://${connection.user}:${connection.password}@${connection.host}:${connection.port}/${encodeURIComponent(connection.vhost)}?${QueryString.stringify(connection.params)}`

            Amqp.connect(amqpUrl, connection.options)
            .then(connection => {
               _.assign(this.memory, {
                  connection: connection,
                  reconnects: 0,
               })

               this.transition('connected')
            }, error => {
               this.handle('error', error)
            })
         },
         error: function () {
            Logger.info('connect/error')
            this.deferAndTransition('disconnect')
         },
      },
      connected: {
         _onEnter: function () {
            Logger.info('connected/enter')

            this.memory.connection.on('error', error => {
               this.handle('connection_error', error)
            })

            this.memory.connection.on('close', error => {
               this.handle('connection_close', error)
            })

            this.emit('connected', this.memory.connection)
         },
         connection_error: function (error) {
            Logger.info('connected/connection_error', error)
            this.deferAndTransition('disconnect')
         },
         connection_close: function (error) {
            Logger.info('connected/connection_close', error)
            this.deferAndTransition('disconnect')
         },
      },
      disconnect: {
         _onEnter: function () {
            Logger.info('disconnect/enter')

            if (this.memory.connection) {
               this.memory.connection.removeAllListeners()
            }

            if (this.memory.connection) {
               this.memory.connection.close()
            }

            this.emit('disconnected')

            if (!this.closed) {
               this.transition('reconnect')
            }
         },
      },
      reconnect: {
         _onEnter: function () {
            Logger.info('reconnect/enter')
            const reconnects = (this.memory.reconnects || 0) + 1
            const waitTimeMs = Math.min(Math.pow(2, reconnects) * 100, 60 * 1000)

            this.emit('reconnect_waiting', {
               reconnects: reconnects,
               wait_time_ms: waitTimeMs
            })

            setTimeout(() => {
               this.emit('reconnecting', {
                  reconnects: reconnects,
                  wait_time_ms: waitTimeMs
               })

               _.assign(this.memory, {
                  reconnects: reconnects,
               })

               this.transition('connect')
            }, waitTimeMs)
         }
      },
   },
   open: function () {
      this.handle('open')
   },
   close: function () {
      this.closed = true
      this.transition('disconnect')
   },
})

module.exports = AmqpConnectionFsm
