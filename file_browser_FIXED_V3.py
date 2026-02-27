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
        # Force base_dir to project root to ensure consistent path mapping
        self.base_dir = Path(files.get_base_dir())

    def _check_file_size(self, file) -> bool:
        try:
            file.seek(0, os.SEEK_END)
            size = file.tell()
            file.seek(0)
            return size <= self.MAX_FILE_SIZE
        except (AttributeError, IOError):
            return False

    def save_file_b64(self, current_path: str, filename: str, base64_content: str):
        try:
            # Resolve the target directory path
            target_file = Path(current_path).resolve() / filename
            
            os.makedirs(target_file.parent, exist_ok=True)
            # Save file
            with open(target_file, "wb") as file:
                file.write(base64.decodebytes(base64_content.encode()))
            return True
        except Exception as e:
            PrintStyle.error(f"Error saving file {filename}: {e}")
            return False

    def save_files(self, files_list: List, current_path: str = "") -> Tuple[List[str], List[str]]:
        """Save uploaded files and return successful and failed filenames"""
        successful = []
        failed = []

        try:
            # current_path is already absolute due to fix_dev_path in API handler
            target_dir = Path(current_path).resolve()
            os.makedirs(target_dir, exist_ok=True)

            for file in files_list:
                try:
                    if file and self._is_allowed_file(file.filename, file):
                        filename = secure_filename(file.filename)
                        file_path = target_dir / filename

                        file.save(str(file_path))
                        successful.append(filename)
                    else:
                        failed.append(file.filename)
                except Exception as e:
                    PrintStyle.error(f"Error saving file {file.filename}: {e}")
                    failed.append(file.filename)

            return successful, failed

        except Exception as e:
            PrintStyle.error(f"Error in save_files: {e}")
            return successful, failed

    def delete_file(self, file_path: str) -> bool:
        """Delete a file or empty directory"""
        try:
            full_path = Path(file_path).resolve()
            if os.path.exists(full_path):
                if os.path.isfile(full_path):
                    os.remove(full_path)
                elif os.path.isdir(full_path):
                    shutil.rmtree(full_path)
                return True
            return False
        except Exception as e:
            PrintStyle.error(f"Error deleting {file_path}: {e}")
            return False

    def _is_allowed_file(self, filename: str, file) -> bool:
        return True 

    def _get_file_extension(self, filename: str) -> str:
        return filename.rsplit('.', 1)[1].lower() if '.' in filename else ''

    def _get_files_via_ls(self, full_path: Path) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Get files and folders using ls command for better error handling"""
        files_res: List[Dict[str, Any]] = []
        folders: List[Dict[str, Any]] = []

        try:
            result = subprocess.run(
                ['ls', '-la', str(full_path)],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                PrintStyle.error(f"ls command failed: {result.stderr}")
                return files_res, folders

            # Use splitlines to avoid character mangling
            lines = result.stdout.strip().splitlines()
            if len(lines) <= 1:
                return files_res, folders

            for line in lines[1:]: 
                try:
                    if line.endswith(' .') or line.endswith(' ..'):
                        continue

                    parts = line.split()
                    if len(parts) < 9:
                        continue

                    permissions = parts[0]
                    is_symlink = permissions.startswith('l')
                    
                    if is_symlink:
                        full_name_part = ' '.join(parts[8:])
                        if ' -> ' in full_name_part:
                            filename = full_name_part.split(' -> ')[0]
                            symlink_target = full_name_part.split(' -> ')[1]
                        else:
                            filename = full_name_part
                            symlink_target = None
                    else:
                        filename = ' '.join(parts[8:])
                        symlink_target = None

                    if not filename:
                        continue

                    entry_path = full_path / filename

                    try:
                        stat_info = entry_path.stat()
                        
                        # Calculate virtual path for UI compatibility
                        try:
                            rel_to_base = entry_path.relative_to(self.base_dir)
                            virtual_path = os.path.join("/a0", str(rel_to_base))
                        except ValueError:
                            virtual_path = str(entry_path)

                        entry_data: Dict[str, Any] = {
                            "name": filename,
                            "path": virtual_path,
                            "modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat()
                        }

                        if is_symlink and symlink_target:
                            entry_data["symlink_target"] = symlink_target
                            entry_data["is_symlink"] = True

                        if entry_path.is_file():
                            entry_data.update({
                                "type": self._get_file_type(filename),
                                "size": stat_info.st_size,
                                "is_dir": False
                            })
                            files_res.append(entry_data)
                        elif entry_path.is_dir():
                            entry_data.update({
                                "type": "folder",
                                "size": 0,
                                "is_dir": True
                            })
                            folders.append(entry_data)

                    except (OSError, PermissionError, FileNotFoundError):
                        continue

                    if len(files_res) + len(folders) > 10000:
                        break

                except Exception:
                    continue

        except Exception as e:
            PrintStyle.error(f"Error running ls command: {e}")

        return files_res, folders

    def get_files(self, current_path: str = "") -> Dict:
        try:
            full_path = Path(current_path).resolve()
            
            files_list, folders_list = self._get_files_via_ls(full_path)
            all_entries = folders_list + files_list

            parent_path = ""
            try:
                if full_path != self.base_dir:
                    rel_parent = full_path.parent.relative_to(self.base_dir)
                    parent_path = os.path.join("/a0", str(rel_parent))
                else:
                    parent_path = ""
            except Exception:
                parent_path = ""

            return {
                "entries": all_entries,
                "current_path": current_path,
                "parent_path": parent_path
            }

        except Exception as e:
            PrintStyle.error(f"Error reading directory: {e}")
            return {"entries": [], "current_path": "", "parent_path": ""}

    def get_full_path(self, file_path: str, allow_dir: bool = False) -> str:
        return str(Path(file_path).resolve())

    def _get_file_type(self, filename: str) -> str:
        ext = self._get_file_extension(filename)
        for file_type, extensions in self.ALLOWED_EXTENSIONS.items():
            if ext in extensions:
                return file_type
        return 'unknown'
