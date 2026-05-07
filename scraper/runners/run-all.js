const { main: runBiology } = require('./run-biology');
const { main: runPhysics } = require('./run-physics');
const { main: runChemistry } = require('./run-chemistry');

function main() {
  runBiology([]);
  runPhysics();
  runChemistry();
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
