/**
 * Simple logger.
 */
function Logger(debugEnabled = true) {
  this.debugEnabled = debugEnabled;

  this.prefix = level => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return '[' + timestamp + '] [' + level.toUpperCase() + ']';
  };

  this.error = message => {
    console.log(this.prefix('ERROR'), message);
  };

  this.info = message => {
    console.log(this.prefix('INFO'), message);
  };

  this.debug = (...args) => {
    if (this.debugEnabled) {
      console.log(this.prefix('DEBUG'), ...args);
    }
  };
}

exports.Logger = Logger;
