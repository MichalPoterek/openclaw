#!/bin/bash

echo "Applying Agent Zero Patches..."

# 1. Fix runtime.py (Disable RFC)
cat << 'PYTHON' > /home/mike/agent-zero/python/helpers/runtime.py
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
    parser.add_argument("--dockerized", action="store_true")
    parser.add_argument("--development", action="store_true")
    known, unknown = parser.parse_known_args()
    args = vars(known)

def get_arg(name: str):
    global args
    return args.get(name, None)

def is_dockerized() -> bool:
    return bool(get_arg("dockerized"))

def is_development() -> bool:
    return True # Keep dev features but bypass RFC via call_development_function

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
    # SAFETY BYPASS: Never use RFC, always call locally
    if inspect.iscoroutinefunction(func):
        return await func(*args, **kwargs)
    return func(*args, **kwargs)

def call_development_function_sync(func, *args, **kwargs):
    return func(*args, **kwargs)

async def handle_rfc(rfc_call):
    return await rfc.handle_rfc(rfc_call=rfc_call, password="none")

def _get_rfc_password(): return "none"
def _get_rfc_url(): return "http://localhost:55080/rfc"

def get_web_ui_port():
    return int(get_arg("port") or dotenv.get_dotenv_value("WEB_UI_PORT", 5000))

def get_platform(): return sys.platform
def is_windows(): return False
def get_terminal_executable(): return "/bin/bash"
PYTHON
echo "✓ runtime.py patched"

# 2. Fix file_browser.py (Path mapping + safe listing)
cat << 'PYTHON' > /home/mike/agent-zero/python/helpers/file_browser.py
import os
from pathlib import Path
import shutil
import base64
import subprocess
from typing import Dict, List, Tuple, Any
from werkzeug.utils import secure_filename
from datetime import datetime

from python.helpers import files
from python.helpers.print_style import PrintStyle


class FileBrowser:
    ALLOWED_EXTENSIONS = {
        'image': {'jpg', 'jpeg', 'png', 'bmp'},
        'code': {'py', 'js', 'sh', 'html', 'css'},
        'document': {'md', 'pdf', 'txt', 'csv', 'json'}
    }

    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

    def __init__(self):
        self.base_dir = Path(files.get_base_dir()).resolve()

    def save_file_b64(self, current_path: str, filename: str, base64_content: str):
        try:
            target_file = Path(current_path).resolve() / filename
            os.makedirs(target_file.parent, exist_ok=True)
            with open(target_file, "wb") as file:
                file.write(base64.decodebytes(base64_content.encode()))
            return True
        except Exception as e:
            PrintStyle.error(f"Error saving file {filename}: {e}")
            return False

    def save_files(self, files_list: List, current_path: str = "") -> Tuple[List[str], List[str]]:
        successful = []
        failed = []
        try:
            target_dir = Path(current_path).resolve()
            os.makedirs(target_dir, exist_ok=True)
            for file in files_list:
                try:
                    if file:
                        filename = secure_filename(file.filename)
                        file_path = target_dir / filename
                        file.save(str(file_path))
                        successful.append(filename)
                except Exception as e:
                    PrintStyle.error(f"Error saving file {file.filename}: {e}")
                    failed.append(file.filename)
            return successful, failed
        except Exception as e:
            PrintStyle.error(f"Error in save_files: {e}")
            return successful, failed

    def _get_file_type(self, filename: str) -> str:
        ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
        for file_type, extensions in self.ALLOWED_EXTENSIONS.items():
            if ext in extensions:
                return file_type
        return 'unknown'

    def get_files(self, current_path: str = "") -> Dict:
        files_res = []
        folders_res = []
        try:
            full_path = Path(current_path).resolve()
            
            PrintStyle.hint(f"FileBrowser listing directory: {full_path}")

            if not full_path.exists():
                PrintStyle.error(f"Path does not exist: {full_path}")
                return {"entries": [], "current_path": current_path, "parent_path": ""}

            with os.scandir(full_path) as it:
                for entry in it:
                    if entry.name in ('.', '..'): continue
                    try:
                        stat = entry.stat()
                        try:
                            rel_to_base = Path(entry.path).relative_to(self.base_dir)
                            virtual_path = os.path.join("/a0", str(rel_to_base))
                        except ValueError:
                            virtual_path = entry.path

                        entry_data = {
                            "name": entry.name,
                            "path": virtual_path,
                            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "is_dir": entry.is_dir()
                        }

                        if entry.is_file():
                            entry_data.update({
                                "type": self._get_file_type(entry.name),
                                "size": stat.st_size
                            })
                            files_res.append(entry_data)
                        elif entry.is_dir():
                            entry_data.update({
                                "type": "folder",
                                "size": 0
                            })
                            folders_res.append(entry_data)
                    except Exception:
                        continue

            folders_res.sort(key=lambda x: x["name"].lower())
            files_res.sort(key=lambda x: x["name"].lower())
            all_entries = folders_res + files_res

            parent_path = ""
            try:
                if full_path != self.base_dir:
                    rel_parent = full_path.parent.relative_to(self.base_dir)
                    parent_path = os.path.join("/a0", str(rel_parent))
            except Exception:
                parent_path = ""

            return {
                "entries": all_entries,
                "current_path": current_path,
                "parent_path": parent_path
            }

        except Exception as e:
            PrintStyle.error(f"Error reading directory {current_path}: {e}")
            return {"entries": [], "current_path": current_path, "parent_path": ""}
