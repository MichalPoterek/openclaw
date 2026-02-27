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

        # Return files using the virtual path for the UI
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
