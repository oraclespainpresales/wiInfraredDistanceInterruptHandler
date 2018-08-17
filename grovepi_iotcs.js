'use strict';

// Module imports
const async = require('async')
    , GrovePi = require('node-grovepi').GrovePi
    , LCD = require('./lcd')
    , Device = require('./device')
    , SENSORSCFG = require('./sensors.json')
    , LEDSCFG = require('./leds.json')
    , express = require('express')
    , http = require('http')
    , bodyParser = require('body-parser')
    , restify = require('restify')
    , fs = require('fs')
    , commandLineArgs = require('command-line-args')
    , getUsage = require('command-line-usage')
    , log = require('npmlog-ts')
    , _ = require('lodash')
;

// Initialize input arguments
const optionDefinitions = [
  { name: 'device', alias: 'd', type: String },
  { name: 'iotcs', alias: 's', type: String },
  { name: 'verbose', alias: 'v', type: Boolean, defaultOption: false },
  { name: 'help', alias: 'h', type: Boolean }
];

const sections = [
  {
    header: 'GrovePi - IoTCS Wrapper',
    content: 'Wrapper to GrovePi sensors information to IoTCS'
  },
  {
    header: 'Options',
    optionList: [
      {
        name: 'device',
        typeLabel: '[underline]{file}',
        alias: 'd',
        type: String,
        description: 'Device configuration file (.conf)'
      },
      {
        name: 'iotcs',
        typeLabel: '[underline]{server URL}',
        alias: 's',
        type: String,
        description: 'IoTCS server URL'
      },
      {
        name: 'verbose',
        alias: 'v',
        description: 'Enable verbose logging.'
      },
      {
        name: 'help',
        alias: 'h',
        description: 'Print this usage guide.'
      }
    ]
  }
]
var options = undefined;

try {
  options = commandLineArgs(optionDefinitions);
} catch (e) {
  console.log(getUsage(sections));
  console.log(e.message);
  process.exit(-1);
}

if (options.help) {
  console.log(getUsage(sections));
  process.exit(0);
}

if (!options.device) {
  console.log(getUsage(sections));
  process.exit(-1);
}

if (!options.iotcs) {
  console.log(getUsage(sections));
  process.exit(-1);
}

if (!fs.existsSync(options.device)) {
  log.error("", "Device file %s does not exist or is not readable", options.device);
  process.exit(-1);
}

log.level = (options.verbose) ? 'verbose' : 'info';
log.timestamp = true;

// IoTCS stuff
const GROVEPIDEV = "GrovePi+"
    , INFRAREDDISTANCEINTERRUPTSENSORDM = "urn:com:oracle:iot:device:grovepi:infrareddistanceinterrupt"
    , CARDM = "urn:oracle:iot:device:model:car"
    , storeFile = options.device
    , storePassword = 'Welcome1'
;

var dcl = require('./device-library.node')
  , urn = [ CARDM ]
  , grovepi = new Device(GROVEPIDEV)
  , sensors = []
  , devices = [ grovepi ]
  , gpsPoints = _.noop()
  , gpsCounter = 0
  , lcd = new LCD(log);
;

dcl = dcl({debug: false});
lcd.execute(
  [
    { action: "write", text: "Hi there", clear: true, color: [ 0, 0, 255 ] },
    { action: "wait", time: 1000 },
    { action: "clear" },
    { action: "wait", time: 1000 },
    { action: "color", color: [ 255, 0, 0 ] },
    { action: "wait", time: 1000 },
    { action: "write", text: "In red!!" },
    { action: "wait", time: 1000 },
    { action: "loop", param: { loops: 5, interval: 1000, action: "wirite", text: "Taking picture\nin %d sec" } },
    { action: "off" }
  ]).then(() => { console.log("done")});

