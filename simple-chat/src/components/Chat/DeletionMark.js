import { Mark, mergeAttributes } from '@tiptap/core';

const DeletionMark = Mark.create({
  name: 'deletion',

  addAttributes() {
    return {
      'data-change': {
        default: 'delete',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'del[data-change="delete"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'del',
      mergeAttributes(HTMLAttributes, {
        'data-change': 'delete',
        class: 'text-slate-400 line-through',
      }),
      0,
    ];
  },
});

export default DeletionMark;

