from python.helpers.api import ApiHandler, Request, Response
from python.helpers.file_browser import FileBrowser
from python.helpers import runtime, files
import os

class GetWorkDirFiles(ApiHandler):
    async def process(self, input: dict, request: Request) -> dict | Response:
        path_in = input.get("path", "")
        # If path is empty or just /a0, use project root
        if not path_in or path_in == "/a0" or path_in == "/a0/":
            real_path = files.get_base_dir()
        else:
            real_path = files.fix_dev_path(path_in)
        
        browser = FileBrowser()
        result = browser.get_files(real_path)
        
        # Ensure current_path in result matches what UI expects
        result["current_path"] = path_in if path_in.startswith("/a0") else "/a0"
        
        return {
            "message": "Files retrieved successfully",
            "data": result
        }

def get_files(current_path: str = ""):
    real_path = files.fix_dev_path(current_path) if current_path.startswith("/a0") else files.get_abs_path(current_path)
    browser = FileBrowser()
    return browser.get_files(real_path)
