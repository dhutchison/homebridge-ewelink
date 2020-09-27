const platform = require('../index');

// import { Logger } from 'homebridge';
const hap = require('hap-nodejs');

let eWeLinkPlatform;
let log;
// const log = Logger.internal;
  
//   const setup = (config) => {
//     const platform = new BroadlinkRMPlatform(log, config);
  
//     const device = new FakeDevice()
//     addDevice(device)
  
//     return { platform, device }
//   }

/* Mock for requests */
jest.mock('request', () => {
    const mockRequest = {
      pipe: jest.fn(),
      on: jest.fn(),
    }
    return () => mockRequest;
});

beforeEach(() => {
    
    /* Logger */
    this.log = console.log;
    this.log.debug = console.debug;
    this.log.warn = console.warn;
    this.log.info = console.info;
    this.log.error = console.error;

    
});

afterEach(() => {
    this.eWeLinkPlatform = undefined;
});

test('Check missing config causes error', (done) => {


    /* Default configuration, should be supplied */
    const pluginConfig = {

    };
    
    /* Make a mock of the register function to capture the created platform */
    const mockRegister = jest.fn((pluginIdentifier, platformName, constructor) => {
        console.log('Constructor is %o', constructor);

        let error;
        try {
            this.eWeLinkPlatform = constructor(this.log, pluginConfig, undefined);
        } catch (err) {
            error = err;
        }

        expect(error).toBeDefined();
        expect(error.message).toBe('Initialization skipped. Missing configuration data.');
        done();
    });

    
    

    const homebridge = {
        hap: hap,
        registerPlatform: mockRegister
    };

    platform(homebridge);

});

test('Check the platform can be registered', (done) => {

    /* Default configuration, should be supplied */
    const pluginConfig = {
        platform: 'eWeLink',
        name: 'eWeLink',
        countryCode: '44',
        email: "test@example.com",
        password: 'hunter2',
        imei: '711376DE-DDEE-43AB-8BE0-DCFF4BD357D2'

    };
    
    /* Make a mock of the register function to capture the created platform */
    const mockRegister = jest.fn((pluginIdentifier, platformName, constructor) => {
        console.log('Constructor is %o', constructor);

        let error;
        try {
            this.eWeLinkPlatform = constructor(this.log, pluginConfig, undefined);
        } catch (err) {
            error = err;
        }

        expect(error).toBeUndefined();
        expect(this.eWeLinkPlatform).toBeDefined();
        done();
    });

    
    

    const homebridge = {
        hap: hap,
        registerPlatform: mockRegister
    };

    platform(homebridge);

    expect(this.eWeLinkPlatform).toBeDefined();

});