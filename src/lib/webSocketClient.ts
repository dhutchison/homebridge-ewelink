import { Cache } from './cache';
import { BaseDevice } from './commonApi';

import { Logger } from 'homebridge';

import WebSocketAsPromised from 'websocket-as-promised';

import crypto from 'crypto';

import WebSocket from 'ws';

/**
 * Class exposing methods to interact with Ewelink through their websocket API.
 * 
 */
export class WebSocketClient {

    /** 
     * Cache of device status values to prevent spamming the websocket API.
     */
    private readonly deviceStatusMap: Cache<BaseDevice>;

    /**
     * Message number
     */
    private number = 0;

    /**
     * Interval to wait (in ms) before an automatic reconnection
     */
    private autoReconnectInterval = 5 * 1000;

    /**
     * Boolean to indicate if we are waiting on a reconnect
     */
    private pendingReconnect = false;

    /**
     * Boolean holding if the socket is currently open or not
     */
    private socketOpen = false;

    /**
     * The websocket client instance
     */
    private instance: WebSocketAsPromised | undefined;

    /**
     * Handle on any timeout timer that we have running to ping a socket
     */
    private pingInterval: NodeJS.Timeout | undefined;

    /**
     * The last URL that was connected to. 
     */
    private url: string | undefined;
    

    /**
     * Create a new WebSocketClient
     * @param {*} log the logger instance to use for log messages
     * @param {*} config the plugin configuration
     */
    constructor(
        private readonly log: Logger, 
        private readonly config) {

        /* Cache to prevent spamming the websocket API.*/
        this.deviceStatusMap = new Cache(log);

    }

    isSocketOpen(): boolean {
        return this.socketOpen;
    }
    
