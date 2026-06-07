import { describe, expect, it } from 'vitest';

import { parseMarkdownTasks } from '../src/parser';

describe('parseMarkdownTasks', () => {
  it('parses Markdown and Tasks-compatible metadata', () => {
    const tasks = parseMarkdownTasks({
      vaultId: 'vault-a',
      vaultName: 'Work Vault',
      notePath: 'Projects/Plan.md',
      content: [
        '# Launch',
        '',
        '- [ ] Ship task #ops 📅 2026-06-10 🔺 ^ship-task',
        '- [x] Done task ✅ 2026-06-01 #done'
      ].join('\n')
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      providerTaskId: 'vault-a:block:ship-task',
      title: 'Ship task',
      status: 'open',
      priority: 1,
      labels: ['ops'],
      dueAt: '2026-06-10T00:00:00.000Z',
      completedAt: null,
      notePath: 'Projects/Plan.md',
      noteTitle: 'Plan',
      heading: 'Launch',
      lineNumber: 3,
      blockId: 'ship-task',
      parserFormat: 'tasks'
    });
    expect(tasks[0]?.openUri).toContain('obsidian://open');
    expect(tasks[0]?.openUri).toContain('block=ship-task');

    expect(tasks[1]).toMatchObject({
      title: 'Done task',
      status: 'completed',
      labels: ['done'],
      completedAt: '2026-06-01T00:00:00.000Z'
    });
  });

  it('parses Dataview inline due dates and plain Markdown tasks', () => {
    const tasks = parseMarkdownTasks({
      vaultId: 'vault-b',
      vaultName: 'Personal',
      notePath: 'Inbox.md',
      content: [
        '- [ ] Call vendor [due:: 2026-07-04] #phone',
        '- [ ] Plain checkbox'
      ].join('\n')
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      title: 'Call vendor',
      dueAt: '2026-07-04T00:00:00.000Z',
      labels: ['phone'],
      parserFormat: 'tasks'
    });
    expect(tasks[1]).toMatchObject({
      title: 'Plain checkbox',
      dueAt: null,
      labels: [],
      parserFormat: 'markdown'
    });
  });

  it('does not include unsupported Tasks metadata in imported titles', () => {
    const tasks = parseMarkdownTasks({
      vaultId: 'vault-c',
      vaultName: 'Research',
      notePath: 'Research.md',
      content:
        '- [ ] Review plan ⏳ 2026-06-09 🛫 2026-06-08 ➕ 2026-06-01 [context:: launch] 🔽 #next ^meta'
    });

    expect(tasks[0]).toMatchObject({
      title: 'Review plan',
      priority: 4,
      labels: ['next'],
      blockId: 'meta'
    });
  });
});
