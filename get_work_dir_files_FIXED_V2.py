from python.helpers.api import ApiHandler, Request, Response
from python.helpers.file_browser import FileBrowser
from python.helpers import runtime, files

class GetWorkDirFiles(ApiHandler):
    async def process(self, input: dict, request: Request) -> dict | Response:
        # Map virtual /a0/ path to real filesystem path
        current_path = files.fix_dev_path(input.get("path", ""))
        
        browser = FileBrowser()
        # Ensure we are passing a relative path to FileBrowser if it's based on /
        # or handle the absolute path correctly.
        result = browser.get_files(current_path)
        
        # We need to return the virtual path back to the UI
        result["current_path"] = input.get("path", "")
        
        return {
            "message": "Files retrieved successfully",
            "data": result
        }

def get_files(current_path: str = ""):
    # This is used by other internal components
    real_path = files.fix_dev_path(current_path)
    browser = FileBrowser()
    return browser.get_files(real_path)