// Initializing REST server BEGIN
const PORT = process.env.GPSPORT || 8888
    , restURI = '/'
    , resetURI = '/gps/resetroute'
    , ledsURI  = '/leds/:led/:action/:duration?'
    , lcdURI   = '/lcd'
    , RED = 'RED'
    , GREEN = 'GREEN'
    , ON = 'ON'
    , OFF = 'OFF'
    , BLINK = 'BLINK'
;

var app    = express()
  , router = express.Router()
  , server = http.createServer(app)
;
// Initializing REST server END

// Initializing REST client BEGIN
var client = restify.createJsonClient({
  url: options.iotcs,
  connectTimeout: 1000,
  requestTimeout: 1000,
  retry: false,
  rejectUnauthorized: false,
  headers: {
    "content-type": "application/json",
    "accept": "application/json"
  }
});
var truckController = restify.createJsonClient({
  url: "http://localhost:7877",
  headers: {
    "accept": "application/json"
  }
});
// Initializing REST client END

// Init Devices
grovepi.setStoreFile(storeFile, storePassword);
grovepi.setUrn(urn);

// GrovePi stuff
var board      = undefined
  , boardReady = false
  , LEDS       = []
  , lastData   = undefined
  , timer      = undefined
;

// Misc
const PROCESS = 'PROCESS';
const IOTCS   = 'IOTCS';
const GROVEPI = 'GROVEPI';
const REST    = 'REST';

// device class helper
function getModel(device, urn, callback) {
  device.getDeviceModel(urn, function (response, error) {
    if (error) {
      callback(error);
    }
    callback(null, response);
  });
}

// Detect CTRL-C
process.on('SIGINT', function() {
  log.info(PROCESS, "Caught interrupt signal");
  log.info(PROCESS, "Exiting gracefully");
  if (board) board.close()
  board = undefined;
  process.removeAllListeners()
  if (typeof err != 'undefined')
    log.error(PROCESS, err)
  process.exit(2);
});

var pre = false;
var flag = undefined;
var processing = false;

