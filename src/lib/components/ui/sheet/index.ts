import { Dialog as DialogPrimitive } from 'bits-ui';
import Content from './sheet-content.svelte';

const Root = DialogPrimitive.Root;
const Trigger = DialogPrimitive.Trigger;
const Close = DialogPrimitive.Close;

export {
  Root,
  Trigger,
  Close,
  Content,
  Root as Sheet,
  Trigger as SheetTrigger,
  Close as SheetClose,
  Content as SheetContent,
};
