const { main: runAll } = require('./runners/run-all');
const { main: runBiology } = require('./runners/run-biology');
const { main: runPhysics } = require('./runners/run-physics');
const { main: runChemistry } = require('./runners/run-chemistry');
const { main: runClass12 } = require('./subjects/biology/class-12.scraper');

function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'all') {
    return runAll(argv.slice(1));
  }

  if (argv[0] === 'biology') {
    return runBiology(argv.slice(1));
  }

  if (argv[0] === 'physics') {
    return runPhysics(argv.slice(1));
  }

  if (argv[0] === 'chemistry') {
    return runChemistry(argv.slice(1));
  }

  return runClass12(argv);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  main
};