async.series( {
  internet: (callbackMainSeries) => {
    log.info(PROCESS, "Checking for Internet & IoTCS server availability...");
    var URI = "/iot/api/v1/private/server";
    var retries = 0;
    async.retry({
      times: 99999999999,
      interval: 2000
    }, (cb, results) => {
      retries++;
      log.verbose(PROCESS, "Trying to reach server %s (attempt %d)", options.iotcs, retries);
      client.get(URI, function(err, req, res, obj) {
        if (err) {
          if (err.statusCode === 401 || err.statusCode === 404) {
            cb(null, "OK");
          } else {
            cb(err.message);
          }
        } else {
          cb(null, "OK");
        }
      });
    }, (err, result) => {
      if (!result) {
        // Server not available. Abort whole process
        log.error(PROCESS, "Server not available after %d attempts. Aborting process!", retries);
        process.exit(2);
      }
      log.info(PROCESS, "Server %s seems up & running...", options.iotcs);
      callbackMainSeries(null, true);
    });
  },
  iot: (callbackMainSeries) => {
    log.info(IOTCS, "Initializing IoTCS devices");
    log.info(IOTCS, "Using IoTCS JavaScript Libraries v" + dcl.version);
    async.eachSeries( devices, (d, callbackEachSeries) => {
      async.series( [
        (callbackSeries) => {
          // Initialize Device
          log.info(IOTCS, "Initializing IoT device '" + d.getName() + "'");
          d.setIotDcd(new dcl.device.DirectlyConnectedDevice(d.getIotStoreFile(), d.getIotStorePassword()));
          callbackSeries(null);
        },
        (callbackSeries) => {
          // Check if already activated. If not, activate it
          if (!d.getIotDcd().isActivated()) {
            log.verbose(IOTCS, "Activating IoT device '" + d.getName() + "'");
            d.getIotDcd().activate(d.getUrn(), function (device, error) {
              if (error) {
                log.error(IOTCS, "Error in activating '" + d.getName() + "' device (" + d.getUrn() + "). Error: " + error.message);
                callbackSeries(error);
              }
              d.setIotDcd(device);
              if (!d.getIotDcd().isActivated()) {
                log.error(IOTCS, "Device '" + d.getName() + "' successfully activated, but not marked as Active (?). Aborting.");
                callbackSeries("ERROR: Successfully activated but not marked as Active");
              }
              callbackSeries(null);
            });
          } else {
            log.verbose(IOTCS, "'" + d.getName() + "' device is already activated");
            callbackSeries(null);
          }
        },
        (callbackSeries) => {
          // When here, the device should be activated. Get device models, one per URN registered
          async.eachSeries(d.getUrn(), function(urn, callbackEachSeriesUrn) {
            getModel(d.getIotDcd(), urn, (function (error, model) {
              if (error !== null) {
                log.error(IOTCS, "Error in retrieving '" + urn + "' model. Error: " + error.message);
                callbackEachSeriesUrn(error);
              } else {
                d.setIotVd(urn, model, d.getIotDcd().createVirtualDevice(d.getIotDcd().getEndpointId(), model));
                log.verbose(IOTCS, "'" + urn + "' intialized successfully");
              }
              callbackEachSeriesUrn(null);
            }).bind(this));
          }, (err) => {
            if (err) {
              callbackSeries(err);
            } else {
              callbackSeries(null, true);
            }
          });
        }
      ], (err, results) => {
        callbackEachSeries(err);
      });
    }, (err) => {
      if (err) {
        callbackMainSeries(err);
      } else {
        log.info(IOTCS, "IoTCS device initialized successfully");
        callbackMainSeries(null, true);
      }
    });
  },
  grovepi: (callbackMainSeries) => {
    log.info(GROVEPI, "Initializing GrovePi devices");
    if (board)
      callbackMainSeries(null, true);
    log.verbose(GROVEPI, 'Starting Board setup');
    board = new GrovePi.board({
      debug: true,
      onError: function(err) {
        log.error(GROVEPI, 'TEST ERROR');
        log.error(GROVEPI, err);
      },
      onInit: (res) => {
        if (res) {
          boardReady = true;
          log.verbose(GROVEPI, 'GrovePi Version :: ' + board.version());
          // Sensors
          log.verbose(GROVEPI, 'Initializing %d sensors', SENSORSCFG.length);
          _.forEach(SENSORSCFG, (s) => {
            log.verbose(GROVEPI, "Looking for Ultrasonic sensor with id '%d' at digital port #%d", s.id, s.port);
            var ultrasonicSensor = new GrovePi.sensors.UltrasonicDigital(s.port);
            sensors.push({ id: s.id, port: s.port, sensors: ultrasonicSensor });
            log.verbose(GROVEPI, 'Start watch Ultrasonic Sensor %d', s.id);
            ultrasonicSensor.on('change', function(res) {
              if (!processing) {
                processing = true;
                if (res <= 5) {
                  flag = true;
                } else {
                  flag = false;
                }
                if (pre !== flag) {
                  pre = flag;
                  if (flag == true) {
                    // Got it!!
                    var s = _.find(SENSORSCFG, { port: this.pin });
                    if (s.finishline) {
                      log.verbose(GROVEPI, 'Reached finish line!!');
                      truckController.post('/stop', (err, req, res, obj) => {
                        if (err) {
                          log.error(REST, 'Error stoping the truck: ' + err);
                          return;
                        }
                        log.verbose(REST, 'Truck successfully stopped');
                      });
                    }
                    if ( !_.isUndefined(gpsPoints)) {
                      if (gpsCounter > (gpsPoints.length - 1)) {
                        gpsCounter = 0;
                      }
                      var coordinates = gpsPoints[gpsCounter];
                      var sensorData = { ora_latitude: coordinates.lat, ora_longitude: coordinates.lon };
                      var vd = grovepi.getIotVd(CARDM);
                      if (vd) {
                        log.verbose(GROVEPI, 'Ultrasonic onChange value (%d) = %s', gpsCounter, JSON.stringify(sensorData));
                        vd.update(sensorData);
                      } else {
                        log.error(IOTCS, "URN not registered: " + INFRAREDDISTANCEINTERRUPTSENSOR);
                      }
                      gpsCounter++;
                    } else {
                      log.error(IOTCS, "Cannot send GPS position as route hasn't been set yet");
                    }
                  }
                }
                processing = false;
              }
            });
            ultrasonicSensor.watch();
          });
          // LEDS
          log.verbose(GROVEPI, 'Initializing %d leds', LEDSCFG.length);
          _.forEach(LEDSCFG, (l) => {
            log.verbose(GROVEPI, "Setting LED with color '%s' at digital port #%d", l.color, l.port);
            var led = new GrovePi.sensors.DigitalOutput(l.port);
            LEDS.push({ color: l.color, port: l.port, device: led });
          });
        } else {
          log.error(GROVEPI, 'TEST CANNOT START')
        }
      }
    })
    board.init()
    callbackMainSeries(null, true);
  },
  rest: (callbackMainSeries) => {
    log.info(REST, "Initializing REST Server");
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
    app.use(restURI, router);
    router.post(resetURI, (req, res) => {
      res.status(200).send({
        result: "Success",
        message: "Route reset successfully with " + req.body.length + " GPS points"
      });
      res.end();
      gpsPoints = req.body;
      gpsCounter = 0;
      log.verbose(REST, "New route received successfully with %d points", req.body.length);
    });
    router.get(ledsURI, (req, res) => {
      // /leds/:led/:action/:duration?
      var led = req.params.led.toUpperCase();
      var action = req.params.action.toUpperCase();
      var duration = req.params.duration;
      // Let's check the inputs
      if (!LEDS || LEDS.length == 0) {
        res.status(400).send({
          result: "Failure",
          message: "Leds not yet initialized"
        });
        res.end();
        return;
      }
      var LED = _.find(LEDS, { color: led });
      if (!LED) {
        res.status(400).send({
          result: "Failure",
          message: "Led with color " + req.params.led + " not found"
        });
        res.end();
        return;
      }
      if (
          ( action !== ON && action !== OFF && action !== BLINK ) ||
          ( action === BLINK && ( !duration || parseInt(duration) == NaN))
        ) {
          res.status(400).send({
            result: "Failure",
            message: "Invalid parameters"
          });
          res.end();
          return;
        }
      if (!boardReady) {
        res.status(400).send({
          result: "Failure",
          message: "GrovePi board is not ready"
        });
        res.end();
        return;
      }
      // No matter which action, if BLINKing, cancel it
      if (LED.status === BLINK) {
        clearInterval(LED.blink.interval);
        delete LED.blink;
      }
      if ( action === ON) {
          LED.device.turnOn();
          LED.status = ON;
      } else if (action === OFF) {
        LED.device.turnOff();
        LED.status = OFF;
      } else if (action === BLINK) {
        LED.status = BLINK;
        LED.blink = {};
        LED.blink.status = OFF;
        // We will NOT accept blinking interval less than 300. Somehow it blocks the whole code.
        if (duration < 300) { duration = 300 }
        LED.blink.interval = setInterval(() => {
          if (LED.blink.status === OFF) {
              LED.device.turnOn();
              LED.blink.status = ON;
          } else {
            LED.device.turnOff();
            LED.blink.status = OFF;
          }
        }, duration);
      }
      res.status(200).send({
        result: "Success",
        message: "Led changed as required"
      });
      res.end();
    });
    server.listen(PORT, () => {
      log.info(REST, "REST Server initialized successfully");
      callbackMainSeries(null, true);
    });
  }
}, (err, results) => {
  if (err) {
  } else {
    log.info(PROCESS, 'Initialization completed');
  }
});
