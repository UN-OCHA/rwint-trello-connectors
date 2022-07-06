/**
 * Overview board manager.
 */
function OverviewManager(config, logger, trelloClient, date) {
  this.config = config;
  this.logger = logger;
  this.trelloClient = trelloClient;
  this.date = date;

  this.overviewBoard = null;
  this.boards = null;
  this.projects = null;

  // Current date.
  this.currentDate = this.date.format('D MMM YYYY');

  /**
   * Main process function.
   */
  this.process = async () => {
    try {
      await this.getOverviewBoard();
      await this.getBoards();
      await this.updateBoard();
    }
    catch (exception) {
      this.logger.error(exception);
    }
  };

  /**
   * Retrieve the other boards.
   */
  this.getBoards = async () => {
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

    const result = await this.trelloClient.get('/boards', data);
    if (!result) {
      throw 'Unable to retrieve the Trello board data';
    }
    this.boards = result;
  };

  /**
   * Retrieve the Trello board data.
   */
  this.getOverviewBoard = async () => {
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
    this.overviewBoard = result;
  };

  /**
   * Get project name.
   */
  this.getProjectName = async (label) => {
    if (label.indexOf(this.config.projectPrefix) === 0) {
      return label.substring(this.config.projectPrefix.length);
    }

    return '';
  };

  /**
   * Get doer name.
   */
   this.getDoerName = async (label) => {
    if (label.indexOf(this.config.doerPrefix) === 0) {
      return label.substring(this.config.doerPrefix.length);
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
  
    if (action.Due != '') {
      parts.push(parts, '*' + action.Due + '*')
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
          "link": card.ShortUrl,
          "status": list,
          "due": card.Due,
          "complete": false,
        }
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
            "card": card,
            "actions": []
          }
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
      for (const list in board.lists) {
        lists[list.id] = list.name;
      }

      for (const card in board.card) {
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
        "name": action.name,
        "checked": action.complete
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
        "idChecklistCurrent":  checklistId,
        "idCheckItem":  id,
        "name":  action.Name,
        "state":  action.Complete,
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
        "idCheckItem":  id,
      });
      this.logger.debug('Deleted checkitem ' + id);
    }
    catch (exception) {
      this.logger.error('Unable to delete checkitem ' + id);
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

const DateWrapper = require('./libs/date.js').DateWrapper;

const manager = new OverviewManager(config, logger, trelloClient, new DateWrapper());
manager.process();
