/**
 * Disaster board manager.
 */
function DisasterManager(config, logger, trelloClient, rwapiClient, date) {
  this.config = config;
  this.logger = logger;
  this.trelloClient = trelloClient;
  this.rwapiClient = rwapiClient;
  this.date = date;

  this.board = null;
  this.disasters = null;

  this.lists = new Map();
  this.labels = new Map();

  // Current date.
  this.currentDate = this.date.format('D MMM YYYY');

  // Constants.
  this.maxIndex = 10000000;
  this.urlPattern = /^https?:\/\/reliefweb\.int\/taxonomy\/term\/\d+$/;
  this.profileUpdateHeader = '# Last Profile Update\n\n';
  this.profileHeader = '\n\n# Profile\n\n';
  this.glideHeader = '\n\n# Glide Number\n\n';

  // @todo retrieve the string from the config?
  this.profileUpdateOlderThan3Weeks = 'Profile Update > 3 Weeks';
  this.profileUpdateOlderThan2Weeks = 'Profile Update > 2 Weeks';
  this.profileUpdateOlderThan1Week = 'Profile Update > 1 Weeks';

  // @todo retrieve the string from the config?
  this.lastReportOlderThan2Months = 'Last Report > 2 Months';
  this.lastReportOlderThan1Month = 'Last Report > 1 Month';
  this.lastReportOlderThan1Week = 'Last Report > 1 Week';

  // Map of the positions of the status lists to help sorting the disasters.
  this.statusPositions = new Map(this.config.lists.map(item => [item.status, item.position]));

  /**
   * Main process function.
   */
  this.process = async () => {
    try {
      await this.getDisasters();
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
   * Retrieve the ReliefWeb disasters.
   */
  this.getDisasters = async () => {
    const data = {
      fields: {
        include: [
          'id',
          'url',
          'name',
          'date.created',
          'glide',
          'status',
          'profile.overview',
          'country.name',
          'country.shortname',
          'type.name',
          'type.code'
        ]
      },
      limit: 1000,
      filter: {
        field: 'status',
        value: this.config.lists.map(item => item.status),
      },
      sort: ['id:desc'],
    };

    const result = await this.rwapiClient.fetch('/disasters', data);
    if (!result || !result.data) {
      throw 'Unable to retrieve the ReliefWeb disasters';
    }

    if (result.data.length > 0) {
      // Prepare the disaster data.
      const disasters = result.data.map(item => this.prepareDisaster(item.fields));

      // Get the extra data for the disasters.
      await this.getExtraDisasterData(disasters);

      // Sort the disasters.
      this.sortDisasters(disasters);

      // Store the disasters.
      this.disasters = disasters;
    }
    else {
      this.disasters = [];
    }
  };

  /**
   * Prepare a disaster.
   */
  this.prepareDisaster = disaster => {
    if (!disaster.profile) {
      disaster.profile = {overview: ''};
    }

    // Truncate the overview if it's too long because Trello
    // has a limit on the card description length.
    if (disaster.profile.overview) {
      let overview = disaster.profile.overview;
      let paragraphs = overview.split(/\n{2,}/);
      if (paragraphs.length > 3) {
        paragraphs.push('[Read full description](' + disaster.url + ')');
        overview = '...\n\n' + paragraphs.slice(-4).join('\n\n').trim();
      }
      disaster.profile.overview = overview;
    }
    else {
      disaster.profile.overview = '';
    }

    // Keep compatibility with existing cards.
    disaster.url = disaster.url.replace(/^https:/, 'http:');

    // Position of the status list to help sort the disasters.
    disaster.statusPosition = this.statusPositions.get(disaster.status) || 0;

    // Set the glide number if not set so we can compare with the one extracted
    // from the disaster card description.
    if (typeof disaster.glide === 'undefined') {
      disaster.glide = '';
    }

    return disaster;
  };

  /**
   * Get extra data for the disasters.
   */
  this.getExtraDisasterData = async disasters => {
    const twoMonthAgo = this.date.clone().substract('months', 2).iso();
    const disasterMap = new Map();
    const facets = [];

    // Generate a list of facets to retrieve the information about the latest
    // published report for each disaster.
    for (const disaster of disasters) {
      disasterMap.set(String(disaster.id), disaster);

      // Add a facet on the day for the reports posted within the last 2 months
      // and a facet on the year so we can now if there was ever a report
      // posted for the disaster.
      facets.push({
        name: disaster.id + '-day',
        field: 'date.created',
        interval: 'day',
        sort: 'value:desc',
        filter: {
          conditions: [
            {
              field: 'disaster.id',
              value: disaster.id,
            },
            {
              field: 'status',
              value: 'published',
            },
            {
              field: 'date.created',
              value: {
                from: twoMonthAgo,
              },
            },
          ],
          operator: 'AND',
        },
      });
      facets.push({
        name: disaster.id + '-year',
        field: 'date.created',
        interval: 'year',
        sort: 'value:desc',
        filter: {
          conditions: [
            {
              field: 'disaster.id',
              value: disaster.id,
            },
            {
              field: 'status',
              value: 'published',
            },
          ],
          operator: 'AND',
        },
      });
    }

    // Retrieve the data form the ReliefWeb API.
    const data = await this.rwapiClient.fetch('/reports', {
      limit: 0,
      facets: facets,
    });
    if (!data || !data.embedded.facets) {
      throw 'Unable to retrieve extra disaster data';
    }

    // Update the disaster with the date of the latest posted documents.
    const results = data.embedded.facets;
    for (const key in results) {
      if (results.hasOwnProperty(key) && key.indexOf('-day') !== -1) {
        const id = key.slice(0, -4);
        const disaster = disasterMap.get(id);
        const facetDay = results[key];

        if (disaster) {
          // Check the number of days since the last published report.
          if (facetDay.data.length > 0) {
            const days = this.date.diffDays(facetDay.data[0].value);
            if (days > 60) {
              disaster.lastReport = 61;
            }
            else if (days > 30) {
              disaster.lastReport = 31;
            }
            else if (days > 7) {
              disaster.lastReport = 8;
            }
            else {
              disaster.lastReport = days;
            }
          }
          // Otherwise check if there was at least 1 report in the past.
          else if (results.hasOwnProperty(id + '-year') && results[id + '-year'].data.length > 0) {
            disaster.lastReport = 61;
          }
        }
      }
    }
  };

  /**
   * Sort the disasters by status list position asc and ID desc.
   */
  this.sortDisasters = disasters => {
    disasters.sort((a, b) => {
      if (a.pos === b.pos) {
        if (a.id < b.id) {
          return 1;
        }
        else if (a.id > b.id) {
          return -1;
        }
        return 0;
      }
      else if (a.pos < b.pos) {
        return -1;
      }
      return 1;
    });
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
      list_fields: 'name,closed',
      cards: 'all',
      card_fields: 'name,labels,idList,desc,closed,pos',
      card_attachments: 'true',
      card_attachment_fields: 'url',
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
    const boardLists = new Map();

    // Retrieve existing board lists.
    for (const list of this.board.lists) {
      boardLists.set(list.name, list);
    }

    // Set the manager lists, creating non existing ones.
    for (const item of this.config.lists) {
      if (boardLists.has(item.name)) {
        this.lists.set(item.status, boardLists.get(item.name));
      }
      else {
        const list = await this.trelloClient.post('/lists', {
          name: item.name,
          pos: item.position,
          idBoard: this.config.trello.boardId,
        });
        if (!list) {
          throw 'Unable to create list: ' + item.name;
        }
        else {
          this.lists.set(item.status, list);
          this.logger.info('Created list: ' + item.name);
        }
      }
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

    // Get the disaster type, country and status from the disasters.
    // Those are colorless labels.
    for (const disaster of this.disasters) {
      for (const item of disaster.type) {
        labels.set(item.name, '');
      }
      for (const item of disaster.country) {
        labels.set(item.name, '');
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
   * Extract the profile and glide sections from the card description.
   */
  this.prepareCard = card => {
    if (card.desc !== '') {
      const i1 = card.desc.lastIndexOf(this.profileUpdateHeader);
      const i2 = card.desc.lastIndexOf(this.profileHeader);
      const i3 = card.desc.lastIndexOf(this.glideHeader);

      const l1 = this.profileUpdateHeader.length;
      const l2 = this.profileHeader.length;
      const l3 = this.glideHeader.length;

      if (i1 !== -1 && i2 !== -1 && i3 !== -1) {
        card.profileUpdate = card.desc.substring(i1 + l1, i2);
        card.profile = card.desc.substring(i2 + l2, i3);
        card.glide = card.desc.substring(i3 + l3);
      }
    }
    return card;
  };

  /**
   * Get the labels for a disaster.
   */
  this.getDisasterLabels = disaster => {
    const labels = new Map();

    // Disaster types and countries.
    for (const item of disaster.type) {
      const label = this.labels.get(item.name);
      if (label) {
        labels.set(item.name, label.id);
      }
    }
    for (const item of disaster.country) {
      const label = this.labels.get(item.name);
      if (label) {
        labels.set(item.name, label.id);
      }
    }

    // Last posted report.
    if (disaster.lastReport > 60) {
      const label = this.labels.get(this.lastReportOlderThan2Months);
      if (label) {
        labels.set(label.name, label.id);
      }
    }
    else if (disaster.lastReport > 30) {
      const label = this.labels.get(this.lastReportOlderThan1Month);
      if (label) {
        labels.set(label.name, label.id);
      }
    }
    else if (disaster.lastReport > 7) {
      const label = this.labels.get(this.lastReportOlderThan1Week);
      if (label) {
        labels.set(label.name, label.id);
      }
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
   * Generate a card's description.
   */
  this.generateCardDescription = (disaster, updateDate) => {
    return [
      this.profileUpdateHeader,
      updateDate || this.currentDate,
      this.profileHeader,
      disaster.profile.overview || '',
      this.glideHeader,
      disaster.glide,
    ].join('');
  };

  /**
   * Update a card's labels.
   */
  this.updateCardLabels = async (card, disaster) => {
    let changed = false;

    // Disaster labels and warning label regarding last profile update.
    const labels = new Map([
      ...this.getDisasterLabels(disaster),
      ...this.getProfileUpdateLabel(card.profileUpdate),
    ]);

    // Remove old labels.
    for (const label of card.labels) {
      if (!labels.has(label.name)) {
        try {
          await this.trelloClient.delete('/cards/' + card.id + '/idLabels/' + label.id);
          this.logger.debug('Removed old label ' + label.name + ' for card ' + card.name);
          changed = true;
        }
        catch (exception) {
          this.logger.error('Unable to remove old label ' + label.name + ' for card ' + card.name);
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
   * Update a Trello card.
   */
  this.updateCard = async (position, card, disaster) => {
    const data = new Map();

    // Update list in which the card should be if the disaster status changed.
    if (card.idList !== this.lists.get(disaster.status).id) {
      this.logger.debug('Updated list ID of card ' + card.name);
      data.set('idList', this.lists.get(disaster.status).id);
    }

    // Update the card position if necessary.
    if (Number(parseFloat(card.pos).toFixed()) !== position) {
      this.logger.debug('Updated position of card ' + card.name);
      data.set('pos', position);
    }

    // Unarchive if necessary.
    if (card.closed) {
      this.logger.debug('Unarchived card ' + card.name);
      data.set('closed', 'false');
    }

    // Update the card name if necessary.
    if (card.name !== disaster.name) {
      this.logger.debug('Updated name of card ' + card.name);
      data.set('name', 'disaster.name');
    }

    // If the disaster profile changed, set the new update date.
    if (disaster.profile.overview !== card.profile) {
      card.profileUpdate = this.currentDate;
    }

    // Check the description and update the labels.
    if (disaster.profile.overview !== card.profile || disaster.glide !== card.glide) {
      this.logger.debug('Updated description of card ' + card.name);
      data.set('desc', this.generateCardDescription(disaster, card.profileUpdate));
    }

    // Update the card labels.
    let changed = await this.updateCardLabels(card, disaster);
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
   * Create a Trello card.
   */
  this.createCard = async (position, disaster) => {
    const data = {
      idList: this.lists.get(disaster.status).id,
      urlSource: '',
      name: disaster.name,
      desc: this.generateCardDescription(disaster),
      pos: position,
      idLabels: Array.from(this.getDisasterLabels(disaster).values()).join(','),
    };

    // Create the card.
    let card;
    try {
      card = await this.trelloClient.post('/cards', data);
      this.logger.info('Created card ' + disaster.name);
    }
    catch (exception) {
      this.logger.error('Unable to create card ' + disaster.name + ': ' + exception);
      return;
    }

    // Add the disaster URL as attachment.
    try {
      await this.trelloClient.post('/cards/' + card.id + '/attachments', {
        url: disaster.url,
      });
      this.logger.debug('Added url ' + disaster.url + ' to card ' + disaster.name);
    }
    catch (exception) {
      this.logger.error('Unable to set the URL ' + disaster.url + ' to card ' + disaster.name);
    }
  };

  /**
   * Archive a Trello card.
   */
  this.archiveCard = async (card) => {
    if (card.closed === false) {
      try {
        await this.trelloClient.put('/cards/' + card.id, {
          closed: 'true',
        });
        this.logger.info('Archived card ' + card.name);
      }
      catch (exception) {
        this.logger.error('Unable to archive card ' + card.name + ': ' + exception);
      }
    }
  };

  /**
   * Update the Trello board.
   */
  this.updateBoard = async () => {
    const cards = new Map();

    // Get the list of existing disaster cards.
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

    // Update or create the disaster cards.
    let updated = 0;
    for (const disaster of this.disasters) {
      const position = this.maxIndex - disaster.id;
      if (cards.has(disaster.url)) {
        if (await this.updateCard(position, cards.get(disaster.url), disaster)) {
          updated++;
        }
        cards.delete(disaster.url);
      }
      else {
        await this.createCard(position, disaster);
        updated++;
      }
    }
    this.logger.info('Updated/created ' + updated + ' card(s)');

    // Archive the remaining disaster cards as they were not in the list of
    // disasters to monitor.
    if (cards.size > 0) {
      // Map of the status lists keyed by list ID.
      const lists = new Map();
      for (const list of this.lists.values()) {
        lists.set(list.id, list.name);
      }

      // Only archive cards that are in the status lists.
      let archived = 0;
      for (const card of cards.values()) {
        if (lists.has(card.idList)) {
          await this.archiveCard(card);
          archived++;
        }
      }
      this.logger.info('Archived ' + archived + ' card(s)');
    }
  };
}

/**
 * Execute logic.
 */
const config = JSON.parse(process.env.CONFIG);

const Logger = require('./libs/logger.js').Logger;
const logger = new Logger(config.debug);

const TrelloClient = require('./libs/trello.js').TrelloClient;
const trelloClient = new TrelloClient(config.trello, logger);

const RWApiClient = require('./libs/rwapi.js').RWApiClient;
const rwapiClient = new RWApiClient(config.rwapi, logger);

const DateWrapper = require('./libs/date.js').DateWrapper;

const manager = new DisasterManager(config, logger, trelloClient, rwapiClient, new DateWrapper());
manager.process();