    open(url: string) {

        this.url = url;

        const options = {
            /* Need to configure this to use the 'ws' module
             * for the websocket interaction
             */
            createWebSocket: socketUrl => new WebSocket(socketUrl),
            extractMessageData: event => event, // <- this is important
            /* API requests and responses use a "sequence" field we can use
             * attach the requestId to this field. 
             */
            attachRequestId: (data, requestId) => Object.assign({sequence: requestId}, data),
            extractRequestId: data => data && data.sequence,

            /* Need to specify how JSON is serialized */
            packMessage: (data: any) => JSON.stringify(data),
            unpackMessage: (data: string) => {
                this.log.debug('unpackMessage: %s', data);
                if (data === 'pong') {
                    /* Heartbeat response, just return as-is */
                    return data;
                } else {
                    /* Convert into an object */
                    return JSON.parse(data);
                }
            }
        };


        this.instance = new WebSocketAsPromised(url, options);
        this.instance.open();

        this.instance.onOpen.addListener(() => {
            this.onopen();
        });
    
        this.instance.onUnpackedMessage.addListener(data => {
            this.number++;
            this.onmessage(data, this.number);
        });
    
        this.instance.onClose.addListener(e => {
            if (e === 1000) {
                // CLOSE_NORMAL
                // console.log("WebSocket: closed");
            } else {
                // Abnormal closure
                this.reconnect();
            }
            this.log.warn("WebSocket was closed. Reason [%s]", e);
            
            /* Close the 'ping' timer */
            this.socketOpen = false;
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = undefined;
            }

            this.onclose(e);
        });
        // this.instance.on('error', (e) => {
        this.instance.onError.addListener(e => {
            if (e.code === 'ECONNREFUSED') {
                this.reconnect();
            } else {
                this.onerror(e);
            }
        });
    }

    send(data: any) {
        if (this.instance) {
            this.instance.send(data);
        } else {
            throw new Error('Socket not open');
        }
    }

    reconnect() {
        // console.log(`WebSocketClient: retry in ${this.autoReconnectInterval}ms`, e);

        if (!this.pendingReconnect) {
            this.pendingReconnect = true;

            if (this.instance) {
                this.instance.removeAllListeners();
            }

            setTimeout(() => {

                if (!this.url) {
                    throw new Error('Attempted reconnect without a URL');
                }

                this.pendingReconnect = false;
                this.log.info("WebSocketClient: reconnecting...");
                this.open(this.url);
            }, this.autoReconnectInterval);
        }
    }

    onopen() {
        // console.log("WebSocketClient: open", arguments);

        this.socketOpen = true;

        // We need to authenticate upon opening the connection

        // Here's the eWeLink payload as discovered via Charles
        let payload = {};
        payload.action = "userOnline";
        payload.userAgent = 'app';
        payload.apkVesrion = "1.8";
        payload.at = this.config.authenticationToken;
        payload.apikey = this.config.apiKey;
        payload.sequence = this.getSequence();

        payload = this.populateCommonApiRequestFields(payload);

        let string = JSON.stringify(payload);

        this.log.debug('Sending login request [%s]', string);

        // this.send(string);
        this.instance!.sendRequest(payload, {
            requestId: this.getSequence()
        }).then(response => {
            this.log.debug('Login websocket response: %o', response);

            /* There is some configuration values we should look at */
            if (response.config) {

                if (response.config.hb && response.config.hbInterval) {
                    /* Configure a 'ping' poll to keep alive the connection.
                     * API docs say to add 7 to this and use as the interval.
                    */
                    this.pingInterval = setInterval(() => {
                        this.instance!.send('ping');
                    }, (response.config.hbInterval + 7) * 1000);
                }
            } 

        }).catch(err => {
            this.log.error('Login websocket request failed: %s', err);
        });

        
    }

    /**
     * Helper method to set the common values all implementations or BaseApiRequest are
     * expected to include before being sent with API requests. 
     * @param obj the object to populate the fields in
     * @returns the updated object. 
     */
    private populateCommonApiRequestFields(obj) {

        obj.version = '6';
        obj.ts = '' + Math.floor(new Date().getTime() / 1000);
        obj.nonce = this.nonce();
        // obj.appid = 'oeVkj2lYFGnJu5XUtWisfW4utiN4u9Mq';
        // obj.imei = this.config.imei;
        obj.os = 'iOS';
        obj.model = 'iPhone10,6';
        obj.romVersion = '11.1.2';
        // obj.appVersion = '3.5.3';

        return obj;
    }

    onmessage(data, number) {
        // console.log("WebSocketClient: message", arguments);
    }

    onerror(e) {
        this.log.error("WebSocketClient: error", arguments);
    }

    onclose(e?) {
        // console.log("WebSocketClient: closed", arguments);
    }


    /**
     * Get the next sequence number for a websocket request.
     * 
     * @returns the sequence number
     */
    getSequence() {
        // let time_stamp = new Date() / 1000;
        // let sequence = Math.floor(time_stamp * 1000);
        // return "" + sequence;
        return "" + Date.now();
    }

    /**
     * Generate a nonce for sending with API requests. 
     * 
     * @returns the base64 encoded nonce.
     */
    private nonce(): string {
        return crypto.randomBytes(16).toString('base64');
    }

    getDeviceStatus(deviceId: string) {

        return new Promise((resolve, reject) => {

            let cachedDeviceStatus = this.deviceStatusMap.get(deviceId);

            if (cachedDeviceStatus) {
                this.log.debug('Returning cached status for device %s: %o', 
                    deviceId, cachedDeviceStatus);
                
                resolve(cachedDeviceStatus);
            } else {
                this.log.debug('Making request for status for device %s', 
                    deviceId);

                let payload = {
                    action: 'query',
                    apikey: this.config.apiKey,
                    deviceid: deviceId,
                    userAgent: 'app',
                    params: []
                };

                /* Extra undocumented params */
                payload.at = this.config.authenticationToken;
                payload = this.populateCommonApiRequestFields(payload);

                /* Introduce a small pause to prevent spamming the websocket,
                * random duration between 200 & 400 ms. 
                */
                let delay = (Math.random() * (200)) + 200
                this.log.debug('Pausing for %s for %s', delay, deviceId);
                this.sleep(delay).then(() => {
                    this.log.debug('After pause for %s', deviceId);

                    this.instance!.sendRequest(payload, {
                            requestId: this.getSequence()
                        }).then(result => {
                            /* Add to the cache */
                            this.deviceStatusMap.set(deviceId, result);

                            /* Return */
                            resolve(result);
                        }).catch(err => reject(err));
                });
            }
        });
    }

    updateDeviceStatus(deviceId, params) {

        return new Promise((resolve, reject) => {

            /* Documentation says action value should be 'action:update', this is
            * incorrect, should just be 'update'
            */
            let payload = {
                action: 'update',
                apikey: this.config.apiKey,
                deviceid: deviceId,
                userAgent: 'app',
                params: params
            };

            /* Extra undocumented params */
            payload.at = this.config.authenticationToken;
            payload = this.populateCommonApiRequestFields(payload);

            /* Introduce a small pause to prevent spamming the websocket,
            * random duration between 200 & 400 ms. 
            */
            let delay = (Math.random() * (200)) + 200
            this.log.debug('Pausing for %s for %s', delay, deviceId);
            this.sleep(delay).then(() => {
                this.log.debug('After pause for %s', deviceId);

                if (this.socketOpen) {
                    /* Send the request */
                    this.instance!.sendRequest(payload, 
                            { requestId: this.getSequence() }
                        ).then(result => resolve(result)
                        ).catch(err => reject(err));
                } else {
                    this.log.warn("[%s] Socket was closed. Retrying in 5 sec...", deviceId);
                    setTimeout(() => {
                        /* Send the request */
                        this.instance!.sendRequest(payload, 
                            { requestId: this.getSequence() }
                        ).then(result => resolve(result)
                        ).catch(err => reject(err));
                    }, 5000);
                }
            });
        });

    }

    /**
     * Helper method that can be used to "wait" for a period of time. 
     * 
     * Callers can do something like this to introduce a 1s delay in their execution. 
     * "await sleep(1000);"
     * 
     * See: https://stackoverflow.com/a/41957152/230449
     * 
     * @param {number} ms the number of millseconds to sleep for. 
     * @returns a promise that will be resolved after the supplied duration has passed. 
     */
    sleep(ms: number) {
        return new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
    } 

    //TODO: PREVIOUS SEND IMPLEMENTATION
    // May need to look at the delay approach here again
    // eWeLink.prototype.sendWebSocketMessage = function (string, callback) {
    //     let platform = this;
    
    //     if (!platform.hasOwnProperty('delaySend')) {
    //         platform.delaySend = 0;
    //     }
    //     const delayOffset = 280;
    
    //     let sendOperation = function (string) {
    //         if (!platform.isSocketOpen) {
    //             // socket not open, retry later
    //             setTimeout(function () {
    //                 sendOperation(string);
    //             }, delayOffset);
    //             return;
    //         }
    
    //         if (platform.wsc) {
    //             platform.wsc.send(string);
    //             //platform.log("WS message sent");
    //             callback();
    //         }
    
    //         if (platform.delaySend <= 0) {
    //             platform.delaySend = 0;
    //         } else {
    //             platform.delaySend -= delayOffset;
    //         }
    //     };
    
    //     if (!platform.isSocketOpen) {
    //         platform.log('Socket was closed. It will reconnect automatically');
    
    //         let interval;
    //         let waitToSend = function (string) {
    //             if (platform.isSocketOpen) {
    //                 clearInterval(interval);
    //                 sendOperation(string);
    //             } else {
    //                 //platform.log('Connection not ready.....');
    //             }
    //         };
    //         interval = setInterval(waitToSend, 750, string);
    //     } else {
    //         setTimeout(sendOperation, platform.delaySend, string);
    //         platform.delaySend += delayOffset;
    //     }
    // };

}