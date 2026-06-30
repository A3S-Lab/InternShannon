# internShannon Design Language

This document defines the product UI taste for internShannon. It replaces the
previous MiniMax-inspired marketing aesthetic with a design language shaped by
what internShannon actually is: a focused desktop workspace for agent chat and
knowledge-base management.

The goal is not to make the product look more "AI". The goal is to make a
powerful system feel calm, legible, trustworthy, and operational.

Product usability comes before test convenience. Tests are guardrails for the
intended user experience; they are not the product goal. When a behavior feels
wrong in real use, do not reshape the product merely to satisfy a narrow test or
make an implementation easy to verify. First define the normal user workflow and
the expectation that would make the product feel natural, then design the code
and tests to protect that workflow.

## 1. Design Thesis

internShannon should feel like a serious workbench with a quiet intelligence inside.

It is closer to an operating system, IDE, command center, and asset registry
than to an AI landing page. The interface should make complex agentic systems
inspectable: what exists, what is running, what changed, what failed, who owns
it, and what can be done next.

The desired feeling:

- Calm under load.
- Dense without feeling cramped.
- Technical without being cold.
- Chinese enterprise-ready without looking bureaucratic.
- AI-native without AI-decoration.
- Clear enough for repeated daily operation, not only first-time delight.

The core metaphor is:

> A governed cognitive workbench.

Avoid the common AI product smell:

- Giant gradient hero sections.
- Purple-blue glow everywhere.
- Floating glass cards over decorative blobs.
- Chatbot-first layouts for knowledge management.
- Over-friendly copy that explains obvious controls.
- Cards used as the only layout grammar.
- Every page trying to look like a launch announcement.

## 2. Product Personality

### Keywords

- Precise
- Composed
- Capable
- Inspectable
- Modular
- Trustworthy
- Work-focused
- Slightly warm

### What The UI Should Communicate

Users should feel that internShannon can safely host valuable work:

- Digital assets have provenance.
- Agent sessions and knowledge sources can be inspected.
- Runtime state is observable.
- Permissions and ownership are explicit.
- AI behavior is configurable, not magical.
- Failures are diagnosable instead of theatrical.

### What The UI Should Not Communicate

Do not make internShannon feel like:

- A prompt demo site.
- A model leaderboard.
- A consumer chatbot wrapper.
- A generic admin template.
- A dark sci-fi dashboard.
- A pastel AI toy.
- A portfolio page for feature screenshots.

## 3. Interface Families

internShannon has several interface modes. They should share tokens and behavior, but
their density and expressiveness differ.

### Admin Console

Use for platform settings, local capabilities, access metadata, assets,
packages, marketplace, runtimes, resources, and governance.

Style:

- Quiet, dense, table-friendly.
- Headers are compact and informational.
- Controls are predictable.
- Status is visible through restrained semantic color.
- Empty states are useful, not promotional.

Default composition:

- Page shell.
- Compact header band.
- Filter/action toolbar.
- Table, split pane, or structured workspace.
- Detail drawer or dialog for focused editing.

Avoid:

- Hero blocks.
- Oversized cards.
- Marketing illustrations.
- Decorative gradients.
- Long feature explanations inside the app.

### Asset Workbench

Use for digital asset creation, editing, versions, knowledge source review,
debugging, and artifact inspection.

Style:

- IDE-like, spatial, pane-based.
- Strong left-to-right hierarchy: navigation, canvas/list, inspector.
- Small labels and stable dimensions.
- Graph/canvas areas may have richer visuals, but controls stay quiet.

Default composition:

- Toolbar with primary mode and actions.
- Canvas or editor center.
- Side inspector.
- Bottom or right runtime/debug panel.
- Inline status and diagnostics.

Avoid:

- Decorative cards around the canvas.
- Resizing controls based on content.
- Excessive shadows on graph nodes.
- Animation that competes with inspection.

### Desktop Workspace

Use for the local Tauri client, agent sessions, files, skills, and terminal-like
flows.

Style:

- Closer to a native work app than a web dashboard.
- Compact navigation.
- Strong keyboard affordances.
- File, terminal, chat, and editor surfaces should feel related.

Default composition:

- Activity bar.
- Session or file list.
- Main work surface.
- Contextual inspector or side panel.

Avoid:

- Landing-page patterns.
- High-contrast decorative panels.
- Chat bubble dominance when the task is file or runtime work.

### Landing And Public Pages

Public marketing pages may be more expressive, but they must not define the
admin product language.

Allowed:

- One strong first-viewport visual.
- Carefully chosen brand imagery.
- More generous spacing.
- Narrative sections.

Still avoid:

- Generic AI nebula visuals.
- Abstract gradient blobs.
- Fake app mockups that do not show real state.
- Purple-blue dominance.

