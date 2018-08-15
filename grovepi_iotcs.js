'use strict';

// Module imports
const async = require('async')
    , GrovePi = require('node-grovepi').GrovePi
    , Device = require('./device')
    , SENSORS = require('./sensors.json')
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

var dcl = require('./device-library.node')
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

// IoTCS stuff
const GROVEPIDEV = "GrovePi+";
dcl = dcl({debug: false});
var storePassword = 'Welcome1';
const INFRAREDDISTANCEINTERRUPTSENSOR = "urn:com:oracle:iot:device:grovepi:infrareddistanceinterrupt"
    , CAR = "urn:oracle:iot:device:model:car";

var urn = [
     CAR
];
var grovepi = new Device(GROVEPIDEV);
var sensors = [];
const storeFile = options.device;
var devices = [ grovepi ];

// Initializing REST server BEGIN
const PORT = process.env.GPSPORT || 8888
    , restURI = '/gps'
    , resetURI = '/resetroute'
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
// Initializing REST client END

// Init Devices
grovepi.setStoreFile(storeFile, storePassword);
grovepi.setUrn(urn);

// GrovePi stuff
var board    = undefined;
var lastData = undefined;
var timer    = undefined;

// Misc
const PROCESS = 'PROCESS';
const IOTCS   = 'IOTCS';
const GROVEPI = 'GROVEPI';
const REST    = 'REST';
log.timestamp = true;

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

async.series( {
  internet: function(callbackMainSeries) {
    log.info(PROCESS, "Checking for Internet & IoTCS server availability...");
    var URI = "/iot/api/v1/private/server";
    var retries = 0;
    async.retry({
      times: 99999999999,
      interval: 2000
    }, function(cb, results) {
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
    }, function(err, result) {
      if (!result) {
        // Server not available. Abort whole process
        log.error(PROCESS, "Server not available after %d attempts. Aborting process!", retries);
        process.exit(2);
      }
      log.info(PROCESS, "Server %s seems up & running...", options.iotcs);
      callbackMainSeries(null, true);
    });
  },
  iot: function(callbackMainSeries) {
    log.info(IOTCS, "Initializing IoTCS devices");
    log.info(IOTCS, "Using IoTCS JavaScript Libraries v" + dcl.version);
    async.eachSeries( devices, function(d, callbackEachSeries) {
      async.series( [
        function(callbackSeries) {
          // Initialize Device
          log.info(IOTCS, "Initializing IoT device '" + d.getName() + "'");
          d.setIotDcd(new dcl.device.DirectlyConnectedDevice(d.getIotStoreFile(), d.getIotStorePassword()));
          callbackSeries(null);
        },
        function(callbackSeries) {
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
        function(callbackSeries) {
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
          }, function(err) {
            if (err) {
              callbackSeries(err);
            } else {
              callbackSeries(null, true);
            }
          });
        }
      ], function(err, results) {
        callbackEachSeries(err);
      });
    }, function(err) {
      if (err) {
        callbackMainSeries(err);
      } else {
        log.info(IOTCS, "IoTCS device initialized successfully");
        callbackMainSeries(null, true);
      }
    });
  },
  grovepi: function(callbackMainSeries) {
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
      onInit: function(res) {
        if (res) {
          log.verbose(GROVEPI, 'GrovePi Version :: ' + board.version());
          log.verbose(GROVEPI, 'Initializing %d sensors', SENSORS.length);
          _.forEach(SENSORS, (s) => {
            log.verbose(GROVEPI, "Looking for Infrared Distance Interrupt sensor with id '%d' at digital port #%d", s.id, s.port);
            var infraredSensor = new GrovePi.sensors.base.Digital(s.port);
            sensors.push({ id: s.id, port: s.port, sensors: infraredSensor });
            log.verbose(GROVEPI, 'Start watch Infrared Distance Interrupt Sensor %d', s.id);
            infraredSensor.on('change', function(res) {
              var sensorData = { id: s.id };
              sensorData.presence = (res != "1");
              var vd = grovepi.getIotVd(INFRAREDDISTANCEINTERRUPTSENSOR);
              if (vd) {
                log.verbose(GROVEPI, 'Infrared Distance Interrupt onChange value = ' + JSON.stringify(sensorData));
                vd.update(sensorData);
              } else {
                log.error(IOTCS, "URN not registered: " + INFRAREDDISTANCEINTERRUPTSENSOR);
              }
            });
//            infraredSensor.watch();

            var us = new GrovePi.sensors.UltrasonicDigital(6);
            var pre = false;
            var flag = false;
            var processing = false;
            us.on('change', function(res) {
              if (!processing) {
                processing = true;
                console.log("res: " + res + " flag: " + flag);
                if (res <= 5) {
                  flag = true;
                } else {
                  flag = false;
                }
                if (pre !== flag) {
                  console.log(flag);
                  pre = flag;
                }
                processing = false;
              }
            });
            us.watch();

          });
        } else {
          log.error(GROVEPI, 'TEST CANNOT START')
        }
      }
    })
    board.init()
    callbackMainSeries(null, true);
  },
  rest: function(callbackMainSeries) {
    log.info(REST, "Initializing REST Server");
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
    app.use(restURI, router);
    router.post(resetURI, function(req, res) {
      res.status(200).send({
        result: "Success",
        message: "Route reset successfully"
      });
      res.end();
      console.log("request!!");
      console.log(req.body);
    });
    server.listen(PORT, function() {
      log.info(REST, "REST Server initialized successfully");
      callbackMainSeries(null, true);
    });

  }
}, function(err, results) {
  if (err) {
  } else {
    log.info(PROCESS, 'Initialization completed');
  }
});
