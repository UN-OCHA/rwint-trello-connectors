/**
 * Country board manager.
 */
function CountryManager(config, logger, trelloClient, rwapiClient, date) {
  this.config = config;
  this.logger = logger;
  this.trelloClient = trelloClient;
  this.rwapiClient = rwapiClient;
  this.date = date;

  this.board = null;
  this.countries = null;

  this.lists = new Map();
  this.labels = new Map();

  // Current date.
  this.currentDate = this.date.format('D MMM YYYY');

  // Constants.
  this.maxIndex = 10000000;
  this.urlPattern = /^https?:\/\/reliefweb\.int\/taxonomy\/term\/\d+$/;
  this.profileUpdateHeader = '# Last Profile Update\n\n';
  this.profileHeader = '\n\n# Profile\n\n';

  // @todo retrieve the string from the config?
  this.ongoingSituation = 'Ongoing Situation';
  this.profileChecked = 'Profile Checked';
  this.profileUpdateOlderThan3Weeks = 'Profile Update > 3 Weeks';
  this.profileUpdateOlderThan2Weeks = 'Profile Update > 2 Weeks';
  this.profileUpdateOlderThan1Week = 'Profile Update > 1 Weeks';

  /**
   * Main process function.
   */
  this.process = async () => {
    try {
      await this.getCountries();
      await this.getBoard();
      await this.prepareLists();
      await this.prepareLabels();
      await this.updateBoard();
    }
    catch (exception) {
      this.logger.error(exception);
    }
  };

  /**
   * Retrieve the ReliefWeb countries.
   */
  this.getCountries = async () => {
    const data = {
      fields: {
        include: [
          'id',
          'url',
          'name',
          'shortname',
          'iso3',
          'status',
          'description',
        ]
      },
      limit: 1000,
      sort: ['id:desc'],
    };

    const result = await this.rwapiClient.fetch('/countries', data);
    if (!result || !result.data || result.data.length === 0) {
      throw 'Unable to retrieve the ReliefWeb countries';
    }

    if (result.data.length > 0) {
      // Prepare the country data.
      const countries = result.data.map(item => this.prepareCountry(item.fields));

      // Store the countries.
      this.countries = countries;
    }
    else {
      this.countries = [];
    }
  };

  /**
   * Prepare a country.
   */
  this.prepareCountry = country => {
    if (!country.description) {
      country.description = '';
    }

    // Keep compatibility with existing cards.
    country.url = country.url.replace(/^https:/, 'http:');

    return country;
  };

  /**
   * Retrieve the Trello board data.
   */
  this.getBoard = async () => {
    const data = {
      labels: 'all',
      label_fields: 'name,color',
      labels_limit: 1000,
      lists: 'open',
      list_fields: 'name',
      cards: 'open',
      card_fields: 'name,labels,idList,desc',
      card_attachments: 'true',
      card_attachment_fields: 'url,name',
      fields: 'name'
    };

    const result = await this.trelloClient.get('/boards/' + this.config.trello.boardId, data);
    if (!result) {
      throw 'Unable to retrieve the Trello board data';
    }
    this.board = result;
  };

  /**
   * Retrieve, and create if necessary, the board lists.
   */
  this.prepareLists = async () => {
    // Map the board lists by ID.
    for (const list of this.board.lists) {
      this.lists.set(list.id, list);
    }
  };

  /**
   * Retrieve, and create if necessary, the board labels.
   */
  this.prepareLabels = async () => {
    const labels = new Map();
    const boardLabels = new Map();

    // Retrieve existing board labels.
    for (const label of this.board.labels) {
      if (label.name !== '') {
        boardLabels.set(label.name, label);
      }
    }

    // Get the configuration labels.
    for (const name in this.config.labels) {
      if (this.config.labels.hasOwnProperty(name)) {
        labels.set(name, this.config.labels[name]);
      }
    }

    // Get the country iso3 and shortname labels.
    // Those are colorless labels.
    for (const country of this.countries) {
      if (country.iso3) {
        labels.set(country.iso3, '');
      }
      if (country.shortname) {
        labels.set(country.shortname, '');
      }
    }

    // Set the manager labels, creating non existing ones.
    for (const [name, color] of labels) {
      if (boardLabels.has(name)) {
        this.labels.set(name, boardLabels.get(name));
      }
      else {
        const label = await this.trelloClient.post('/labels', {
          name: name,
          color: color,
          idBoard: this.config.trello.boardId,
        });
        if (!label) {
          throw 'Unable to create label: ' + name;
        }
        else {
          this.labels.set(name, label);
          this.logger.info('Created label: ' + name);
        }
      }
    }
  };

  /**
   * Extract the last profile update date from the card description.
   */
  this.prepareCard = card => {
    if (card.desc !== '') {
      const i1 = card.desc.lastIndexOf(this.profileUpdateHeader);
      const i2 = card.desc.lastIndexOf(this.profileHeader);
      const l1 = this.profileUpdateHeader.length;
      const l2 = this.profileHeader.length;

      if (i1 !== -1) {
        if (i2 !== -1) {
          card.profileUpdate = card.desc.substring(i1 + l1, i2).trim();
          card.description = card.desc.substring(i2 + l2);
        }
        else {
          card.profileUpdate = card.desc.substring(i1 + l1).trim();
          card.description = '';
        }
      }
    }
    return card;
  };

  /**
   * Get the labels for a country.
   */
  this.getCountryLabels = country => {
    const labels = new Map();

    // Ongoing situation.
    if (this.labels.has(this.ongoingSituation) && this.config.statuses[country.status] === 'ongoing') {
      labels.set(this.ongoingSituation, this.labels.get(this.ongoingSituation).id);
    }
    // Profile checked.
    if (this.labels.has(this.profileChecked) && country.description) {
      labels.set(this.profileChecked, this.labels.get(this.profileChecked).id);
    }
    // ISO3.
    if (country.iso3 && this.labels.has(country.iso3)) {
      labels.set(country.iso3, this.labels.get(country.iso3).id);
    }
    // Shortname.
    if (country.shortname && this.labels.has(country.shortname)) {
      labels.set(country.shortname, this.labels.get(country.shortname).id);
    }

    return labels;
  };

  /**
   * Get the label for the profile last update.
   */
  this.getProfileUpdateLabel = lastUpdate => {
    const labels = new Map();

    // Get the number of days since the last update.
    const days = this.date.diffDays(lastUpdate);

    // Last profile update.
    if (days > 21) {
      const label = this.labels.get(this.profileUpdateOlderThan3Weeks);
      if (label) {
        labels.set(label.name, label.id);
      }
    }
    else if (days > 14) {
      const label = this.labels.get(this.profileUpdateOlderThan2Weeks);
      if (label) {
        labels.set(label.name, label.id);
      }
    }
    else if (days > 7) {
      const label = this.labels.get(this.profileUpdateOlderThan1Week);
      if (label) {
        labels.set(label.name, label.id);
      }
    }

    return labels;
  };

  /**
   * Update a card's labels.
   */
  this.updateCardLabels = async (card, country) => {
    let changed = false;

    // Country labels and warning label regarding last profile update.
    const labels = new Map([
      ...this.getCountryLabels(country),
      ...this.getProfileUpdateLabel(card.profileUpdate),
    ]);

    // Remove old labels but only country and config ones so that editors
    // can add custom labels.
    for (const label of card.labels) {
      if (!labels.has(label.name)) {
        if (this.labels.has(label.name)) {
          try {
            await this.trelloClient.delete('/cards/' + card.id + '/idLabels/' + label.id);
            this.logger.debug('Removed old label ' + label.name + ' for card ' + card.name);
            changed = true;
          }
          catch (exception) {
            this.logger.error('Unable to remove old label ' + label.name + ' for card ' + card.name);
          }
        }
      }
      else {
        labels.delete(label.name);
      }
    }

    // Add new labels.
    for (const [name, id] of labels) {
      try {
        await this.trelloClient.post('/cards/' + card.id + '/idLabels', {
          value: id,
        });
        this.logger.debug('Added new label ' + name + ' for card ' + card.name);
        changed = true;
      }
      catch (exception) {
        this.logger.error('Unable to add label ' + name + ' for card ' + card.name + ': ' + exception);
      }
    }

    return changed;
  };

  /**
   * Generate a card's description.
   */
  this.generateCardDescription = (country) => {
    return [
      this.profileUpdateHeader,
      this.currentDate,
      this.profileHeader,
      country.description || '',
    ].join('');
  };

  /**
   * Update a Trello card.
   */
  this.updateCard = async (card, country) => {
    const data = new Map();

    // Update the description.
    if (country.description !== '') {
      if (card.description !== country.description) {
        data.set('desc', this.generateCardDescription(country));
        this.logger.debug('Update description for ' + country.name);
      }
    }
    else if (card.description === '') {
      data.set('desc', '');
      this.logger.debug('Removed description for ' + country.name);
    }

    // Update the card labels.
    let changed = await this.updateCardLabels(card, country);
    if (changed) {
      this.logger.info('Updated labels for card ' + card.name);
    }

    // Update the card if necessary.
    if (data.size > 0) {
      try {
        await this.trelloClient.put('/cards/' + card.id, Object.fromEntries(data));
        this.logger.info('Updated card ' + card.name);
        changed = true;
      }
      catch (exception) {
        this.logger.error('Unable to update card ' + card.name + ': ' + exception);
      }
    }
    else {
      this.logger.info('No changes for card ' + card.name);
    }
    return changed;
  };

  /**
   * Update the Trello board.
   */
  this.updateBoard = async () => {
    const cards = new Map();

    // Update the card descriptions.
    for (const card of this.board.cards) {
      if (card.attachments) {
        for (const attachment of card.attachments) {
          if (this.urlPattern.test(attachment.url)) {
            cards.set(attachment.url, this.prepareCard(card));
            break;
          }
        }
      }
    }

    // Get the list of existing country cards.
    let updated = 0;
    for (const country of this.countries) {
      if (cards.has(country.url)) {
        if (await this.updateCard(cards.get(country.url), country)) {
          updated++;
        }
      }
    }
    this.logger.info('Updated ' + updated + ' card(s)');
  };
}

/**
 * Execute logic.
 */
const config = require(process.env.CONFIG);

const Logger = require('./libs/logger.js').Logger;
const logger = new Logger(config.debug);

const TrelloClient = require('./libs/trello.js').TrelloClient;
const trelloClient = new TrelloClient(config.trello, logger);

const RWApiClient = require('./libs/rwapi.js').RWApiClient;
const rwapiClient = new RWApiClient(config.rwapi, logger);

const DateWrapper = require('./libs/date.js').DateWrapper;

const manager = new CountryManager(config, logger, trelloClient, rwapiClient, new DateWrapper());
manager.process();
