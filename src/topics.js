/**
 * Topic board manager.
 */
function TopicManager(config, logger, trelloClient, rwapiClient, date) {
  this.config = config;
  this.logger = logger;
  this.trelloClient = trelloClient;
  this.rwapiClient = rwapiClient;
  this.date = date;

  this.board = null;
  this.topics = null;

  this.lists = new Map();
  this.labels = new Map();

  // Constants.
  this.maxIndex = 10000000;
  this.urlPattern = /^https?:\/\/reliefweb\.int\/node\/\d+$/;
  this.lastUpdateHeader = '# Last Update\n\n';
  this.introductionHeader = '\n\n# Introduction\n\n';
  this.lastUpdateFormat = 'D MMM YYYY hh:mm:ss UTC';
  this.resourcePattern = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)</g;

  // @todo retrieve the string from the config?
  this.lastUpdateOlderThan2Months = 'Last Update > 2 Months';
  this.lastUpdateOlderThan1Month = 'Last Update > 1 Month';
  this.lastUpdateOlderThan1Week = 'Last Update > 1 Week';

  // Map of the positions of the status lists to help sorting the topics.
  this.statusPositions = new Map(this.config.lists.map(item => [item.status, item.position]));

  /**
   * Main process function.
   */
  this.process = async () => {
    try {
      await this.getTopics();
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
   * Retrieve the ReliefWeb topics.
   */
  this.getTopics = async () => {
    const data = {
      fields: {
        include: [
          'id',
          'url',
          'title',
          'date.changed',
          'status',
          'featured',
          'introduction',
          'rivers',
          'resources-html',
          'disaster_type.name',
          'theme.name',
        ],
      },
      limit: 1000,
      filter: {
        field: 'status',
        value: this.config.lists.map(item => item.status),
      },
      sort: ['id:desc'],
    };

    const result = await this.rwapiClient.fetch('/topics', data);
    if (!result || !result.data) {
      throw 'Unable to retrieve the ReliefWeb topics';
    }

    if (result.data.length > 0) {
      // Prepare the topic data.
      const topics = result.data.map(item => this.prepareTopic(item.fields));

      // Sort the topics.
      this.sortTopics(topics);

      // Store the topics.
      this.topics = topics;
    }
    else {
      this.topics = [];
    }
  };

  /**
   * Prepare a topic.
   */
  this.prepareTopic = topic => {
    // Truncate the introduction if it's too long because Trello
    // has a limit on the card description length.
    if (topic.introduction) {
      let introduction = topic.introduction;
      let paragraphs = introduction.split(/\n{2,}/);
      if (paragraphs.length > 3) {
        paragraphs.push('[Read full introduction](' + topic.url + ')');
        introduction = '...\n\n' + paragraphs.slice(-4).join('\n\n').trim();
      }
      topic.introduction = introduction;
    }
    else {
      topic.introduction = '';
    }

    // Position of the status list to help sort the topics.
    topic.statusPosition = this.statusPositions.get(topic.status) || 0;

    // Get the last update (changed date).
    topic.lastUpdate = this.date.clone(topic.date.changed).format(this.lastUpdateFormat);

    const rivers = new Map();
    const sections = new Map();
    const resources = new Map();

    // Add the river and sections.
    if (topic.hasOwnProperty('rivers')) {
      for (const river of topic.rivers) {
        const list = river.id.indexOf('section-') === 0 ? sections : rivers;
        river.name = this.generateMarkdownLink(river.url, river.title);
        river.position = list.size + 1;
        list.set(river.url, river);
      }
    }

    // Add the resource links.
    if (topic.hasOwnProperty('resources-html')) {
      for (const match of topic['resources-html'].matchAll(this.resourcePattern)) {
        const url = match[1].trim();
        const title = match[2].trim();
        resources.set(url, {
          url: url,
          title: title || url,
          name: this.generateMarkdownLink(url, title),
          position: resources.size + 1,
        });
      }
    }

    topic.checklists = new Map([
      ['Rivers', rivers],
      ['Sections', sections],
      ['Resources', resources],
    ]);

    return topic;
  };

  /**
   * Generate a markdown link.
   */
  this.generateMarkdownLink = (url, title) => {
    return '[' + title + '](' + url + ')';
  };

  /**
   * Sort the topics by status list position asc and ID desc.
   */
  this.sortTopics = topics => {
    topics.sort((a, b) => {
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
   * Get the board's cards.
   */
  this.getCards = async board => {
    const data = {
      fields: 'name,labels,idList,desc,closed,pos',
      attachments: 'true',
      attachment_fields: 'url',
      checklists: 'all',
      checklist_fields: 'name,pos',
    };

    try {
      const cards = await this.trelloClient.get('/boards/' + board.id + '/cards', data);
      board.cards = new Map();
      for (const cardId in cards) {
        if (cards.hasOwnProperty(cardId)) {
          board.cards.set(cards[cardId].id, cards[cardId]);
        }
      }
      this.logger.debug('Loaded cards of board ' + board.id);
    }
    catch (exception) {
      this.logger.error('Unable to load cards of board ' + board.id);
    }
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
      fields: 'name',
    };

    const result = await this.trelloClient.get('/boards/' + this.config.trello.boardId, data);
    if (!result) {
      throw 'Unable to retrieve the Trello board data';
    }

    this.board = result;

    await this.getCards(this.board);
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

    // Get the disaster type, and theme from the topics.
    // Those are colorless labels.
    for (const topic of this.topics) {
      if (topic.disaster_type) {
        for (const item of topic.disaster_type) {
          labels.set(item.name, '');
        }
      }
      if (topic.theme) {
        for (const item of topic.theme) {
          labels.set(item.name, '');
        }
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
      const i1 = card.desc.lastIndexOf(this.lastUpdateHeader);
      const i2 = card.desc.lastIndexOf(this.introductionHeader);

      const l1 = this.lastUpdateHeader.length;
      const l2 = this.introductionHeader.length;

      if (i1 !== -1 && i2 !== -1) {
        card.lastUpdate = card.desc.substring(i1 + l1, i2);
        card.introduction = card.desc.substring(i2 + l2);
        card.desc = card.desc.substring(0, i1);
      }
    }
    return card;
  };

  /**
   * Get the labels for a topic.
   */
  this.getTopicLabels = topic => {
    const labels = new Map();

    // Disaster types and themes.
    if (topic.disaster_type) {
      for (const item of topic.disaster_type) {
        const label = this.labels.get(item.name);
        if (label) {
          labels.set(item.name, label.id);
        }
      }
    }
    if (topic.theme) {
      for (const item of topic.theme) {
        const label = this.labels.get(item.name);
        if (label) {
          labels.set(item.name, label.id);
        }
      }
    }

    // Featured label.
    if (topic.featured === true) {
      const label = this.labels.get('Featured');
      if (label) {
        labels.set(label.name, label.id);
      }
    }

    // Status label.
    const label = this.labels.get(this.lists.get(topic.status).name);
    if (label) {
      labels.set(label.name, label.id);
    }

    // Get the number of days since the last update.
    const days = this.date.diffDays(topic.date.changed);

    // Last update.
    if (days > 60) {
      const label = this.labels.get(this.lastUpdateOlderThan2Months);
      if (label) {
        labels.set(label.name, label.id);
      }
    }
    else if (days > 30) {
      const label = this.labels.get(this.lastUpdateOlderThan1Month);
      if (label) {
        labels.set(label.name, label.id);
      }
    }
    else if (days > 7) {
      const label = this.labels.get(this.lastUpdateOlderThan1Week);
      if (label) {
        labels.set(label.name, label.id);
      }
    }

    return labels;
  };

  /**
   * Generate a card's description.
   */
  this.generateCardDescription = (description, updateDate, introduction) => {
    return [
      description,
      this.lastUpdateHeader,
      updateDate,
      this.introductionHeader,
      introduction || '',
    ].join('');
  };

  /**
   * Update a card's labels.
   */
  this.updateCardLabels = async (card, topic) => {
    let changed = false;

    // Topic labels.
    const labels = this.getTopicLabels(topic);

    // Remove old labels but only topic and config ones so that editors
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
   * Add a checklist item.
   */
  this.addCheckItem = async (checklistId, item) => {
    try {
      await this.trelloClient.post('/checklists/' + checklistId + '/checkItems', {
        name: item.name,
        pos: item.position,
      });
      this.logger.debug('Added checklist item ' + item.url);
    }
    catch (exception) {
      this.logger.error('Unable to add checklist item ' + item.url + ' to list ' + checklistId);
    }
  };

  /**
   * Update a checklist item.
   */
  this.updateCheckItem = async (cardId, checklistId, id, item) => {
    try {
      await this.trelloClient.put('/cards/' + cardId + '/checklist/' + checklistId + '/checkItem/' + id, {
        idChecklistCurrent: checklistId,
        idCheckItem: id,
        name: item.name,
        pos: item.position,
      });
      this.logger.debug('Updated checklist item ' + id);
    }
    catch (exception) {
      this.logger.error('Unable to update checklist item ' + id);
    }
  };

  /**
   * Delete a checklist item.
   */
  this.deleteCheckItem = async (checklistId, id) => {
    try {
      await this.trelloClient.delete('/checklists/' + checklistId + '/checkItems/' + id, {
        idCheckItem: id,
      });
      this.logger.debug('Deleted checklist item ' + id);
    }
    catch (exception) {
      this.logger.error('Unable to delete checklist item ' + id);
    }
  };

  /**
   * Add a checklist.
   */
  this.addChecklist = async (cardId, name, items) => {
    try {
      const checklist = await this.trelloClient.post('/cards/' + cardId + '/checklists', {
        name: name,
      });
      this.logger.debug('Added checklist ' + name);

      // Add all check lis titems.
      for (const item of items.values()) {
        this.logger.debug('Adding checklist item ' + item.url);
        await this.addCheckItem(checklist.id, item);
      }
    }
    catch (exception) {
      this.logger.error('Unable to add checklist ' + name + ' to card ' + cardId);
    }
  };

  /**
   * Update achecklist: add, update or remove items.
   */
  this.updateChecklist = async (cardId, checklist, items) => {
    let changed = false;

    // Update or delete exisiting items.
    for (const checkitem of checklist.checkItems) {
      if (checkitem.name.indexOf('](') > 0) {
        const parts = checkitem.name.split('](');
        const title = parts[0].slice(1);
        const url = parts[1].slice(0, -1);

        if (items.has(url)) {
          let item = items.get(url);

          // Update if title changed.
          if (item.title != title || item.position != checkitem.pos) {
            await this.updateCheckItem(cardId, checklist.id, checkitem.id, item);
            items.delete(url);
            changed = true;
          }

          // Remove the item from the list so it's not processed when adding
          // new actions below.
          items.delete(url);
        }
        // Otherwise, if there is no corresponding item, remove it.
        else {
          await this.deleteCheckItem(checklist.id, checkitem.id);
        }
      }
    }

    // Add new items.
    for (const action of items.values()) {
      this.logger.debug('Adding checklist item ' + action.name);
      await this.addCheckItem(checklist.id, action);
      changed = true;
    }

    return changed;
  };

  /**
   * Delete a board checklist.
   */
  this.deleteChecklist = async (id) => {
    try {
      await this.trelloClient.delete('/checklists/' + id);
      this.logger.debug('Deleted checklist ' + id);
    }
    catch (exception) {
      this.logger.error('Unable to delete checklist ' + id);
    }
  };

  /**
   * Update a card's checklists.
   */
  this.updateCardChecklists = async (card, topic) => {
    let changed = false;

    var checklists = new Map();
    if (card.checklists) {
      for (const checklist of card.checklists) {
        checklists.set(checklist.name, checklist);
      }
    }

    for (const [name, items] of topic.checklists) {
      if (!checklists.has(name)) {
        await this.addChecklist(card.id, name, items);
        changed = true;
      }
      else {
        if (await this.updateChecklist(card.id, checklists.get(name), items)) {
          changed = true;
        }
      }
    }

    return changed;
  };

  /**
   * Update a Trello card.
   */
  this.updateCard = async (position, card, topic) => {
    let changed = false;

    // Store the card data to update.
    const data = new Map();

    // Check if the card is in a automatically managed list (status list).
    let managedList = false;
    for (const list of this.lists.values()) {
      if (card.idList === list.id) {
        managedList = true;
        break;
      }
    }

    // Update list in which the card should be if the topic status changed.
    if (managedList && card.idList !== this.lists.get(topic.status).id) {
      this.logger.debug('Updated list ID of card ' + card.name);
      data.set('idList', this.lists.get(topic.status).id);
    }

    // Update the card position if necessary.
    if (managedList && Number(parseFloat(card.pos).toFixed()) !== position) {
      this.logger.debug('Updated position of card ' + card.name);
      data.set('pos', position);
    }

    // Unarchive if necessary.
    if (card.closed) {
      this.logger.debug('Unarchived card ' + card.name);
      data.set('closed', 'false');
    }

    // Update the card name if necessary.
    if (card.name !== topic.title) {
      this.logger.debug('Updated name of card ' + card.name);
      data.set('name', topic.title);
    }

    // Update the card description if the introduction or update date changed.
    if (topic.introduction !== card.introduction || topic.lastUpdate !== card.lastUpdate) {
      this.logger.debug('Updated description of card ' + card.name);
      data.set('desc', this.generateCardDescription(card.desc, topic.lastUpdate, topic.introduction));
    }

    // Update the card labels.
    if (await this.updateCardLabels(card, topic)) {
      this.logger.info('Updated labels for card ' + card.name);
      changed = true;
    }

    // Update the card checklists.
    if (await this.updateCardChecklists(card, topic)) {
      this.logger.info('Updated checklists for card ' + card.name);
      changed = true;
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
  this.createCard = async (position, topic) => {
    const data = {
      idList: this.lists.get(topic.status).id,
      urlSource: '',
      name: topic.title,
      desc: this.generateCardDescription('', topic.lastUpdate, topic.introduction),
      pos: position,
      idLabels: Array.from(this.getTopicLabels(topic).values()).join(','),
    };

    // Create the card.
    let card;
    try {
      card = await this.trelloClient.post('/cards', data);
      this.logger.info('Created card ' + topic.title);
    }
    catch (exception) {
      this.logger.error('Unable to create card ' + topic.title + ': ' + exception);
      return;
    }

    // Add the topic URL as attachment.
    try {
      await this.trelloClient.post('/cards/' + card.id + '/attachments', {
        url: topic.url,
      });
      this.logger.debug('Added url ' + topic.url + ' to card ' + topic.title);
    }
    catch (exception) {
      this.logger.error('Unable to set the URL ' + topic.url + ' to card ' + topic.title);
    }

    // Update the card checklists.
    if (await this.updateCardChecklists(card, topic)) {
      this.logger.info('Updated checklists for card ' + card.name);
    }
  };

  /**
   * Update the Trello board.
   */
  this.updateBoard = async () => {
    const cards = new Map();

    // Get the list of existing topic cards.
    for (const card of this.board.cards.values()) {
      if (card.attachments) {
        for (const attachment of card.attachments) {
          if (this.urlPattern.test(attachment.url)) {
            cards.set(attachment.url, this.prepareCard(card));
            break;
          }
        }
      }
    }

    // Update or create the topic cards.
    let updated = 0;
    for (const topic of this.topics) {
      const position = this.maxIndex - topic.id;
      if (cards.has(topic.url)) {
        if (await this.updateCard(position, cards.get(topic.url), topic)) {
          updated++;
        }
      }
      else {
        await this.createCard(position, topic);
        updated++;
      }
    }
    this.logger.info('Updated/created ' + updated + ' card(s)');
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

const manager = new TopicManager(config, logger, trelloClient, rwapiClient, new DateWrapper());
manager.process();
