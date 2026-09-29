"use client";

import { forwardRef } from 'react';
import * as Dropdown from '@/components/ui/dropdown-menu';

type ContentProps = React.ComponentProps<typeof Dropdown.DropdownMenuContent>;
type SubContentProps = React.ComponentProps<typeof Dropdown.DropdownMenuSubContent>;

const Content = forwardRef<HTMLDivElement, ContentProps>(({ className, ...props }, ref) => (
  <Dropdown.DropdownMenuContent ref={ref} className={`tetro-editor-popup bn-menu-dropdown ${className ?? ''}`} {...props} />
));
Content.displayName = 'TetroEditorDropdownContent';

const SubContent = forwardRef<HTMLDivElement, SubContentProps>(({ className, ...props }, ref) => (
  <Dropdown.DropdownMenuPortal>
    <Dropdown.DropdownMenuSubContent ref={ref} className={`tetro-editor-popup bn-menu-dropdown ${className ?? ''}`} {...props} />
  </Dropdown.DropdownMenuPortal>
));
SubContent.displayName = 'TetroEditorDropdownSubContent';

export const tetroEditorDropdown = {
  DropdownMenu: Dropdown.DropdownMenu,
  DropdownMenuTrigger: Dropdown.DropdownMenuTrigger,
  DropdownMenuContent: Content,
  DropdownMenuItem: Dropdown.DropdownMenuItem,
  DropdownMenuCheckboxItem: Dropdown.DropdownMenuCheckboxItem,
  DropdownMenuLabel: Dropdown.DropdownMenuLabel,
  DropdownMenuSeparator: Dropdown.DropdownMenuSeparator,
  DropdownMenuSub: Dropdown.DropdownMenuSub,
  DropdownMenuSubContent: SubContent,
  DropdownMenuSubTrigger: Dropdown.DropdownMenuSubTrigger,
};
