#!/usr/bin/env python3
"""SafeClaw-owned Hermes bootstrap.

Loads the SafeClaw runtime patch before delegating to the upstream Hermes CLI.
This lets SafeClaw integrate Hermes native runs/events without modifying the
external hermes-agent repository in-place.
"""

from safeclaw_hermes_patch import apply_patch


def main() -> None:
    apply_patch()

    from hermes_cli.main import main as hermes_main

    hermes_main()


if __name__ == "__main__":
    main()
