const fs = require('fs');

async function loadHtml(source) {
  if (source.startsWith('http')) {
    const response = await fetch(source, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.text();
  }

  const filePath = source.startsWith('file://') ? source.replace('file://', '') : source;
  return fs.readFileSync(filePath, 'utf8');
}

module.exports = {
  loadHtml
};
