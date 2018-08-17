'use strict';

function sleep(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}

function loop(tids, times, timeout, fn) {
    return new Promise(resolve => {
        let c = 1;
        tids.tid0 = setInterval(() => {
            if (times > 0 && c > times) {
                clearInterval(tids.tid0);
                return resolve();
            }
            fn(c++);
        }, timeout);
    });
}

module.exports = {
    loop,
    sleep
};
