const buildSseData = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

const buildSseEvent = (event, payload) => `event: ${event}\n${buildSseData(payload)}`;

module.exports = {
  buildSseData,
  buildSseEvent,
};
