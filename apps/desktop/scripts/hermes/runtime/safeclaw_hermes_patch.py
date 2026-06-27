#!/usr/bin/env python3
"""SafeClaw-owned Hermes API server overlay.

The upstream Hermes API server exposes native `/v1/runs` + `/events`, but it
resolves the runtime provider/model from Hermes' own global config. SafeClaw
needs per-session provider/model overrides so Hermes can reuse SafeClaw's
unified provider configuration while still running Hermes' native agent flow.

This overlay is intentionally stored in SafeClaw and injected only into a
temporary build/run context. The external `hermes-agent` repository stays
untouched.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_PATCHED = False
_VALID_API_MODES = {
    "chat_completions",
    "codex_responses",
    "anthropic_messages",
}


def _normalize_runtime_override(body: Any) -> Optional[Dict[str, str]]:
    if not isinstance(body, dict):
        return None

    runtime = body.get("runtime")
    runtime = runtime if isinstance(runtime, dict) else {}

    model = str(body.get("model") or "").strip()
    provider = str(runtime.get("provider") or "").strip().lower()
    api_key = str(runtime.get("api_key") or "").strip()
    base_url = str(runtime.get("base_url") or "").strip().rstrip("/")
    api_mode = str(runtime.get("api_mode") or "").strip().lower()

    if not provider and "/" in model:
        provider = model.split("/", 1)[0].strip().lower()

    if api_mode not in _VALID_API_MODES:
        api_mode = _infer_api_mode(provider, base_url)

    override = {
        "model": model,
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
        "api_mode": api_mode,
    }
    normalized = {
        key: value for key, value in override.items() if isinstance(value, str) and value
    }
    return normalized or None


def _infer_api_mode(provider: str, base_url: str) -> str:
    normalized_provider = (provider or "").strip().lower()
    normalized_base_url = (base_url or "").strip().lower().rstrip("/")

    if normalized_provider == "anthropic" or "/anthropic" in normalized_base_url:
        return "anthropic_messages"
    if normalized_provider == "openai-codex":
        return "codex_responses"
    if "api.openai.com" in normalized_base_url and "openrouter" not in normalized_base_url:
        return "codex_responses"
    if normalized_provider or normalized_base_url:
        return "chat_completions"
    return ""


def apply_patch() -> None:
    global _PATCHED
    if _PATCHED:
        return

    from gateway.platforms.api_server import APIServerAdapter

    original_handle_runs = APIServerAdapter._handle_runs
    original_create_agent = APIServerAdapter._create_agent

    async def patched_handle_runs(self, request):  # type: ignore[override]
        try:
            body = await request.json()
        except Exception:
            return await original_handle_runs(self, request)

        override = _normalize_runtime_override(body)
        session_id = str(body.get("session_id") or "").strip()
        if override and session_id:
            overrides = getattr(self, "_safeclaw_runtime_overrides", None)
            if overrides is None:
                overrides = {}
                setattr(self, "_safeclaw_runtime_overrides", overrides)
            overrides[session_id] = override
            logger.info(
                "[safeclaw-hermes] queued runtime override for session=%s provider=%s model=%s",
                session_id[:24],
                override.get("provider", ""),
                override.get("model", ""),
            )

        return await original_handle_runs(self, request)

    def patched_create_agent(
        self,
        *,
        ephemeral_system_prompt: Optional[str],
        session_id: str,
        stream_delta_callback=None,
        tool_progress_callback=None,
        tool_start_callback=None,
        tool_complete_callback=None,
    ):  # type: ignore[override]
        overrides = getattr(self, "_safeclaw_runtime_overrides", {}) or {}
        runtime_override = overrides.pop(session_id, None)
        if not runtime_override:
            return original_create_agent(
                self,
                ephemeral_system_prompt=ephemeral_system_prompt,
                session_id=session_id,
                stream_delta_callback=stream_delta_callback,
                tool_progress_callback=tool_progress_callback,
                tool_start_callback=tool_start_callback,
                tool_complete_callback=tool_complete_callback,
            )

        from gateway.run import (
            GatewayRunner,
            _load_gateway_config,
            _resolve_gateway_model,
            _resolve_runtime_agent_kwargs,
        )
        from hermes_cli.tools_config import _get_platform_tools
        from run_agent import AIAgent

        runtime_kwargs = dict(_resolve_runtime_agent_kwargs())
        provider = runtime_override.get("provider", "").strip()
        base_url = runtime_override.get("base_url", "").strip()
        api_mode = runtime_override.get("api_mode", "").strip()

        if provider:
            runtime_kwargs["provider"] = provider
        if runtime_override.get("api_key"):
            runtime_kwargs["api_key"] = runtime_override["api_key"]
        if base_url:
            runtime_kwargs["base_url"] = base_url
        if api_mode:
            runtime_kwargs["api_mode"] = api_mode
        elif provider or base_url:
            runtime_kwargs.pop("api_mode", None)

        model = runtime_override.get("model") or _resolve_gateway_model()
        user_config = _load_gateway_config()
        enabled_toolsets = sorted(_get_platform_tools(user_config, "api_server"))
        max_iterations = int(__import__("os").getenv("HERMES_MAX_ITERATIONS", "90"))
        fallback_model = GatewayRunner._load_fallback_model()

        logger.info(
            "[safeclaw-hermes] applying runtime override session=%s provider=%s model=%s api_mode=%s",
            session_id[:24],
            runtime_kwargs.get("provider", ""),
            model,
            runtime_kwargs.get("api_mode", ""),
        )

        return AIAgent(
            model=model,
            **runtime_kwargs,
            max_iterations=max_iterations,
            quiet_mode=True,
            verbose_logging=False,
            ephemeral_system_prompt=ephemeral_system_prompt or None,
            enabled_toolsets=enabled_toolsets,
            session_id=session_id,
            platform="api_server",
            stream_delta_callback=stream_delta_callback,
            tool_progress_callback=tool_progress_callback,
            tool_start_callback=tool_start_callback,
            tool_complete_callback=tool_complete_callback,
            session_db=self._ensure_session_db(),
            fallback_model=fallback_model,
        )

    APIServerAdapter._handle_runs = patched_handle_runs
    APIServerAdapter._create_agent = patched_create_agent
    _PATCHED = True
    logger.info("[safeclaw-hermes] Hermes API server patch is active")