## 4. Visual Principles

### 4.1 Surfaces Before Decoration

The primary visual unit is a useful surface:

- table
- list
- editor
- graph
- timeline
- terminal
- inspector
- settings section
- runtime panel

Decoration must come after structure. If a visual element does not help scan,
compare, decide, or act, remove it.

### 4.2 System Chrome Is Quiet

Navigation, headers, tabs, sidebars, and toolbars should recede. They frame the
work; they are not the work.

Use:

- thin borders
- muted backgrounds
- small labels
- stable icon buttons
- clear active states

Avoid:

- large nav cards
- glowing sidebars
- heavily colored headers
- oversized page titles

### 4.3 AI Is A Capability Layer

AI should appear as:

- assistant configuration
- model/provider routing
- skills and tools
- run traces
- prompt and context controls
- suggestions at the point of work

AI should not appear as:

- visual magic dust
- permanent sparkle icons
- gradient mascots
- every empty state saying "AI-powered"
- chat as the default layout for unrelated tasks

### 4.4 Density Is A Feature

internShannon users compare many assets, sessions, runs, permissions, and artifacts.
The UI should support scanning without making everything tiny.

Prefer:

- 13px to 14px body text in operational views
- 11px to 12px metadata
- compact rows with clear hit areas
- grouped fields
- tables with persistent affordances
- split panes instead of stacked cards

Avoid:

- 18px body text in dashboards
- page sections that are floating cards
- large vertical gaps between related controls
- single-purpose cards when a table or list would scan better

## 5. Color System

The current brand blue can remain, but it must become a functional accent rather
than a decorative wash.

### Core Tokens

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Background | `#ffffff` | `#080d17` | app base |
| Raised surface | `#ffffff` | `#0f172a` | panels, dialogs |
| Subtle surface | `#f7f8fb` | `#111827` | page background, inactive bands |
| Border light | `#edf0f7` | `#243044` | section borders |
| Border strong | `#d7dde8` | `#344054` | inputs, selected edges |
| Text primary | `#111827` | `#f8fafc` | main content |
| Text secondary | `#475569` | `#cbd5e1` | descriptions |
| Text muted | `#64748b` | `#94a3b8` | metadata |
| Primary | `#1456f0` | `#60a5fa` | active, focus, primary action |
| Primary soft | `#eaf1ff` | `rgba(96,165,250,0.14)` | selected backgrounds |

### Semantic Colors

Use semantic colors sparingly and consistently.

| State | Color | Use |
| --- | --- | --- |
| Success | `#10b981` | healthy, complete, enabled |
| Warning | `#f59e0b` | degraded, needs attention |
| Error | `#ef4444` | failed, blocked, destructive |
| Info | `#2563eb` | neutral guidance |
| Running | `#06b6d4` | active execution, streaming |
| Pending | `#94a3b8` | queued, inactive |

### Color Rules

- Blue is for interaction and current selection, not atmosphere.
- Pink and purple are rare accents, not product defaults.
- Avoid full-page blue, purple, beige, espresso, or dark-slate themes.
- Use colored backgrounds only for state, selection, or a small class of
  domain-specific objects.
- Prefer neutral surfaces with colored indicators over colorful panels.
- Graphs and knowledge maps may use more color, but each color must encode meaning.

## 6. Typography

Typography should feel like a product interface, not a launch page.

### Fonts

Preferred:

- UI: `DM Sans`, system sans fallback.
- Code and logs: `Fira Code`, system mono fallback.
- Dense technical data: system sans or mono depending on value type.

Use `Outfit` only for public brand surfaces or rare display moments. Do not use
multiple display fonts inside the admin console.

### Scale

| Role | Size | Weight | Line Height | Use |
| --- | --- | --- | --- | --- |
| Page title | 18px | 600 | 24px | admin page shell |
| Section title | 14px | 600 | 20px | settings, panels |
| Toolbar label | 12px | 500 to 600 | 16px | filters, tabs |
| Body | 14px | 400 to 500 | 20px | normal app text |
| Compact body | 13px | 400 to 500 | 18px | tables, metadata-rich views |
| Metadata | 11px to 12px | 500 | 16px | ids, tags, timestamps |
| Code/log | 12px to 13px | 400 | 18px to 19px | terminal, JSON, trace |

### Typography Rules

- Use letter spacing `0`.
- Do not scale font size with viewport width.
- Reserve large type for public pages, not internal tools.
- Avoid 48px+ headings inside the app.
- Use weight and spacing before using color for hierarchy.
- Chinese labels should be concise; English technical terms can remain when
  they are product vocabulary, such as Provider, Runtime, Token, MCP.

## 7. Layout System

### Grid And Spacing

Use an 8px spacing base. Operational screens may use half-steps where needed.

Recommended scale:

