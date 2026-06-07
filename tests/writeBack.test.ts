import { describe, expect, it } from 'vitest';

import { hashTaskLine, parseMarkdownTasks } from '../src/parser';
import {
  applyOperationToContent,
  DainvoWriteBackConflict
} from '../src/writeBack';
import type { ObsidianSnapshotTask, PendingOperation } from '../src/types';

describe('applyOperationToContent', () => {
  it('updates title, tags, due date, priority, and preserves block id', () => {
    const content = '- [ ] Old title #old 📅 2026-06-01 ^abc\n';
    const operation = makeOperation(content, {
      operationType: 'update',
      task: {
        title: 'New title',
        priority: 2,
        labels: ['next', 'work'],
        dueAt: '2026-06-15T00:00:00.000Z'
      }
    });

    expect(applyOperationToContent(content, operation)).toBe(
      '- [ ] New title ⏫ 📅 2026-06-15 #next #work ^abc\n'
    );
  });

  it('preserves recurrence and unsupported Obsidian Tasks metadata', () => {
    const content =
      '- [ ] Old title 🔁 every week ⏳ 2026-06-09 🛫 2026-06-08 ➕ 2026-06-01 [context:: launch] 🔽 #old ^meta\n';
    const operation = makeOperation(content, {
      operationType: 'update',
      task: {
        title: 'New title',
        priority: 3,
        labels: ['next'],
        dueAt: '2026-06-15T00:00:00.000Z'
      }
    });

    expect(applyOperationToContent(content, operation)).toBe(
      '- [ ] New title 🔼 📅 2026-06-15 🔁 every week ⏳ 2026-06-09 🛫 2026-06-08 ➕ 2026-06-01 [context:: launch] #next ^meta\n'
    );
  });

  it('keeps low-priority metadata when Dainvo is not writing a higher priority', () => {
    const content =
      '- [ ] Low task ⏳ 2026-06-09 [context:: launch] 🔽 #old ^low\n';
    const operation = makeOperation(content, {
      operationType: 'update',
      task: {
        title: 'Renamed low task',
        priority: 4,
        labels: ['next']
      }
    });

    expect(applyOperationToContent(content, operation)).toBe(
      '- [ ] Renamed low task ⏳ 2026-06-09 🔽 [context:: launch] #next ^low\n'
    );
  });

  it('preserves existing completion dates during non-completion edits', () => {
    const content = '- [x] Done title ✅ 2026-06-01 ^done';
    const operation = makeOperation(content, {
      operationType: 'update',
      task: {
        title: 'Retitled done task',
        status: 'completed'
      }
    });

    expect(applyOperationToContent(content, operation)).toBe(
      '- [x] Retitled done task ✅ 2026-06-01 ^done'
    );
  });

  it('completes, reopens, and deletes existing task lines', () => {
    const content = [
      '- [ ] Open task ^open',
      '- [x] Done task ✅ 2026-06-01 ^done',
      '- [ ] Delete task ^delete'
    ].join('\n');

    const completed = applyOperationToContent(
      content,
      makeOperation(content, {
        lineNumber: 1,
        blockId: 'open',
        operationType: 'complete',
        task: { title: 'Open task', status: 'completed' }
      })
    );
    expect(completed.split('\n')[0]).toMatch(
      /^- \[x\] Open task ✅ \d{4}-\d{2}-\d{2} \^open$/
    );

    const reopened = applyOperationToContent(
      content,
      makeOperation(content, {
        lineNumber: 2,
        blockId: 'done',
        operationType: 'reopen',
        task: { title: 'Done task', status: 'open' }
      })
    );
    expect(reopened.split('\n')[1]).toBe('- [ ] Done task ^done');

    const deleted = applyOperationToContent(
      content,
      makeOperation(content, {
        lineNumber: 3,
        blockId: 'delete',
        operationType: 'delete'
      })
    );
    expect(deleted).toBe('- [ ] Open task ^open\n- [x] Done task ✅ 2026-06-01 ^done');
  });

  it('finds a moved line by block id when the line hash still matches', () => {
    const original = '- [ ] Move me ^same';
    const content = ['# Heading', '', original].join('\n');
    const operation = makeOperation(original, {
      lineNumber: 1,
      blockId: 'same',
      operationType: 'update',
      task: { title: 'Moved task' }
    });

    expect(applyOperationToContent(content, operation)).toBe(
      '# Heading\n\n- [ ] Moved task ^same'
    );
  });

  it('throws a conflict when the expected line changed', () => {
    const operation = makeOperation('- [ ] Original task ^x', {
      blockId: 'x',
      operationType: 'update',
      task: { title: 'Patched task' }
    });

    expect(() =>
      applyOperationToContent('- [ ] User edited task ^x', operation)
    ).toThrow(DainvoWriteBackConflict);
  });
});

function makeOperation(
  content: string,
  overrides: Omit<Partial<PendingOperation>, 'source' | 'task'> & {
    task?: Partial<PendingOperation['task']>;
    lineNumber?: number;
    blockId?: string | null;
  }
): PendingOperation {
  const lines = content.split(/\r?\n/);
  const lineNumber = overrides.lineNumber ?? 1;
  const rawLine = lines[lineNumber - 1] ?? lines[0] ?? '';
  const parsed =
    parseMarkdownTasks({
      vaultId: 'vault',
      vaultName: 'Vault',
      notePath: 'Tasks.md',
      content
    }).find(
      (task) =>
        task.lineNumber === lineNumber ||
        (overrides.blockId && task.blockId === overrides.blockId)
    ) ?? makeSource(rawLine, lineNumber, overrides.blockId ?? null);

  return {
    id: overrides.id ?? 'op-1',
    operationType: overrides.operationType ?? 'update',
    task: {
      id: 'task-1',
      title: parsed.title,
      status: parsed.status,
      priority: parsed.priority,
      labels: parsed.labels,
      dueAt: parsed.dueAt,
      ...overrides.task
    },
    source: {
      ...parsed,
      lineNumber,
      blockId: overrides.blockId ?? parsed.blockId
    }
  };
}

function makeSource(
  rawTaskLine: string,
  lineNumber: number,
  blockId: string | null
): ObsidianSnapshotTask {
  return {
    providerTaskId: 'vault:line:1',
    title: 'Original task',
    status: 'open',
    priority: 4,
    labels: [],
    dueAt: null,
    completedAt: null,
    notePath: 'Tasks.md',
    noteTitle: 'Tasks',
    heading: null,
    lineNumber,
    blockId,
    lineHash: hashTaskLine(rawTaskLine),
    rawTaskLine,
    openUri: 'obsidian://open?vault=Vault&file=Tasks.md',
    parserFormat: 'markdown'
  };
}
