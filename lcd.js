var method = LCD.prototype;

const {
    GroveLCDRGB
} = require('grove-lcd-rgb');

const {
    loop,
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
      }
      if ( step.action == ON) {
        lcd.on();
        next();
      } else if ( step.action == OFF) {
        lcd.setRGB(0, 0, 0);
        lcd.clear();
        lcd.off();
        next();
      } else if ( step.action == WRITE) {
        if (step.clear) {
          lcd.clear();
          lcd.setCursor(0, 0);
        }
        if (step.color) {
          lcd.setRGB(step.color[0], step.color[1], step.color[2]);
        }
        if (step.goto) {
          lcd.setCursor(step.goto[0], step.goto[1]);
        }
        if (step.text) {
          if (step.raw) {
            lcd.setTextRaw(step.text);
          } else {
            lcd.setText(step.text);
          }
        }
        next();
      } else if ( step.action == CLEAR) {
        lcd.clear();
        lcd.setCursor(0, 0);
        next();
      } else if ( step.action == LOOP) {
        if (!step.param || !step.param.loops || !step.param.interval ) {
          log.error(LOG, "Invalid loop action: %j", step.param);
          next();
          return;
        }
        if (!step.param.action || !_.includes(VALIDACTIONS, step.param.action)) {
          log.error(LOG, "Unknown loop action '%s'. Valid actions: %s", step.param.action, VALIDACTIONS.join(", "));
          next();
          return;
        }
        loop(tids, step.param.loops, step.param.interval, (i) => {
          if ( step.param.action == WRITE) {
            if (step.param.clear) {
              lcd.clear();
              lcd.setCursor(0, 0);
            }
            if (step.param.goto) {
              lcd.setCursor(step.param.goto[0], step.param.goto[1]);
            }
            if (step.param.text) {
              let c = i;
              if (step.param.reversed) {
                c = step.param.loops + 1 - i;
              }
              var text = step.param.text.replace('%d', c);
              if (step.param.raw) {
                lcd.setTextRaw(text);
              } else {
                lcd.setText(text);
              }
            }
          }
        }).then(() => {next()});
      } else if ( step.action == COLOR) {
        if (step.color) {
          lcd.setRGB(step.color[0], step.color[1], step.color[2]);
        }
        next();
      } else if ( step.action == WAIT) {
        sleep(step.time).then(() => next());
      }
    }, (err) => {
      if (err) { reject(err) } else { resolve() }
    });
  });
}

method.color = (r,g,b) => {
  lcd.setRGB(r, g, b);
}

method.off = () => {
  lcd.off();
}

method.clear = () => {
  lcd.clear();
}

method.write = text => {
  lcd.setText(text);
}

module.exports = LCD;
