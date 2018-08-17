var method = LCD.prototype;

const {
    GroveLCDRGB
} = require('grove-lcd-rgb');

const {
    loop: _loop,
    sleep
} = require('./helper');

const _ = require('lodash');

const lcd = new GroveLCDRGB()
    , tids = { tid0: null }
;
function LCD() {
  console.log("constructor");
}

method.execute = steps => {
  console.log(steps);
}

method.off = () => {
  lcd.off();
}

method.write = text => {
  lcd.setText(text);
}

module.exports = LCD;
