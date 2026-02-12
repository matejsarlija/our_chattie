const { isTrialAllowed, nextRunsUsed } = require('../helpers/trial');

describe('trial quota helpers', () => {
  test('allows up to limit', () => {
    expect(isTrialAllowed({ runsUsed: 0, limit: 3 })).toBe(true);
    expect(isTrialAllowed({ runsUsed: 2, limit: 3 })).toBe(true);
    expect(isTrialAllowed({ runsUsed: 3, limit: 3 })).toBe(false);
  });

  test('nextRunsUsed caps at limit', () => {
    expect(nextRunsUsed({ runsUsed: 0, limit: 3 })).toBe(1);
    expect(nextRunsUsed({ runsUsed: 2, limit: 3 })).toBe(3);
    expect(nextRunsUsed({ runsUsed: 3, limit: 3 })).toBe(3);
  });
});
