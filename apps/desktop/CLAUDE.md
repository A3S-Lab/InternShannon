# internShannon Desktop 前端开发规范

## 项目概述

- **技术栈**: Tauri v2 shell + desktop static frontend + NestJS sidecar API
- **状态管理**: Valtio (全局) + ahooks useReactive (组件内)
- **路由**: React Router v7 (Hash Router，兼容 Tauri)
- **API**: NestJS sidecar 运行在 `http://127.0.0.1:29653`
- **包管理**: pnpm

## 开发命令

从 repo root 优先使用这些命令：

```bash
# 安装依赖
CI=true pnpm install

# 桌面本地预检：CLI、sidecar build、29653/5000 端口状态
just doctor

# 构建 NestJS sidecar (运行 Tauri 前必须)
just sidecar-build

# 启动 Tauri 开发模式 (会先构建 sidecar，再启动桌面窗口)
just dev

# 构建可重复验证的 Tauri .app
pnpm --filter @internshannon/desktop tauri:build

# 构建 `.app` 并校验 sidecar JS 资源已进入 bundle
just build

# 构建发行安装包（包含 DMG 等平台 installer 和 standalone sidecar）
just bundle

# 校验 release sidecar 是否已经真正 standalone（tauri:bundle 已自动执行一次）
just check-standalone

# 从已构建的 `.app` 资源目录隔离启动 sidecar 并检查 /api/v1/health
just smoke-standalone

# 构建包含 hoisted sidecar node_modules 的 standalone `.app` 验证包
# 成功/失败后会尽力把 src-tauri/resources/sidecar 清回 dist-only
# 可能需要 registry/store 访问
pnpm --filter @internshannon/desktop tauri:build:standalone

# 使用 Biome 格式化代码
pnpm --filter @internshannon/desktop format

# 类型检查
pnpm --filter @internshannon/desktop exec tsc --noEmit
```

`just dev` 会打印实际选中的 Web/API/Health 信息。如果 `5000`
被占用，它会切到下一个可用前端端口；需要固定端口时设置
`PUBLIC_DESKTOP_DEV_PORT`。Tauri/Rust 改动只允许在 `apps/desktop/src-tauri/`
内进行，repo root 不是 Rust workspace。

Root pnpm config disables `verifyDepsBeforeRun` because pnpm 11 can otherwise
mis-detect generated desktop sidecar runtime `node_modules` as an install target
and attempt a non-interactive production prune before running scripts.

## 状态管理规范

### useState → useReactive 转换规则

**优先使用 `useReactive` 而不是 `useState`**：

```typescript
// ❌ 不推荐 - 传统的 useState
const [isOpen, setIsOpen] = useState(false);
const [count, setCount] = useState(0);

// ✅ 推荐 - useReactive
import { useReactive } from "ahooks";

const state = useReactive({
  isOpen: false,
  count: 0,
});
```

**状态更新方式**：

```typescript
// ❌ useState 的函数式更新
setSelectedIndex((i) => Math.min(i + 1, max));
setItems((prev) => [...prev, newItem]);

// ✅ useReactive 直接赋值
state.selectedIndex = Math.min(state.selectedIndex + 1, max);
state.items = [...state.items, newItem];
```

**Set/Map/数组等引用类型的更新**：

```typescript
// 对于 Set
if (state.expandedGroups.has(type)) {
  state.expandedGroups.delete(type);
} else {
  state.expandedGroups.add(type);
}

// 对于数组
state.items = state.items.filter((item) => item.id !== id);
state.items = [...state.items, newItem].slice(0, 100);
```

**useReactive 使用场景**：
- 组件内部管理的 UI 状态（isOpen, selectedIndex, isLoading 等）
- 需要同时管理多个相关状态
- 状态更新逻辑简单，主要是赋值操作

**不适合使用 useReactive 的场景**：
- 状态需要触发批量更新（使用 useState 的函数式更新更安全）
- 状态更新依赖旧值且操作复杂
- 需要自定义更新逻辑（如乐观更新）

## 组件规范

