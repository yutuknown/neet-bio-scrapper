function isFlag(value) {
  return String(value || '').startsWith('--');
}

function firstSourceArg(args, defaultSource) {
  return (Array.isArray(args) ? args : []).find((arg) => !isFlag(arg)) || defaultSource;
}

function copyArgs(args) {
  return Array.isArray(args) ? [...args] : [];
}

module.exports = {
  isFlag,
  firstSourceArg,
  copyArgs
};
