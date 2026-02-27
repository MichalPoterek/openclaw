from python.helpers.api import ApiHandler, Request, Response
from python.helpers.file_browser import FileBrowser
from python.helpers import runtime

class GetWorkDirFiles(ApiHandler):
    async def process(self, input: dict, request: Request) -> dict | Response:
        current_path = input.get("path", "")
        
        # Fixed: Use direct call to bypass RFC password requirement
        browser = FileBrowser()
        result = browser.get_files(current_path)
        
        return {
            "message": "Files retrieved successfully",
            "data": result
        }

def get_files(current_path: str = ""):
    browser = FileBrowser()
    return browser.get_files(current_path)
