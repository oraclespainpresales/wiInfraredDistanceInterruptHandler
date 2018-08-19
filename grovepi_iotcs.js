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
    , fs = require('fs-extra')
    , glob = require("glob")
    , commandLineArgs = require('command-line-args')
    , getUsage = require('command-line-usage')
    , log = require('npmlog-ts')
    , _ = require('lodash')
;

// Initialize input arguments
const optionDefinitions = [
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

if (!options.iotcs) {
  console.log(getUsage(sections));
  process.exit(-1);
}

log.level = (options.verbose) ? 'verbose' : 'info';
log.timestamp = true;

// IoTCS stuff
const GROVEPIDEV = "GrovePi+"
    , INFRAREDDISTANCEINTERRUPTSENSORDM = "urn:com:oracle:iot:device:grovepi:infrareddistanceinterrupt"
    , CARDM = "urn:oracle:iot:device:model:car"
    , storePassword = 'Welcome1'
    , DEMOZONEFILE  = '/demozone.dat'
    , DEFAULTDEMOZONE = 'MADRID'
;

var dcl = require('./device-library.node')
  , urn = [ CARDM ]
  , sensors = []
  , devices = []
  , selectedTruck = _.noop()
  , gpsPoints = _.noop()
  , gpsCounter = 0
  , lcd = new LCD(log);
;

dcl = dcl({debug: false});

// Get demozone Data
var DEMOZONE = DEFAULTDEMOZONE;
fs.readFile(DEMOZONEFILE,'utf8').then((data)=>{DEMOZONE=data).catch(() => {});
log.info(PROCESS, 'Working for demozone: %s', DEMOZONE);

// Initializing REST server BEGIN
const APEXURL = 'https://apex.digitalpracticespain.com'
    , GETTRUCKS = '/ords/pdb1/wedoindustry/trucks/id/:demozone'
    , GETIOTDEVICEDATA = '/ords/pdb1/wedoindustry/iot/device/:demozone/:deviceid'
    , PORT = process.env.GPSPORT || 8888
    , READERPORT = 8886
    , readerTakePicture = '/reader/take'
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
var apexClient = restify.createJsonClient({
  url: APEXURL,
  connectTimeout: 1000,
  requestTimeout: 1000,
  retry: false,
  rejectUnauthorized: false,
  headers: {
    "content-type": "application/json",
    "accept": "application/json"
  }
});
var iotClient = restify.createJsonClient({
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
var readerClient = restify.createJsonClient({
  url: "http://localhost:" + READERPORT,
  headers: {
    "accept": "application/json"
  }
});
// Initializing REST client END

// GrovePi stuff
var board      = undefined
  , boardReady = false
  , LEDS       = []
  , lastData   = undefined
  , timer      = undefined
;

// Misc
const PROCESS = 'PROCESS'
    , IOTCS   = 'IOTCS'
    , GROVEPI = 'GROVEPI'
    , REST    = 'REST'
    , APEX    = 'APEX'
;

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
  lcd: (callbackMainSeries) => {
    lcd.clear();
    lcd.color(0, 0, 0);
    callbackMainSeries(null, true);
  },
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
      iotClient.get(URI, function(err, req, res, obj) {
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
  devices: (callbackMainSeries) => {
    log.info(IOTCS, "Retrieving IoT Truck devices for demozone '%s'", DEMOZONE);
    apexClient.get(GETTRUCKS.replace(':demozone', DEMOZONE), (err, req, res, body) => {
      if (err || res.statusCode != 200) {
        callbackMainSeries(new Error("Error retrieving truck information: " + err));
        return;
      }
      if (!body || !body.items || body.items.length == 0) {
        callbackMainSeries(new Error("No truck information found for demozone '" + DEMOZONE + "'"));
        return;
      }
      log.verbose(IOTCS, "Devices registered for demozone '%s': %s",  DEMOZONE, _.map(body.items, 'truckid').join(', '));
      // Remove any existing .conf file
      // We keep it async as it should have finished before we're creating the new files... hopefully
      glob('*.conf', (er, files) => {
        _.forEach(files, (f) => {
          fs.removeSync(f);
        });
      });
      async.eachSeries( body.items, (truck, nextTruck) => {
        log.verbose(IOTCS, "Retrieving provisioning data for device '%s'", truck.truckid);
        apexClient.get(GETIOTDEVICEDATA.replace(':demozone', DEMOZONE).replace(':deviceid', truck.truckid), (_err, _req, _res, _body) => {
          if (err || res.statusCode != 200) {
            callbackMainSeries(new Error("Error retrieving truck device information: " + err));
            return;
          }
          if (!_body || !_body.provisiondata) {
            callbackMainSeries(new Error("No truck device information found for demozone '" + DEMOZONE + "' and ID '" + truck.truckid + "'"));
            return;
          }
          // We have the device ID and the provisioning data. Create the provisioning file
          var file = truck.truckid.toUpperCase() + '.conf';
          fs.outputFileSync(file, _body.provisiondata);
          // Create and init Device object and push it to the array
          var device = new Device(truck.truckid.toUpperCase());
          device.setStoreFile(truck.truckid.toUpperCase() + '.conf', storePassword);
          device.setUrn(urn);
          devices.push(device);
          log.verbose(IOTCS, "Data file created successfully: %s", file);
          nextTruck();
        });
      }, (err) => {
        callbackMainSeries(err);
      });
    });
  },
  iot: (callbackMainSeries) => {
    log.info(IOTCS, "Initializing IoTCS device(s)");
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
        log.info(IOTCS, "IoTCS device(s) initialized successfully");
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
                      async.series( {
                        check: (n) => {
                          if ( _.isUndefined(gpsPoints)) {
                            n("Cannot continue as route hasn't been set yet");
                          } else {
                            n();
                          }
                        },
                        stopTruck: (n) => {
                          truckController.post('/stop', (err, req, res, obj) => {
                            if (err) {
                              n('Error stoping the truck: ' + err);
                            } else {
                              log.verbose(REST, 'Truck successfully stopped');
                              n();
                            }
                          });
                        },
                        getCode: (n) => {
                          var action = [
                            { action: "on" },
                            { action: "color", color: [255,255,255]},
                            { action: "write", text: "Taking picture\nin 5 sec" },
                            { action: "loop", param: { loops: 5, interval: 1000, reversed: true, action: "write", goto: [3, 1], raw: true, text: "%d" } },
                            { action: "write", raw: true, goto: [3, 1], text: "0" },
                            { action: "wait", time: 500 },
                            { action: "clear" },
                            { action: "color", color: [0,0,0]},
                            { action: "wait", time: 500 },
                            { action: "color", color: [255,255,255]},
                            { action: "wait", time: 50 },
                            { action: "off" },
                          ];
                          lcd.execute(action)
                          .then(() => { log.verbose(REST, "LCD request completed successfully"); n() })
                          .catch(() => { n("LCD request completed with errors") });
                        }
                      }, (err) => {
                        if (err) {
                          log.error(PROCESS, err);
                        }
                      });
                    } else {
                      if ( !_.isUndefined(gpsPoints)) {
                        if (gpsCounter > (gpsPoints.length - 1)) {
                          gpsCounter = 0;
                        }
                        var coordinates = gpsPoints[gpsCounter];
                        var sensorData = { ora_latitude: coordinates.lat, ora_longitude: coordinates.lon };
                        var d = _.find(devices, (o) => { return o.getName() == selectedTruck });
                        var vd = d.getIotVd(CARDM);
                        if (vd) {
                          log.verbose(selectedTruck, 'Ultrasonic onChange value (%d) = %s', gpsCounter, JSON.stringify(sensorData));
                          vd.update(sensorData);
                        } else {
                          log.error(IOTCS, "URN not registered: " + INFRAREDDISTANCEINTERRUPTSENSOR);
                        }
                        gpsCounter++;
                      } else {
                        log.error(IOTCS, "Cannot send GPS position as truck hasn't been selected and route hasn't been set yet");
                      }
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
        message: "Route reset successfully for truck " + req.body.truck + " with " + req.body.gps.length + " GPS points"
      });
      res.end();
      gpsPoints = req.body.gps;
      selectedTruck = req.body.truck;
      gpsCounter = 0;
      log.verbose(REST, "New route successfully received for truck " + req.body.truck + " with %d points", req.body.gps.length);
    });
    router.post(lcdURI, (req, res) => {
      res.status(204).send();
      res.end();
      log.verbose(REST, "LCD request with actions: %j", req.body);
      var actions = req.body;
      lcd.execute(req.body)
      .then(() => { log.verbose(REST, "LCD request completed successfully") })
      .catch(() => { log.verbose(REST, "LCD request completed with errors") });
      return;
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
    log.error(PROCESS, "Aborting.Severe error: " + err);
  } else {
    log.info(PROCESS, 'Initialization completed');
  }
});
