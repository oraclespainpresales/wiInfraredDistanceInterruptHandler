var method = LCD.prototype;

const {
    GroveLCDRGB
} = require('grove-lcd-rgb');

const {
    loop: _loop,
    sleep
} = require('./helper');

const _ = require('lodash')
    , async = require('async')
;

const lcd = new GroveLCDRGB()
    , tids = { tid0: null }
;

const ON = "on", OFF = "off", WRITE = "write", CLEAR = "clear", LOOP = "loop", COLOR = "color", WAIT = "wait"
    , VALIDACTIONS = [ ON, OFF, WRITE, CLEAR, LOOP, COLOR, WAIT ]
    , LOG = "LCD"
;

var log = _.noop();

function LCD(_log) {
  log = _log;
  log.info(LOG, "Constructor");
}

method.execute = steps => {
  return new Promise( (resolve, reject) => {
    if (!_.isArray(steps)) {
      log.error(LOG, "Execute object not an array");
      reject();
    }
    async.eachSeries(steps, (step, next) => {
      if (!step.action || !_.includes(VALIDACTIONS, step.action)) {
          log.error(LOG, "Unknown action '%s'. Valid actions: %s", step.action, VALIDACTIONS.join(", "));
          next();
          return;
      }
      if ( step.action == ON) {
        lcd.on();
        next();
      } else if ( step.action == OFF) {
        lcd.on();
        next();
      } else if ( step.action == WRITE) {
        if (step.clear) {
          lcd.clear();
          lcd.setCursor(0, 0);
          next();
        }
        if (step.color) {
          lcd.setRGB(step.color[0], step.color[1], step.color[2]);
          next();
        }
        if (step.text) {
          lcd.setText(step.text);
          next();
        }
      } else if ( step.action == CLEAR) {
        lcd.clear();
        lcd.setCursor(0, 0);
        next();
      } else if ( step.action == LOOP) {
        // TODO
      } else if ( step.action == COLOR) {
        if (step.color) {
          lcd.setRGB(step.color[0], step.color[1], step.color[2]);
          next();
        }
      } else if ( step.action == WAIT) {
        sleep(step.time).then(() => next());
      }
    }, (err) => {
      if (err) { reject(err) } else { resolve() }
    });
  });
}

method.off = () => {
  lcd.off();
}

method.write = text => {
  lcd.setText(text);
}

module.exports = LCD;