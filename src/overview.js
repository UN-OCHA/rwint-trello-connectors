/**
 * Overview board manager.
 */
function OverviewManager(config, logger, trelloClient, date) {
  this.config = config;
  this.logger = logger;
  this.trelloClient = trelloClient;

  this.overviewBoard = null;
  this.boards = [];
  this.projects = new Map();

  /**
   * Main process function.
   */
  this.process = async () => {
    try {
      if (await this.getBoards()) {
        this.prepare();
        await this.update();
      }
    }
    catch (exception) {
      this.logger.error(exception);
    }
  };

  /**
   * Get project name.
   */
  this.getProjectName = (label) => {
    if (label.indexOf(this.config.trello.projectPrefix) === 0) {
      return label.substring(this.config.trello.projectPrefix.length);
    }

    return '';
  };

  /**
   * Get doer name.
   */
  this.getDoerName = (label) => {
    if (label.indexOf(this.config.trello.doerPrefix) === 0) {
      return label.substring(this.config.trello.doerPrefix.length);
    }

    return '';
  };

  /**
   * Compute an action name.
   */
  this.getActionName = (action) => {
    let doers = '*Not assigned*';
    if (action.doers.length > 0) {
      doers = '**' + action.doers.join(', ') + '**';
    }

    let parts = [
      action.link,
      doers,
      action.status
    ];

    if (action.due) {
      // Format: YYYY/MM/DD.
      parts.push('*' + action.due.substr(0, 10).replaceAll('-', '/') + '*');
    }

    return parts.join(' - ');
  };

  /**
   * Get the projects actions for a card.
   */
  this.getActions = (card, list) => {
    let actions = new Map();
    let doers = [];

    for (const labelId in card.labels) {
      if (card.labels.hasOwnProperty(labelId)) {
        let label = card.labels[labelId];

        let projectName = this.getProjectName(label.name);
        if (projectName != '') {
          actions.set(projectName, {
            link: card.shortUrl,
            status: list,
            due: card.due,
            complete: false,
          });
        }

        let doerName = this.getDoerName(label.name);
        if (doerName != '') {
          doers.push(doerName);
        }
      }
    }

    // Set action name and status.
    for (let action of actions.values()) {
      action.doers = doers;
      action.name = this.getActionName(action);
      this.logger.debug('Processing action ' + action.name);
      if (list && list.toLowerCase().indexOf('done') != -1) {
        action.complete = true;
      }
    }

    return actions;
  };

  /**
   * Get Overview board projects.
   */
  this.getProjects = () => {
    for (const card of this.overviewBoard.cards.values()) {
      this.logger.debug('Processing card ' + card.name);
      for (const labelId in card.labels) {
        if (card.labels.hasOwnProperty(labelId)) {
          let label = card.labels[labelId];
          let projectName = this.getProjectName(label.name);
          if (projectName != '') {
            // Each project can have max 1 card.
            this.projects.set(projectName, {
              card: card,
              actions: new Map(),
            });
          }
        }
      }
    }

    return this.projects;
  };

  /**
   * Prepare the data to update the overview board.
   */
  this.prepare = () => {
    let projects = this.getProjects();

    for (const board of this.boards) {
      let lists = {};
      for (const list of board.lists) {
        lists[list.id] = list.name;
      }
      for (const card of board.cards.values()) {
        this.logger.debug('Processing card ' + card.name);
        let actions = this.getActions(card, lists[card.idList]);
        for (const [name, action] of actions) {
          if (projects.has(name)) {
            if (!projects.get(name).actions.has(board.name)) {
              projects.get(name).actions.set(board.name, new Map());
            }
            projects.get(name).actions.get(board.name).set(action.name, action);
          }
        }
      }
    }
  };

  /**
   * Add an action checklist item.
   */
  this.addCheckItem = async (checklistId, action) => {
    try {
      await this.trelloClient.post('/checklists/' + checklistId + '/checkItems', {
        name: action.name,
        checked: action.complete
      });
      this.logger.debug('Added checkitem ' + action.name);
    }
    catch (exception) {
      this.logger.error('Unable to add checkitem ' + action.name + ' to list ' + checklistId);
    }
  };

  /**
   * Update an action checklist item.
   */
  this.updateCheckItem = async (cardId, checklistId, id, action) => {
    try {
      await this.trelloClient.put('/cards/' + cardId + '/checklist/' + checklistId + '/checkItem/' + id, {
        idChecklistCurrent: checklistId,
        idCheckItem: id,
        name: action.name,
        state: action.complete,
      });
      this.logger.debug('Updated checkitem ' + id);
    }
    catch (exception) {
      this.logger.error('Unable to update checkitem ' + id);
    }
  };

  /**
   * Delete an action checklist item.
   */
  this.deleteCheckItem = async (checklistId, id) => {
    try {
      await this.trelloClient.delete('/checklists/' + checklistId + '/checkItems/' + id, {
        idCheckItem: id,
      });
      this.logger.debug('Deleted checkitem ' + id);
    }
    catch (exception) {
      this.logger.error('Unable to delete checkitem ' + id);
    }
  };

  /**
   * Add a board checklist.
   */
  this.addChecklist = async (cardId, name, actions) => {
    try {
      const checklist = await this.trelloClient.post('/checklists', {
        idCard: cardId,
        name: name,
      });
      this.logger.debug('Added checklist ' + name);

      // Add all actions.
      for (const action of actions.values()) {
        this.logger.debug('Processing action ' + action.name);
        await this.addCheckItem(checklist.id, action);
      }
    }
    catch (exception) {
      this.logger.error('Unable to add checklist ' + name + ' to card ' + cardId);
    }
  };

  /**
   * Update board checklist: add, update or remove actions.
   */
  this.updateChecklist = async (cardId, checklist, actions) => {
    let items = new Map();
    // Map the actions with their link which acts as identifier. It's indeed
    // the constant part of the checklist items.
    // @see getActionName().
    for (const action of actions.values()) {
      this.logger.debug('Processing action ' + action.link);
      items.set(action.link, action);
    }

    for (const checkitem of checklist.checkItems) {
      // Extract the card shortURL (action link) from the check item name.
      // @see getActionName().
      const link = checkitem.name.substring(0, 29);

      // Update the check list item if the corresponding action has changed.
      if (items.has(link)) {
        let action = items.get(link);

        // Update if name changed.
        if (action.name != checkitem.name) {
          await this.updateCheckItem(cardId, checklist.id, checkitem.id, action);
          items.delete(link);
        }

        // Remove the action from the list so it's not processed when adding
        // new actions below.
        items.delete(link);
      }
      // Otherwise, if there is no corresponding action, remove the item.
      else {
        await this.deleteCheckItem(checklist.id, checkitem.id);
      }
    }

    // Add new actions.
    for (const action of items.values()) {
      this.logger.debug('Processing action ' + action.name);
      await this.addCheckItem(checklist.id, action);
    }
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
   * Update the Overview board.
   */
  this.update = async () => {
    let boards = new Map();
    for (const board of this.boards) {
      boards.set(board.name, true);
    }

    for (const [projectId, project] of this.projects) {
      this.logger.debug('Updating project ' + projectId);
      let card = project.card;
      for (const checklist of card.checklists) {
        if (boards.has(checklist.name)) {
          let actions = project.actions.get(checklist.name);
          if (actions) {
            await this.updateChecklist(card.id, checklist, actions);
            project.actions.delete(checklist.name);
          }
          else {
            await this.deleteChecklist(checklist.id);
          }
        }
        else {
          await this.deleteChecklist(checklist.id);
        }
      }

      for (const [checklistName, actions] of project.actions) {
        await this.addChecklist(card.id, checklistName, actions);
      }
    }
  };

  /**
   * Retrieve board data.
   */
  this.getBoardData = async (board, checklists) => {
    const data = {
      filter: 'open',
      fields: 'name,shortUrl,labels,idList,due',
    };

    if (checklists) {
      data['checklists'] = 'all';
    }

    try {
      const cards = await this.trelloClient.get('/boards/' + board.id + '/cards', data);
      board.cards = new Map();
      for (const cardId in cards) {
        if (cards.hasOwnProperty(cardId)) {
          board.cards.set(cards[cardId].id, cards[cardId]);
        }
      }
      this.logger.debug('Loaded board ' + board.id);
    }
    catch (exception) {
      this.logger.error('Unable to load board ' + board.id);
    }
  };

  /**
   * Retrieve the overview board.
   */
  this.getOverviewBoard = async () => {
    // Get the overview board ID.
    const board = await this.trelloClient.get('/boards/' + this.config.trello.boardId, {
      fields: 'id,name',
      lists: 'open',
    });

    await this.getBoardData(board, true);
    this.overviewBoard = board;
  };

  /**
   * Retrieve organization boards.
   */
  this.getBoards = async () => {
    // Retrieve the overview board.
    this.getOverviewBoard();

    // Retrieve the organization boards.
    const boards = await this.trelloClient.get('/organizations/' + this.config.trello.organization + '/boards', {
      filter: 'open',
      fields: 'id,name',
      lists: 'open',
    });

    // Get the list of board to skip, including the overview board.
    const excludedBoards = this.config.trello.excludedBoards || [];
    excludedBoards.push(this.config.trello.boardId);

    // Get the lists and cards for the boards to monitor.
    for (let board of boards) {
      if (!excludedBoards.includes(board.id)) {
        await this.getBoardData(board, false);
        this.boards.push(board);
      }
    }

    return this.overviewBoard !== null;
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

const DateWrapper = require('./libs/date.js').DateWrapper;

const manager = new OverviewManager(config, logger, trelloClient, new DateWrapper());
manager.process();
