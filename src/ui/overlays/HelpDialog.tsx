import { Dialog, Kbd } from '../components';

const SHORTCUTS: [string, string][] = [
  ['↑ ↓  or  J K', 'Move between deals'],
  ['PgUp PgDn  ·  Home End', 'Jump'],
  ['Space  or  X', 'Select / unselect deal'],
  ['Shift + ↑ ↓', 'Extend selection'],
  ['⌘/Ctrl + A', 'Select every deal in this view'],
  ['1 – 7', 'Move focused / selected deals to that stage'],
  [']  [', 'Move to next / previous stage'],
  ['M', 'Open stage picker'],
  ['Z  or  ⌘/Ctrl + Z', 'Undo last move'],
  ['R', 'Show teammates’ changes (re-sort list)'],
  ['Y  /  N', 'On a failed or conflicted row: retry (keep mine) / discard (keep theirs)'],
  ['E', 'Review unsaved changes'],
  ['/', 'Search'],
  ['Shift + 1–4', 'Views: Today, My pipeline, Whole team, Quarter-end cleanup'],
  ['Esc', 'Clear selection / close'],
  ['`', 'Simulation controls (latency, failures, teammates)'],
  ['?', 'This help'],
];

/** Every keyboard shortcut, in one place (?). */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      label="Keyboard shortcuts"
      onClose={onClose}
      className="help"
      onKeyDown={(e) => {
        if (e.key === '?') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <h2>Keyboard shortcuts</h2>
      <table>
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <td>
                <Kbd>{keys}</Kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
