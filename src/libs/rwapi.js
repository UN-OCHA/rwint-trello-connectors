const URLSearchParams = require('node:url').URLSearchParams;

/**
 * Simple wrapper around the ReliefWeb API.
 */
function RWApiClient(config, logger) {
  this.config = config;
  this.logger = logger;

  /**
   * Perform a request against the ReliefWeb API.
   *
   * Note: it's a post request with a JSON payload.
   */
  this.fetch = async (endpoint, data) => {
    const params = new URLSearchParams({
      appname: this.config.appname,
      preset: this.config.preset,
      slim: 1,
      timestamp: new Date().getTime(),
    });

    const response = await fetch(this.config.url + endpoint + '?' + params.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      const data = await response.json();
      return data;
    }
    else {
      try {
        const error = await response.json();
        if (error) {
          this.logger.debug(error);
        }
      }
      catch (exception) {
        // Nothing to do.
      }
      throw 'ReliefWeb API error for request on ' + endpoint + ': ' + response.status + ' ' + response.statusText;
    }
  };

}

exports.RWApiClient = RWApiClient;
