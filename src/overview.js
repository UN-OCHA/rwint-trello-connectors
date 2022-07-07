/**
 * Overview board manager.
 */
function OverviewManager(config, logger, trelloClient, date) {
  this.config = config;
  this.logger = logger;
  this.trelloClient = trelloClient;

  this.overviewBoard = null;
  this.boards = null;
  this.projects = null;

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
  this.getProjectName = async (label) => {
    if (label.indexOf(this.config.trello.projectPrefix) === 0) {
      return label.substring(this.config.trello.projectPrefix.length);
    }

    return '';
  };

  /**
   * Get doer name.
   */
  this.getDoerName = async (label) => {
    if (label.indexOf(this.config.trello.doerPrefix) === 0) {
      return label.substring(this.config.trello.doerPrefix.length);
    }

    return '';
  };

  /**
   * Compute an action name.
   */
  this.getActionName = async (action) => {
    let doers = '*Not assigned*';
    if (action.Doers.length > 0) {
      doers = '**' + action.Doers.join(', ') + '**';
    }

    let parts = [
      action.Link,
      doers,
      action.Status
    ];

    if (action.due != '') {
      parts.push(parts, '*' + action.due + '*');
    }

    return parts.join(' - ');
  };

  /**
   * Get the projects actions for a card.
   */
  this.getActions = async (card, list) => {
    let actions = new Map();
    let doers = [];

    for (const label of card.labels) {
      let projectName = this.getProjectName(label.name);
      if (projectName != '') {
        actions[projectName] = {
          link: card.ShortUrl,
          status: list,
          due: card.Due,
          complete: false,
        };
      }

      let doerName = this.getDoerName(label.name);
      if (doerName != '') {
        doers.push(doerName);
      }
    }

    for (let action of actions) {
      action.doers = doers;
      action.name = this.getActionName(action);
      if (list.toLowerCase().indexOf('done') != -1) {
        action.complete = true;
      }
    }

    return actions;
  };

  /**
   * Get Overview board projects.
   */
  this.getProjects = async () => {
    for (const card of this.overviewBoard.cards) {
      for (const label of card.labels) {
        let projectName = this.getProjectName(label.name);
        if (projectName != '') {
          this.projects[projectName] = {
            card: card,
            actions: []
          };
        }
      }
    }

    return this.projects;
  };

  /**
   * Prepare the data to update the overview board.
   */
  this.prepare = async () => {
    let projects = this.projects;

    for (const board of this.boards) {
      let lists = {};
      for (const list of board.lists) {
        lists[list.id] = list.name;
      }

      for (const card of board.card) {
        let actions = this.getActions(card, lists[card.idList]);
        for (const [name, action] of actions) {
          if (projects[name]) {
            if (!projects.actions[board.name]) {
              projects.actions[board.name] = [];
            }
            projects.actions[board.name].push(action);
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
      await this.trelloClient.post('/cards/' + cardId + '/checklist/' + checklistId + '/checkItem/' + id, {
        idChecklistCurrent:  checklistId,
        idCheckItem:  id,
        name:  action.Name,
        state:  action.Complete,
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
        idCheckItem:  id,
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
      const checklistId = await this.trelloClient.post('/checklists', {
        idCart:  cardId,
        name:  name,
      });
      this.logger.debug('Added checklist ' + name);

      for (const action of actions) {
        this.addCheckItem(checklistId, action);
      }
    }
    catch (exception) {
      this.logger.error('Unable to add checklist ' + name + ' to card ' + cardId);
    }
  };

  /**
   * Update board checklist: add, update or remove actions.
   */
  this.updateChecklist = (cardId, checklist, actions) => {
    let items = new Map();
    for (const action of actions) {
      items.set(action.link, action);
    }

    for (const checkitem of checklist.checkItems) {
      if (checkitem.name.length > 29) {
        checkitem.name = checkitem.name.slice(0, 29);
        if (items.has(checkitem.name)) {
          let action = items.get(checkitem.name);
          if (action.name != checkitem.name) {
            this.updateCheckItem(cardId, checklist.id, checkitem.id, action);
            items.delete(checkitem.name);
            continue;
          }
        }
      }
      else {
        this.deleteCheckItem(checklist.id, checkitem.id);
      }
    }

    for (const action of items) {
      this.addCheckItem(checklist.id, action);
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

    for (const project of this.projects) {
      let card = project.card;
      for (const checklist of card.checklist) {
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
      board.cards = await this.trelloClient.get('/boards/' + board.id + '/cards', data);
      this.logger.debug('Loaded board ' + board.id);
    }
    catch (exception) {
      this.logger.error('Unable to load board ' + board.id);
    }
  };

  /**
   * Retrieve organization boards.
   */
  this.getBoards = async () => {
    const boards = await this.trelloClient.get('/organizations/' + this.config.trello.organization + '/boards', {
      filter: 'open',
      fields: 'id,name',
      lists: 'open',
    });

    for (let board of boards) {
      if (board.id == this.config.trello.boardId) {
        await this.getBoardData(board, true);
        this.overviewBoard = board;
      }
      else {
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
const config = JSON.parse(process.env.CONFIG);

const Logger = require('./libs/logger.js').Logger;
const logger = new Logger(config.debug);

const TrelloClient = require('./libs/trello.js').TrelloClient;
const trelloClient = new TrelloClient(config.trello, logger);

const DateWrapper = require('./libs/date.js').DateWrapper;

const manager = new OverviewManager(config, logger, trelloClient, new DateWrapper());
manager.process();
