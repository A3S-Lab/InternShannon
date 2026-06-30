# InternShannon Domain Context

InternShannon is a desktop-centered cognitive workspace where agents, skills,
knowledge, tools, files, and runtime sessions are configured, observed, and
evolved through governed local workflows.

This file defines product language for agents and contributors. Use these terms
when naming code, docs, UI copy, logs, and tests.

## Language

**Digital Asset**:
The primary product object that captures an agent, skill, workflow, knowledge
base, tool, model, codebase, or evaluation history as a versioned and governable
unit.
_Avoid_: repository metadata, file bundle

**Asset Artifact**:
A build or upload output produced from a Digital Asset version, such as an agent
source package, skill ZIP, workflow package, or OCI artifact.
_Avoid_: raw registry manifest, infrastructure object

**Asset Artifact Catalog**:
The product interface for finding, validating, and presenting Asset Artifacts for
a Digital Asset across package, registry, or stored build outputs.
_Avoid_: registry index, OCI repository listing

**Runnable Artifact**:
An Asset Artifact with enough launch metadata and a launchable distribution for
the runtime to create a Runtime Instance.
_Avoid_: image, container, source package

**Kernel Session**:
An interactive agent workspace session that receives user messages, streams
assistant/tool events, and records conversation history.
_Avoid_: WebSocket connection, browser tab

**Kernel Session Connection**:
The live client membership for a Kernel Session, binding connected clients to a
session stream and keeping the active runtime alive while users are present.
_Avoid_: socket map, browser tab state

**Kernel Message Run**:
One user-message turn inside a Kernel Session, including model/tool streaming,
cancellation, human approval feedback, and assistant message persistence.
_Avoid_: gateway handler, socket message

**Kernel Message Run Intake**:
The application operation that accepts a user message, appends the user side to
the Kernel Conversation Log, resolves the Kernel Session Runtime, and starts a
Kernel Message Run.
_Avoid_: WebSocket message handler, raw stream launcher

**Kernel Message Run Cancellation**:
The operation that marks a Kernel Message Run as cancelled, interrupts the active
Kernel Session Runtime when present, and reports cancellation readiness to the
client.
_Avoid_: socket interrupt handler, raw cancel flag

**Kernel BTW Query**:
An ephemeral side question executed against the active Kernel Session Runtime
without appending to the main Kernel Conversation Log.
_Avoid_: hidden user message, alternate message run

**Kernel Conversation Log**:
The persisted ordered user and assistant messages for a Kernel Session, including
attachment metadata and assistant tool/content blocks.
_Avoid_: WebSocket history buffer, raw message repository

**Kernel Session Snapshot**:
The initial read model for a Kernel Session subscription, including persisted
session metadata and Conversation Log history normalized for stream replay.
_Avoid_: socket subscribe handler, browser-only history mapper

**Kernel Session Runtime**:
The live a3s-code session backing a Kernel Session, including workspace
resolution, model/runtime overrides, MCP initialization, and HITL tool policy
hooks.
_Avoid_: socket room, raw Agent instance

**Kernel Session Runtime Access**:
The application seam that refreshes runtime catalog data, applies runtime
overrides, resolves active-or-new Kernel Session Runtimes, and closes idle
runtimes.
_Avoid_: gateway runtime cache, scattered get-or-create calls

**Kernel Session Status**:
The observable snapshot of an active Kernel Session Runtime, including tools,
commands, MCP status, memory status, skills, and initialization warnings.
_Avoid_: debug dump, raw runtime object

**Kernel Session Reset**:
The operation that clears a Kernel Session's Conversation Log and transient
Session Runtime files, and closes any active runtime.
_Avoid_: clear button handler, delete message loop

**Kernel Tool Confirmation**:
The HITL decision point that determines whether a Kernel Message Run may execute
a tool call requiring user approval.
_Avoid_: confirmation modal, socket callback

**Lifecycle Feedback**:
Product-level event facts emitted so assets, runtime instances, kernel sessions,
and message runs can be observed through one lifecycle vocabulary.
_Avoid_: ad hoc telemetry payload, controller log