- 2px: hairline alignment, badge internals
- 4px: tight icon/text gap
- 6px: compact row gap
- 8px: default gap
- 12px: panel padding
- 16px: page padding and major control gaps
- 24px: large group separation
- 32px: rare page-level separation

Avoid 64px+ vertical gaps inside authenticated product views.

### Common Page Shapes

Prefer these shapes:

- List plus detail.
- Table plus drawer.
- Canvas plus inspector.
- Editor plus preview.
- Timeline plus event detail.
- Settings section plus grouped fields.
- Dashboard summary plus data table.

Avoid:

- stacked marketing cards
- nested cards
- centered one-column forms for complex settings
- split hero text/media layouts inside the app

### Stable Dimensions

Fixed-format UI elements must not resize on hover or content changes:

- icon buttons
- graph nodes
- board tiles
- toolbar controls
- counters
- status pills
- tab items
- table cells with actions

Use fixed width, min width, max width, aspect ratio, or truncation.

## 8. Components

### Buttons

Default button radius: 6px to 8px.

Use icons for tool actions:

- save
- refresh
- upload
- download
- filter
- search
- open
- copy
- delete
- run
- stop
- retry

Use text buttons for commands that need clarity:

- Create asset
- Publish version
- Save configuration
- Start debug run

Primary actions:

- Blue background only when there is one clear next action.
- Do not make every toolbar action blue.

Secondary actions:

- Neutral border or muted background.
- Use hover states, not persistent color.

Destructive actions:

- Red only when the action is destructive or irreversible.
- Prefer confirmation dialogs for high-impact deletes.

### Cards

Cards are for repeated objects or focused modules, not page layout.

Radius:

- App cards: 6px to 8px.
- Dialogs and drawers: 8px.
- Public landing cards may use 12px, rarely more.

Card rules:

- No card inside another card.
- No page section styled as a giant floating card.
- No decorative shadows for normal cards.
- Use border and background contrast before elevation.
- Cards must show actionable state: owner, version, status, last change, or
  available action.

### Tables And Lists

Tables should be first-class, not a fallback.

Rules:

- Keep headers compact.
- Use tabular numbers for counts and durations.
- Keep actions visible or predictably revealed.
- Use row hover only to clarify target, not to decorate.
- Long IDs should truncate with copy affordances.
- Status columns should use icon/dot plus label where ambiguity matters.

### Panels And Inspectors

Inspectors are central to internShannon.

Rules:

- Keep a sticky title/action area.
- Use grouped fields.
- Show source, owner, version, and state near the top.
- Use JSON/code editors only when the user truly needs raw structure.
- Provide validation close to the field.

### Dialogs And Drawers

Dialogs are for focused decisions. Drawers are for inspecting a selected object
without losing spatial context.

Rules:

- Dialog width should match task complexity.
- Avoid tiny modals for dense technical forms.
- Drawers should preserve the selected object identity.
- Dialog footers should have one primary action.

### Status

Status is a product object, not decoration.

Every status display should answer:

- What is the state?
- Is it healthy?
- Does it need action?
- When did it change?
- Where can I inspect the cause?

Use:

- small dot for simple live state
- pill for filterable state
- banner for page-level issue
- inline field message for validation
- timeline for runtime or audit history

## 9. Data Visualization And Graphs

Graphs are allowed to be expressive because they reveal system structure, but
they must remain inspectable.

Rules:

- Use color by semantic category, not by decoration.
- Always provide legend or direct labels when color carries meaning.
- Selected state must be unmistakable.
- Hover state should reveal useful metadata.
- Dense graphs need search, filtering, zoom, and reset controls.
- Keep graph controls outside the visual field when possible.

Avoid:

- neon-on-black default dashboards
- particles and background effects in operational graph views
- animated edges unless they indicate live execution
- color palettes where every node looks equally important

## 10. Motion

Motion should explain causality.

Allowed:

- 120ms to 180ms hover and selection transitions.
- 180ms to 240ms panel open/close.
- subtle pulse for newly streamed agent events.
- progress indication for running jobs.
- skeleton loading for async data.

Avoid:

- ambient animation loops.
- decorative background motion in the app.
- springy UI for serious operations.
- motion that delays command execution.

Respect `prefers-reduced-motion`.

## 11. Writing And Voice

The interface should sound precise and calm.

Use:

- direct labels
- concrete nouns
- exact status
- specific remediation
- Chinese-first product copy with technical terms preserved where useful

Avoid:

- "AI-powered" as filler.
- "智能化赋能" style slogans.
- long instructions for obvious controls.
- vague errors such as "Something went wrong".
- cute empty states.

Examples:

- Good: "未配置默认 OCR 后端"
- Better: "启用一个 OCR 后端并设为默认后，文档解析会自动使用该服务。"
- Bad: "让 AI 帮你开启智能识别之旅"

