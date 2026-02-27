from python.helpers.api import ApiHandler, Request, Response
from python.helpers.file_browser import FileBrowser
from python.helpers import runtime, files
import os

class GetWorkDirFiles(ApiHandler):
    async def process(self, input: dict, request: Request) -> dict | Response:
        # Agent Zero UI often sends empty path or root-relative path
        path_in = input.get("path", "")
        
        # Robust path resolution
        if not path_in or path_in in ["/a0", "/a0/", "/", "."]:
            real_path = files.get_base_dir()
            display_path = "/a0"
        else:
            real_path = files.fix_dev_path(path_in)
            display_path = path_in if path_in.startswith("/a0") else "/a0"
        
        browser = FileBrowser()
        result = browser.get_files(real_path)
        
        # Crucial for UI: match exactly what the frontend requested
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
