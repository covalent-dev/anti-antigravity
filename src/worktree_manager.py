import json
import os
import subprocess
import time
from pathlib import Path
from typing import Dict, List, Optional


class WorktreeManager:
    """Manage per-session git worktrees and branches."""

    def __init__(self, base_dir: Optional[str] = None) -> None:
        self.base_dir = Path(base_dir or "~/.orch-v2/worktrees").expanduser()

    def get_worktree_path(self, session_id: str) -> str:
        return str(self.base_dir / session_id)

    def create_worktree(self, session_id: str, repo_path: str, base_branch: str = "main") -> str:
        repo_path = str(Path(repo_path).resolve())
        self._ensure_repo(repo_path)

        worktree_path = Path(self.get_worktree_path(session_id))
        if worktree_path.exists():
            raise FileExistsError(f"worktree already exists: {worktree_path}")

        worktree_path.parent.mkdir(parents=True, exist_ok=True)
        branch = f"session/{session_id}"

        self._run_git(repo_path, ["worktree", "add", "-b", branch, str(worktree_path), base_branch])
        self._write_metadata(session_id, repo_path, branch, base_branch)
        return str(worktree_path)

    def destroy_worktree(self, session_id: str, delete_branch: bool = True) -> None:
        worktree_path = Path(self.get_worktree_path(session_id))
        metadata = self._read_metadata(session_id)
        repo_path = None
        branch = None
        if metadata:
            repo_path = metadata.get("repo_path")
            branch = metadata.get("branch")
        elif worktree_path.exists():
            repo_path = self._infer_repo_path_from_worktree(worktree_path)

        if worktree_path.exists() and repo_path:
            self._run_git(repo_path, ["worktree", "remove", "--force", str(worktree_path)])
        elif worktree_path.exists():
            raise RuntimeError("unable to determine repo path for worktree removal")

        if delete_branch and repo_path and branch:
            self._run_git(repo_path, ["branch", "-D", branch], check=False)

    def list_worktrees(self, repo_path: str) -> List[Dict[str, str]]:
        repo_path = str(Path(repo_path).resolve())
        self._ensure_repo(repo_path)
        result = self._run_git(repo_path, ["worktree", "list", "--porcelain"])

        entries: List[Dict[str, str]] = []
        current: Dict[str, str] = {}
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            key, _, value = line.partition(" ")
            if key == "worktree":
                if current:
                    entries.append(current)
                current = {"path": value}
            else:
                current[key] = value
        if current:
            entries.append(current)

        for entry in entries:
            meta_path = Path(entry["path"]) / ".orch-meta.json"
            if meta_path.exists():
                try:
                    with meta_path.open("r", encoding="utf-8") as handle:
                        meta = json.load(handle)
                    entry.update({
                        "session_id": meta.get("session_id", ""),
                        "repo_path": meta.get("repo_path", ""),
                        "branch": meta.get("branch", entry.get("branch", "")),
                        "base_branch": meta.get("base_branch", ""),
                    })
                except json.JSONDecodeError:
                    entry["meta_error"] = "invalid metadata"
        return entries

    def merge_worktree(self, session_id: str, target_branch: str = "main") -> None:
        metadata = self._read_metadata(session_id)
        if not metadata:
            raise FileNotFoundError("missing metadata for session")

        repo_path = metadata["repo_path"]
        branch = metadata.get("branch", f"session/{session_id}")

        self._run_git(repo_path, ["checkout", target_branch])
        self._run_git(repo_path, ["merge", branch])

    def _write_metadata(self, session_id: str, repo_path: str, branch: str, base_branch: str) -> None:
        metadata = {
            "session_id": session_id,
            "repo_path": repo_path,
            "branch": branch,
            "base_branch": base_branch,
            "created_at": int(time.time()),
        }
        meta_path = Path(self.get_worktree_path(session_id)) / ".orch-meta.json"
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2, sort_keys=True)

    def _read_metadata(self, session_id: str) -> Optional[Dict[str, str]]:
        meta_path = Path(self.get_worktree_path(session_id)) / ".orch-meta.json"
        if not meta_path.exists():
            return None
        with meta_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _ensure_repo(self, repo_path: str) -> None:
        result = self._run_git(repo_path, ["rev-parse", "--git-dir"], check=False)
        if result.returncode != 0:
            raise FileNotFoundError(f"not a git repo: {repo_path}")

    def _run_git(self, repo_path: str, args: List[str], check: bool = True) -> subprocess.CompletedProcess:
        result = subprocess.run(
            ["git", "-C", repo_path, *args],
            capture_output=True,
            text=True,
        )
        if check and result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return result

    def _infer_repo_path_from_worktree(self, worktree_path: Path) -> Optional[str]:
        result = self._run_git(str(worktree_path), ["rev-parse", "--git-common-dir"], check=False)
        if result.returncode != 0:
            return None
        common_dir = result.stdout.strip()
        if not common_dir:
            return None
        common_path = Path(common_dir)
        if not common_path.is_absolute():
            common_path = (worktree_path / common_dir).resolve()
        for parent in [common_path] + list(common_path.parents):
            if parent.name == ".git":
                return str(parent.parent)
        return None
