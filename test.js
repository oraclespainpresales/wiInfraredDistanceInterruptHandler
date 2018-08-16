'use strict';

// Module imports
const async = require('async')
    , GrovePi = require('node-grovepi').GrovePi
    , log = require('npmlog-ts')
    , _ = require('lodash')
;

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
      var led = new GrovePi.sensors.DigitalOutput(5);
      led.turnOn();
    }
  }
});
board.init()
