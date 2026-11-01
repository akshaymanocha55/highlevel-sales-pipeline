/**
 * Shared UI building blocks. Screens compose these; they never re-implement
 * buttons, chips, dialogs or form fields themselves.
 */
export { Avatar, initials, type AvatarProps } from './Avatar';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { Dialog, type DialogProps } from './Dialog';
export {
  CheckboxField,
  RangeField,
  SelectField,
  type CheckboxFieldProps,
  type RangeFieldProps,
  type SelectFieldProps,
} from './fields';
export { IconButton, type IconButtonProps } from './IconButton';
export { Kbd } from './Kbd';
export { Panel, type PanelProps } from './Panel';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { Spinner } from './Spinner';
export { StageChip, type StageChipProps } from './StageChip';
export { trapTab, useAutoFocusRef, useFocusOnMount } from './useFocusManagement';
