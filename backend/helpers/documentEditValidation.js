const validateDocumentEditPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid request payload.' };
  }

  const { content, instruction, selectionRange } = payload;

  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'Content is required.' };
  }

  if (typeof instruction !== 'string' || !instruction.trim()) {
    return { ok: false, error: 'Instruction is required.' };
  }

  const maxContentLength = 20000;
  const maxInstructionLength = 1000;

  if (content.length > maxContentLength) {
    return { ok: false, error: `Content is too long (max ${maxContentLength} characters).` };
  }

  if (instruction.length > maxInstructionLength) {
    return { ok: false, error: `Instruction is too long (max ${maxInstructionLength} characters).` };
  }

  if (selectionRange) {
    const { from, to } = selectionRange;
    const validRange = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from;
    if (!validRange) {
      return { ok: false, error: 'selectionRange must include valid { from, to } integers.' };
    }
  }

  return { ok: true };
};

module.exports = {
  validateDocumentEditPayload,
};

