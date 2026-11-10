#!/usr/bin/env python3
"""Set Home Assistant trusted proxy settings through its WebSocket API."""

from __future__ import annotations

import asyncio
import json
import os

import websockets


WS_URL = "ws://127.0.0.1:8123/api/websocket"


async def command(ws, message_id: int, payload: dict) -> dict:
    await ws.send(json.dumps({"id": message_id, **payload}))
    while True:
        response = json.loads(await ws.recv())
        if response.get("id") == message_id:
            return response


async def main() -> None:
    token = os.environ.get("HA_TOKEN")
    if not token:
        raise SystemExit("HA_TOKEN is required")

    async with websockets.connect(WS_URL) as ws:
        hello = json.loads(await ws.recv())
        if hello.get("type") != "auth_required":
            raise SystemExit(f"Unexpected WebSocket hello: {hello}")

        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            raise SystemExit(f"Authentication failed: {auth}")

        current = await command(ws, 1, {"type": "http/config"})
        if not current.get("success"):
            raise SystemExit(f"http/config failed: {current}")

        config = dict(current["result"]["stable"])
        for key in ("created_at", "error", "error_message"):
            config.pop(key, None)
        config["use_x_forwarded_for"] = True
        config["trusted_proxies"] = ["127.0.0.1/32", "::1/128"]

        response = await command(
            ws,
            2,
            {"type": "http/config/configure", "config": config},
        )
        if not response.get("success"):
            raise SystemExit(f"http/config/configure failed: {response}")
        print("Home Assistant HTTP proxy configuration restarted successfully.")


if __name__ == "__main__":
    asyncio.run(main())
