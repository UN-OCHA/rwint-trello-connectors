const URLSearchParams = require('node:url').URLSearchParams;

/**
 * Simple wrapper around the Trello data api.
 */
function TrelloClient(config, logger) {
  this.config = config;
  this.logger = logger;

  /**
   * Perform a request against the Trello API.
   */
  this.fetch = async (method, endpoint, parameters = {}, data = null) => {
    const options = {
      method: method,
    };

    const params = new URLSearchParams(parameters);
    params.append('key', this.config.key);
    params.append('token', this.config.token);

    const url = this.config.url + endpoint + '?' + params.toString();

    if (data) {
      options.headers = {'Content-Type': 'application/x-www-form-urlencoded'};
      options.body = new URLSearchParams(data).toString();
    }

    const response = await fetch(url, options);

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
      throw 'Trello API error for ' + method + ' request on ' + endpoint + ': ' + response.status + ' ' + response.statusText;
    }
  };

  /**
   * Get data from the trello API.
   */
  this.get = async (endpoint, data) => {
    return this.fetch('GET', endpoint, data);
  };

  /**
   * Put data to the Trello API.
   */
  this.put = async (endpoint, data) => {
    return this.fetch('PUT', endpoint, {}, data);
  };

  /**
   * Post data to the Trello API.
   */
  this.post = async (endpoint, data) => {
    return this.fetch('POST', endpoint, {}, data);
  };

  /**
   * Delete data from the Trello API.
   */
  this.delete = async (endpoint) => {
    return this.fetch('DELETE', endpoint);
  };

}

exports.TrelloClient = TrelloClient;
