import argparse
import inspect
import secrets
from pathlib import Path
from typing import TypeVar, Callable, Awaitable, Union, overload, cast
from python.helpers import dotenv, rfc, settings, files
import asyncio
import threading
import queue
import sys

T = TypeVar("T")
R = TypeVar("R")

parser = argparse.ArgumentParser()
args = {}
dockerman = None
runtime_id = None

def initialize():
    global args
    if args: return
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", type=str, default=None)
    parser.add_argument("--dockerized", type=bool, default=False)
    known, unknown = parser.parse_known_args()
    args = vars(known)

def get_arg(name: str):
    global args
    return args.get(name, None)

def is_dockerized() -> bool:
    return True # Force True to disable RFC

def is_development() -> bool:
    return False # Force False to disable RFC

def get_local_url():
    return "127.0.0.1"

def get_runtime_id() -> str:
    global runtime_id
    if not runtime_id: runtime_id = secrets.token_hex(8)
    return runtime_id

def get_persistent_id() -> str:
    id = dotenv.get_dotenv_value("A0_PERSISTENT_RUNTIME_ID")
    if not id:
        id = secrets.token_hex(16)
        dotenv.save_dotenv_value("A0_PERSISTENT_RUNTIME_ID", id)
    return id

async def call_development_function(func, *args, **kwargs):
    if inspect.iscoroutinefunction(func):
        return await func(*args, **kwargs)
    return func(*args, **kwargs)

async def handle_rfc(rfc_call):
    return await rfc.handle_rfc(rfc_call=rfc_call, password="none")

def get_web_ui_port():
    return int(dotenv.get_dotenv_value("WEB_UI_PORT", 5000))

def get_platform(): return sys.platform
def is_windows(): return False
def get_terminal_executable(): return "/bin/bash"