**Runtime**:
A product-level execution domain that turns a digital asset artifact or local
workspace capability into a managed running capability for agents, workflows,
models, or tools.
_Avoid_: Kubernetes, container, pod, deployment

**Runtime Instance**:
A concrete running instance created and governed by the Runtime.
_Avoid_: Pod, process, container

**Compute Resource**:
Allocatable capacity such as CPU, GPU, memory, storage, or network that can be
assigned to a Runtime.
_Avoid_: Kubernetes resource, infrastructure object

**Infrastructure Object**:
A backend orchestration object exposed for operations visibility, such as a
process, service, worker, container, Kubernetes Pod, Deployment, Event, or
Namespace.
_Avoid_: Resource, Runtime

**Infrastructure Operations**:
An ops-facing product area for inspecting and acting on backend-specific
Infrastructure Objects.
_Avoid_: Resource management, Runtime management

**Orchestration Backend**:
The infrastructure adapter behind Runtime and operations views, such as the local
desktop runtime, Kubernetes, OrbStack, or a remote backend.
_Avoid_: Runtime

## Relationships

- A Digital Asset may produce one or more Asset Artifacts.
- The Asset Artifact Catalog finds Asset Artifacts for a Digital Asset and
  applies product rules before callers publish, list, or launch them.
- A Runnable Artifact is an Asset Artifact that the Runtime can launch.
- A Runtime creates one or more Runtime Instances.
- A Runtime may reserve or consume one or more Compute Resources.
- An Orchestration Backend materializes Runtime Instances as backend-specific
  Infrastructure Objects.
- Infrastructure Operations surfaces Infrastructure Objects from an
  Orchestration Backend.
- A Kernel Session may have one or more active Kernel Session Connections.
- A Kernel Session may execute many Kernel Message Runs.
- Kernel Message Run Intake starts a Kernel Message Run from a user message.
- Kernel Message Run Cancellation interrupts an active Kernel Message Run through
  the Kernel Session Runtime.
- A Kernel Session may answer Kernel BTW Queries through its active Kernel
  Session Runtime.
- A Kernel Session owns one Kernel Conversation Log.
- A Kernel Session Snapshot replays the persisted Kernel Conversation Log when a
  client subscribes to a Kernel Session.
- A Kernel Session may have one active Kernel Session Runtime.
- Kernel Session Connections keep a Kernel Session Runtime alive while clients
  are subscribed.
- Kernel Session Runtime Access is the shared entry point for resolving and
  closing a Kernel Session Runtime.
- A Kernel Session Reset clears the Kernel Conversation Log and transient files
  for a Kernel Session Runtime.
- A Kernel Session Runtime exposes Kernel Session Status for UI and operations
  views.
- A Kernel Message Run appends assistant output to the Kernel Conversation Log.
- A Kernel Message Run executes through the active Kernel Session Runtime.
- A Kernel Message Run may request Kernel Tool Confirmation before executing a
  sensitive or non-readonly tool.
- A Runtime Instance emits Lifecycle Feedback for creation, update, scaling, and
  deletion.
- A Kernel Message Run emits Lifecycle Feedback for streaming, tool approval,
  cancellation, and completion.

## Example dialogue

> **Dev:** "Should the Runtime page show pods directly?"
> **Domain expert:** "No. The Runtime page should show Runtime Instances. Pods
> are Infrastructure Objects available in operations views."

## Flagged ambiguities

- "Resource" can mean allocatable capacity or a raw backend object. Use Compute
  Resource for allocatable capacity and Infrastructure Object for backend
  orchestration objects.
- "Runtime" should remain a product abstraction. Kubernetes, a local process, or
  a sidecar worker is an Orchestration Backend detail.
- "Package", "artifact", and "image" should not be used interchangeably. Use
  Asset Artifact for outputs from a Digital Asset and Runnable Artifact for the
  subset the Runtime can launch.