### 组件结构

```typescript
// ✅ 推荐：使用 useReactive 管理组件状态
import { useReactive } from "ahooks";

export function MyComponent({ initialValue }: Props) {
  const state = useReactive({
    value: initialValue,
    isLoading: false,
  });

  return <div>{state.value}</div>;
}

// ✅ 简单的 UI 状态可以直接用 JSX 表达式
<Button onClick={() => (state.isOpen = !state.isOpen)}>
  {state.isOpen ? "关闭" : "打开"}
</Button>
```

### Hook 规范

```typescript
// ✅ 推荐：使用 useReactive 实现自定义 Hook
export function useNotificationCenter() {
  const state = useReactive({
    notifications: [] as Notification[],
    isRunning: false,
  });

  const addNotification = useCallback((notification: Omit<Notification, "id">) => {
    state.notifications = [notification, ...state.notifications].slice(0, 100);
  }, []);

  return {
    notifications: state.notifications,
    addNotification,
  };
}
```

## 导入规范

### 导入顺序（按优先级）

1. React 相关 (`react`, `ahooks`)
2. 路由相关 (`react-router-dom`)
3. UI 组件 (`@/components/ui/*`)
4. 工具库 (`lucide-react`, `@/lib/utils`)
5. 类型定义
6. 其他导入

```typescript
import { useCallback, useEffect, useRef } from "react";
import { useReactive } from "ahooks";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MyType } from "./types";
```

### 移除未使用的导入

转换后必须移除不再使用的导入：

```typescript
// ❌ 残留未使用的导入
import { useCallback, useMemo, useState } from "react";
import { useReactive } from "ahooks";

// ✅ 正确的导入
import { useCallback, useMemo } from "react";
import { useReactive } from "ahooks";
```

## 代码风格

### 变量命名

- 使用 camelCase 命名变量和函数
- 未使用的变量前缀加 `_`
- 类型命名使用 PascalCase

```typescript
// ✅ 未使用的参数
const renderItem = (item: Item, _index: number) => { ... }

// ✅ 未使用的变量
const _unusedVariable = something;
```

### 条件渲染

```typescript
// ✅ 使用短路求值
{state.isLoading && <Spinner />}

// ✅ 使用三元运算符
{state.isEmpty ? <EmptyState /> : <ItemList />}

// ✅ 使用 && 或 || 的复杂表达式
{(isEnabled && !isLoading) && <Content />}
```

## 目录结构

```
src/
├── components/
│   └── custom/           # 业务组件
│       ├── chat/
│       ├── code-editor/
│       ├── dockview/
│       ├── file-tree-editor/
│       ├── memoized-markdown/
│       ├── notification-center/
│       ├── tiptap-editor/
│       └── ...
├── hooks/                 # 自定义 Hooks
├── layouts/              # 布局组件
├── lib/                  # 工具库
├── models/               # Valtio 状态模型
├── pages/                # 页面组件
└── constants/            # 常量
```

## 已知限制

### 不需要转换的 useState

以下场景的 useState 暂不需要转换（保持原样）：

1. **拖拽库内部状态** - 如 `react-easy-crop`、`react-dropzone` 等第三方库需要通过 useState 管理内部状态
2. **Dockview 相关** - `dockview/react.ts` 中的 `useState` 用于触发强制渲染，是桥接模式的一部分
3. ** Monaco/DiffEditor 的主题状态** - 已在 code-editor 和 diff-editor 中转换
4. **复杂的函数式批量更新** - 如果状态更新依赖旧值且操作复杂，保持 useState

## 类型检查

```bash
# 运行完整类型检查
pnpm tsc --noEmit

# 过滤特定文件的错误
pnpm tsc --noEmit 2>&1 | grep "specific-file"
```

## 调试技巧

### useReactive 状态调试

由于 useReactive 使用 Proxy，React DevTools 中显示的状态可能是 Proxy 对象而不是实际值。在控制台中可以这样查看：

```typescript
// 在组件中添加临时日志
console.log("state:", JSON.stringify(state));
```
