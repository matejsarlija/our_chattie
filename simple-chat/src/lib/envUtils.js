export const readProcess = (key) => {
  try {
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch { /* process may not exist in browser */ }
  return undefined;
};

export const first = (...values) => {
  for (const v of values) {
    if (v !== undefined && v !== '') return v;
  }
  return '';
};

export const readBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const requireEnv = (value, keyName) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${keyName}`);
  }

  return value;
};
