import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";

const DAINVO_TASK_BLOCK_ID_RE =
  /\s+\^(?:dainvo|d)-[A-Za-z0-9-]+\s*$/;
const TASK_PREFIX_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/;

export type StableIdLineRange = {
  from: number;
  to: number;
};

export function findDainvoStableIdRange(
  line: string,
): StableIdLineRange | null {
  const match = DAINVO_TASK_BLOCK_ID_RE.exec(line);
  if (!match || !TASK_PREFIX_RE.test(line.slice(0, match.index))) {
    return null;
  }
  return {
    from: match.index,
    to: match.index + match[0].trimEnd().length,
  };
}

class DainvoStableIdVisibilityPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    const livePreviewChanged =
      update.startState.field(editorLivePreviewField, false) !==
      update.state.field(editorLivePreviewField, false);
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      livePreviewChanged
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  if (view.state.field(editorLivePreviewField, false) !== true) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const seenLines = new Set<number>();
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      if (!seenLines.has(line.number)) {
        seenLines.add(line.number);
        const active = view.state.selection.ranges.some(
          (selection) =>
            selection.from <= line.to && selection.to >= line.from,
        );
        if (!active) {
          const range = findDainvoStableIdRange(line.text);
          if (range) {
            builder.add(
              line.from + range.from,
              line.from + range.to,
              Decoration.replace({}),
            );
          }
        }
      }
      if (line.number >= view.state.doc.lines || line.to >= visible.to) {
        break;
      }
      line = view.state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

export const dainvoStableIdVisibilityExtension = ViewPlugin.fromClass(
  DainvoStableIdVisibilityPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);
