const buildSseData = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

module.exports = {
  buildSseData,
};
