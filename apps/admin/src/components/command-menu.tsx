import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Laptop, Moon, School, Sun } from 'lucide-react';
import { schools } from '@/lib/client';
import { useMe } from '@/lib/me';
import { navFor } from '@/lib/nav';
import { useSearch } from '@/context/search-provider';
import { useTheme } from '@/context/theme-provider';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { sidebarData } from './layout/data/sidebar-data';
import { ScrollArea } from './ui/scroll-area';

/**
 * Ctrl+K: jump to any page this role sees in the sidebar (lib/nav.ts), jump
 * to a school (by its code or name: the list of schools is read once, the
 * first time the menu opens), or change the theme.
 * A later plan may add "find a person".
 */
export function CommandMenu() {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { open, setOpen } = useSearch();
  const me = useMe();
  const [schoolList, setSchoolList] = React.useState<{ code: string; name: string }[] | null>(null);

  React.useEffect(() => {
    if (!open || schoolList !== null) return;
    // A failed read leaves the group out; the pages still work.
    schools.index().then(setSchoolList, () => setSchoolList([]));
  }, [open, schoolList]);

  const run = React.useCallback(
    (command: () => unknown) => {
      setOpen(false);
      command();
    },
    [setOpen],
  );

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen}>
      <CommandInput placeholder='Go to a page or a school…' />
      <CommandList>
        <ScrollArea type='hover' className='h-72 pe-1'>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {navFor(me.role, sidebarData).map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((item, i) =>
                item.url ? (
                  <CommandItem key={`${item.title}-${i}`} value={item.title} onSelect={() => run(() => navigate({ to: item.url }))}>
                    <div className='flex size-4 items-center justify-center'>
                      <ArrowRight className='size-2 text-muted-foreground/80' />
                    </div>
                    {item.title}
                  </CommandItem>
                ) : null,
              )}
            </CommandGroup>
          ))}
          {schoolList && schoolList.length > 0 && (
            <CommandGroup heading='Schools'>
              {schoolList.map((sc) => (
                <CommandItem
                  key={sc.code}
                  value={`${sc.code} ${sc.name}`}
                  onSelect={() => run(() => navigate({ to: '/schools/$code', params: { code: sc.code }, search: { tab: 'overview' } }))}
                >
                  <School className='text-muted-foreground' />
                  <span className='font-mono text-xs'>{sc.code}</span>
                  <span>{sc.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading='Theme'>
            <CommandItem onSelect={() => run(() => setTheme('light'))}>
              <Sun /> <span>Light</span>
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme('dark'))}>
              <Moon className='scale-90' />
              <span>Dark</span>
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme('system'))}>
              <Laptop />
              <span>System</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  );
}