- Good: "运行失败：镜像拉取超时"
- Better: "运行失败：节点 3 次拉取镜像超时。检查镜像地址或仓库凭据。"
- Bad: "任务遇到了一点问题"

## 12. internShannon Specific Patterns

### Digital Asset Cards

Asset cards must expose operational identity:

- name
- kind
- owner
- visibility
- latest version
- last updated
- publish/deploy/run state
- primary action

Avoid decorative thumbnails unless they are real previews.

### Knowledge Builder

Knowledge-base UI should feel like a structured editor:

- left palette
- central source list or document canvas
- right inspector
- bottom diagnostics or ingest trace

Node colors:

- source/action: blue
- condition/branch: amber
- loop: cyan
- input/output: slate
- error: red
- success/completed: emerald

Do not add colors without domain meaning.

### Runtime And Process Views

Runtime pages should prioritize:

- current state
- owner
- namespace
- image or package reference
- resources
- logs
- events
- exposure URL
- remediation action

Use dense tables, status dots, and log panels. Avoid dashboard theatrics.

### AI And LLM Configuration

AI configuration is infrastructure configuration.

Show:

- provider
- model
- base URL
- capability flags
- runtime limits
- tool/MCP settings
- default route
- saved/customized state

Avoid:

- model cards that look like a consumer product gallery
- decorative model illustrations
- copy that implies magic

### OCR Configuration

OCR configuration should mirror LLM configuration:

- default backend selector
- backend list
- enabled state
- base URL and endpoint
- request format
- output format
- timeout
- headers and advanced options

OCR providers are service adapters. Treat them as infrastructure, not feature
cards.

## 13. Accessibility And Interaction

Baseline requirements:

- All icon-only buttons need accessible labels or tooltips.
- Text must fit inside controls at desktop and mobile widths.
- Focus rings must be visible.
- Color cannot be the only state indicator.
- Hit targets should be at least 32px in dense views and 40px in touch-heavy
  views.
- Form errors must be associated with fields.
- Keyboard users must be able to reach primary actions, tables, tabs, dialogs,
  and drawers.

## 14. Do And Do Not

### Do

- Use neutral surfaces and meaningful state color.
- Build dense, stable layouts for repeated work.
- Prefer split panes, tables, drawers, and inspectors.
- Use real product state as the visual anchor.
- Keep app headers compact.
- Make every status inspectable.
- Let AI appear through controls, traces, and suggestions.
- Use icon buttons for tools and text buttons for clear commands.
- Keep cards flat, bordered, and purposeful.

### Do Not

- Do not make admin pages look like landing pages.
- Do not use giant hero headings inside the app.
- Do not use decorative gradient blobs or floating glow objects.
- Do not use purple-blue gradients as a default background.
- Do not nest cards.
- Do not add shadows to create hierarchy where borders and layout suffice.
- Do not make chat the default shape for every AI-related feature.
- Do not fill empty states with generic AI illustrations.
- Do not hide operational metadata for the sake of visual cleanliness.

## 15. Agent Prompt Guide

When asking an agent to build internShannon UI, use prompts like:

> Build this as an operational internShannon admin surface. Use a compact page shell,
> neutral background, bordered sections, dense table/list layout, stable icon
> buttons, and semantic status color only. Do not use landing-page hero sections,
> decorative gradients, nested cards, or generic AI illustration.

For settings pages:

> Use the existing system settings pattern: compact header action, grouped
> sections, 13px to 14px labels, 6px to 8px radius, bordered neutral surfaces,
> dirty state, validation state, and clear save affordance.

For asset/knowledge pages:

> Use an IDE-like composition: toolbar, central canvas or list, right inspector,
> and bottom diagnostics. Encode ingest state with semantic color and labels.
> Keep controls outside the canvas where possible.

For runtime pages:

> Prioritize inspection: state, owner, namespace, image/package reference,
> resources, events, logs, and remediation actions. Use tables, timelines, and
> log panels instead of marketing cards.

For public pages:

> Public pages may use a stronger first-viewport visual, but must show real
> product surfaces and avoid generic AI gradients. Brand expression should not
> leak into admin/workbench density.

## 16. Final Taste Check

Before shipping a internShannon screen, ask:

1. Can a returning operator scan this in under five seconds?
2. Does every color encode a state, category, or action?
3. Is the main object of work visible in the first viewport?
4. Are actions stable and predictable?
5. Can failures be inspected from here?
6. Would this still look credible without the word "AI" on the page?
7. Did we choose a table, split pane, or inspector where a card grid would be
   weaker?
8. Is the visual interest coming from real system state rather than decoration?

If the answer to any of these is no, simplify the visual design and expose more
product structure.
