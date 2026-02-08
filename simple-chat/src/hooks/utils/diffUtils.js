const tokenize = (text) => {
  if (!text) return [];
  return text.match(/\s+|[^\s]+/g) || [];
};

const escapeHtml = (text) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const tokensToDiff = (oldText, newText) => {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      diff.push({ type: 'equal', value: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'delete', value: a[i] });
      i += 1;
    } else {
      diff.push({ type: 'insert', value: b[j] });
      j += 1;
    }
  }

  while (i < m) {
    diff.push({ type: 'delete', value: a[i] });
    i += 1;
  }

  while (j < n) {
    diff.push({ type: 'insert', value: b[j] });
    j += 1;
  }

  return diff;
};

export const buildTrackedChangesHtml = (oldText, newText) => {
  const diff = tokensToDiff(oldText, newText);
  let html = '';
  let textLength = 0;

  diff.forEach((token) => {
    const escaped = escapeHtml(token.value).replace(/\n/g, '<br />');
    textLength += token.value.length;

    if (token.type === 'insert') {
      html += `<ins data-change="insert">${escaped}</ins>`;
      return;
    }

    if (token.type === 'delete') {
      html += `<del data-change="delete">${escaped}</del>`;
      return;
    }

    html += escaped;
  });

  return { html, textLength };
};