PYTHON
echo "✓ file_browser.py patched"

# 3. Fix get_work_dir_files.py (API Handler)
cat << 'PYTHON' > /home/mike/agent-zero/python/api/get_work_dir_files.py
from python.helpers.api import ApiHandler, Request, Response
from python.helpers.file_browser import FileBrowser
from python.helpers import runtime, files
import os

class GetWorkDirFiles(ApiHandler):
    @classmethod
    def get_methods(cls) -> list[str]:
        return ["GET", "POST"]

    async def process(self, input: dict, request: Request) -> dict | Response:
        path_in = input.get("path", "")
        if not path_in:
            path_in = request.args.get("path", "")
        
        if not path_in or path_in in ["/a0", "/a0/", "/", "."]:
            real_path = files.get_base_dir()
            display_path = "/a0"
        else:
            real_path = files.fix_dev_path(path_in)
            display_path = path_in if path_in.startswith("/a0") else "/a0"
        
        browser = FileBrowser()
        result = browser.get_files(real_path)
        result["current_path"] = display_path
        
        return {
            "message": "Files retrieved successfully",
            "data": result
        }

def get_files(current_path: str = ""):
    if not current_path or current_path in ["/a0", "/a0/", "/", "."]:
        real_path = files.get_base_dir()
    else:
        real_path = files.fix_dev_path(current_path) if current_path.startswith("/a0") else files.get_abs_path(current_path)
    browser = FileBrowser()
    return browser.get_files(real_path)
PYTHON
echo "✓ get_work_dir_files.py patched"

# 4. Fix upload_work_dir_files.py (Upload Handler)
cat << 'PYTHON' > /home/mike/agent-zero/python/api/upload_work_dir_files.py
import base64
from werkzeug.datastructures import FileStorage
from python.helpers.api import ApiHandler, Request, Response
from python.helpers.file_browser import FileBrowser
from python.helpers import files, runtime
from python.api import get_work_dir_files
import os


class UploadWorkDirFiles(ApiHandler):
    async def process(self, input: dict, request: Request) -> dict | Response:
        if "files[]" not in request.files:
            raise Exception("No files uploaded")

        virtual_path = request.form.get("path", "")
        real_path = files.fix_dev_path(virtual_path)
        uploaded_files = request.files.getlist("files[]")

        successful, failed = await upload_files(uploaded_files, real_path)

        if not successful and failed:
            raise Exception("All uploads failed")

        browser = FileBrowser()
        result = browser.get_files(real_path)
        result["current_path"] = virtual_path

        return {
            "message": (
                "Files uploaded successfully"
                if not failed
                else "Some files failed to upload"
            ),
            "data": result,
            "successful": successful,
            "failed": failed,
        }


async def upload_files(uploaded_files: list[FileStorage], current_path: str):
    browser = FileBrowser()
    successful, failed = browser.save_files(uploaded_files, current_path)
    return successful, failed


async def upload_file(current_path: str, filename: str, base64_content: str):
    real_path = files.fix_dev_path(current_path)
    browser = FileBrowser()
    return browser.save_file_b64(real_path, filename, base64_content)
PYTHON
echo "✓ upload_work_dir_files.py patched"

echo "Restarting Agent Zero service..."
systemctl --user restart agent-zero
echo "Done! Patches applied and service restarted."
