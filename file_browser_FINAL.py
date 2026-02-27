import os
from pathlib import Path
import shutil
import base64
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
            
            # DIAGNOSTIC LOG
            PrintStyle.hint(f"FileBrowser listing directory: {full_path}")

            if not full_path.exists():
                PrintStyle.error(f"Path does not exist: {full_path}")
                return {"entries": [], "current_path": current_path, "parent_path": ""}

            with os.scandir(full_path) as it:
                for entry in it:
                    if entry.name in ('.', '..'): continue
                    
                    try:
                        stat = entry.stat()
                        
                        # Virtual path mapping for UI
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

            # Sort: folders then files
            folders_res.sort(key=lambda x: x["name"].lower())
            files_res.sort(key=lambda x: x["name"].lower())
            
            all_entries = folders_res + files_res

            # Parent path calculation
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
