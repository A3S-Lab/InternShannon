import { useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { formatKeybinding, type WorkspaceCommand } from "./command-registry";

/**
 * 工作区命令面板(Cmd+Shift+P)—— 搜索并执行任意已注册命令,行尾显示其快捷键。
 * 复用 cmdk(ui/command.tsx),不引入新依赖。命令来源由调用方汇总(文件树自身命令 + 父级注入的 extraCommands)。
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: WorkspaceCommand[];
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, WorkspaceCommand[]>();
    for (const command of commands) {
      if (command.when && !command.when()) continue;
      const bucket = byGroup.get(command.group);
      if (bucket) bucket.push(command);
      else byGroup.set(command.group, [command]);
    }
    return [...byGroup.entries()];
  }, [commands]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="搜索命令…" />
      <CommandList>
        <CommandEmpty>无匹配命令</CommandEmpty>
        {groups.map(([group, groupCommands]) => (
          <CommandGroup key={group} heading={group}>
            {groupCommands.map((command) => (
              <CommandItem
                key={command.id}
                value={`${command.title} ${command.group}`}
                onSelect={() => {
                  onOpenChange(false);
                  command.run();
                }}
              >
                <span className="min-w-0 truncate">{command.title}</span>
                {command.keybinding ? (
                  <CommandShortcut>{formatKeybinding(command.keybinding)}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
