import {
  EDITOR_COMMANDS,
  actionCategories,
  actionsByCategory,
  captureKeyCombo,
  defaultKeybindings,
  formatKeyCombo,
} from "@/desktop/components/code-editor/keybindings";
import { normalizeKeyCombo } from "@/lib/key-combo";
import settingsModel, {
  type WordWrapSetting,
  type CursorStyle,
  type CursorBlinking,
  type RenderWhitespace,
} from "@/models/settings.model";
import { Switch } from "@/components/ui/switch";
import {
  Code2,
  Keyboard,
  Map as MapIcon,
  Pilcrow,
  RotateCcw,
  Type,
  AlignLeft,
  Hash,
  MousePointer,
  LayoutList,
  Brackets,
  ScrollText,
  AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import { useSnapshot } from "valtio";
import { SettingsSection, SettingsCard } from "./shared";

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return <Switch checked={checked} onCheckedChange={onChange} />;
}

function KeyRecorder({
  value,
  defaultValue,
  onChange,
}: {
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setRecording(false);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      onChange("");
      setRecording(false);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

    const combo = captureKeyCombo(e.nativeEvent);
    if (combo) {
      onChange(combo);
      setRecording(false);
    }
  };

  const isDefault = normalizeKeyCombo(value) === normalizeKeyCombo(defaultValue);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={() => setRecording((state) => !state)}
        onBlur={() => setRecording(false)}
        className={`min-w-[120px] rounded-lg border px-3 py-1.5 text-center font-mono text-xs transition-all focus:outline-none ${
          recording
            ? "animate-pulse border-primary bg-primary/10 text-primary"
            : "border-[var(--col-border)] bg-[var(--col-bg14)] hover:border-primary hover:bg-[var(--col-bg14)]"
        }`}
      >
        {recording ? "按下快捷键..." : value ? formatKeyCombo(value) : "未设置"}
      </button>
      {!isDefault ? (
        <button
          type="button"
          title="恢复默认"
          onClick={() => onChange(defaultValue)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function buildShortcutConflicts(keybindings: Record<string, string>) {
  const shortcutMap = new Map<string, string[]>();
  for (const action of EDITOR_COMMANDS) {
    const shortcut = normalizeKeyCombo(keybindings[action.id] ?? action.defaultKey);
    if (!shortcut) continue;
    const ids = shortcutMap.get(shortcut) ?? [];
    ids.push(action.id);
    shortcutMap.set(shortcut, ids);
  }

  const conflictByCommand = new Map<string, string[]>();
  for (const [shortcut, ids] of shortcutMap) {
    if (ids.length <= 1) continue;
    const labels = ids.map((id) => EDITOR_COMMANDS.find((action) => action.id === id)?.label ?? id);
    for (const id of ids) {
      conflictByCommand.set(
        id,
        labels.filter((label) => label !== (EDITOR_COMMANDS.find((action) => action.id === id)?.label ?? id)),
      );
    }
  }

  return conflictByCommand;
}

function RangeRow({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-800">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
        </div>
        <div className="font-mono text-sm tabular-nums text-slate-700">{value}</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full accent-primary"
      />
    </div>
  );
}

function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
        </div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: typeof Type;
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <div>
          <div className="text-sm font-medium text-slate-800">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function EditorSection() {
  const snap = useSnapshot(settingsModel.state);
  const ed = snap.editorSettings;
  const shortcutConflicts = buildShortcutConflicts(ed.keybindings);
  const conflictCount = shortcutConflicts.size;

  return (
    <SettingsSection
      title="编辑器"
      description="统一管理代码编辑器的外观、行为与快捷键。"
      icon={Code2}
      accentColor="violet"
    >
      <SettingsCard title="字体" description="编辑器字体大小和连字设置" icon={Type} accentColor="violet">
        <div className="space-y-4">
          <RangeRow
            label="字体大小"
            hint="编辑器字体大小（像素）。"
            value={ed.fontSize}
            min={10}
            max={24}
            onChange={(value) => settingsModel.setEditorSettings({ fontSize: value })}
          />
          <SelectRow
            label="字体连字"
            hint="启用编程字体连字显示（如 →、!=）。"
            value={ed.fontLigatures ? "on" : "off"}
            options={[
              { value: "on", label: "启用" },
              { value: "off", label: "禁用" },
            ]}
            onChange={(value) =>
              settingsModel.setEditorSettings({
                fontLigatures: value === "on",
              })
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="缩进" description="编辑器缩进方式与行为配置" icon={AlignLeft} accentColor="blue">
        <div className="space-y-4">
          <SelectRow
            label="Tab 宽度"
            hint="按下 Tab 时插入的空格数量。"
            value={String(ed.tabSize)}
            options={[
              { value: "2", label: "2 空格" },
              { value: "4", label: "4 空格" },
              { value: "8", label: "8 空格" },
            ]}
            onChange={(value) => settingsModel.setEditorSettings({ tabSize: Number(value) })}
          />
          <ToggleRow
            icon={AlignLeft}
            label="使用空格代替 Tab"
            hint="按下 Tab 时插入空格而非制表符。"
            checked={ed.insertSpaces}
            onChange={() =>
              settingsModel.setEditorSettings({
                insertSpaces: !ed.insertSpaces,
              })
            }
          />
          <ToggleRow
            icon={Hash}
            label="自动检测缩进"
            hint="根据文件内容自动检测缩进方式。"
            checked={ed.detectIndentation}
            onChange={() =>
              settingsModel.setEditorSettings({
                detectIndentation: !ed.detectIndentation,
              })
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="显示" description="编辑器界面显示相关配置" icon={MapIcon} accentColor="emerald">
        <div className="space-y-4">
          <SelectRow
            label="自动换行"
            hint="控制编辑器中的换行行为。"
            value={ed.wordWrap}
            options={[
              { value: "off", label: "关闭" },
              { value: "on", label: "视口宽度" },
              { value: "wordWrapColumn", label: "指定列数" },
              { value: "bounded", label: "视口或列数取小" },
            ]}
            onChange={(value) =>
              settingsModel.setEditorSettings({
                wordWrap: value as WordWrapSetting,
              })
            }
          />
          {(ed.wordWrap === "wordWrapColumn" || ed.wordWrap === "bounded") && (
            <RangeRow
              label="换行列数"
              hint="超出此列数时自动换行。"
              value={ed.wordWrapColumn}
              min={40}
              max={200}
              onChange={(value) => settingsModel.setEditorSettings({ wordWrapColumn: value })}
            />
          )}
          <ToggleRow
            icon={MapIcon}
            label="小地图"
            hint="在编辑器右侧显示代码缩略图。"
            checked={ed.minimap}
            onChange={() => settingsModel.setEditorSettings({ minimap: !ed.minimap })}
          />
          <SelectRow
            label="行号显示"
            hint="编辑器左侧的行号显示方式。"
            value={ed.lineNumbers}
            options={[
              { value: "off", label: "关闭" },
              { value: "on", label: "显示" },
              { value: "relative", label: "相对行号" },
              { value: "interval", label: "间隔显示" },
            ]}
            onChange={(value) =>
              settingsModel.setEditorSettings({
                lineNumbers: value as "off" | "on" | "relative" | "interval",
              })
            }
          />
          <SelectRow
            label="空白字符"
            hint="控制空格和制表符的显示方式。"
            value={ed.renderWhitespace}
            options={[
              { value: "none", label: "无" },
              { value: "boundary", label: "边界" },
              { value: "all", label: "全部" },
              { value: "selection", label: "仅选中" },
            ]}
            onChange={(value) =>
              settingsModel.setEditorSettings({
                renderWhitespace: value as RenderWhitespace,
              })
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="光标" description="编辑器光标样式与动画" icon={MousePointer} accentColor="orange">
        <div className="space-y-4">
          <SelectRow
            label="光标样式"
            hint="编辑器光标的样式。"
            value={ed.cursorStyle}
            options={[
              { value: "line", label: "竖线" },
              { value: "block", label: "方块" },
              { value: "underline", label: "下划线" },
              { value: "line-thin", label: "细竖线" },
              { value: "block-outline", label: "方块轮廓" },
              { value: "underline-thin", label: "细下划线" },
            ]}
            onChange={(value) =>
              settingsModel.setEditorSettings({
                cursorStyle: value as CursorStyle,
              })
            }
          />
          <SelectRow
            label="光标动画"
            hint="光标闪烁或静止的动画方式。"
            value={ed.cursorBlinking}
            options={[
              { value: "blink", label: "闪烁" },
              { value: "smooth", label: "平滑" },
              { value: "phase", label: "渐变" },
              { value: "expand", label: "扩展" },
              { value: "solid", label: "静止" },
            ]}
            onChange={(value) =>
              settingsModel.setEditorSettings({
                cursorBlinking: value as CursorBlinking,
              })
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="编辑行为" description="编辑器编辑时自动触发的行为" icon={Pilcrow} accentColor="blue">
        <div className="space-y-4">
          <ToggleRow
            icon={Pilcrow}
            label="粘贴时格式化"
            hint="粘贴内容时自动格式化。"
            checked={ed.formatOnPaste}
            onChange={() =>
              settingsModel.setEditorSettings({
                formatOnPaste: !ed.formatOnPaste,
              })
            }
          />
          <ToggleRow
            icon={Brackets}
            label="括号对上色"
            hint="配对括号使用不同颜色高亮显示。"
            checked={ed.bracketPairColorization}
            onChange={() =>
              settingsModel.setEditorSettings({
                bracketPairColorization: !ed.bracketPairColorization,
              })
            }
          />
          <ToggleRow
            icon={ScrollText}
            label="粘性滚动"
            hint="滚动时保持当前光标位置可见。"
            checked={ed.stickyScroll}
            onChange={() =>
              settingsModel.setEditorSettings({
                stickyScroll: !ed.stickyScroll,
              })
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="上下文" description="编辑器上下文菜单与 CodeLens" icon={LayoutList} accentColor="slate">
        <div className="space-y-4">
          <ToggleRow
            icon={MousePointer}
            label="上下文菜单"
            hint="启用编辑器右键菜单（禁用则使用系统菜单）。"
            checked={ed.contextmenu}
            onChange={() =>
              settingsModel.setEditorSettings({
                contextmenu: !ed.contextmenu,
              })
            }
          />
          <ToggleRow
            icon={LayoutList}
            label="CodeLens"
            hint="在代码上方显示引用和操作提示。"
            checked={ed.codeLens}
            onChange={() =>
              settingsModel.setEditorSettings({
                codeLens: !ed.codeLens,
              })
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="快捷键"
        description="点击按键区域开始录制，按 Esc 取消，按 Backspace 或 Delete 清空"
        icon={Keyboard}
        accentColor="violet"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          {conflictCount > 0 ? (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>{conflictCount} 个命令存在快捷键冲突</span>
            </div>
          ) : (
            <div />
          )}
          <button
            type="button"
            title="重置所有快捷键到默认值"
            onClick={() => {
              const defaults = defaultKeybindings();
              settingsModel.setEditorSettings({
                keybindings: defaults,
              });
            }}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <RotateCcw className="size-3.5" />
            <span>重置全部</span>
          </button>
        </div>
        <div className="space-y-4">
          {actionCategories().map((category) => (
            <div key={category} className="overflow-hidden rounded-lg border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600">
                {category}
              </div>
              <div className="divide-y divide-slate-100">
                {actionsByCategory(category).map((action) => {
                  const current = ed.keybindings[action.id] ?? action.defaultKey;
                  const conflicts = shortcutConflicts.get(action.id) ?? [];
                  return (
                    <div key={action.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-white">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{action.label}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          默认: {action.defaultKey ? formatKeyCombo(action.defaultKey) : "未设置"}
                        </div>
                        {conflicts.length > 0 ? (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="size-3" />
                            <span>与 {conflicts.join("、")} 冲突</span>
                          </div>
                        ) : null}
                      </div>
                      <KeyRecorder
                        value={current}
                        defaultValue={action.defaultKey}
                        onChange={(value) =>
                          settingsModel.setEditorSettings({
                            keybindings: {
                              ...settingsModel.state.editorSettings.keybindings,
                              [action.id]: value,
                            },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
