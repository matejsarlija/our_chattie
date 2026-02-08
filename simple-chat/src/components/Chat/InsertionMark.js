import { Mark, mergeAttributes } from '@tiptap/core';

const InsertionMark = Mark.create({
  name: 'insertion',

  addAttributes() {
    return {
      'data-change': {
        default: 'insert',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'ins[data-change="insert"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, {
        'data-change': 'insert',
        class: 'bg-emerald-100 text-emerald-900 rounded px-0.5',
      }),
      0,
    ];
  },
});

export default InsertionMark;

