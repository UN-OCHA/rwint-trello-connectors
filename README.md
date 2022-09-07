ReliefWeb Trello Connectors
===========================

NodeJs scripts (with no dependencies) used to manage ReliefWeb Trello Boards.

- [Countries](src/countries.js): Connector for the **Country Oveview** Trello board, using data from the ReliefWeb API. This board is to ease monitoring and maintaining countries with an ongoing humanitarian situation.
- [Disasters](src/disasters.js): Connector for the **Disaster Oveview** Trello board, using data from the ReliefWeb API. This board is to ease monitoring and maintaining draft, alert and ongoing disasters.
- [Topics](src/topics.js): Connector for the **Topic Oveview** Trello board, using data from the ReliefWeb API. This board is to ease monitoring and maintaining ReliefWeb's topics.
- [Overview](src/overview.js): Connector for the **Overview** Trello board using only data from Trello. This board is used to monitor the activity in other boards.

Configuration
-------------

The scripts need some configuration. This can should be passed using the `CONFIG` environment variable.

Ex: `CONFIG=$(cat config/countries.config.json) node src/countries.js`

The `config` directory contains examples that just need to the Trello API crendentials and board ID.

Docker
------

1. Clone the repository somewhere and `cd` to it.
2. Edit the config file.
3. Run the script with something like `docker run --rm -v "$(pwd)/src:/tmp" -e CONFIG="$(cat config/countries.config.json)" node:latest node /tmp/countries.js`

Development
-----------

The scripts don't have dependencies. The package.json however contains `eslint` as dev dependency to ensure coding standards are respected.

There is also a `git-hooks` directory that contains a pre-commit hook used to lint the code before committing, that can be installed via `npm run install-git-hooks`.

License
-------

This code is free and unencumbered public domain software. For more information, see http://unlicense.org/ or the accompanying UNLICENSE file.
