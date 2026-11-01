// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  Button,
  CheckboxField,
  Dialog,
  IconButton,
  initials,
  Panel,
  ProgressBar,
  RangeField,
  SelectField,
  Spinner,
  StageChip,
} from '.';

describe('Button', () => {
  it('is type="button" by default and passes props through', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} aria-pressed="true" className="extra">
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(b).toHaveClass('extra');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('maps variants to classes and shows a shortcut hint', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="link" shortcut="Z">
          B
        </Button>
        <Button type="submit">C</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('primary');
    const b = screen.getByRole('button', { name: /^B/ });
    expect(b).toHaveClass('link');
    expect(b.querySelector('kbd')).toHaveTextContent('Z');
    expect(screen.getByRole('button', { name: 'C' })).toHaveAttribute('type', 'submit');
  });

  it('respects disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('always has an accessible name', () => {
    render(<IconButton label="Dismiss" />);
    const b = screen.getByRole('button', { name: 'Dismiss' });
    expect(b).toHaveTextContent('×');
    expect(b).toHaveAttribute('title', 'Dismiss');
  });

  it('can show another icon', () => {
    render(<IconButton label="Help" icon="?" className="help-btn" />);
    expect(screen.getByRole('button', { name: 'Help' })).toHaveClass('icon-btn', 'help-btn');
  });
});

describe('StageChip', () => {
  it('is a plain label by default', () => {
    const { container } = render(<StageChip stage="demo" showKey />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.firstChild).toHaveClass('chip', 'stage-demo');
    expect(container).toHaveTextContent('Demo Done3');
  });

  it('becomes a button when clickable, with pending style and extra content', async () => {
    const onClick = vi.fn();
    render(
      <StageChip stage="won" pending onClick={onClick} label="Change stage">
        <span>!</span>
      </StageChip>,
    );
    const b = screen.getByRole('button', { name: 'Change stage' });
    expect(b).toHaveClass('pending');
    expect(b).toHaveTextContent('Won!');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('ProgressBar', () => {
  it('reports progress and clamps it to 0–100', () => {
    const { rerender } = render(<ProgressBar value={42.4} label="Saved" />);
    expect(screen.getByRole('progressbar', { name: 'Saved' })).toHaveAttribute('aria-valuenow', '42');
    rerender(<ProgressBar value={140} label="Saved" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar value={-3} label="Saved" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Avatar and Spinner', () => {
  it('shows initials, the same colour for the same name, and accent for me', () => {
    expect(initials('Akshay Manocha')).toBe('AM');
    expect(initials('  priya  ')).toBe('P');
    const { container } = render(
      <>
        <Avatar name="Rahul Verma" />
        <Avatar name="Rahul Verma" />
        <Avatar name="Akshay Manocha" highlight />
        <Spinner />
      </>,
    );
    const [a, b, me] = container.querySelectorAll('.avatar');
    expect(a.getAttribute('style')).toBe(b.getAttribute('style'));
    expect(me).toHaveClass('me');
    expect(me).not.toHaveAttribute('style');
    expect(container.querySelector('.spinner')).toHaveAttribute('aria-hidden');
  });
});

describe('form fields', () => {
  it('SelectField hands back the real option value, typed', async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Idle"
        value={0}
        options={[
          [0, 'Any'],
          [30, '30+ days'],
        ]}
        onChange={onChange}
        compact
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Idle' });
    expect(select.closest('label')).toHaveClass('field', 'sel', 'compact');
    await userEvent.selectOptions(select, '30+ days');
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('CheckboxField and RangeField report booleans and numbers', async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      const [n, setN] = useState(5);
      return (
        <>
          <CheckboxField label="Offline" checked={on} onChange={setOn} />
          <RangeField label={`Rate ${n}`} value={n} min={0} max={10} onChange={setN} />
          <RangeField ariaLabel="Bare" value={1} min={0} max={10} onChange={() => undefined} />
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Offline' }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.change(screen.getByRole('slider', { name: /Rate/ }), { target: { value: '6' } });
    expect(screen.getByRole('slider', { name: 'Rate 6' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Bare' }).closest('label')).toBeNull();
  });
});

describe('Dialog', () => {
  function Harness({ onKeyDown }: { onKeyDown?: (e: React.KeyboardEvent) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        {open && (
          <Dialog label="Example" onClose={() => setOpen(false)} onKeyDown={onKeyDown}>
            <button>First</button>
            <button>Last</button>
          </Dialog>
        )}
      </>
    );
  }

  it('takes focus, traps Tab, closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Example' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab(); // wraps
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab({ shift: true }); // wraps backwards
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes on a click outside but not inside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'First' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(document.querySelector('.overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the content handle a key first, and keeps keys away from the page', async () => {
    const user = userEvent.setup();
    const pageKey = vi.fn();
    window.addEventListener('keydown', pageKey);
    render(<Harness onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    pageKey.mockClear();
    await user.keyboard('{Escape}x');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // content swallowed Escape
    expect(pageKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageKey);
  });

  it('focuses a [data-autofocus] child instead of itself, and handles no focusable content', async () => {
    const user = userEvent.setup();
    render(
      <Dialog label="Auto" onClose={() => undefined}>
        <div tabIndex={-1} data-autofocus>
          target
        </div>
      </Dialog>,
    );
    expect(screen.getByText('target')).toHaveFocus();
    await user.tab();
    expect(screen.getByText('target')).toHaveFocus(); // nothing tabbable: stays inside
  });
});

describe('Panel', () => {
  it('shows a title, takes focus, closes with its button or Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Panel title="Unsaved (2)" label="Unsaved" onClose={onClose} closeLabel="Close it">
        <p>body</p>
      </Panel>,
    );
    const panel = screen.getByRole('dialog', { name: 'Unsaved' });
    expect(panel).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Unsaved (2)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close it' }));
    panel.focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('can be a region and uses the title as its name by default', () => {
    render(
      <Panel title="Simulation" role="region" onClose={() => undefined}>
        x
      </Panel>,
    );
    expect(screen.getByRole('region', { name: 'Simulation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
